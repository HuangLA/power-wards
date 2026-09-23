const { app, BrowserWindow, dialog, ipcMain, net, protocol } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DATA_DIR = process.env.POWER_WARDS_DATA_DIR || path.join(app.getPath('userData'), 'power-wards');
const PROFILES_DIR = path.join(DATA_DIR, 'profiles');
const SCREENSHOTS_DIR = path.join(DATA_DIR, 'screenshots');
const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' };
const EXT_TYPES = Object.fromEntries(Object.entries(IMAGE_TYPES).map(([type, ext]) => [ext, type]));

function isSafeId(id) {
  return typeof id === 'string' && id.length > 0 && id.length <= 120 && /^[\w-]+$/.test(id);
}

function profilePath(id) {
  if (!isSafeId(id)) throw new Error('无效的 Profile 标识');
  return path.join(PROFILES_DIR, `${id}.json`);
}

function screenshotDir(profileId) {
  if (!isSafeId(profileId)) throw new Error('无效的 Profile 标识');
  return path.join(SCREENSHOTS_DIR, profileId);
}

async function ensureDirs() {
  await fsp.mkdir(PROFILES_DIR, { recursive: true });
  await fsp.mkdir(SCREENSHOTS_DIR, { recursive: true });
}

function toMeta(profile) {
  return {
    id: profile.id,
    name: profile.name,
    mapVersion: profile.mapVersion,
    wardCount: Array.isArray(profile.wards) ? profile.wards.length : 0,
    updatedAt: profile.updatedAt,
  };
}

async function listProfiles() {
  await ensureDirs();
  const files = await fsp.readdir(PROFILES_DIR);
  const metas = [];
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    try {
      const profile = JSON.parse(await fsp.readFile(path.join(PROFILES_DIR, file), 'utf-8'));
      metas.push(toMeta(profile));
    } catch {
      // 跳过损坏的 Profile 文件，不影响其它资料
    }
  }
  metas.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return metas;
}

async function loadProfile(id) {
  try {
    return JSON.parse(await fsp.readFile(profilePath(id), 'utf-8'));
  } catch {
    return null;
  }
}

async function saveProfile(profile) {
  await ensureDirs();
  const target = profilePath(profile.id);
  const tmp = `${target}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(profile, null, 2), 'utf-8');
  await fsp.rename(tmp, target);
}

async function deleteProfile(id) {
  await fsp.rm(profilePath(id), { force: true });
  await fsp.rm(screenshotDir(id), { recursive: true, force: true });
}

function shotFile(profileId, screenshotId, ext) {
  if (!isSafeId(screenshotId)) throw new Error('无效的截图标识');
  return path.join(screenshotDir(profileId), `${screenshotId}${ext}`);
}

async function findShotFile(profileId, screenshotId) {
  for (const ext of Object.keys(EXT_TYPES)) {
    const file = shotFile(profileId, screenshotId, ext);
    try {
      await fsp.access(file);
      return file;
    } catch {
      // 尝试下一个扩展名
    }
  }
  return null;
}

async function putScreenshot(profileId, _wardId, screenshotId, data, type) {
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new Error('不支持的截图格式');
  const buffer = Buffer.from(data);
  const dir = screenshotDir(profileId);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(shotFile(profileId, screenshotId, ext), buffer);
}

async function getScreenshot(profileId, screenshotId) {
  const file = await findShotFile(profileId, screenshotId);
  if (!file) return null;
  const data = await fsp.readFile(file);
  return { data, type: EXT_TYPES[path.extname(file)] };
}

async function deleteScreenshot(profileId, screenshotId) {
  const file = await findShotFile(profileId, screenshotId);
  if (file) await fsp.rm(file, { force: true });
}

async function listScreenshots(profileId) {
  try {
    const files = await fsp.readdir(screenshotDir(profileId));
    return files.filter((file) => EXT_TYPES[path.extname(file)]).map((file) => path.basename(file, path.extname(file)));
  } catch {
    return [];
  }
}

async function copyScreenshots(fromProfileId, toProfileId, screenshotIds) {
  for (const id of screenshotIds) {
    const source = await findShotFile(fromProfileId, id);
    if (!source) continue;
    const dir = screenshotDir(toProfileId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.copyFile(source, path.join(dir, path.basename(source)));
  }
}

function registerIpc() {
  ipcMain.handle('storage:listProfiles', () => listProfiles());
  ipcMain.handle('storage:loadProfile', (_event, id) => loadProfile(id));
  ipcMain.handle('storage:saveProfile', (_event, profile) => saveProfile(profile));
  ipcMain.handle('storage:deleteProfile', (_event, id) => deleteProfile(id));
  ipcMain.handle('storage:putScreenshot', (_event, profileId, wardId, screenshotId, data, type) =>
    putScreenshot(profileId, wardId, screenshotId, data, type),
  );
  ipcMain.handle('storage:getScreenshot', async (_event, profileId, screenshotId) => {
    const result = await getScreenshot(profileId, screenshotId);
    return result ? { data: result.data.buffer.slice(result.data.byteOffset, result.data.byteOffset + result.data.byteLength), type: result.type } : null;
  });
  ipcMain.handle('storage:deleteScreenshot', (_event, profileId, screenshotId) => deleteScreenshot(profileId, screenshotId));
  ipcMain.handle('storage:listScreenshots', (_event, profileId) => listScreenshots(profileId));
  ipcMain.handle('storage:copyScreenshots', (_event, fromId, toId, ids) => copyScreenshots(fromId, toId, ids));

  ipcMain.handle('dialog:exportFile', async (event, fileName, content) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: fileName,
      filters: [{ name: 'Power Wards 分享文件', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return null;
    await fsp.writeFile(result.filePath, content, 'utf-8');
    return result.filePath;
  });

  ipcMain.handle('dialog:importFile', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Power Wards 分享文件', extensions: ['json'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const stat = await fsp.stat(filePath);
    if (stat.size > MAX_IMPORT_BYTES) throw new Error('文件过大，超出导入限制');
    return { name: path.basename(filePath), content: await fsp.readFile(filePath, 'utf-8') };
  });
}

let allowClose = false;

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function registerAppProtocol() {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    const file = path.normalize(path.join(__dirname, '..', 'dist', pathname));
    const distRoot = path.normalize(path.join(__dirname, '..', 'dist'));
    if (!file.startsWith(distRoot)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'POWER WARDS · 眼位地图编辑器',
    backgroundColor: '#10141b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault();
      win.webContents.send('app:close-request');
    }
  });

  ipcMain.on('app:confirm-close', () => {
    allowClose = true;
    win.close();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    win.loadURL(devUrl);
  } else {
    win.loadURL('app://power-wards/index.html');
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
