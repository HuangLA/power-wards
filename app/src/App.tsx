import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { visibleWards } from './domain/filter';
import { CURRENT_MAP_VERSION } from './domain/types';
import { MAX_SHARE_FILE_BYTES } from './domain/share';
import { MapMeta, Point, ViewState, FOCUS_SCALE_FACTOR, fitScale, fitView, focusOn, minScale } from './map/viewport';
import { createStorage, isDesktop } from './storage/platform';
import { AddWardPanel } from './ui/AddWardPanel';
import { AppController } from './ui/controller';
import { DetailPanel } from './ui/DetailPanel';
import { Dialogs, ReactDialogManager } from './ui/dialogs';
import { MapMode, MapView } from './ui/MapView';
import { SidebarLeft } from './ui/SidebarLeft';
import { Toasts } from './ui/Toasts';

const dialogManager = new ReactDialogManager();
const controller = new AppController(createStorage(), dialogManager);

function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [meta, setMeta] = useState<MapMeta | null>(null);
  const [metaError, setMetaError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState | null>(null);
  const [mode, setMode] = useState<MapMode>('normal');
  const [focusRequest, setFocusRequest] = useState<{ point: Point; nonce: number } | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const mapAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void controller.init();
  }, []);

  useEffect(() => {
    fetch('map/meta.json')
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data: MapMeta) => setMeta(data))
      .catch(() => setMetaError('地图资源缺失，请先运行 npm run tiles 生成切片。'));
  }, []);

  const dirtyRef = useRef(state.dirty);
  dirtyRef.current = state.dirty;
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    window.powerWards!.onCloseRequest(() => {
      void controller.closeRequested().then((allow) => {
        if (allow) window.powerWards!.confirmClose();
      });
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (state.draftPosition) controller.cancelDraft();
        setMode('normal');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state.draftPosition]);

  const visible = useMemo(() => {
    if (!state.draft) return [];
    return visibleWards(state.draft.wards, controller.categoryFilter(), state.filters.tagSelection);
  }, [state.draft, state.filters]);

  const selectedWard = controller.selectedWard();

  const handlePrimaryClick = useCallback(
    (rel: Point, ctrlKey: boolean) => {
      if (mode === 'add') {
        controller.beginDraft(rel.x, rel.y);
        setMode('normal');
        return;
      }
      if (mode === 'move') {
        const id = controller.getState().selectedWardId;
        if (id) controller.patchWard(id, { x: rel.x, y: rel.y });
        setMode('normal');
        return;
      }
      if (ctrlKey) {
        controller.beginDraft(rel.x, rel.y);
        return;
      }
      controller.selectWard(null);
    },
    [mode],
  );

  const handleMarkerClick = useCallback(
    (id: string) => {
      controller.selectWard(id);
      const ward = controller.getState().draft?.wards.find((w) => w.id === id);
      if (ward && meta) setFocusRequest({ point: { x: ward.x * meta.width, y: ward.y * meta.height }, nonce: Date.now() });
    },
    [meta],
  );

  const appliedFocusNonce = useRef(0);
  useEffect(() => {
    if (!focusRequest || !meta || !mapAreaRef.current) return;
    if (appliedFocusNonce.current === focusRequest.nonce) return;
    appliedFocusNonce.current = focusRequest.nonce;
    const viewport = { width: mapAreaRef.current.clientWidth, height: mapAreaRef.current.clientHeight };
    const world = { width: meta.width, height: meta.height };
    const target = fitScale(world, viewport) * FOCUS_SCALE_FACTOR;
    setView((current) => (current ? focusOn(current, focusRequest.point, viewport, target, minScale(world, viewport)) : current));
  }, [focusRequest, meta]);

  const resetView = useCallback(() => {
    if (!meta || !mapAreaRef.current) return;
    const viewport = { width: mapAreaRef.current.clientWidth, height: mapAreaRef.current.clientHeight };
    setView(fitView({ width: meta.width, height: meta.height }, viewport));
  }, [meta]);

  const exportNow = async () => {
    const result = await controller.exportFlow();
    if (!result.ok || !result.content) return;
    if (isDesktop()) {
      const saved = await window.powerWards!.exportFile(result.fileName!, result.content);
      if (saved) controller.pushToast(`已导出：${saved}`);
    } else {
      downloadText(result.fileName!, result.content);
      controller.pushToast('已导出 JSON 分享文件（不含截图）');
    }
  };

  const importFromInput = async (file: File) => {
    if (file.size > MAX_SHARE_FILE_BYTES) {
      await dialogManager.notice('导入失败：文件过大，超出 10 MB 限制。');
      return;
    }
    const text = await file.text();
    await controller.importFlow(text);
  };

  const importClick = async () => {
    if (isDesktop()) {
      const picked = await window.powerWards!.importFile();
      if (picked) await controller.importFlow(picked.content);
    } else {
      importRef.current?.click();
    }
  };

  const renameCurrent = async () => {
    const id = controller.getState().draft?.id;
    if (!id) return;
    const current = controller.getState().profiles.find((p) => p.id === id);
    const name = await dialogManager.promptName('重命名 Profile', current?.name ?? '');
    if (name) await controller.renameProfile(id, name);
  };

  if (state.status === 'loading') {
    return <div className="app-loading">正在连接本机资料服务…</div>;
  }

  if (state.status === 'error') {
    return (
      <main className="app-startup-error">
        <h1>无法打开本地资料</h1>
        <p>{state.startupError}</p>
        <p>开发运行请使用 <code>npm run dev</code>；正式本地运行请使用 <code>npm run local</code>。</p>
        <button type="button" className="primary" onClick={() => void controller.init()}>重试连接</button>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo">◉</span>
          <span className="brand-name">POWER WARDS</span>
          <span className="brand-sub">眼位地图编辑器</span>
        </div>
        <div className="header-status">
          <span className={`save-indicator${state.dirty ? ' dirty' : ''}`}>{state.dirty ? '● 未保存' : '已保存'}</span>
          <button type="button" disabled={!state.dirty} onClick={() => void controller.save()}>
            保存
          </button>
          <button type="button" onClick={() => void controller.saveAs()}>另存为</button>
          <button type="button" className="primary" onClick={() => void exportNow()}>
            导出
          </button>
        </div>
      </header>

      <main className="app-main">
        <SidebarLeft
          profiles={state.profiles}
          currentId={state.draft?.id ?? null}
          filters={state.filters}
          allTags={controller.allTags()}
          visibleCount={visible.length}
          totalCount={state.draft?.wards.length ?? 0}
          mapVersion={state.draft?.mapVersion ?? CURRENT_MAP_VERSION}
          onSwitchProfile={(id) => void controller.switchProfile(id)}
          onCreateProfile={() => void controller.createProfileFlow()}
          onImport={() => void importClick()}
          onRenameProfile={() => void renameCurrent()}
          onDeleteProfile={(id) => void controller.deleteProfile(id)}
          onToggleFaction={(faction) => controller.toggleFaction(faction)}
          onTogglePurpose={(purpose) => controller.togglePurpose(purpose)}
          onToggleTag={(tag) => controller.toggleTag(tag)}
          onResetFilters={() => controller.resetFilters()}
        />

        <section className="map-panel" ref={mapAreaRef}>
          <button type="button" className={`add-ward-button${mode === 'add' ? ' active' : ''}`} onClick={() => setMode(mode === 'add' ? 'normal' : 'add')}>
            ＋ 添加眼位
          </button>
          {metaError && <div className="map-error">{metaError}</div>}
          {meta && (
            <MapView
              meta={meta}
              wards={visible}
              selectedWardId={state.selectedWardId}
              draftPosition={state.draftPosition}
              mode={mode}
              view={view}
              onViewChange={setView}
              onPrimaryClick={handlePrimaryClick}
              onMarkerClick={handleMarkerClick}
              onResetView={resetView}
            />
          )}
          {state.draftPosition && (
            <AddWardPanel onConfirm={(categories) => controller.confirmDraft(categories)} onCancel={() => controller.cancelDraft()} />
          )}
        </section>

        {selectedWard && (
          <DetailPanel
            ward={selectedWard}
            controller={controller}
            moveMode={mode === 'move'}
            onToggleMove={() => setMode(mode === 'move' ? 'normal' : 'move')}
            onClose={() => controller.selectWard(null)}
          />
        )}
      </main>

      <input
        ref={importRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFromInput(file);
        }}
      />

      <Toasts toasts={state.toasts} dismiss={(id) => controller.dismissToast(id)} />
      <Dialogs manager={dialogManager} />
    </div>
  );
}
