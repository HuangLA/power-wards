import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_TYPES = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);
const EXT_TYPES = new Map([...IMAGE_TYPES].map(([type, ext]) => [ext, type]));
const CATEGORY_KEYS = new Set(['radiant-offense', 'radiant-defense', 'dire-offense', 'dire-defense']);
const WARD_COLORS = new Set(['#56b6f7', '#f7b756', '#f77056', '#4cd2c0']);
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
const MAX_PROFILE_BYTES = 64 * 1024 * 1024;
const MAX_WARDS = 2000;
const ID_PATTERN = /^[\w-]{1,120}$/;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function defaultDataDir() {
  if (process.env.POWER_WARDS_DATA_DIR) return path.resolve(process.env.POWER_WARDS_DATA_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Power Wards', 'data');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Power Wards', 'data');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'power-wards');
}

function assertSafeId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id) || id === '.' || id === '..') throw new HttpError(400, '标识无效');
  return id;
}

function imageSignatureMatches(type, body) {
  if (type === 'image/png') return body.length >= 8 && body.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return body.length >= 3 && body[0] === 0xff && body[1] === 0xd8 && body[2] === 0xff;
  if (type === 'image/webp') return body.length >= 12 && body.toString('ascii', 0, 4) === 'RIFF' && body.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateProfile(profile, expectedId) {
  if (!isRecord(profile) || profile.id !== expectedId) throw new HttpError(400, 'Profile 数据无效');
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0 || profile.name.length > 100) throw new HttpError(400, 'Profile 名称无效');
  if (typeof profile.mapVersion !== 'string' || profile.mapVersion.length > 32) throw new HttpError(400, '地图版本无效');
  if (!Array.isArray(profile.wards) || profile.wards.length > MAX_WARDS) throw new HttpError(400, '眼位数量无效');
  if (typeof profile.createdAt !== 'string' || typeof profile.updatedAt !== 'string') throw new HttpError(400, 'Profile 时间字段无效');

  const wardIds = new Set();
  for (const ward of profile.wards) {
    if (!isRecord(ward) || typeof ward.id !== 'string' || !ID_PATTERN.test(ward.id) || wardIds.has(ward.id)) throw new HttpError(400, '眼位标识无效或重复');
    wardIds.add(ward.id);
    if (!Number.isFinite(ward.x) || ward.x < 0 || ward.x > 1 || !Number.isFinite(ward.y) || ward.y < 0 || ward.y > 1) throw new HttpError(400, '眼位坐标无效');
    if (typeof ward.name !== 'string' || ward.name.length > 200 || typeof ward.description !== 'string' || ward.description.length > 20000) throw new HttpError(400, '眼位文字字段无效');
    if (!WARD_COLORS.has(ward.color)) throw new HttpError(400, '眼位颜色无效');
    if (!Array.isArray(ward.categories) || ward.categories.some((item) => !CATEGORY_KEYS.has(item))) throw new HttpError(400, '眼位分类无效');
    if (!Array.isArray(ward.tags) || ward.tags.length > 50 || ward.tags.some((tag) => typeof tag !== 'string' || tag.length > 100)) throw new HttpError(400, '眼位标签无效');
    if (!Array.isArray(ward.screenshotIds) || ward.screenshotIds.length > 10 || ward.screenshotIds.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) throw new HttpError(400, '眼位截图关联无效');
    if (typeof ward.createdAt !== 'string' || typeof ward.updatedAt !== 'string') throw new HttpError(400, '眼位时间字段无效');
  }
  return profile;
}

async function readBody(request, limit) {
  const declared = Number(request.headers['content-length'] || 0);
  if (Number.isFinite(declared) && declared > limit) {
    request.resume();
    throw new HttpError(413, '请求内容超过大小限制');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, '请求内容超过大小限制');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function sendJson(response, status, data) {
  const body = Buffer.from(JSON.stringify(data));
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(body);
}

function trustedLocalOrigin(request, servicePort) {
  const hostHeader = request.headers.host;
  if (!hostHeader) return false;
  let host;
  try {
    host = new URL(`http://${hostHeader}`);
  } catch {
    return false;
  }
  if (!['localhost', '127.0.0.1'].includes(host.hostname)) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  return originAllowed(origin, servicePort);
}

function originAllowed(origin, servicePort) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'http:'
      && ['localhost', '127.0.0.1'].includes(parsed.hostname)
      && (parsed.port === String(servicePort) || parsed.port === '5173');
  } catch {
    return false;
  }
}

function contentTypeFor(file) {
  const extension = path.extname(file).toLowerCase();
  return new Map([
    ['.html', 'text/html; charset=utf-8'],
    ['.js', 'text/javascript; charset=utf-8'],
    ['.css', 'text/css; charset=utf-8'],
    ['.json', 'application/json; charset=utf-8'],
    ['.png', 'image/png'],
    ['.jpg', 'image/jpeg'],
    ['.jpeg', 'image/jpeg'],
    ['.webp', 'image/webp'],
    ['.svg', 'image/svg+xml'],
    ['.ico', 'image/x-icon'],
  ]).get(extension) || 'application/octet-stream';
}

async function serveStatic(request, response, staticDir) {
  if (!staticDir || !['GET', 'HEAD'].includes(request.method || '')) throw new HttpError(404, '找不到页面');
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, '请求路径无效');
  }
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const root = path.resolve(staticDir);
  let target = path.resolve(root, relative);
  if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(404, '找不到页面');
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) target = path.join(target, 'index.html');
    await fs.access(target);
  } catch {
    if (path.extname(pathname)) throw new HttpError(404, '找不到页面');
    target = path.join(root, 'index.html');
  }
  const data = await fs.readFile(target);
  response.writeHead(200, {
    'Content-Type': contentTypeFor(target),
    'Content-Length': data.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  response.end(request.method === 'HEAD' ? undefined : data);
}

export async function createLocalServer({ dataDir = defaultDataDir(), staticDir = path.join(APP_DIR, 'dist'), port = 5173, apiOnly = false } = {}) {
  const resolvedDataDir = path.resolve(dataDir);
  const profilesDir = path.join(resolvedDataDir, 'profiles');
  const screenshotsDir = path.join(resolvedDataDir, 'screenshots');
  await fs.mkdir(profilesDir, { recursive: true });
  await fs.mkdir(screenshotsDir, { recursive: true });

  const instanceFile = path.join(resolvedDataDir, 'instance-id');
  let instanceId;
  try {
    instanceId = (await fs.readFile(instanceFile, 'utf8')).trim();
    if (!ID_PATTERN.test(instanceId)) throw new Error('invalid instance id');
  } catch {
    instanceId = randomUUID();
    const temp = `${instanceFile}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, instanceId, { flag: 'wx' });
    try {
      await fs.rename(temp, instanceFile);
    } catch (error) {
      await fs.rm(temp, { force: true });
      if (error.code !== 'EEXIST') throw error;
      instanceId = (await fs.readFile(instanceFile, 'utf8')).trim();
    }
  }

  const profilePath = (id) => path.join(profilesDir, `${assertSafeId(id)}.json`);
  const screenshotDir = (id) => path.join(screenshotsDir, assertSafeId(id));
  const screenshotPath = (profileId, screenshotId, extension) => path.join(screenshotDir(profileId), `${assertSafeId(screenshotId)}${extension}`);

  async function saveAtomic(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, data, { flag: 'wx' });
    try {
      await fs.rename(temp, file);
    } catch (error) {
      await fs.rm(temp, { force: true });
      throw error;
    }
  }

  async function findScreenshot(profileId, screenshotId) {
    for (const extension of EXT_TYPES.keys()) {
      const file = screenshotPath(profileId, screenshotId, extension);
      try {
        await fs.access(file);
        return file;
      } catch {}
    }
    return null;
  }

  async function listProfiles() {
    const entries = await fs.readdir(profilesDir, { withFileTypes: true });
    const results = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const id = entry.name.slice(0, -5);
      try {
        assertSafeId(id);
        const profile = JSON.parse(await fs.readFile(path.join(profilesDir, entry.name), 'utf8'));
        validateProfile(profile, id);
        results.push({ id, name: profile.name, mapVersion: profile.mapVersion, wardCount: profile.wards.length, updatedAt: profile.updatedAt });
      } catch (error) {
        console.error(`跳过无效的 Profile 文件 ${entry.name}: ${error.message}`);
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async function getProfile(id) {
    try {
      const profile = JSON.parse(await fs.readFile(profilePath(id), 'utf8'));
      validateProfile(profile, id);
      return profile;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function routeApi(request, response) {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    if (!trustedLocalOrigin(request, actualPort)) throw new HttpError(403, '只允许本机应用访问数据接口');
    const origin = request.headers.origin;
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '600',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end();
      return;
    }
    const url = new URL(request.url || '/', `http://127.0.0.1:${port}`);
    let parts;
    try {
      parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      throw new HttpError(400, '请求路径无效');
    }
    if (parts[0] !== 'api' || parts[1] !== 'v1') throw new HttpError(404, '找不到接口');

    if (request.method === 'GET' && parts.join('/') === 'api/v1/health') {
      return sendJson(response, 200, { service: 'power-wards-local', apiVersion: 1, instanceId });
    }

    if (parts.length === 3 && parts[2] === 'profiles' && request.method === 'GET') {
      return sendJson(response, 200, await listProfiles());
    }

    if (parts.length === 4 && parts[2] === 'profiles') {
      const id = assertSafeId(parts[3]);
      if (request.method === 'GET') {
        const profile = await getProfile(id);
        return profile ? sendJson(response, 200, profile) : sendJson(response, 404, { error: 'Profile 不存在' });
      }
      if (request.method === 'PUT') {
        const body = await readBody(request, MAX_PROFILE_BYTES);
        let profile;
        try {
          profile = JSON.parse(body.toString('utf8'));
        } catch {
          throw new HttpError(400, 'Profile JSON 无法解析');
        }
        validateProfile(profile, id);
        await saveAtomic(profilePath(id), `${JSON.stringify(profile, null, 2)}\n`);
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'DELETE') {
        await fs.rm(profilePath(id), { force: true });
        await fs.rm(screenshotDir(id), { recursive: true, force: true });
        return sendJson(response, 200, { ok: true });
      }
    }

    if (parts.length === 5 && parts[2] === 'profiles' && parts[4] === 'screenshots' && request.method === 'GET') {
      const id = assertSafeId(parts[3]);
      let files = [];
      try {
        files = await fs.readdir(screenshotDir(id));
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return sendJson(response, 200, files.filter((file) => EXT_TYPES.has(path.extname(file).toLowerCase())).map((file) => path.basename(file, path.extname(file))));
    }

    if (parts.length === 6 && parts[2] === 'profiles' && parts[4] === 'screenshots') {
      const profileId = assertSafeId(parts[3]);
      const screenshotId = assertSafeId(parts[5]);
      if (request.method === 'PUT') {
        const type = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        const extension = IMAGE_TYPES.get(type);
        if (!extension) throw new HttpError(415, '不支持的截图格式');
        const body = await readBody(request, MAX_SCREENSHOT_BYTES);
        if (body.length === 0) throw new HttpError(400, '截图内容为空');
        if (!imageSignatureMatches(type, body)) throw new HttpError(400, '截图内容与文件格式不匹配');
        await saveAtomic(screenshotPath(profileId, screenshotId, extension), body);
        return sendJson(response, 200, { ok: true });
      }
      if (request.method === 'GET') {
        const file = await findScreenshot(profileId, screenshotId);
        if (!file) throw new HttpError(404, '截图不存在');
        const data = await fs.readFile(file);
        response.writeHead(200, { 'Content-Type': EXT_TYPES.get(path.extname(file).toLowerCase()), 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(data);
        return;
      }
      if (request.method === 'DELETE') {
        const file = await findScreenshot(profileId, screenshotId);
        if (file) await fs.rm(file, { force: true });
        return sendJson(response, 200, { ok: true });
      }
    }

    if (parts.length === 6 && parts[2] === 'profiles' && parts[4] === 'copy-screenshots' && request.method === 'POST') {
      const fromId = assertSafeId(parts[3]);
      const toId = assertSafeId(parts[5]);
      const body = await readBody(request, 256 * 1024);
      let data;
      try {
        data = JSON.parse(body.toString('utf8'));
      } catch {
        throw new HttpError(400, '截图复制请求无效');
      }
      if (!isRecord(data) || !Array.isArray(data.ids) || data.ids.length > MAX_WARDS * 10 || data.ids.some((id) => typeof id !== 'string' || !ID_PATTERN.test(id))) {
        throw new HttpError(400, '截图列表无效');
      }
      await fs.mkdir(screenshotDir(toId), { recursive: true });
      for (const id of data.ids) {
        const source = await findScreenshot(fromId, id);
        if (source) await fs.copyFile(source, path.join(screenshotDir(toId), path.basename(source)));
      }
      return sendJson(response, 200, { ok: true });
    }

    throw new HttpError(404, '找不到接口');
  }

  const server = createServer((request, response) => {
    void (async () => {
      try {
        const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
        if (pathname.startsWith('/api/')) return await routeApi(request, response);
        if (apiOnly) throw new HttpError(404, '找不到页面');
        return await serveStatic(request, response, staticDir);
      } catch (error) {
        if (response.headersSent) {
          response.destroy();
          return;
        }
        const status = error instanceof HttpError ? error.status : 500;
        if (status >= 500) console.error('本机服务请求失败', error);
        sendJson(response, status, { error: error instanceof HttpError ? error.message : '本机服务暂时无法处理请求' });
      }
    })();
  });

  return { server, dataDir: resolvedDataDir, instanceId };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--port') options.port = Number(args[++index]);
    else if (args[index] === '--data-dir') options.dataDir = path.resolve(args[++index]);
    else if (args[index] === '--api-only') options.apiOnly = true;
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const port = options.port ?? Number(process.env.POWER_WARDS_PORT || 5173);
  const created = await createLocalServer({ ...options, port });
  const listenPort = port;
  created.server.listen(listenPort, '127.0.0.1', () => {
    if (options.apiOnly) console.log(`Power Wards 本机数据 API 已启动（仅供本地网页访问）：http://127.0.0.1:${listenPort}/api/v1`);
    else console.log(`Power Wards 本机网页服务已启动：http://localhost:${listenPort}`);
    console.log(`本地数据目录：${created.dataDir}`);
  });
  const shutdown = () => created.server.close(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
