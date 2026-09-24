import { Profile, ProfileMeta } from '../domain/types';
import { StorageAdapter } from './adapter';
import { LocalApiStorageAdapter } from './localApi';

export interface DesktopBridge {
  platform: 'electron';
  storage: {
    listProfiles(): Promise<ProfileMeta[]>;
    loadProfile(id: string): Promise<Profile | null>;
    saveProfile(profile: Profile): Promise<void>;
    deleteProfile(id: string): Promise<void>;
    putScreenshot(profileId: string, wardId: string, screenshotId: string, data: ArrayBuffer, type: string): Promise<void>;
    getScreenshot(profileId: string, screenshotId: string): Promise<{ data: ArrayBuffer; type: string } | null>;
    deleteScreenshot(profileId: string, screenshotId: string): Promise<void>;
    listScreenshots(profileId: string): Promise<string[]>;
    copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void>;
  };
  onCloseRequest(handler: () => void): void;
  confirmClose(): void;
  exportFile(fileName: string, content: string): Promise<string | null>;
  importFile(): Promise<{ name: string; content: string } | null>;
}

declare global {
  interface Window {
    powerWards?: DesktopBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.powerWards;
}

class ElectronStorageAdapter implements StorageAdapter {
  constructor(private bridge: DesktopBridge) {}

  listProfiles(): Promise<ProfileMeta[]> {
    return this.bridge.storage.listProfiles();
  }
  loadProfile(id: string): Promise<Profile | null> {
    return this.bridge.storage.loadProfile(id);
  }
  saveProfile(profile: Profile): Promise<void> {
    return this.bridge.storage.saveProfile(profile);
  }
  deleteProfile(id: string): Promise<void> {
    return this.bridge.storage.deleteProfile(id);
  }
  async putScreenshot(profileId: string, wardId: string, screenshotId: string, data: Blob): Promise<void> {
    const buffer = await data.arrayBuffer();
    return this.bridge.storage.putScreenshot(profileId, wardId, screenshotId, buffer, data.type || 'image/png');
  }
  async getScreenshot(profileId: string, screenshotId: string): Promise<Blob | null> {
    const result = await this.bridge.storage.getScreenshot(profileId, screenshotId);
    return result ? new Blob([result.data], { type: result.type }) : null;
  }
  deleteScreenshot(profileId: string, screenshotId: string): Promise<void> {
    return this.bridge.storage.deleteScreenshot(profileId, screenshotId);
  }
  listScreenshots(profileId: string): Promise<string[]> {
    return this.bridge.storage.listScreenshots(profileId);
  }
  copyScreenshots(fromProfileId: string, toProfileId: string, screenshotIds: string[]): Promise<void> {
    return this.bridge.storage.copyScreenshots(fromProfileId, toProfileId, screenshotIds);
  }
}

export function createStorage(): StorageAdapter {
  if (isDesktop()) return new ElectronStorageAdapter(window.powerWards!);
  return new LocalApiStorageAdapter();
}
