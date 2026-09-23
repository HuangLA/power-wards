// 桌面端（Electron）验证：文件存储、切片加载、保存、截图落盘、关闭保护。
// 运行前需要 npm run build。结果输出到 verification/。
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(appDir, 'verification');
fs.mkdirSync(outDir, { recursive: true });
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'power-wards-e2e-'));

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const tinyPng = path.join(outDir, 'tiny.png');
if (!fs.existsSync(tinyPng)) {
  fs.writeFileSync(
    tinyPng,
    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
  );
}

let app;
try {
  app = await electron.launch({
    args: ['.'],
    cwd: appDir,
    env: { ...process.env, POWER_WARDS_DATA_DIR: dataDir },
  });
  const page = await app.firstWindow();
  await page.waitForSelector('.map-tile', { timeout: 20000 });
  check('D01 桌面端启动并通过应用协议加载切片', true);

  const storedViaBridge = await page.evaluate(() => typeof window.powerWards !== 'undefined' && window.powerWards.platform === 'electron');
  check('D02 使用桌面受控桥接存储', storedViaBridge);

  // 新增眼位
  const box = await page.locator('.map-container').boundingBox();
  await page.keyboard.down('Control');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.keyboard.up('Control');
  await page.waitForSelector('.add-ward-panel');
  await page.locator('.add-ward-panel label', { hasText: '天辉进攻' }).click();
  await page.locator('.add-ward-panel button.primary').click();
  await page.waitForSelector('.ward-marker');
  await page.locator('.detail-name').fill('桌面端眼位');

  // 上传截图
  await page.setInputFiles('input[type=file][accept*="image"]', tinyPng);
  await page.waitForSelector('img.shot-thumb');

  // 保存
  await page.locator('.header-status button', { hasText: '保存' }).click();
  await page.waitForSelector('.save-indicator:not(.dirty)');
  check('D03 桌面端保存成功', true);

  await page.waitForTimeout(300);
  const profilesDir = path.join(dataDir, 'profiles');
  const profileFiles = fs.readdirSync(profilesDir).filter((f) => f.endsWith('.json'));
  const saved = profileFiles.length === 1 ? JSON.parse(fs.readFileSync(path.join(profilesDir, profileFiles[0]), 'utf-8')) : null;
  check('D04 应用数据目录写入 Profile 文件', !!saved && saved.wards[0]?.name === '桌面端眼位', saved ? `${profileFiles[0]}，${saved.wards.length} 个眼位` : '无文件');

  const shotDir = saved ? path.join(dataDir, 'screenshots', saved.id) : '';
  const shotFiles = saved && fs.existsSync(shotDir) ? fs.readdirSync(shotDir) : [];
  check('D05 截图以文件形式保存在应用数据目录', shotFiles.length === 1, shotFiles.join(','));

  // 关闭保护：有未保存修改时拦截关闭
  await page.locator('.detail-name').fill('桌面端眼位·改');
  await page.evaluate(() => window.close());
  await page.waitForSelector('.dialog', { timeout: 5000 });
  check('D06 关闭窗口时弹未保存三选', (await page.locator('.dialog h3').textContent()).includes('未保存'));

  await Promise.all([
    app.waitForEvent('close', { timeout: 10000 }),
    page.locator('.dialog button', { hasText: '保存' }).click(),
  ]);
  app = null;
  const savedAfter = JSON.parse(fs.readFileSync(path.join(profilesDir, profileFiles[0]), 'utf-8'));
  check('D07 选择保存后写入并关闭', savedAfter.wards[0]?.name === '桌面端眼位·改');

  // 重启读取
  const app2 = await electron.launch({ args: ['.'], cwd: appDir, env: { ...process.env, POWER_WARDS_DATA_DIR: dataDir } });
  const page2 = await app2.firstWindow();
  await page2.waitForSelector('.ward-marker', { timeout: 20000 });
  await page2.locator('.ward-marker').click();
  const name2 = await page2.locator('.detail-name').inputValue();
  check('D08 重启后读取最后保存版本', name2 === '桌面端眼位·改', name2);
  await page2.waitForSelector('img.shot-thumb');
  check('D09 重启后截图仍可读取', true);
  await page2.screenshot({ path: path.join(outDir, 'electron-final.png') });
  await app2.close();
} catch (error) {
  check('桌面端验证异常', false, String(error).slice(0, 300));
  try {
    if (app) await app.close();
  } catch {}
}

fs.rmSync(dataDir, { recursive: true, force: true });
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
fs.writeFileSync(path.join(outDir, 'electron-results.json'), JSON.stringify(results, null, 2));
process.exit(failed.length > 0 ? 1 : 0);
