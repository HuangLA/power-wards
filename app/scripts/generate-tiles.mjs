// 从项目根目录原始地图生成 Deep Zoom 切片金字塔。
// 原图保持不动；派生切片输出到 app/public/map/。
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(appDir, '..', '..', 'Game_map_7.41.jpg');
const OUT_DIR = path.resolve(appDir, '..', 'public', 'map');
const TMP_DIR = path.join(OUT_DIR, '_dz_tmp');
const TILE_SIZE = 512;
const KEEP_LEVELS = 5; // 保留最高的 5 个层级
const JPEG_QUALITY = 82;

const meta = await sharp(SRC).metadata();
const width = meta.width;
const height = meta.height;
if (!width || !height) throw new Error('无法读取地图尺寸');
console.log(`原图 ${width} × ${height}`);

fs.rmSync(TMP_DIR, { recursive: true, force: true });
fs.mkdirSync(TMP_DIR, { recursive: true });

await sharp(SRC, { limitInputPixels: false })
  .jpeg({ quality: JPEG_QUALITY })
  .tile({ size: TILE_SIZE, layout: 'dz' })
  .toFile(path.join(TMP_DIR, 'map'));

const filesDir = path.join(TMP_DIR, 'map_files');
const dzLevels = fs.readdirSync(filesDir)
  .filter((d) => /^\d+$/.test(d))
  .map(Number)
  .sort((a, b) => a - b);
const top = dzLevels.slice(-KEEP_LEVELS);

const levels = [];
for (let z = 0; z < top.length; z++) {
  const dzLevel = top[z];
  const scale = Math.pow(2, dzLevel - top[top.length - 1]);
  const lw = Math.ceil(width * scale);
  const lh = Math.ceil(height * scale);
  const cols = Math.ceil(lw / TILE_SIZE);
  const rows = Math.ceil(lh / TILE_SIZE);
  const srcDir = path.join(filesDir, String(dzLevel));
  const dstDir = path.join(OUT_DIR, 'tiles', String(z));
  fs.mkdirSync(dstDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    fs.renameSync(path.join(srcDir, f), path.join(dstDir, f.replace(/\.jpeg$/, '.jpg')));
  }
  levels.push({ scale, width: lw, height: lh, cols, rows });
  console.log(`层级 ${z} (dz ${dzLevel}) ${lw}×${lh} ${cols}×${rows} 片`);
}

fs.rmSync(TMP_DIR, { recursive: true, force: true });

const out = {
  mapVersion: '7.41',
  width,
  height,
  tileSize: TILE_SIZE,
  levels,
};
fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(out, null, 2));
console.log('完成 →', path.join(OUT_DIR, 'meta.json'));
