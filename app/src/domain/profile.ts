import {
  CategoryKey,
  CURRENT_MAP_VERSION,
  DEFAULT_WARD_COLOR,
  MAX_PROFILE_NAME_LENGTH,
  Profile,
  Ward,
  newId,
} from './types';

export function uniqueProfileName(desired: string, existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  const base = desired.trim() || '未命名 Profile';
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
}

export function createProfile(name: string, mapVersion: string = CURRENT_MAP_VERSION, now: string = new Date().toISOString()): Profile {
  return {
    id: newId(),
    name: name.trim().slice(0, MAX_PROFILE_NAME_LENGTH) || '未命名 Profile',
    mapVersion,
    wards: [],
    createdAt: now,
    updatedAt: now,
  };
}

export interface NewWardInput {
  x: number;
  y: number;
  categories: CategoryKey[];
  name?: string;
}

export function createWard(input: NewWardInput, now: string = new Date().toISOString()): Ward {
  return {
    id: newId(),
    x: input.x,
    y: input.y,
    name: (input.name ?? '').trim() || '未命名眼位',
    color: DEFAULT_WARD_COLOR,
    categories: [...new Set(input.categories)],
    tags: [],
    description: '',
    screenshotIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function addWard(profile: Profile, ward: Ward, now: string = new Date().toISOString()): Profile {
  return { ...profile, wards: [...profile.wards, ward], updatedAt: now };
}

export function updateWard(profile: Profile, wardId: string, patch: Partial<Omit<Ward, 'id' | 'createdAt'>>, now: string = new Date().toISOString()): Profile {
  return {
    ...profile,
    wards: profile.wards.map((ward) => (ward.id === wardId ? { ...ward, ...patch, id: ward.id, createdAt: ward.createdAt, updatedAt: now } : ward)),
    updatedAt: now,
  };
}

export interface RemovedWard {
  ward: Ward;
  index: number;
}

export function removeWard(profile: Profile, wardId: string, now: string = new Date().toISOString()): { profile: Profile; removed: RemovedWard | null } {
  const index = profile.wards.findIndex((ward) => ward.id === wardId);
  if (index < 0) return { profile, removed: null };
  const removed: RemovedWard = { ward: profile.wards[index], index };
  return { profile: { ...profile, wards: profile.wards.filter((ward) => ward.id !== wardId), updatedAt: now }, removed };
}

export function restoreWard(profile: Profile, removed: RemovedWard, now: string = new Date().toISOString()): Profile {
  if (profile.wards.some((ward) => ward.id === removed.ward.id)) return profile;
  const wards = [...profile.wards];
  wards.splice(Math.min(removed.index, wards.length), 0, removed.ward);
  return { ...profile, wards, updatedAt: now };
}

export function cloneProfileAs(source: Profile, name: string, existingNames: readonly string[], now: string = new Date().toISOString()): Profile {
  return {
    ...source,
    id: newId(),
    name: uniqueProfileName(name, existingNames),
    wards: source.wards.map((ward) => ({ ...ward, categories: [...ward.categories], tags: [...ward.tags], screenshotIds: [...ward.screenshotIds] })),
    createdAt: now,
    updatedAt: now,
  };
}
