import { spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiPort = Number(process.env.POWER_WARDS_API_PORT || 4174);
const webPort = Number(process.env.POWER_WARDS_FRONTEND_PORT || 5173);
const serverPath = path.join(appDir, 'local', 'server.mjs');
const vitePath = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js');
const env = { ...process.env, POWER_WARDS_API_PORT: String(apiPort), VITE_LOCAL_API_ORIGIN: `http://127.0.0.1:${apiPort}` };

const api = spawn(process.execPath, [serverPath, '--api-only', '--port', String(apiPort)], { cwd: appDir, env, stdio: 'inherit' });
let web;
let shuttingDown = false;

function stop() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (web && web.exitCode === null) web.kill();
  if (api.exitCode === null) api.kill();
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

try {
  let ready = false;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && !ready) {
    if (api.exitCode !== null) throw new Error(`本机数据服务提前退出，退出码 ${api.exitCode}`);
    ready = await fetch(`http://127.0.0.1:${apiPort}/api/v1/health`).then((response) => response.ok).catch(() => false);
    if (!ready) await delay(200);
  }
  if (!ready) throw new Error('等待本机数据服务超时');

  web = spawn(process.execPath, [vitePath, '--host', 'localhost', '--port', String(webPort), '--strictPort'], { cwd: appDir, env, stdio: 'inherit' });
  const result = await new Promise((resolve) => {
    web.once('exit', (code, signal) => resolve({ code, signal }));
    api.once('exit', (code, signal) => {
      if (!shuttingDown) {
        console.error(`本机数据服务已退出（${signal || code}）。`);
        stop();
      }
    });
  });
  if (result.signal) process.exitCode = 1;
  else process.exitCode = result.code ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  stop();
}
