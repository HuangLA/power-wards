import { cloneProfileAs, uniqueProfileName } from '../domain/profile';
import { MAX_PROFILE_NAME_LENGTH, Profile, ProfileMeta } from '../domain/types';
import { StorageAdapter } from './adapter';
import { openExistingLegacyDatabase, WebStorageAdapter } from './webStorage';

const LOCAL_DEV_API_ORIGIN = import.meta.env.VITE_LOCAL_API_ORIGIN || 'http://127.0.0.1:4174';
const API_ROOT = `${import.meta.env.DEV ? LOCAL_DEV_API_ORIGIN : ''}/api/v1`;
const MIGRATION_MARKER_PREFIX = 'power-wards:legacy-browser-migration:';

interface LocalServiceHealth {
  service: string;
  apiVersion: number;
  instanceId: string;
}

async function responseError(response: Response): Promise<Error> {
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string') return new Error(body.error);
  } catch {}
  return new Error(`本机数据服务请求失败（HTTP ${response.status}）`);
}

function profileEqual(left: Profile, right: Profile): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function migrateLegacyProfiles(target: StorageAdapter, legacy: WebStorageAdapter): Promise<{ profiles: number; screenshots: number }> {
  const oldProfiles = await legacy.listProfiles();
  let migratedProfiles = 0;
  let migratedScreenshots = 0;

  for (const meta of oldProfiles) {
    const source = await legacy.loadProfile(meta.id);
    if (!source) throw new Error(`旧浏览器资料「${meta.name}」无法读取；原资料仍保留在浏览器数据库中。`);

    const existing = await target.loadProfile(source.id);
    const currentNames = (await target.listProfiles()).map((profile) => profile.name);
    let destination = source;
    if (existing && !profileEqual(existing, source)) {
      const suffix = '（旧浏览器迁移）';
      const name = uniqueProfileName(`${source.name.slice(0, MAX_PROFILE_NAME_LENGTH - suffix.length - 10)}${suffix}`, currentNames);
      destination = cloneProfileAs(source, name, currentNames);
    }

    const screenshotIds = await legacy.listScreenshots(source.id);
    const screenshotSet = new Set(screenshotIds);
    for (const ward of source.wards) {
      for (const screenshotId of ward.screenshotIds) {
        if (!screenshotSet.has(screenshotId)) {
          throw new Error(`旧 Profile「${source.name}」缺少关联截图；迁移已停止，浏览器中的原资料没有删除。`);
        }
      }
    }

    for (const screenshotId of screenshotIds) {
      const blob = await legacy.getScreenshot(source.id, screenshotId);
      if (!blob) throw new Error(`旧 Profile「${source.name}」的截图无法读取；迁移已停止，原资料没有删除。`);
      await target.putScreenshot(destination.id, '', screenshotId, blob);
      const copied = await target.getScreenshot(destination.id, screenshotId);
      if (!copied || copied.size !== blob.size || copied.type !== blob.type) {
        throw new Error(`截图「${screenshotId}」写入本机文件失败；原资料没有删除。`);
      }
      migratedScreenshots += 1;
    }

    await target.saveProfile(destination);
    const saved = await target.loadProfile(destination.id);
    if (!saved || !profileEqual(saved, destination)) throw new Error(`Profile「${destination.name}」写入本机文件失败；原资料没有删除。`);
    migratedProfiles += 1;
  }

  return { profiles: migratedProfiles, screenshots: migratedScreenshots };
}

export class LocalApiStorageAdapter implements StorageAdapter {
  private initialized: Promise<string | null> | null = null;

  private async request(path: string, init?: RequestInit): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${API_ROOT}${path}`, init);
    } catch {
      throw new Error('无法连接本机数据服务。请确认 Power Wards 本机服务正在运行，然后重试。');
    }
    if (!response.ok) throw await responseError(response);
    return response;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return await (await this.request(path, init)).json() as T;
  }

  private profileUrl(id: string): string {
    return `/profiles/${encodeURIComponent(id)}`;
  }

  initialize(): Promise<string | null> {
    if (!this.initialized) {
      const operation = this.initializeOnce();
      this.initialized = operation;
      operation.catch(() => {
        if (this.initialized === operation) this.initialized = null;
      });
    }
    return this.initialized;
  }

  private async initializeOnce(): Promise<string | null> {
    const health = await this.json<LocalServiceHealth>('/health');
    if (health.service !== 'power-wards-local' || health.apiVersion !== 1 || !health.instanceId) {
      throw new Error('本机数据服务版本不兼容，请更新 Power Wards 后重试。');
    }

    const marker = `${MIGRATION_MARKER_PREFIX}${health.instanceId}`;
    try {
      if (localStorage.getItem(marker) === 'complete') return null;
    } catch {}

    const database = await openExistingLegacyDatabase();
    if (!database) {
      try { localStorage.setItem(marker, 'complete'); } catch {}
      return null;
    }

    try {
      const migration = await migrateLegacyProfiles(this, new WebStorageAdapter(database));
      try { localStorage.setItem(marker, 'complete'); } catch {}
      if (migration.profiles === 0) return null;
      const screenshotNote = migration.screenshots > 0 ? `及 ${migration.screenshots} 张截图` : '';
      return `已将旧浏览器中的 ${migration.profiles} 个 Profile${screenshotNote}迁移到本机文件；浏览器中的旧数据仍保留。`;
    } finally {
      database.close();
    }
  }

  listProfiles(): Promise<ProfileMeta[]> {
    return this.json('/profiles');
  }

  async loadProfile(id: string): Promise<Profile | null> {
    const response = await fetch(`${API_ROOT}${this.profileUrl(id)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response);
    return await response.json() as Profile;
  }

  async saveProfile(profile: Profile): Promise<void> {
    await this.request(this.profileUrl(profile.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
  }

  async deleteProfile(id: string): Promise<void> {
    await this.request(this.profileUrl(id), { method: 'DELETE' });
  }

  async putScreenshot(profileId: string, _wardId: string, screenshotId: string, data: Blob): Promise<void> {
    await this.request(`${this.profileUrl(profileId)}/screenshots/${encodeURIComponent(screenshotId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': data.type || 'image/png' },
      body: data,
    });
  }

  async getScreenshot(profileId: string, screenshotId: string): Promise<Blob | null> {
    const response = await fetch(`${API_ROOT}${this.profileUrl(profileId)}/screenshots/${encodeURIComponent(screenshotId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response);
    return await response.blob();
  }

  async deleteScreenshot(profileId: string, screenshotId: string): Promise<void> {
    await this.request(`${this.profileUrl(profileId)}/screenshots/${encodeURIComponent(screenshotId)}`, { method: 'DELETE' });
  }

  listScreenshots(profileId: string): Promise<string[]> {
    return this.json(`${this.profileUrl(profileId)}/screenshots`);
  }

  async copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void> {
    await this.request(`${this.profileUrl(fromProfileId)}/copy-screenshots/${encodeURIComponent(toProfileId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: screenshotIds }),
    });
  }
}
