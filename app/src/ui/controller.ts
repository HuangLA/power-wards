import { CategoryFilter, collectAllTags } from '../domain/filter';
import {
  cloneProfileAs,
  createProfile,
  createWard,
  removeWard,
  restoreWard,
  uniqueProfileName,
  updateWard,
  RemovedWard,
} from '../domain/profile';
import { decodeShare, importAsProfile, serializeProfile, ShareFormatError } from '../domain/share';
import {
  CategoryKey,
  CURRENT_MAP_VERSION,
  Faction,
  MAX_SCREENSHOTS_PER_WARD,
  MAX_SCREENSHOT_BYTES,
  Profile,
  ProfileMeta,
  Purpose,
  SCREENSHOT_ACCEPT,
  Ward,
  newId,
} from '../domain/types';
import { StorageAdapter } from '../storage/adapter';

export type LeaveChoice = 'save' | 'discard' | 'cancel';
export type ExportChoice = 'save' | 'saveAs' | 'cancel';

export interface DialogManager {
  leaveGuard(): Promise<LeaveChoice>;
  exportGuard(): Promise<ExportChoice>;
  promptName(title: string, defaultName: string): Promise<string | null>;
  confirm(message: string): Promise<boolean>;
  notice(message: string): Promise<void>;
}

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
}

export interface FilterState {
  factions: Set<Faction>;
  purposes: Set<Purpose>;
  tagSelection: Set<string> | null;
}

export interface AppState {
  status: 'loading' | 'ready' | 'error';
  startupError: string | null;
  profiles: ProfileMeta[];
  draft: Profile | null;
  saved: Profile | null;
  dirty: boolean;
  selectedWardId: string | null;
  draftPosition: { x: number; y: number } | null;
  filters: FilterState;
  toasts: Toast[];
}

export interface ExportResult {
  ok: boolean;
  reason?: 'cancelled' | 'save-failed' | 'changed-during-save' | 'empty';
  fileName?: string;
  content?: string;
}

const ALL_FACTIONS: Faction[] = ['radiant', 'dire'];
const ALL_PURPOSES: Purpose[] = ['offense', 'defense'];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class AppController {
  private state: AppState = {
    status: 'loading',
    startupError: null,
    profiles: [],
    draft: null,
    saved: null,
    dirty: false,
    selectedWardId: null,
    draftPosition: null,
    filters: { factions: new Set(ALL_FACTIONS), purposes: new Set(ALL_PURPOSES), tagSelection: null },
    toasts: [],
  };

  private listeners = new Set<() => void>();
  private deleted: RemovedWard | null = null;
  private screenshotCache = new Map<string, Blob>();
  private uploadingScreenshotIds = new Set<string>();
  private initPromise: Promise<void> | null = null;
  private savePromise: Promise<boolean> | null = null;

  constructor(
    private storage: StorageAdapter,
    private dialogs: DialogManager,
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private emit() {
    for (const listener of this.listeners) listener();
  }

  getState = (): AppState => this.state;

  private setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    if (this.state.status === 'ready') return Promise.resolve();
    const operation = this.initializeOnce();
    this.initPromise = operation;
    const clearPending = () => {
      if (this.initPromise === operation) this.initPromise = null;
    };
    operation.then(clearPending, clearPending);
    return operation;
  }

  private async initializeOnce(): Promise<void> {
    this.setState({ status: 'loading', startupError: null });
    try {
      const startupNotice = await this.storage.initialize?.();
      let profiles = await this.storage.listProfiles();
      if (profiles.length === 0) {
        const profile = createProfile('我的眼位', CURRENT_MAP_VERSION);
        await this.storage.saveProfile(profile);
        profiles = await this.storage.listProfiles();
      }
      // 列表按名称展示；启动时打开最近保存的资料，避免同名 Profile 让用户误以为修改丢失。
      const newest = profiles.reduce((selected, profile) => profile.updatedAt > selected.updatedAt ? profile : selected);
      const first = await this.storage.loadProfile(newest.id);
      const toasts = startupNotice ? [{ id: newId(), message: startupNotice }] : this.state.toasts;
      this.setState({ status: 'ready', startupError: null, profiles, draft: clone(first), saved: clone(first), toasts });
    } catch (error) {
      const message = error instanceof Error ? error.message : '本机数据服务初始化失败';
      this.setState({ status: 'error', startupError: message });
    }
  }

  private async refreshProfiles(): Promise<void> {
    const profiles = await this.storage.listProfiles();
    this.setState({ profiles });
  }

  private async waitForPendingSave(): Promise<boolean> {
    return this.savePromise ? this.savePromise : true;
  }

  allTags(): string[] {
    return this.state.draft ? collectAllTags(this.state.draft.wards) : [];
  }

  categoryFilter(): CategoryFilter {
    return { factions: this.state.filters.factions, purposes: this.state.filters.purposes };
  }

  selectedWard(): Ward | null {
    const { draft, selectedWardId } = this.state;
    return draft?.wards.find((ward) => ward.id === selectedWardId) ?? null;
  }

  private markDirty(draft: Profile) {
    this.setState({ draft, dirty: true });
  }

  // ---------- 筛选 ----------

  toggleFaction(faction: Faction): void {
    const factions = new Set(this.state.filters.factions);
    if (factions.has(faction)) factions.delete(faction);
    else factions.add(faction);
    this.setState({ filters: { ...this.state.filters, factions } });
  }

  togglePurpose(purpose: Purpose): void {
    const purposes = new Set(this.state.filters.purposes);
    if (purposes.has(purpose)) purposes.delete(purpose);
    else purposes.add(purpose);
    this.setState({ filters: { ...this.state.filters, purposes } });
  }

  toggleTag(tag: string): void {
    const current = this.state.filters.tagSelection;
    if (!this.allTags().includes(tag)) return;
    // 从“全部眼位”点击标签时直接筛选该标签；显式选中所有标签仍排除无标签眼位。
    const next = current === null ? new Set([tag]) : new Set(current);
    if (current !== null) {
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
    }
    this.setState({ filters: { ...this.state.filters, tagSelection: next } });
  }

  resetFilters(): void {
    this.setState({ filters: { factions: new Set(ALL_FACTIONS), purposes: new Set(ALL_PURPOSES), tagSelection: null } });
  }

  // ---------- 眼位编辑 ----------

  selectWard(id: string | null): void {
    if (this.state.selectedWardId === id) return;
    this.setState({ selectedWardId: id });
  }

  beginDraft(x: number, y: number): void {
    this.setState({ draftPosition: { x, y }, selectedWardId: null });
  }

  cancelDraft(): void {
    this.setState({ draftPosition: null });
  }

  confirmDraft(categories: CategoryKey[]): void {
    const { draft, draftPosition } = this.state;
    if (!draft || !draftPosition || categories.length === 0) return;
    const ward = createWard({ x: draftPosition.x, y: draftPosition.y, categories });
    const next = { ...draft, wards: [...draft.wards, ward], updatedAt: new Date().toISOString() };
    this.deleted = null;
    this.setState({ draftPosition: null, selectedWardId: ward.id });
    this.markDirty(next);
  }

  patchWard(id: string, patch: Partial<Omit<Ward, 'id' | 'createdAt'>>): void {
    const { draft } = this.state;
    if (!draft) return;
    this.markDirty(updateWard(draft, id, patch));
  }

  deleteWard(id: string): void {
    const { draft } = this.state;
    if (!draft) return;
    const { profile, removed } = removeWard(draft, id);
    if (!removed) return;
    this.deleted = removed;
    this.markDirty(profile);
    if (this.state.selectedWardId === id) this.setState({ selectedWardId: null });
    this.pushToast('已删除眼位，可撤销', { label: '撤销', run: () => this.undoDelete() });
  }

  undoDelete(): void {
    const { draft } = this.state;
    if (!draft || !this.deleted) return;
    const restored = restoreWard(draft, this.deleted);
    const wardId = this.deleted.ward.id;
    this.deleted = null;
    this.setState({ selectedWardId: wardId });
    this.markDirty(restored);
  }

  // ---------- 截图 ----------

  async addScreenshots(wardId: string, files: File[]): Promise<void> {
    const { draft } = this.state;
    if (!draft) return;
    const ward = draft.wards.find((w) => w.id === wardId);
    if (!ward) return;
    const accepted: string[] = [];
    const pendingIds: string[] = [];
    try {
      for (const file of files) {
        if (!(SCREENSHOT_ACCEPT as readonly string[]).includes(file.type)) {
          await this.dialogs.notice(`不支持的截图格式：${file.name}（仅 PNG / JPG / WebP）`);
          continue;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          await this.dialogs.notice(`截图超过 8 MB 限制：${file.name}`);
          continue;
        }
        const currentWard = this.state.draft?.id === draft.id ? this.state.draft.wards.find((w) => w.id === wardId) : null;
        if (!currentWard || currentWard.screenshotIds.length + accepted.length >= MAX_SCREENSHOTS_PER_WARD) {
          if (currentWard) await this.dialogs.notice(`每个眼位最多 ${MAX_SCREENSHOTS_PER_WARD} 张截图`);
          break;
        }
        const id = newId();
        pendingIds.push(id);
        this.uploadingScreenshotIds.add(id);
        try {
          await this.storage.putScreenshot(draft.id, wardId, id, file);
          this.screenshotCache.set(id, file);
          accepted.push(id);
        } catch (error) {
          console.error('截图保存失败', error);
          await this.dialogs.notice(`截图保存失败：${file.name}`);
        }
      }
      if (accepted.length > 0) {
        const currentWard = this.state.draft?.id === draft.id ? this.state.draft.wards.find((w) => w.id === wardId) : null;
        if (currentWard) {
          this.patchWard(wardId, { screenshotIds: [...currentWard.screenshotIds, ...accepted] });
        } else {
          for (const id of accepted) {
            await this.storage.deleteScreenshot(draft.id, id);
            this.screenshotCache.delete(id);
          }
        }
      }
    } finally {
      for (const id of pendingIds) this.uploadingScreenshotIds.delete(id);
    }
  }

  async removeScreenshot(wardId: string, screenshotId: string): Promise<void> {
    const ward = this.state.draft?.wards.find((w) => w.id === wardId);
    if (!ward) return;
    this.screenshotCache.delete(screenshotId);
    this.patchWard(wardId, { screenshotIds: ward.screenshotIds.filter((id) => id !== screenshotId) });
  }

  async getScreenshotBlob(screenshotId: string): Promise<Blob | null> {
    const cached = this.screenshotCache.get(screenshotId);
    if (cached) return cached;
    const { draft } = this.state;
    if (!draft) return null;
    const blob = await this.storage.getScreenshot(draft.id, screenshotId);
    if (blob) this.screenshotCache.set(screenshotId, blob);
    return blob;
  }

  // ---------- 保存 / 另存为 ----------

  private async cleanupOrphanScreenshots(profile: Profile): Promise<void> {
    const referenced = new Set(profile.wards.flatMap((ward) => ward.screenshotIds));
    const stored = await this.storage.listScreenshots(profile.id);
    for (const id of stored) {
      const current = this.state.draft?.id === profile.id ? this.state.draft : null;
      const referencedByCurrentDraft = current?.wards.some((ward) => ward.screenshotIds.includes(id)) ?? false;
      if (!referenced.has(id) && !referencedByCurrentDraft && !this.uploadingScreenshotIds.has(id)) {
        await this.storage.deleteScreenshot(profile.id, id);
        this.screenshotCache.delete(id);
      }
    }
  }

  save(): Promise<boolean> {
    if (this.savePromise) return this.savePromise;
    const operation = this.saveCurrentDraft();
    this.savePromise = operation;
    const clearPending = () => {
      if (this.savePromise === operation) this.savePromise = null;
    };
    operation.then(clearPending, clearPending);
    return operation;
  }

  private async saveCurrentDraft(): Promise<boolean> {
    const { draft } = this.state;
    if (!draft) return true;
    const deletedAtStart = this.deleted;
    try {
      const toSave = { ...draft, updatedAt: new Date().toISOString() };
      await this.storage.saveProfile(toSave);
      if (this.state.draft === draft) await this.cleanupOrphanScreenshots(toSave);
      if (this.deleted === deletedAtStart) this.deleted = null;
      const current = this.state.draft;
      if (current?.id === draft.id) {
        const unchanged = current === draft;
        this.setState({
          draft: unchanged ? clone(toSave) : current,
          saved: clone(toSave),
          dirty: !unchanged,
        });
      }
      await this.refreshProfiles();
      return true;
    } catch (error) {
      console.error('保存失败', error);
      await this.dialogs.notice('保存失败，修改仍保留在编辑器中，请重试。');
      return false;
    }
  }

  async saveAs(): Promise<boolean> {
    if (!(await this.waitForPendingSave())) return false;
    const initialDraft = this.state.draft;
    if (!initialDraft) return false;
    const name = await this.dialogs.promptName('另存为', uniqueProfileName(initialDraft.name, this.state.profiles.map((p) => p.name)));
    if (name === null) return false;
    const draft = this.state.draft;
    if (!draft) return false;
    try {
      const copy = cloneProfileAs(draft, name, this.state.profiles.map((p) => p.name));
      const shotIds = copy.wards.flatMap((ward) => ward.screenshotIds);
      await this.storage.copyScreenshots(draft.id, copy.id, shotIds);
      await this.storage.saveProfile(copy);
      if (this.state.draft === draft) {
        this.deleted = null;
        this.setState({ draft: clone(copy), saved: clone(copy), dirty: false, selectedWardId: null });
      } else if (this.state.draft?.id === draft.id) {
        await this.dialogs.notice('另存为副本已创建；期间的新修改仍留在原 Profile 中，尚未保存。');
      }
      await this.refreshProfiles();
      return true;
    } catch (error) {
      console.error('另存为失败', error);
      await this.dialogs.notice('另存为失败，修改仍保留在编辑器中，请重试。');
      return false;
    }
  }

  discardChanges(): void {
    const { saved } = this.state;
    if (!saved) return;
    this.deleted = null;
    this.setState({ draft: clone(saved), dirty: false, draftPosition: null, selectedWardId: null });
  }

  // ---------- 导出 ----------

  async exportFlow(): Promise<ExportResult> {
    const { draft, dirty } = this.state;
    if (!draft) return { ok: false, reason: 'empty' };
    if (dirty) {
      const choice = await this.dialogs.exportGuard();
      if (choice === 'cancel') return { ok: false, reason: 'cancelled' };
      const saved = choice === 'save' ? await this.save() : await this.saveAs();
      if (!saved) return { ok: false, reason: 'save-failed' };
      if (this.state.dirty) {
        await this.dialogs.notice('保存期间出现了新修改，本次未导出。请再次保存后导出。');
        return { ok: false, reason: 'changed-during-save' };
      }
    }
    const current = this.state.draft!;
    return {
      ok: true,
      fileName: `${current.name}.power-wards.json`,
      content: serializeProfile(current),
    };
  }

  // ---------- Profile 管理 ----------

  private async leaveGuardIfDirty(): Promise<boolean> {
    if (!(await this.waitForPendingSave())) return false;
    if (!this.state.dirty) return true;
    const choice = await this.dialogs.leaveGuard();
    if (choice === 'cancel') return false;
    if (choice === 'save') return this.save();
    this.discardChanges();
    return true;
  }

  async switchProfile(id: string): Promise<boolean> {
    if (this.state.draft?.id === id) return true;
    if (!(await this.leaveGuardIfDirty())) return false;
    const loaded = await this.storage.loadProfile(id);
    if (!loaded) {
      await this.dialogs.notice('无法读取该 Profile。');
      return false;
    }
    this.deleted = null;
    this.screenshotCache.clear();
    this.setState({
      draft: clone(loaded),
      saved: clone(loaded),
      dirty: false,
      selectedWardId: null,
      draftPosition: null,
      filters: { ...this.state.filters, tagSelection: null },
    });
    return true;
  }

  async createProfileFlow(): Promise<boolean> {
    if (!(await this.leaveGuardIfDirty())) return false;
    const name = await this.dialogs.promptName('新建 Profile', uniqueProfileName('新建 Profile', this.state.profiles.map((p) => p.name)));
    if (name === null) return false;
    const profile = createProfile(name, CURRENT_MAP_VERSION);
    await this.storage.saveProfile(profile);
    this.deleted = null;
    this.screenshotCache.clear();
    this.setState({
      draft: clone(profile),
      saved: clone(profile),
      dirty: false,
      selectedWardId: null,
      draftPosition: null,
      filters: { ...this.state.filters, tagSelection: null },
    });
    await this.refreshProfiles();
    return true;
  }

  async renameProfile(id: string, name: string): Promise<void> {
    if (!(await this.waitForPendingSave())) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = await this.storage.loadProfile(id);
    if (!target) return;
    const others = this.state.profiles.filter((p) => p.id !== id).map((p) => p.name);
    const renamed = { ...target, name: uniqueProfileName(trimmed, others), updatedAt: new Date().toISOString() };
    await this.storage.saveProfile(renamed);
    if (this.state.saved?.id === id) {
      const saved = clone(renamed);
      const draft = this.state.dirty && this.state.draft ? { ...this.state.draft, name: saved.name } : clone(renamed);
      this.setState({ saved, draft });
    }
    await this.refreshProfiles();
  }

  async deleteProfile(id: string): Promise<boolean> {
    if (!(await this.waitForPendingSave())) return false;
    const meta = this.state.profiles.find((p) => p.id === id);
    if (!meta) return false;
    if (!(await this.dialogs.confirm(`确定删除 Profile「${meta.name}」？该操作不可恢复。`))) return false;
    await this.storage.deleteProfile(id);
    this.screenshotCache.clear();
    let profiles = await this.storage.listProfiles();
    if (this.state.draft?.id === id) {
      if (profiles.length === 0) {
        const profile = createProfile('我的眼位', CURRENT_MAP_VERSION);
        await this.storage.saveProfile(profile);
        profiles = await this.storage.listProfiles();
      }
      const first = await this.storage.loadProfile(profiles[0].id);
      this.deleted = null;
      this.setState({
        draft: clone(first),
        saved: clone(first),
        dirty: false,
        selectedWardId: null,
        draftPosition: null,
        filters: { ...this.state.filters, tagSelection: null },
      });
    }
    this.setState({ profiles });
    return true;
  }

  // ---------- 导入 ----------

  async importFlow(text: string): Promise<boolean> {
    let decoded;
    try {
      decoded = decodeShare(text);
    } catch (error) {
      const message = error instanceof ShareFormatError ? error.message : '文件无法解析';
      await this.dialogs.notice(`导入失败：${message}`);
      return false;
    }
    if (!(await this.leaveGuardIfDirty())) return false;
    const profile = importAsProfile(decoded, this.state.profiles.map((p) => p.name));
    await this.storage.saveProfile(profile);
    this.deleted = null;
    this.screenshotCache.clear();
    this.setState({
      draft: clone(profile),
      saved: clone(profile),
      dirty: false,
      selectedWardId: null,
      draftPosition: null,
      filters: { ...this.state.filters, tagSelection: null },
    });
    await this.refreshProfiles();
    if (decoded.mapVersionMismatch) {
      await this.dialogs.notice(`已导入「${profile.name}」。地图版本不同（文件为 ${decoded.mapVersion}，当前为 ${CURRENT_MAP_VERSION}），眼位位置可能产生偏移。`);
    }
    return true;
  }

  // ---------- 关闭保护（桌面端） ----------

  async closeRequested(): Promise<boolean> {
    return this.leaveGuardIfDirty();
  }

  // ---------- 提示 ----------

  pushToast(message: string, action?: ToastAction): void {
    const toast: Toast = { id: newId(), message, action };
    this.setState({ toasts: [...this.state.toasts, toast] });
  }

  dismissToast(id: string): void {
    this.setState({ toasts: this.state.toasts.filter((toast) => toast.id !== id) });
  }
}
