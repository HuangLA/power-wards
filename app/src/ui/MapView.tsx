import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { Ward } from '../domain/types';
import {
  CLICK_DRAG_THRESHOLD_PX,
  MapMeta,
  Point,
  Size,
  ViewState,
  fitView,
  minScale,
  panBy,
  relativeToWorld,
  screenToWorld,
  visibleTiles,
  worldToRelative,
  zoomAt,
  zoomByWheel,
} from '../map/viewport';

export type MapMode = 'normal' | 'add' | 'move';

interface MapViewProps {
  meta: MapMeta;
  wards: Ward[];
  selectedWardId: string | null;
  draftPosition: Point | null;
  mode: MapMode;
  view: ViewState | null;
  onViewChange: (view: ViewState) => void;
  onPrimaryClick: (rel: Point, ctrlKey: boolean) => void;
  onMarkerClick: (id: string) => void;
  onResetView: () => void;
}

function EyeMarker({ selected }: { selected: boolean }) {
  return (
    <svg viewBox="0 0 32 32" className={`eye-icon${selected ? ' selected' : ''}`} aria-hidden="true">
      <circle cx="16" cy="16" r="13" className="eye-ring" />
      <path d="M4 16 C 9 8.5, 23 8.5, 28 16 C 23 23.5, 9 23.5, 4 16 Z" className="eye-shape" />
      <circle cx="16" cy="16" r="4.2" className="eye-pupil" />
    </svg>
  );
}

export function MapView(props: MapViewProps) {
  const { meta, view, onViewChange } = props;
  const world: Size = { width: meta.width, height: meta.height };
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const dragRef = useRef<{ pointerId: number; lastX: number; lastY: number; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setViewport({ width: element.clientWidth, height: element.clientHeight });
    });
    observer.observe(element);
    setViewport({ width: element.clientWidth, height: element.clientHeight });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (view === null && viewport.width > 0) onViewChange(fitView(world, viewport));
  }, [view, viewport, world.width, world.height, onViewChange]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const center = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const min = minScale(world, viewport);
      const current = view ?? fitView(world, viewport);
      onViewChange(zoomByWheel(current, center, event.deltaY, min));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    dragRef.current = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
  };

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId || view === null) return;
      const dx = event.clientX - drag.lastX;
      const dy = event.clientY - drag.lastY;
      if (!drag.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) return;
      drag.moved = true;
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      onViewChange(panBy(view, dx, dy));
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (drag.moved) {
        suppressClickRef.current = true;
        window.setTimeout(() => (suppressClickRef.current = false), 0);
        return;
      }
      if (view === null) return;
      const element = containerRef.current;
      if (!element) return;
      if ((event.target as HTMLElement | null)?.closest?.('.ward-marker')) return;
      const rect = element.getBoundingClientRect();
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      if (point.x < 0 || point.y < 0 || point.x > rect.width || point.y > rect.height) return;
      const rel = worldToRelative(world, screenToWorld(view, point));
      props.onPrimaryClick(rel, event.ctrlKey || event.metaKey);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  });

  if (view === null) {
    return <div ref={containerRef} className="map-container" data-testid="map-container" />;
  }

  const onContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    props.onResetView();
  };

  const zoomButton = (factor: number) => {
    const min = minScale(world, viewport);
    onViewChange(zoomAt(view, { x: viewport.width / 2, y: viewport.height / 2 }, view.scale * factor, min));
  };

  const tiles = viewport.width > 0 ? visibleTiles(meta, view, viewport) : [];
  const cursorClass = props.mode === 'add' || props.mode === 'move' ? ' crosshair' : '';

  return (
    <div
      ref={containerRef}
      className={`map-container${cursorClass}`}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
      data-testid="map-container"
    >
      <div
        className="map-world"
        style={{
          width: world.width,
          height: world.height,
          transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={`${tile.z}-${tile.col}-${tile.row}`}
            src={`map/tiles/${tile.z}/${tile.col}_${tile.row}.jpg`}
            alt=""
            draggable={false}
            className="map-tile"
            style={{ left: tile.x, top: tile.y, width: tile.width + 0.6, height: tile.height + 0.6 }}
          />
        ))}
        {props.wards.map((ward) => {
          const pos = relativeToWorld(world, ward);
          const selected = ward.id === props.selectedWardId;
          return (
            <button
              key={ward.id}
              type="button"
              className={`ward-marker${selected ? ' selected' : ''}`}
              data-ward-id={ward.id}
              title={ward.name}
              style={{ left: pos.x, top: pos.y, color: ward.color, ['--inv' as never]: 1 / view.scale }}
              onClick={(event) => {
                if (suppressClickRef.current) return;
                event.stopPropagation();
                props.onMarkerClick(ward.id);
              }}
            >
              <EyeMarker selected={selected} />
            </button>
          );
        })}
        {props.draftPosition && (
          <div
            className="ward-marker draft"
            style={{
              left: relativeToWorld(world, props.draftPosition).x,
              top: relativeToWorld(world, props.draftPosition).y,
              ['--inv' as never]: 1 / view.scale,
            }}
          >
            <EyeMarker selected={false} />
          </div>
        )}
      </div>
      <div className="map-hint">
        {props.mode === 'add' && '点击地图放置眼位 · Esc 取消'}
        {props.mode === 'move' && '点击地图设置新位置 · Esc 取消'}
        {props.mode === 'normal' && 'Ctrl + 左键添加 · 滚轮缩放 · 拖动平移 · 右键全图'}
      </div>
      <div className="zoom-controls">
        <button type="button" aria-label="缩小" onClick={() => zoomButton(1 / 1.3)}>−</button>
        <span>{Math.round(view.scale * 100)}%</span>
        <button type="button" aria-label="放大" onClick={() => zoomButton(1.3)}>＋</button>
        <button type="button" onClick={props.onResetView}>全图</button>
      </div>
    </div>
  );
}
