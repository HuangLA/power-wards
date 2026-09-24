// Build a portable Windows bundle from the Electron binary already installed for this project.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(appDir, 'package.json'), 'utf-8'));
const releaseDir = path.join(appDir, 'release');
const bundleName = `Power-Wards-v${manifest.version}-win-x64`;
const bundleDir = path.join(releaseDir, bundleName);
const archiveName = `${bundleName}.zip`;
const archivePath = path.join(releaseDir, archiveName);
const electronDist = path.join(appDir, 'node_modules', 'electron', 'dist');

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Windows 客户端须在 Windows x64 环境中打包');
}
if (!(await exists(path.join(electronDist, 'electron.exe')))) {
  throw new Error('缺少 Electron Windows 运行时，请先在 app/ 运行 npm install');
}
if (!(await exists(path.join(appDir, 'dist', 'index.html')))) {
  throw new Error('缺少网页构建，请先运行 npm run build');
}
if (await exists(bundleDir) || await exists(archivePath)) {
  throw new Error(`目标版本已存在：${bundleDir}；请先检查现有构建，不会自动覆盖`);
}

await mkdir(releaseDir, { recursive: true });
await cp(electronDist, bundleDir, { recursive: true });
const resourcesApp = path.join(bundleDir, 'resources', 'app');
await mkdir(resourcesApp, { recursive: true });
await cp(path.join(appDir, 'dist'), path.join(resourcesApp, 'dist'), { recursive: true });
await cp(path.join(appDir, 'electron'), path.join(resourcesApp, 'electron'), { recursive: true });
await writeFile(path.join(resourcesApp, 'package.json'), `${JSON.stringify({
  name: 'power-wards',
  productName: 'Power Wards',
  version: manifest.version,
  private: true,
  main: 'electron/main.cjs',
}, null, 2)}\n`, 'utf-8');
await rename(path.join(bundleDir, 'electron.exe'), path.join(bundleDir, 'Power Wards.exe'));

await run('tar.exe', ['-a', '-c', '-f', archiveName, bundleName], { cwd: releaseDir });
const hash = createHash('sha256');
for await (const chunk of createReadStream(archivePath)) hash.update(chunk);
const digest = hash.digest('hex');
await writeFile(path.join(releaseDir, `${archiveName}.sha256`), `${digest}  ${archiveName}\n`, 'utf-8');

console.log(`Windows 便携版：${archivePath}`);
console.log(`SHA-256：${digest}`);
