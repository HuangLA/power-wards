import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorageAdapter } from '../storage/adapter';
import { AppController, DialogManager, ExportChoice, LeaveChoice } from './controller';
import { decodeShare } from '../domain/share';
import { wardMatchesTags } from '../domain/filter';
import { createProfile } from '../domain/profile';

class ScriptedDialogs implements DialogManager {
  leaveQueue: LeaveChoice[] = [];
  exportQueue: ExportChoice[] = [];
  nameQueue: (string | null)[] = [];
  confirmQueue: boolean[] = [];
  notices: string[] = [];
  promptTitles: string[] = [];

  leaveGuard(): Promise<LeaveChoice> {
    return Promise.resolve(this.leaveQueue.shift() ?? 'cancel');
  }
  exportGuard(): Promise<ExportChoice> {
    return Promise.resolve(this.exportQueue.shift() ?? 'cancel');
  }
  promptName(title: string, defaultName: string): Promise<string | null> {
    this.promptTitles.push(title);
    return Promise.resolve(this.nameQueue.length > 0 ? this.nameQueue.shift()! : defaultName);
  }
  confirm(): Promise<boolean> {
    return Promise.resolve(this.confirmQueue.shift() ?? false);
  }
  notice(message: string): Promise<void> {
    this.notices.push(message);
    return Promise.resolve();
  }
}

let storage: MemoryStorageAdapter;
let dialogs: ScriptedDialogs;
let controller: AppController;

beforeEach(async () => {
  storage = new MemoryStorageAdapter();
  dialogs = new ScriptedDialogs();
  controller = new AppController(storage, dialogs);
  await controller.init();
});

function draft() {
  return controller.getState().draft!;
}

async function addWardAndConfirm(x = 0.3, y = 0.4) {
  controller.beginDraft(x, y);
  controller.confirmDraft(['radiant-offense', 'dire-defense']);
  return draft().wards[draft().wards.length - 1];
}

describe('初始化与单 Profile（A01）', () => {
  it('首次启动自动创建默认 Profile', () => {
    expect(controller.getState().profiles).toHaveLength(1);
    expect(draft().name).toBe('我的眼位');
    expect(controller.getState().dirty).toBe(false);
  });

  it('开发模式重复初始化只创建一份默认 Profile，且不会重置当前编辑', async () => {
    const freshStorage = new MemoryStorageAdapter();
    const freshController = new AppController(freshStorage, new ScriptedDialogs());

    await Promise.all([freshController.init(), freshController.init()]);
    expect(await freshStorage.listProfiles()).toHaveLength(1);

    freshController.beginDraft(0.3, 0.4);
    freshController.confirmDraft(['radiant-offense']);
    await freshController.init();
    expect(freshController.getState().draft?.wards).toHaveLength(1);
    expect(freshController.getState().dirty).toBe(true);
  });

  it('重新启动时打开最近保存的 Profile，即使列表第一份是旧资料', async () => {
    const freshStorage = new MemoryStorageAdapter();
    const older = createProfile('A 旧资料', undefined, '2026-09-01T00:00:00.000Z');
    const newer = createProfile('Z 最近保存', undefined, '2026-09-02T00:00:00.000Z');
    await freshStorage.saveProfile(older);
    await freshStorage.saveProfile(newer);

    const freshController = new AppController(freshStorage, new ScriptedDialogs());
    await freshController.init();
    expect(freshController.getState().draft?.id).toBe(newer.id);
    expect(freshController.getState().profiles).toHaveLength(2);
  });

  it('本机服务暂不可用时显示启动错误，服务恢复后可重试', async () => {
    const reconnectStorage = new MemoryStorageAdapter() as MemoryStorageAdapter & { initialize?: () => Promise<string | null> };
    let serviceReady = false;
    reconnectStorage.initialize = async () => {
      if (!serviceReady) throw new Error('本机服务离线');
      return null;
    };
    const reconnectController = new AppController(reconnectStorage, new ScriptedDialogs());

    await reconnectController.init();
    expect(reconnectController.getState().status).toBe('error');
    expect(reconnectController.getState().startupError).toBe('本机服务离线');

    serviceReady = true;
    await reconnectController.init();
    expect(reconnectController.getState().status).toBe('ready');
    expect(reconnectController.getState().profiles).toHaveLength(1);
  });

  it('切换 Profile 后地图数据仅为当前 Profile，不叠加', async () => {
    await addWardAndConfirm();
    await controller.save();
    const firstId = draft().id;

    dialogs.nameQueue = ['第二套'];
    await controller.createProfileFlow();
    expect(draft().wards).toHaveLength(0);

    await addWardAndConfirm(0.8, 0.8);
    await controller.save();
    await controller.switchProfile(firstId);
    expect(draft().wards).toHaveLength(1);
    expect(draft().wards[0].x).toBe(0.3);
  });
});

describe('编辑与保存（A02、A03）', () => {
  it('编辑置未保存标记，保存后重新读取仍保留修改', async () => {
    const ward = await addWardAndConfirm();
    expect(controller.getState().dirty).toBe(true);
    controller.patchWard(ward.id, { name: '河道高台眼', tags: ['河道'], description: '插眼前砍树' });
    await controller.save();
    expect(controller.getState().dirty).toBe(false);

    const reloaded = await storage.loadProfile(draft().id);
    expect(reloaded!.wards[0].name).toBe('河道高台眼');
    expect(reloaded!.wards[0].tags).toEqual(['河道']);
  });

  it('另存为创建新 Profile，原 Profile 已保存内容不被覆盖', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '原始名字' });
    await controller.save();
    const originalId = draft().id;

    controller.patchWard(ward.id, { name: '改过的名字' });
    dialogs.nameQueue = ['另存副本'];
    expect(await controller.saveAs()).toBe(true);

    expect(draft().name).toBe('另存副本');
    expect(draft().id).not.toBe(originalId);
    expect(controller.getState().dirty).toBe(false);

    const original = await storage.loadProfile(originalId);
    expect(original!.wards[0].name).toBe('原始名字');
    const copy = await storage.loadProfile(draft().id);
    expect(copy!.wards[0].name).toBe('改过的名字');
  });

  it('另存为等待期间的新编辑仍留在原 Profile 并保持未保存', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '副本初始内容' });
    const originalId = draft().id;
    dialogs.nameQueue = ['并发副本'];
    let releaseCopy!: () => void;
    let notifyCopyStarted!: () => void;
    const copyStarted = new Promise<void>((resolve) => (notifyCopyStarted = resolve));
    storage.copyScreenshots = async () => {
      notifyCopyStarted();
      await new Promise<void>((resolve) => (releaseCopy = resolve));
    };

    const pendingSaveAs = controller.saveAs();
    await copyStarted;
    controller.patchWard(ward.id, { description: '另存为期间的新说明' });
    releaseCopy();
    expect(await pendingSaveAs).toBe(true);
    expect(draft().id).toBe(originalId);
    expect(draft().wards[0].description).toBe('另存为期间的新说明');
    expect(controller.getState().dirty).toBe(true);
    expect((await storage.loadProfile(controller.getState().profiles.find((p) => p.name === '并发副本')!.id))!.wards[0].description).toBe('');
  });

  it('保存失败保留编辑内容与未保存标记', async () => {
    await addWardAndConfirm();
    storage.saveProfile = () => Promise.reject(new Error('磁盘错误'));
    expect(await controller.save()).toBe(false);
    expect(controller.getState().dirty).toBe(true);
    expect(draft().wards).toHaveLength(1);
    expect(dialogs.notices.some((m) => m.includes('保存失败'))).toBe(true);
  });

  it('保存等待期间的新编辑不会被旧快照覆盖', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '开始保存时的名字' });
    const writeNormally = storage.saveProfile.bind(storage);
    let releaseWrite!: () => void;
    let firstWrite = true;
    storage.saveProfile = async (profile) => {
      if (firstWrite) {
        firstWrite = false;
        const snapshot = structuredClone(profile);
        await new Promise<void>((resolve) => (releaseWrite = resolve));
        await writeNormally(snapshot);
        return;
      }
      await writeNormally(profile);
    };

    const pendingSave = controller.save();
    controller.patchWard(ward.id, { name: '保存期间的新名字' });
    releaseWrite();
    expect(await pendingSave).toBe(true);
    expect(draft().wards[0].name).toBe('保存期间的新名字');
    expect(controller.getState().saved!.wards[0].name).toBe('开始保存时的名字');
    expect(controller.getState().dirty).toBe(true);

    expect(await controller.save()).toBe(true);
    expect(controller.getState().dirty).toBe(false);
    expect((await storage.loadProfile(draft().id))!.wards[0].name).toBe('保存期间的新名字');
  });

  it('Profile 删除等待正在进行的保存，避免已删除资料被异步写回', async () => {
    await addWardAndConfirm();
    const id = draft().id;
    const writeNormally = storage.saveProfile.bind(storage);
    let releaseWrite!: () => void;
    const pendingSaveGate = new Promise<void>((resolve) => (releaseWrite = resolve));
    storage.saveProfile = async (profile) => {
      const snapshot = structuredClone(profile);
      await pendingSaveGate;
      await writeNormally(snapshot);
    };
    dialogs.confirmQueue = [true];

    const pendingSave = controller.save();
    const pendingDelete = controller.deleteProfile(id);
    releaseWrite();
    expect(await pendingSave).toBe(true);
    expect(await pendingDelete).toBe(true);
    expect(await storage.loadProfile(id)).toBeNull();
  });
});

describe('导出前保存守卫（A14）', () => {
  it('有未保存修改时取消导出，不生成内容', async () => {
    await addWardAndConfirm();
    dialogs.exportQueue = ['cancel'];
    const result = await controller.exportFlow();
    expect(result.ok).toBe(false);
    expect(result.content).toBeUndefined();
  });

  it('选择保存后导出保存结果', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '导出前的名字' });
    dialogs.exportQueue = ['save'];
    const result = await controller.exportFlow();
    expect(result.ok).toBe(true);
    expect(controller.getState().dirty).toBe(false);
    const decoded = decodeShare(result.content!);
    expect(decoded.wards[0].name).toBe('导出前的名字');
  });

  it('保存失败时不导出', async () => {
    await addWardAndConfirm();
    dialogs.exportQueue = ['save'];
    storage.saveProfile = () => Promise.reject(new Error('磁盘错误'));
    const result = await controller.exportFlow();
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('save-failed');
    expect(result.content).toBeUndefined();
  });

  it('保存进行中出现新修改时阻止导出', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '导出快照' });
    dialogs.exportQueue = ['save'];
    const writeNormally = storage.saveProfile.bind(storage);
    let releaseWrite!: () => void;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => (notifyStarted = resolve));
    storage.saveProfile = async (profile) => {
      const snapshot = structuredClone(profile);
      notifyStarted();
      await new Promise<void>((resolve) => (releaseWrite = resolve));
      await writeNormally(snapshot);
    };

    const pendingExport = controller.exportFlow();
    await started;
    controller.patchWard(ward.id, { description: '保存过程中新增的内容' });
    releaseWrite();
    const result = await pendingExport;
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('changed-during-save');
    expect(result.content).toBeUndefined();
    expect(controller.getState().dirty).toBe(true);
    expect(draft().wards[0].description).toBe('保存过程中新增的内容');
  });

  it('无修改时直接导出当前已保存内容', async () => {
    await addWardAndConfirm();
    await controller.save();
    const result = await controller.exportFlow();
    expect(result.ok).toBe(true);
    expect(dialogs.exportQueue).toHaveLength(0);
  });

  it('导出的 JSON 不含截图信息', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { screenshotIds: ['local-shot'] });
    await controller.save();
    const result = await controller.exportFlow();
    expect(result.content).not.toContain('local-shot');
  });
});

describe('离开保护（A10）', () => {
  it('切换时选择保存：持久化后切换', async () => {
    await addWardAndConfirm();
    const originalId = draft().id;
    dialogs.leaveQueue = ['save'];
    dialogs.nameQueue = ['另一套'];
    await controller.createProfileFlow();

    controller.beginDraft(0.9, 0.9);
    controller.confirmDraft(['dire-offense']);
    dialogs.leaveQueue = ['save'];
    expect(await controller.switchProfile(originalId)).toBe(true);

    const secondMeta = controller.getState().profiles.find((p) => p.id !== originalId)!;
    const second = await storage.loadProfile(secondMeta.id);
    expect(second!.wards).toHaveLength(1);
    expect(controller.getState().dirty).toBe(false);
  });

  it('切换时选择放弃：恢复已保存内容后切换', async () => {
    await addWardAndConfirm();
    await controller.save();
    const originalId = draft().id;

    dialogs.nameQueue = ['另一套'];
    await controller.createProfileFlow();
    controller.beginDraft(0.9, 0.9);
    controller.confirmDraft(['dire-offense']);
    expect(controller.getState().dirty).toBe(true);

    dialogs.leaveQueue = ['discard'];
    expect(await controller.switchProfile(originalId)).toBe(true);
    const secondMeta = controller.getState().profiles.find((p) => p.id !== originalId)!;
    const second = await storage.loadProfile(secondMeta.id);
    expect(second!.wards).toHaveLength(0);
  });

  it('切换时选择取消：保留当前编辑状态', async () => {
    await addWardAndConfirm();
    const originalId = draft().id;
    dialogs.leaveQueue = ['save'];
    dialogs.nameQueue = ['另一套'];
    await controller.createProfileFlow();
    controller.beginDraft(0.9, 0.9);
    controller.confirmDraft(['dire-offense']);
    const editingId = draft().id;

    dialogs.leaveQueue = ['cancel'];
    expect(await controller.switchProfile(originalId)).toBe(false);
    expect(draft().id).toBe(editingId);
    expect(draft().wards).toHaveLength(1);
    expect(controller.getState().dirty).toBe(true);
  });
});

describe('导入（A09）', () => {
  async function exportCurrent() {
    await controller.save();
    const result = await controller.exportFlow();
    return result.content!;
  }

  it('导入创建独立 Profile，同名自动加后缀，重复导入不覆盖', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '分享眼位' });
    const text = await exportCurrent();

    expect(await controller.importFlow(text)).toBe(true);
    expect(draft().name).toBe('我的眼位 (2)');
    expect(await controller.importFlow(text)).toBe(true);
    expect(draft().name).toBe('我的眼位 (3)');
    expect(controller.getState().profiles).toHaveLength(3);

    const metas = controller.getState().profiles;
    const first = await storage.loadProfile(metas.find((p) => p.name === '我的眼位 (2)')!.id);
    first!.wards[0].name = '本地改动不影响来源';
    expect((await storage.loadProfile(metas.find((p) => p.name === '我的眼位 (3)')!.id))!.wards[0].name).toBe('分享眼位');
  });

  it('异地图版本允许导入并明确提示可能偏移', async () => {
    await addWardAndConfirm();
    const text = await exportCurrent();
    const older = text.replace('"mapVersion": "7.41"', '"mapVersion": "7.40"');
    expect(await controller.importFlow(older)).toBe(true);
    expect(dialogs.notices.some((m) => m.includes('眼位位置可能产生偏移'))).toBe(true);
    expect(draft().mapVersion).toBe('7.40');
  });

  it('损坏文件导入失败并给出提示，不影响当前资料', async () => {
    await addWardAndConfirm();
    const before = draft();
    expect(await controller.importFlow('{"broken": true}')).toBe(false);
    expect(dialogs.notices.some((m) => m.includes('导入失败'))).toBe(true);
    expect(draft()).toEqual(before);
  });
});

describe('删除与撤销（A15）', () => {
  it('删除后眼位不显示，撤销完整恢复资料与截图关联', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '要删的眼位', tags: ['河道'], description: '说明', screenshotIds: ['shot-x'] });

    controller.deleteWard(ward.id);
    expect(draft().wards).toHaveLength(0);

    controller.undoDelete();
    expect(draft().wards).toHaveLength(1);
    const restored = draft().wards[0];
    expect(restored.id).toBe(ward.id);
    expect(restored.name).toBe('要删的眼位');
    expect(restored.tags).toEqual(['河道']);
    expect(restored.description).toBe('说明');
    expect(restored.screenshotIds).toEqual(['shot-x']);
    expect(restored.x).toBe(0.3);
  });

  it('重新定位只更新位置并标记未保存', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { name: '保留我' });
    await controller.save();
    controller.patchWard(ward.id, { x: 0.77, y: 0.88 });
    expect(controller.getState().dirty).toBe(true);
    const moved = draft().wards[0];
    expect(moved.x).toBe(0.77);
    expect(moved.name).toBe('保留我');
  });
});

describe('筛选状态', () => {
  it('点击标签从全部眼位进入单标签筛选，随后可多选和全不选', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { tags: ['河道', '高台'] });
    controller.toggleTag('河道');
    expect(controller.getState().filters.tagSelection).toEqual(new Set(['河道']));
    controller.toggleTag('高台');
    expect(controller.getState().filters.tagSelection).toEqual(new Set(['河道', '高台']));
    expect(wardMatchesTags({ tags: [] }, controller.getState().filters.tagSelection)).toBe(false);
    controller.toggleTag('河道');
    expect(controller.getState().filters.tagSelection).toEqual(new Set(['高台']));
    controller.toggleTag('高台');
    expect(controller.getState().filters.tagSelection).toEqual(new Set());
    expect(wardMatchesTags({ tags: ['河道'] }, controller.getState().filters.tagSelection)).toBe(false);
    expect(wardMatchesTags({ tags: [] }, controller.getState().filters.tagSelection)).toBe(false);
    controller.toggleFaction('dire');
    controller.togglePurpose('defense');
    controller.resetFilters();
    expect(controller.getState().filters.tagSelection).toBeNull();
    expect(controller.getState().filters.factions).toEqual(new Set(['radiant', 'dire']));
    expect(controller.getState().filters.purposes).toEqual(new Set(['offense', 'defense']));
    expect(wardMatchesTags({ tags: [] }, controller.getState().filters.tagSelection)).toBe(true);
  });

  it('只有一个标签时，点击它会排除未标记的眼位', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { tags: ['需要砍树'] });
    controller.toggleTag('需要砍树');
    expect(controller.getState().filters.tagSelection).toEqual(new Set(['需要砍树']));
    expect(wardMatchesTags({ tags: [] }, controller.getState().filters.tagSelection)).toBe(false);
  });

  it('切换 Profile 后标签筛选重置，阵营/用途保留', async () => {
    const ward = await addWardAndConfirm();
    controller.patchWard(ward.id, { tags: ['河道'] });
    controller.toggleTag('河道');
    controller.toggleFaction('dire');
    await controller.save();

    dialogs.nameQueue = ['另一套'];
    await controller.createProfileFlow();
    expect(controller.getState().filters.tagSelection).toBeNull();
    expect(controller.getState().filters.factions.has('dire')).toBe(false);
    expect(controller.getState().filters.factions.has('radiant')).toBe(true);
  });
});
