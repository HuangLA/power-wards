export interface ViewState {
  scale: number;
  tx: number;
  ty: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export const MIN_SCALE_FACTOR = 0.9;
export const MAX_SCALE = 2.5;
export const FOCUS_SCALE_FACTOR = 5;
export const WHEEL_ZOOM_STEP = 1.0016;
export const CLICK_DRAG_THRESHOLD_PX = 4;

export function worldToScreen(view: ViewState, p: Point): Point {
  return { x: p.x * view.scale + view.tx, y: p.y * view.scale + view.ty };
}

export function screenToWorld(view: ViewState, p: Point): Point {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

export function fitScale(world: Size, viewport: Size): number {
  return Math.min(viewport.width / world.width, viewport.height / world.height);
}

export function minScale(world: Size, viewport: Size): number {
  return fitScale(world, viewport) * MIN_SCALE_FACTOR;
}

export function clampScale(scale: number, min: number, max: number = MAX_SCALE): number {
  return Math.min(max, Math.max(min, scale));
}

export function fitView(world: Size, viewport: Size): ViewState {
  const scale = fitScale(world, viewport);
  return {
    scale,
    tx: (viewport.width - world.width * scale) / 2,
    ty: (viewport.height - world.height * scale) / 2,
  };
}

export function zoomAt(view: ViewState, center: Point, nextScaleRaw: number, min: number, max: number = MAX_SCALE): ViewState {
  const nextScale = clampScale(nextScaleRaw, min, max);
  if (nextScale === view.scale) return view;
  const anchor = screenToWorld(view, center);
  return {
    scale: nextScale,
    tx: center.x - anchor.x * nextScale,
    ty: center.y - anchor.y * nextScale,
  };
}

export function zoomByWheel(view: ViewState, center: Point, deltaY: number, min: number, max: number = MAX_SCALE): ViewState {
  return zoomAt(view, center, view.scale * Math.pow(WHEEL_ZOOM_STEP, -deltaY), min, max);
}

export function panBy(view: ViewState, dx: number, dy: number): ViewState {
  return { ...view, tx: view.tx + dx, ty: view.ty + dy };
}

export function focusOn(view: ViewState, target: Point, viewport: Size, desiredScale: number, min: number, max: number = MAX_SCALE): ViewState {
  const scale = clampScale(Math.max(view.scale, desiredScale), min, max);
  return {
    scale,
    tx: viewport.width / 2 - target.x * scale,
    ty: viewport.height / 2 - target.y * scale,
  };
}

export function relativeToWorld(world: Size, rel: Point): Point {
  return { x: rel.x * world.width, y: rel.y * world.height };
}

export function worldToRelative(world: Size, p: Point): Point {
  return {
    x: Math.min(1, Math.max(0, p.x / world.width)),
    y: Math.min(1, Math.max(0, p.y / world.height)),
  };
}

export interface MapMeta {
  mapVersion: string;
  width: number;
  height: number;
  tileSize: number;
  levels: { scale: number; width: number; height: number; cols: number; rows: number }[];
}

export function pickLevel(meta: MapMeta, viewScale: number): number {
  let best = meta.levels.length - 1;
  for (let i = 0; i < meta.levels.length; i++) {
    if (meta.levels[i].scale >= viewScale * 0.75) {
      best = i;
      break;
    }
  }
  return best;
}

export interface VisibleTile {
  z: number;
  col: number;
  row: number;
  x: number;
  y: number;
  size: number;
}

export function visibleTiles(meta: MapMeta, view: ViewState, viewport: Size): VisibleTile[] {
  const z = pickLevel(meta, view.scale);
  const level = meta.levels[z];
  const topLeft = screenToWorld(view, { x: 0, y: 0 });
  const bottomRight = screenToWorld(view, { x: viewport.width, y: viewport.height });
  const tileWorld = meta.tileSize / level.scale;
  const colStart = Math.max(0, Math.floor(topLeft.x / tileWorld));
  const rowStart = Math.max(0, Math.floor(topLeft.y / tileWorld));
  const colEnd = Math.min(level.cols - 1, Math.floor(bottomRight.x / tileWorld));
  const rowEnd = Math.min(level.rows - 1, Math.floor(bottomRight.y / tileWorld));
  const tiles: VisibleTile[] = [];
  for (let row = rowStart; row <= rowEnd; row++) {
    for (let col = colStart; col <= colEnd; col++) {
      tiles.push({ z, col, row, x: col * tileWorld, y: row * tileWorld, size: tileWorld });
    }
  }
  return tiles;
}
