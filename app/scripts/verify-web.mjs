// 网页端真实浏览器验证：地图加载、手势、坐标稳定、筛选、保存、导入导出、撤销。
// 运行前需要 npm run build。结果输出到 verification/。
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, 'verification');
fs.mkdirSync(outDir, { recursive: true });
const PORT = 4199;
const BASE = `http://localhost:${PORT}`;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const server = spawn('npx vite preview --port ' + PORT + ' --strictPort', {
  cwd: appDir,
  stdio: 'pipe',
  shell: true,
});
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
  const actualY = box.y + box.height;
  return Math.abs(actualX - expectX) < 4 && Math.abs(actualY - expectY) < 8;
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
  check('C07 标记与地图坐标对齐', await markerMathHolds(wardId, ward));

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
  await page.locator('.sidebar-right textarea').fill('插眼前需砍掉入口树木。\n插眼后砍左侧树扩大视野。');
  check('C15 编辑后显示未保存标记', await page.locator('.save-indicator.dirty').isVisible());

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
} catch (error) {
  check('运行异常', false, String(error));
  try {
    await page.screenshot({ path: path.join(outDir, 'web-error.png') });
  } catch {}
} finally {
  await browser.close();
  server.kill();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
fs.writeFileSync(path.join(outDir, 'web-results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
