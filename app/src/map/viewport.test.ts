import { describe, expect, it } from 'vitest';
import {
  fitView,
  focusOn,
  panBy,
  pickLevel,
  relativeToWorld,
  screenToWorld,
  visibleTiles,
  worldToRelative,
  worldToScreen,
  zoomAt,
  MapMeta,
} from './viewport';

const WORLD = { width: 8909, height: 8424 };
const VIEWPORT = { width: 1200, height: 800 };

const META: MapMeta = {
  mapVersion: '7.41',
  width: WORLD.width,
  height: WORLD.height,
  tileSize: 512,
  levels: [
    { scale: 0.0625, width: 557, height: 527, cols: 2, rows: 2 },
    { scale: 0.125, width: 1114, height: 1053, cols: 3, rows: 3 },
    { scale: 0.25, width: 2228, height: 2106, cols: 5, rows: 5 },
    { scale: 0.5, width: 4455, height: 4212, cols: 9, rows: 9 },
    { scale: 1, width: 8909, height: 8424, cols: 18, rows: 17 },
  ],
};

function close(a: number, b: number, eps = 1e-9) {
  expect(Math.abs(a - b)).toBeLessThan(eps);
}

describe('视口坐标换算（A05）', () => {
  it('worldToScreen 与 screenToWorld 互逆', () => {
    const view = { scale: 0.37, tx: -123.4, ty: 56.7 };
    for (const p of [{ x: 0, y: 0 }, { x: 4454.5, y: 4212 }, { x: 8909, y: 8424 }]) {
      const round = screenToWorld(view, worldToScreen(view, p));
      close(round.x, p.x);
      close(round.y, p.y);
    }
  });

  it('zoomAt 保持指针下的世界点不动（指针为中心缩放）', () => {
    const view = { scale: 0.2, tx: 10, ty: -30 };
    const center = { x: 600, y: 400 };
    const anchor = screenToWorld(view, center);
    const zoomed = zoomAt(view, center, 0.8, 0.1);
    const after = worldToScreen(zoomed, anchor);
    close(after.x, center.x, 1e-6);
    close(after.y, center.y, 1e-6);
  });

  it('zoomAt 受最小/最大缩放约束', () => {
    const view = { scale: 0.2, tx: 0, ty: 0 };
    expect(zoomAt(view, { x: 0, y: 0 }, 0.001, 0.1).scale).toBe(0.1);
    expect(zoomAt(view, { x: 0, y: 0 }, 99, 0.1).scale).toBe(2.5);
  });

  it('fitView 全图居中可见', () => {
    const view = fitView(WORLD, VIEWPORT);
    const tl = worldToScreen(view, { x: 0, y: 0 });
    const br = worldToScreen(view, { x: WORLD.width, y: WORLD.height });
    expect(tl.x).toBeGreaterThanOrEqual(-1e-9);
    expect(tl.y).toBeGreaterThanOrEqual(-1e-9);
    expect(br.x).toBeLessThanOrEqual(VIEWPORT.width + 1e-9);
    expect(br.y).toBeLessThanOrEqual(VIEWPORT.height + 1e-9);
  });

  it('focusOn 聚焦目标点居中，已更近时不缩回', () => {
    const view = { scale: 0.2, tx: 0, ty: 0 };
    const target = { x: 2000, y: 3000 };
    const focused = focusOn(view, target, VIEWPORT, 1.0, 0.1);
    close(worldToScreen(focused, target).x, VIEWPORT.width / 2, 1e-6);
    close(worldToScreen(focused, target).y, VIEWPORT.height / 2, 1e-6);
    expect(focused.scale).toBe(1.0);

    const closer = { scale: 1.5, tx: 0, ty: 0 };
    const kept = focusOn(closer, target, VIEWPORT, 1.0, 0.1);
    expect(kept.scale).toBe(1.5);
  });

  it('panBy 平移不改变世界点间的相对关系', () => {
    const view = { scale: 0.5, tx: 0, ty: 0 };
    const moved = panBy(view, 120, -80);
    const a = { x: 100, y: 200 };
    const b = { x: 300, y: 500 };
    const before = worldToScreen(view, a);
    const afterA = worldToScreen(moved, a);
    const afterB = worldToScreen(moved, b);
    close(afterA.x - before.x, 120);
    close(afterA.y - before.y, -80);
    close(afterB.x - afterA.x, (b.x - a.x) * 0.5);
  });

  it('相对坐标与世界坐标互逆并夹取到地图范围', () => {
    for (const rel of [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }, { x: 0.123, y: 0.987 }]) {
      const round = worldToRelative(WORLD, relativeToWorld(WORLD, rel));
      close(round.x, rel.x, 1e-12);
      close(round.y, rel.y, 1e-12);
    }
    expect(worldToRelative(WORLD, { x: -100, y: 99999 })).toEqual({ x: 0, y: 1 });
  });
});

describe('切片选择', () => {
  it('pickLevel 按当前缩放选择合适层级', () => {
    expect(pickLevel(META, 0.05)).toBe(0);
    expect(pickLevel(META, 0.13)).toBe(1);
    expect(pickLevel(META, 0.9)).toBe(4);
    expect(pickLevel(META, 2.5)).toBe(4);
  });

  it('visibleTiles 覆盖可视范围且不越界', () => {
    const view = fitView(WORLD, VIEWPORT);
    const tiles = visibleTiles(META, view, VIEWPORT);
    expect(tiles.length).toBeGreaterThan(0);
    for (const tile of tiles) {
      expect(tile.col).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.col).toBeLessThan(META.levels[tile.z].cols);
      expect(tile.row).toBeLessThan(META.levels[tile.z].rows);
      const level = META.levels[tile.z];
      const pixelWidth = Math.min(META.tileSize, level.width - tile.col * META.tileSize);
      const pixelHeight = Math.min(META.tileSize, level.height - tile.row * META.tileSize);
      expect(tile.width).toBe(pixelWidth / level.scale);
      expect(tile.height).toBe(pixelHeight / level.scale);
    }
  });

  it('边缘切片按实际像素宽高映射，不拉伸到完整切片尺寸', () => {
    const view = fitView(WORLD, { width: 600, height: 300 });
    const tiles = visibleTiles(META, view, { width: 600, height: 300 });
    const full = tiles.find((tile) => tile.z === 0 && tile.col === 0 && tile.row === 0)!;
    const bottomRight = tiles.find((tile) => tile.z === 0 && tile.col === 1 && tile.row === 1)!;

    expect(full.width).toBe(8192);
    expect(full.height).toBe(8192);
    expect(bottomRight.width).toBe((557 - 512) / 0.0625);
    expect(bottomRight.height).toBe((527 - 512) / 0.0625);
    expect(bottomRight.width).toBeLessThan(full.width);
    expect(bottomRight.height).toBeLessThan(full.height);
  });

  it('视野外不产生切片', () => {
    const view = { scale: 1, tx: 0, ty: 0 };
    const tiles = visibleTiles(META, view, VIEWPORT);
    expect(tiles.every((t) => t.col <= 2 && t.row <= 1)).toBe(true);
  });
});
