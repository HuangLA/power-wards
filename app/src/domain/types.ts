export type Faction = 'radiant' | 'dire';
export type Purpose = 'offense' | 'defense';

export const FACTIONS: readonly Faction[] = ['radiant', 'dire'];
export const PURPOSES: readonly Purpose[] = ['offense', 'defense'];

export const FACTION_LABELS: Record<Faction, string> = {
  radiant: '天辉',
  dire: '夜魇',
};

export const PURPOSE_LABELS: Record<Purpose, string> = {
  offense: '进攻',
  defense: '防守',
};

export type CategoryKey = `${Faction}-${Purpose}`;

export const CATEGORY_KEYS: readonly CategoryKey[] = [
  'radiant-offense',
  'radiant-defense',
  'dire-offense',
  'dire-defense',
];

export function categoryLabel(key: CategoryKey): string {
  const [faction, purpose] = splitCategoryKey(key);
  return `${FACTION_LABELS[faction]}${PURPOSE_LABELS[purpose]}`;
}

export function splitCategoryKey(key: CategoryKey): [Faction, Purpose] {
  const [faction, purpose] = key.split('-') as [Faction, Purpose];
  return [faction, purpose];
}

export function isCategoryKey(value: unknown): value is CategoryKey {
  return typeof value === 'string' && (CATEGORY_KEYS as readonly string[]).includes(value);
}

export interface Ward {
  id: string;
  x: number;
  y: number;
  name: string;
  color: string;
  categories: CategoryKey[];
  tags: string[];
  description: string;
  screenshotIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Profile {
  id: string;
  name: string;
  mapVersion: string;
  wards: Ward[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfileMeta {
  id: string;
  name: string;
  mapVersion: string;
  wardCount: number;
  updatedAt: string;
}

export const CURRENT_MAP_VERSION = '7.41';

export const MAX_PROFILE_NAME_LENGTH = 100;
export const MAX_WARD_NAME_LENGTH = 200;
export const MAX_WARDS_PER_PROFILE = 2000;
export const MAX_TAGS_PER_WARD = 50;
export const MAX_TAG_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 20000;

export const SCREENSHOT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_SCREENSHOTS_PER_WARD = 10;

export const WARD_COLORS = ['#56b6f7', '#f7b756', '#f77056', '#4cd2c0'] as const;
export const DEFAULT_WARD_COLOR = WARD_COLORS[0];

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
