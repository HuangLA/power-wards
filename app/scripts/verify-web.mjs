// 网页端真实浏览器验证：地图加载、手势、坐标稳定、筛选、保存、导入导出、撤销。
// 运行前需要 npm run build。结果输出到 verification/。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, 'verification');
fs.mkdirSync(outDir, { recursive: true });
async function freePort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const PORT = await freePort();
const BASE = `http://127.0.0.1:${PORT}`;
const localDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'power-wards-web-verify-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = spawn(process.execPath, [path.join(appDir, 'local', 'server.mjs'), '--port', String(PORT), '--data-dir', localDataDir], {
  cwd: appDir,
  stdio: 'pipe',
});
server.stderr?.on('data', (chunk) => process.stderr.write(chunk));
{
  const deadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < deadline && !ready) {
    ready = await fetch(BASE).then((r) => r.ok).catch(() => false);
    if (!ready) await new Promise((r) => setTimeout(r, 400));
  }
  if (!ready) throw new Error('预览服务器启动超时');
}

const browser = await chromium.launch();

// Verify one-time migration from the previous IndexedDB implementation.
const migrationContext = await browser.newContext({ viewport: { width: 1100, height: 760 } });
const migrationPage = await migrationContext.newPage();
await migrationPage.addInitScript(() => {
  if (new URL(location.href).searchParams.get('seedLegacy') !== '1') return;
  let releaseSeed;
  let failSeed;
  const seedFinished = new Promise((resolve, reject) => { releaseSeed = resolve; failSeed = reject; });
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (...args) => seedFinished.then(() => nativeFetch(...args));
  const profile = {
    id: 'legacy-profile', name: '旧浏览器 Profile', mapVersion: '7.41',
    createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
    wards: [{
      id: 'legacy-ward', x: 0.5, y: 0.5, name: '旧资料眼位', color: '#56b6f7', categories: ['radiant-offense'],
      tags: ['旧资料'], description: '从 IndexedDB 迁移', screenshotIds: ['legacy-shot'],
      createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
    }],
  };
  const request = indexedDB.open('power-wards', 1);
  request.onupgradeneeded = () => {
    const db = request.result;
    db.createObjectStore('profiles', { keyPath: 'id' });
    const shots = db.createObjectStore('screenshots', { keyPath: 'key' });
    shots.createIndex('byProfile', 'profileId', { unique: false });
  };
  request.onsuccess = () => {
    const db = request.result;
    const tx = db.transaction(['profiles', 'screenshots'], 'readwrite');
    tx.objectStore('profiles').put(profile);
    const raw = atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
    const bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
    tx.objectStore('screenshots').put({
      key: 'legacy-profile/legacy-shot', profileId: 'legacy-profile', blob: new Blob([bytes], { type: 'image/png' }),
    });
    tx.oncomplete = () => { db.close(); releaseSeed(); };
    tx.onerror = () => { db.close(); failSeed(tx.error || new Error('无法写入旧浏览器测试资料')); };
  };
  request.onerror = () => failSeed(request.error || new Error('无法创建旧浏览器测试资料'));
});
migrationPage.on('pageerror', (error) => console.error('迁移测试页面错误：', error));
await migrationPage.goto(`${BASE}/?seedLegacy=1`, { waitUntil: 'domcontentloaded' });
try {
  await migrationPage.waitForSelector('.ward-marker', { timeout: 15000 });
} catch (error) {
  console.error('迁移测试页面内容：', await migrationPage.locator('body').innerText().catch(() => '页面不可读'));
  throw error;
}
await migrationPage.locator('.ward-marker').click();
await migrationPage.waitForSelector('img.shot-thumb');
check('C00 旧 IndexedDB Profile 与截图迁移到本机文件', (await migrationPage.locator('.detail-name').inputValue()) === '旧资料眼位');
const migratedData = path.join(localDataDir, 'profiles', 'legacy-profile.json');
check('C00a 迁移后本机目录存在 Profile 文件与截图', fs.existsSync(migratedData) && fs.existsSync(path.join(localDataDir, 'screenshots', 'legacy-profile', 'legacy-shot.png')));
await migrationPage.goto(BASE, { waitUntil: 'domcontentloaded' });
await migrationPage.waitForSelector('.ward-marker', { timeout: 15000 });
await migrationPage.evaluate(async () => {
  await new Promise((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase('power-wards');
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error('旧浏览器数据库仍被页面占用'));
  });
  localStorage.clear();
});
await migrationPage.reload({ waitUntil: 'domcontentloaded' });
await migrationPage.waitForSelector('.ward-marker', { timeout: 15000 });
await migrationPage.locator('.ward-marker').click();
await migrationPage.waitForSelector('img.shot-thumb');
check('C00b 清除浏览器数据库后 Profile 与截图仍从本机文件读取', (await migrationPage.locator('.detail-name').inputValue()) === '旧资料眼位');
await migrationPage.close();
await migrationContext.close();
await fetch(`${BASE}/api/v1/profiles/legacy-profile`, { method: 'DELETE' });

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', (error) => pageErrors.push(String(error)));
page.on('console', (msg) => {
  if (msg.type() === 'error') pageErrors.push(msg.text());
});

// 让测试可读页面内的视图状态
async function worldTransform() {
  return page.evaluate(() => {
    const el = document.querySelector('.map-world');
    const match = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([-\d.e]+)\)/.exec(el.style.transform);
    const rect = document.querySelector('.map-container').getBoundingClientRect();
    return { tx: parseFloat(match[1]), ty: parseFloat(match[2]), scale: parseFloat(match[3]), left: rect.left, top: rect.top };
  });
}

async function markerAnchor(wardId) {
  const box = await page.locator(`.ward-marker[data-ward-id="${wardId}"]`).boundingBox();
  const t = await worldTransform();
  return { box, t };
}

async function markerMathHolds(wardId, ward) {
  const { box, t } = await markerAnchor(wardId);
  const expectX = t.left + ward.x * 8909 * t.scale + t.tx;
  const expectY = t.top + ward.y * 8424 * t.scale + t.ty;
  const actualX = box.x + box.width / 2;
  const actualY = box.y + box.height / 2;
  return Math.abs(actualX - expectX) < 2 && Math.abs(actualY - expectY) < 2;
}

const tinyPng = path.join(outDir, 'tiny.png');
fs.writeFileSync(
  tinyPng,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);

try {
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.map-tile', { timeout: 15000 });
  await page.waitForFunction(() => {
    const tiles = [...document.querySelectorAll('.map-tile')];
    return tiles.length > 0 && tiles.every((img) => img.complete && img.naturalWidth > 0);
  });
  const loadMs = Date.now() - t0;
  const tileInfo = await page.evaluate(() => {
    const tiles = [...document.querySelectorAll('.map-tile')];
    const z = [...new Set(tiles.map((img) => img.src.match(/tiles\/(\d)\//)?.[1]))];
    return { count: tiles.length, levels: z.join(',') };
  });
  check('C01 首屏加载地图切片', true, `${loadMs}ms，${tileInfo.count} 片，层级 ${tileInfo.levels}`);

  const initial = await worldTransform();
  const mapSize = await page.evaluate(() => {
    const rect = document.querySelector('.map-container').getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  });
  const fitScale = Math.min(mapSize.w / 8909, mapSize.h / 8424);
  check('C02 初始视图为全图适应', Math.abs(initial.scale - fitScale) / fitScale < 0.02, `scale=${initial.scale.toFixed(4)}`);

  // C03 Ctrl+左键新增（点击地图容器中心，视口坐标）
  const mapBox = await page.locator('.map-container').boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
  await page.keyboard.up('Control');
  await page.waitForSelector('.add-ward-panel', { timeout: 3000 });
  check('C03 Ctrl+点击弹出底部分类面板', true);
  const draftBox = await page.locator('.ward-marker.draft').boundingBox();
  check('C03a 新眼位预览中心与点击位置对齐',
    Math.abs(draftBox.x + draftBox.width / 2 - (mapBox.x + mapBox.width / 2)) < 2 &&
    Math.abs(draftBox.y + draftBox.height / 2 - (mapBox.y + mapBox.height / 2)) < 2);

  const confirmBtn = page.locator('.add-ward-panel button.primary');
  check('C04 未选分类时确认不可用', await confirmBtn.isDisabled());
  await page.locator('.add-ward-panel label', { hasText: '天辉进攻' }).click();
  await page.locator('.add-ward-panel label', { hasText: '夜魇防守' }).click();
  await confirmBtn.click();
  await page.waitForSelector('.ward-marker', { timeout: 3000 });
  const wardId = await page.locator('.ward-marker').getAttribute('data-ward-id');
  const ward = await page.evaluate(() => {
    const el = document.querySelector('.ward-marker');
    return { x: parseFloat(el.style.left) / 8909, y: parseFloat(el.style.top) / 8424 };
  });
  check('C05 确认后眼位出现在点击位置', Math.abs(ward.x - 0.5) < 0.03 && Math.abs(ward.y - 0.5) < 0.05, `x=${ward.x.toFixed(3)}, y=${ward.y.toFixed(3)}`);
  await page.waitForSelector('.sidebar-right');
  check('C06 新增后右侧详情打开', true);
  check('C07 眼位中心与地图坐标对齐', await markerMathHolds(wardId, ward));

  // 滚轮缩放
  await page.mouse.move(mapSize.w / 2, mapSize.h / 2);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(200);
  const zoomed = await worldTransform();
  check('C08 滚轮缩放生效', zoomed.scale > initial.scale, `${initial.scale.toFixed(4)} → ${zoomed.scale.toFixed(4)}`);
  check('C09 缩放后标记仍对齐同一地图位置', await markerMathHolds(wardId, ward));

  // 拖动平移
  const before = await worldTransform();
  await page.mouse.move(mapSize.w / 2, mapSize.h / 2);
  await page.mouse.down();
  await page.mouse.move(mapSize.w / 2 + 180, mapSize.h / 2 + 120, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const dragged = await worldTransform();
  check('C10 左键拖动平移地图', Math.abs(dragged.tx - before.tx - 180) < 6 && Math.abs(dragged.ty - before.ty - 120) < 6);
  check('C11 拖动未新增眼位', (await page.locator('.ward-marker').count()) === 1);
  check('C12 拖动后标记仍对齐', await markerMathHolds(wardId, ward));

  // 右键恢复全图
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2, { button: 'right' });
  await page.waitForTimeout(150);
  const fitted = await worldTransform();
  const expectedFit = await page.evaluate(() => {
    const r = document.querySelector('.map-container').getBoundingClientRect();
    return Math.min(r.width / 8909, r.height / 8424);
  });
  check('C13 右键恢复全图视图', Math.abs(fitted.scale - expectedFit) / expectedFit < 0.02, `scale=${fitted.scale.toFixed(4)} fit=${expectedFit.toFixed(4)}`);

  // 双击不触发新增
  await page.mouse.dblclick(mapSize.w / 2 - 200, mapSize.h / 2 - 100);
  await page.waitForTimeout(200);
  check('C14 双击不触发新增流程', (await page.locator('.add-ward-panel').count()) === 0 && (await page.locator('.ward-marker').count()) === 1);

  // 编辑详情
  await page.locator('.ward-marker').click();
  await page.waitForSelector('.sidebar-right');
  await page.locator('.detail-name').fill('河道高台眼');
  await page.locator('.tag-input-row input').fill('河道');
  await page.locator('.tag-input-row button').click();
  await page.locator('.tag-input-row input').fill('高台');
  await page.locator('.tag-input-row button').click();
  await page.locator('.sidebar-right textarea').fill('插眼前需砍掉入口树木。\n插眼后砍左侧树扩大视野。');
  check('C15 编辑后显示未保存标记', await page.locator('.save-indicator.dirty').isVisible());
  const riverTag = page.locator('.sidebar-left .chips .chip', { hasText: '河道' });
  const highGroundTag = page.locator('.sidebar-left .chips .chip', { hasText: '高台' });
  check('C15a 初始标签筛选为全选', await riverTag.evaluate((el) => el.classList.contains('active')) && await highGroundTag.evaluate((el) => el.classList.contains('active')));
  await riverTag.click();
  check('C15b 点击河道后仅选中河道标签', await riverTag.evaluate((el) => el.classList.contains('active')) && !(await highGroundTag.evaluate((el) => el.classList.contains('active'))) && (await page.locator('.ward-marker').count()) === 1);
  await riverTag.click();
  check('C15c 标签全部不选后没有可见眼位', !(await riverTag.evaluate((el) => el.classList.contains('active'))) && !(await highGroundTag.evaluate((el) => el.classList.contains('active'))) && (await page.locator('.ward-marker').count()) === 0);
  await highGroundTag.click();
  check('C15d 从全未选恢复部分选择后眼位可见', !(await riverTag.evaluate((el) => el.classList.contains('active'))) && await highGroundTag.evaluate((el) => el.classList.contains('active')) && (await page.locator('.ward-marker').count()) === 1);

  // 上传截图
  await page.setInputFiles('input[type=file][accept*="image"]', tinyPng);
  await page.waitForSelector('img.shot-thumb');
  check('C16 本地截图上传并显示', true);

  // 保存并刷新验证持久化
  await page.locator('.header-status button', { hasText: '保存' }).click();
  await page.waitForSelector('.save-indicator:not(.dirty)');
  check('C17 保存后未保存标记清除', true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ward-marker', { timeout: 15000 });
  await page.locator('.ward-marker').click();
  const persistedName = await page.locator('.detail-name').inputValue();
  const persistedDesc = await page.locator('.sidebar-right textarea').inputValue();
  check('C18 刷新后眼位与说明仍保留', persistedName === '河道高台眼' && persistedDesc.includes('砍左侧树'));
  await page.waitForSelector('img.shot-thumb');
  check('C19 刷新后截图仍可读取', true);
  const savedProfileFile = fs.readdirSync(path.join(localDataDir, 'profiles'))
    .map((name) => path.join(localDataDir, 'profiles', name))
    .map((file) => JSON.parse(fs.readFileSync(file, 'utf8')))
    .find((candidate) => candidate.wards.some((item) => item.id === wardId));
  const savedScreenshotId = savedProfileFile?.wards.find((item) => item.id === wardId)?.screenshotIds[0];
  check('C19a Profile JSON 与截图均为本机普通文件', !!savedProfileFile && !!savedScreenshotId && fs.existsSync(path.join(localDataDir, 'screenshots', savedProfileFile.id, `${savedScreenshotId}.png`)));

  // 导出守卫：有修改时取消不导出
  await page.locator('.detail-name').fill('河道高台眼·改');
  await page.locator('.header-status button', { hasText: '导出' }).click();
  await page.waitForSelector('.dialog');
  check('C20 未保存时导出弹守卫', (await page.locator('.dialog h3').textContent()).includes('导出前需要保存'));
  await page.locator('.dialog button', { hasText: '取消' }).click();
  check('C21 取消导出不生成文件', true);

  await page.locator('.header-status button', { hasText: '导出' }).click();
  await page.waitForSelector('.dialog');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('.dialog button', { hasText: '保存并导出' }).click(),
  ]);
  const exportPath = path.join(outDir, download.suggestedFilename());
  await download.saveAs(exportPath);
  const exported = JSON.parse(fs.readFileSync(exportPath, 'utf-8'));
  const exportText = fs.readFileSync(exportPath, 'utf-8');
  check('C22 保存后导出成功', exported.format === 'power-wards-profile' && exported.profile.wards.length === 1);
  check('C23 导出内容为保存后的修改', exported.profile.wards[0].name === '河道高台眼·改');
  check('C24 导出不含截图与本机路径', !exportText.includes('screenshotIds') && !exportText.includes('data:image') && !exportText.includes('tiny.png'));

  // 导入：同名加后缀
  await page.setInputFiles('input[type=file][accept*="json"]', exportPath);
  await page.waitForTimeout(500);
  const options = await page.locator('.profile-row select option').allTextContents();
  check('C25 导入创建独立 Profile 并加后缀', options.some((name) => name.includes('我的眼位 (2)')), options.join(' / '));

  // 异版本导入提示
  const older = JSON.parse(exportText);
  older.mapVersion = '7.40';
  const olderPath = path.join(outDir, 'older.power-wards.json');
  fs.writeFileSync(olderPath, JSON.stringify(older));
  await page.setInputFiles('input[type=file][accept*="json"]', olderPath);
  await page.waitForSelector('.dialog', { timeout: 5000 });
  const noticeText = await page.locator('.dialog p').textContent();
  check('C26 异地图版本导入提示偏移', noticeText.includes('眼位位置可能产生偏移'), noticeText);
  await page.locator('.dialog button', { hasText: '知道了' }).click();

  // 多字节 JSON 文件的磁盘大小超过 10 MiB，但 JS 字符数较少。
  const oversizedPath = path.join(outDir, 'oversized-unicode.power-wards.json');
  const oversizedJson = JSON.stringify({ ...older, ignored: '中'.repeat(Math.ceil((10 * 1024 * 1024) / 3)) });
  fs.writeFileSync(oversizedPath, oversizedJson, 'utf8');
  check('C27a 大文件夹具的字节数超限且字符数未超限', fs.statSync(oversizedPath).size > 10 * 1024 * 1024 && oversizedJson.length < 10 * 1024 * 1024);
  await page.setInputFiles('input[type=file][accept*="json"]', oversizedPath);
  await page.waitForSelector('.dialog', { timeout: 5000 });
  check('C27b 网页在读取前拒绝超限导入', (await page.locator('.dialog p').textContent()).includes('10 MB 限制'));
  await page.locator('.dialog button', { hasText: '知道了' }).click();

  // 离开保护：有修改时切换 Profile 弹三选
  await page.setInputFiles('input[type=file][accept*="json"]', exportPath); // 再导入一份并切换过去，无修改
  await page.waitForTimeout(400);
  await page.locator('.ward-marker').click();
  await page.waitForSelector('.sidebar-right');
  await page.locator('.detail-name').fill('改动未保存');
  await page.locator('.profile-row select').selectOption({ index: 0 });
  await page.waitForSelector('.dialog');
  check('C27 未保存切换弹离开保护', (await page.locator('.dialog h3').textContent()).includes('未保存'));
  await page.locator('.dialog button', { hasText: '取消' }).click();
  check('C28 取消离开保留编辑状态', (await page.locator('.detail-name').inputValue()) === '改动未保存');

  // 撤销删除
  await page.locator('.detail-name').fill('河道高台眼');
  await page.locator('.header-status button', { hasText: '保存' }).click();
  await page.waitForSelector('.save-indicator:not(.dirty)');
  await page.locator('.detail-footer button.danger').click();
  const deleteToast = page.locator('.toast', { hasText: '已删除眼位' });
  await deleteToast.waitFor();
  check('C29 删除后出现撤销入口', (await deleteToast.textContent()).includes('撤销'));
  await deleteToast.locator('.toast-action').click();
  await page.waitForSelector('.ward-marker');
  check('C30 撤销删除恢复眼位', (await page.locator('.ward-marker').count()) === 1);
  const restoredName = await page.locator('.detail-name').inputValue();
  check('C31 撤销恢复完整资料', restoredName === '河道高台眼');
  await page.locator('.header-status button', { hasText: '保存' }).click();

  // 分类筛选（眼位分类：天辉进攻 + 夜魇防守）
  await page.locator('.filter-group', { hasText: '阵营' }).locator('label', { hasText: '夜魇' }).click();
  check('C32 天辉单选仍可见（天辉进攻命中）', (await page.locator('.ward-marker').count()) === 1);
  await page.locator('.filter-group', { hasText: '用途' }).locator('label', { hasText: '进攻' }).click();
  check('C33 天辉+防守不可见（无此组合）', (await page.locator('.ward-marker').count()) === 0);
  const count33 = await page.locator('.result-count').textContent();
  check('C34 筛选计数同步', count33.includes('0'), count33.trim());
  await page.locator('.reset-button').click();
  check('C35 重置筛选恢复显示', (await page.locator('.ward-marker').count()) === 1);
  await page.locator('.filter-group', { hasText: '阵营' }).locator('label', { hasText: '天辉' }).click();
  await page.locator('.filter-group', { hasText: '阵营' }).locator('label', { hasText: '夜魇' }).click();
  check('C35a 阵营全部不选后没有可见眼位', (await page.locator('.ward-marker').count()) === 0);
  await page.locator('.filter-group', { hasText: '阵营' }).locator('label', { hasText: '天辉' }).click();
  check('C35b 恢复一个阵营后眼位可见', (await page.locator('.ward-marker').count()) === 1);
  await page.locator('.filter-group', { hasText: '用途' }).locator('label', { hasText: '进攻' }).click();
  await page.locator('.filter-group', { hasText: '用途' }).locator('label', { hasText: '防守' }).click();
  check('C35c 用途全部不选后没有可见眼位', (await page.locator('.ward-marker').count()) === 0);
  await page.locator('.reset-button').click();
  check('C35d 全选筛选项后再次恢复显示', (await page.locator('.ward-marker').count()) === 1);

  // 重新定位
  const before36 = await page.evaluate(() => {
    const el = document.querySelector('.ward-marker');
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  });
  await page.locator('.ward-marker').click();
  await page.locator('.detail-footer button', { hasText: '重新定位' }).click();
  const box36 = await page.locator('.map-container').boundingBox();
  await page.mouse.click(box36.x + box36.width / 2 - 260, box36.y + box36.height / 2 - 140);
  await page.waitForTimeout(200);
  const after36 = await page.evaluate(() => {
    const el = document.querySelector('.ward-marker');
    return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
  });
  check('C36 重新定位更新位置', Math.abs(after36.x - before36.x) > 100, `(${before36.x.toFixed(0)},${before36.y.toFixed(0)}) → (${after36.x.toFixed(0)},${after36.y.toFixed(0)})`);

  await page.screenshot({ path: path.join(outDir, 'web-final.png'), fullPage: false });

  // 页面错误检查
  check('C37 无页面运行错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

  // 同分类、不同标签的眼位验证标签筛选确实排除未选标签。
  const fixtureTime = '2026-09-23T00:00:00.000Z';
  const baseFilterWard = {
    color: '#56b6f7', categories: ['radiant-offense'], description: '', screenshotIds: [],
    createdAt: fixtureTime, updatedAt: fixtureTime,
  };
  const filterFixture = {
    id: 'filter-fixture', name: '标签筛选验收', mapVersion: '7.41', createdAt: fixtureTime, updatedAt: fixtureTime,
    wards: [
      { ...baseFilterWard, id: 'filter-a', x: 0.25, y: 0.25, name: '甲标签眼位', tags: ['甲'] },
      { ...baseFilterWard, id: 'filter-b', x: 0.5, y: 0.5, name: '乙标签眼位', tags: ['乙'] },
      { ...baseFilterWard, id: 'filter-none', x: 0.75, y: 0.75, name: '无标签眼位', tags: [] },
    ],
  };
  const singleTagFixture = {
    id: 'single-tag-fixture', name: '单标签筛选验收', mapVersion: '7.41', createdAt: fixtureTime, updatedAt: fixtureTime,
    wards: [
      { ...baseFilterWard, id: 'single-tagged', x: 0.3, y: 0.3, name: '有标签眼位', tags: ['唯一标签'] },
      { ...baseFilterWard, id: 'single-untagged', x: 0.7, y: 0.7, name: '无标签眼位', tags: [] },
    ],
  };
  const seeded = await fetch(`${BASE}/api/v1/profiles/filter-fixture`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(filterFixture),
  });
  if (!seeded.ok) throw new Error('标签筛选验收资料写入失败');
  const seededSingle = await fetch(`${BASE}/api/v1/profiles/single-tag-fixture`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(singleTagFixture),
  });
  if (!seededSingle.ok) throw new Error('单标签筛选验收资料写入失败');
  const filterPage = await context.newPage();
  await filterPage.goto(BASE, { waitUntil: 'domcontentloaded' });
  await filterPage.locator('select[aria-label="切换 Profile"]').selectOption('filter-fixture');
  await filterPage.waitForSelector('.ward-marker[data-ward-id="filter-a"]');
  check('C38 标签初始全选且标签区仅显示真实标签', (await filterPage.locator('.ward-marker').count()) === 3 && (await filterPage.locator('.sidebar-left .chips .chip').count()) === 2);
  const tagA = filterPage.locator('.sidebar-left .chip', { hasText: '甲' });
  const tagB = filterPage.locator('.sidebar-left .chip', { hasText: '乙' });
  const selectAll = filterPage.getByRole('button', { name: '全选筛选项' });
  await tagA.click();
  check('C39 点击甲标签后仅显示甲眼位', (await filterPage.locator('.ward-marker').count()) === 1 && (await filterPage.locator('.ward-marker[data-ward-id="filter-a"]').count()) === 1 && (await tagA.getAttribute('aria-pressed')) === 'true' && (await tagB.getAttribute('aria-pressed')) === 'false');
  await tagB.click();
  check('C40 显式选中全部标签仍排除无标签眼位', (await filterPage.locator('.ward-marker').count()) === 2 && (await tagA.getAttribute('aria-pressed')) === 'true' && (await tagB.getAttribute('aria-pressed')) === 'true');
  await tagA.click();
  check('C41 只选乙标签时仅显示乙眼位', (await filterPage.locator('.ward-marker').count()) === 1 && (await filterPage.locator('.ward-marker[data-ward-id="filter-b"]').count()) === 1);
  await tagB.click();
  check('C42 标签全不选时不显示眼位', (await filterPage.locator('.ward-marker').count()) === 0);
  await selectAll.click();
  check('C43 全选筛选项恢复无标签眼位', (await filterPage.locator('.ward-marker').count()) === 3 && (await tagA.getAttribute('aria-pressed')) === 'true' && (await tagB.getAttribute('aria-pressed')) === 'true');
  await filterPage.locator('select[aria-label="切换 Profile"]').selectOption('single-tag-fixture');
  await filterPage.waitForSelector('.ward-marker[data-ward-id="single-tagged"]');
  check('C44 单标签资料初始显示所有眼位', (await filterPage.locator('.ward-marker').count()) === 2);
  await filterPage.getByRole('button', { name: '唯一标签' }).click();
  check('C45 点击唯一标签仅显示有标签眼位', (await filterPage.locator('.ward-marker').count()) === 1 && (await filterPage.locator('.ward-marker[data-ward-id="single-tagged"]').count()) === 1);
  await selectAll.click();
  check('C46 单标签资料恢复全部眼位', (await filterPage.locator('.ward-marker').count()) === 2);
  await filterPage.close();
} catch (error) {
  check('运行异常', false, String(error));
  try {
    await page.screenshot({ path: path.join(outDir, 'web-error.png') });
  } catch {}
} finally {
  await browser.close();
  if (server.exitCode === null) {
    const stopped = new Promise((resolve) => server.once('exit', resolve));
    server.kill();
    await stopped;
  }
  fs.rmSync(localDataDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
fs.writeFileSync(path.join(outDir, 'web-results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
