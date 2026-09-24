import { Profile, ProfileMeta } from '../domain/types';

export interface ScreenshotData {
  id: string;
  type: string;
  blob: Blob;
}

export interface StorageAdapter {
  initialize?(): Promise<string | null>;
  listProfiles(): Promise<ProfileMeta[]>;
  loadProfile(id: string): Promise<Profile | null>;
  saveProfile(profile: Profile): Promise<void>;
  deleteProfile(id: string): Promise<void>;

  putScreenshot(profileId: string, wardId: string, screenshotId: string, data: Blob): Promise<void>;
  getScreenshot(profileId: string, screenshotId: string): Promise<Blob | null>;
  deleteScreenshot(profileId: string, screenshotId: string): Promise<void>;
  listScreenshots(profileId: string): Promise<string[]>;
  copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void>;
}

export function toMeta(profile: Profile): ProfileMeta {
  return {
    id: profile.id,
    name: profile.name,
    mapVersion: profile.mapVersion,
    wardCount: profile.wards.length,
    updatedAt: profile.updatedAt,
  };
}

export class MemoryStorageAdapter implements StorageAdapter {
  profiles = new Map<string, Profile>();
  screenshots = new Map<string, Map<string, Blob>>();

  async listProfiles(): Promise<ProfileMeta[]> {
    return [...this.profiles.values()].map(toMeta).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  async loadProfile(id: string): Promise<Profile | null> {
    const profile = this.profiles.get(id);
    return profile ? structuredClone(profile) : null;
  }

  async saveProfile(profile: Profile): Promise<void> {
    this.profiles.set(profile.id, structuredClone(profile));
  }

  async deleteProfile(id: string): Promise<void> {
    this.profiles.delete(id);
    this.screenshots.delete(id);
  }

  async putScreenshot(profileId: string, _wardId: string, screenshotId: string, data: Blob): Promise<void> {
    if (!this.screenshots.has(profileId)) this.screenshots.set(profileId, new Map());
    this.screenshots.get(profileId)!.set(screenshotId, data);
  }

  async getScreenshot(profileId: string, screenshotId: string): Promise<Blob | null> {
    return this.screenshots.get(profileId)?.get(screenshotId) ?? null;
  }

  async deleteScreenshot(profileId: string, screenshotId: string): Promise<void> {
    this.screenshots.get(profileId)?.delete(screenshotId);
  }

  async listScreenshots(profileId: string): Promise<string[]> {
    return [...(this.screenshots.get(profileId)?.keys() ?? [])];
  }

  async copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void> {
    const source = this.screenshots.get(fromProfileId);
    if (!source) return;
    if (!this.screenshots.has(toProfileId)) this.screenshots.set(toProfileId, new Map());
    const target = this.screenshots.get(toProfileId)!;
    for (const id of screenshotIds) {
      const blob = source.get(id);
      if (blob) target.set(id, blob);
    }
  }
}
