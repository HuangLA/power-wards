import { Profile, ProfileMeta } from '../domain/types';
import { StorageAdapter, toMeta } from './adapter';

const DB_NAME = 'power-wards';
const DB_VERSION = 1;
const PROFILE_STORE = 'profiles';
const SCREENSHOT_STORE = 'screenshots';

interface ScreenshotRecord {
  key: string;
  profileId: string;
  blob: Blob;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PROFILE_STORE)) db.createObjectStore(PROFILE_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(SCREENSHOT_STORE)) {
        const store = db.createObjectStore(SCREENSHOT_STORE, { keyPath: 'key' });
        store.createIndex('byProfile', 'profileId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('无法打开本地数据库'));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('本地数据库操作失败'));
    tx.onabort = () => reject(tx.error ?? new Error('本地数据库操作被中止'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('本地数据库读取失败'));
  });
}

export class WebStorageAdapter implements StorageAdapter {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDatabase();
    return this.dbPromise;
  }

  async listProfiles(): Promise<ProfileMeta[]> {
    const db = await this.db();
    const tx = db.transaction(PROFILE_STORE, 'readonly');
    const profiles = await requestValue(tx.objectStore(PROFILE_STORE).getAll() as IDBRequest<Profile[]>);
    return profiles.map(toMeta).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async loadProfile(id: string): Promise<Profile | null> {
    const db = await this.db();
    const tx = db.transaction(PROFILE_STORE, 'readonly');
    const result = await requestValue(tx.objectStore(PROFILE_STORE).get(id) as IDBRequest<Profile | undefined>);
    return result ?? null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(PROFILE_STORE, 'readwrite');
    tx.objectStore(PROFILE_STORE).put(profile);
    await txDone(tx);
  }

  async deleteProfile(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([PROFILE_STORE, SCREENSHOT_STORE], 'readwrite');
    tx.objectStore(PROFILE_STORE).delete(id);
    const index = tx.objectStore(SCREENSHOT_STORE).index('byProfile');
    const keys = await requestValue(index.getAllKeys(id));
    for (const key of keys) tx.objectStore(SCREENSHOT_STORE).delete(key);
    await txDone(tx);
  }

  private screenshotKey(profileId: string, screenshotId: string): string {
    return `${profileId}/${screenshotId}`;
  }

  async putScreenshot(profileId: string, _wardId: string, screenshotId: string, data: Blob): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(SCREENSHOT_STORE, 'readwrite');
    const record: ScreenshotRecord = { key: this.screenshotKey(profileId, screenshotId), profileId, blob: data };
    tx.objectStore(SCREENSHOT_STORE).put(record);
    await txDone(tx);
  }

  async getScreenshot(profileId: string, screenshotId: string): Promise<Blob | null> {
    const db = await this.db();
    const tx = db.transaction(SCREENSHOT_STORE, 'readonly');
    const record = await requestValue(tx.objectStore(SCREENSHOT_STORE).get(this.screenshotKey(profileId, screenshotId)) as IDBRequest<ScreenshotRecord | undefined>);
    return record?.blob ?? null;
  }

  async deleteScreenshot(profileId: string, screenshotId: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(SCREENSHOT_STORE, 'readwrite');
    tx.objectStore(SCREENSHOT_STORE).delete(this.screenshotKey(profileId, screenshotId));
    await txDone(tx);
  }

  async listScreenshots(profileId: string): Promise<string[]> {
    const db = await this.db();
    const tx = db.transaction(SCREENSHOT_STORE, 'readonly');
    const records = await requestValue(tx.objectStore(SCREENSHOT_STORE).index('byProfile').getAll(profileId) as IDBRequest<ScreenshotRecord[]>);
    return records.map((record) => record.key.slice(profileId.length + 1));
  }

  async copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void> {
    if (screenshotIds.length === 0) return;
    const db = await this.db();
    const tx = db.transaction(SCREENSHOT_STORE, 'readwrite');
    const store = tx.objectStore(SCREENSHOT_STORE);
    for (const id of screenshotIds) {
      const record = await requestValue(store.get(this.screenshotKey(fromProfileId, id)) as IDBRequest<ScreenshotRecord | undefined>);
      if (record) store.put({ key: this.screenshotKey(toProfileId, id), profileId: toProfileId, blob: record.blob } satisfies ScreenshotRecord);
    }
    await txDone(tx);
  }
}
