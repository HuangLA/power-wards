import {
  CategoryKey,
  CURRENT_MAP_VERSION,
  MAX_DESCRIPTION_LENGTH,
  MAX_PROFILE_NAME_LENGTH,
  MAX_TAGS_PER_WARD,
  MAX_TAG_LENGTH,
  MAX_WARDS_PER_PROFILE,
  MAX_WARD_NAME_LENGTH,
  Profile,
  Ward,
  isCategoryKey,
  newId,
} from './types';
import { uniqueProfileName } from './profile';

export const SHARE_FORMAT = 'power-wards-profile';
export const SHARE_FORMAT_VERSION = 1;
export const MAX_SHARE_FILE_BYTES = 10 * 1024 * 1024;

interface ShareWard {
  id: string;
  x: number;
  y: number;
  name: string;
  color: string;
  categories: CategoryKey[];
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface ShareFileV1 {
  format: typeof SHARE_FORMAT;
  formatVersion: typeof SHARE_FORMAT_VERSION;
  mapVersion: string;
  exportedAt: string;
  profile: {
    name: string;
    wards: ShareWard[];
  };
}

export class ShareFormatError extends Error {}

function exceedsUtf8ByteLimit(value: string, limit: number): boolean {
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else bytes += 3;
    if (bytes > limit) return true;
  }
  return false;
}

export function encodeProfile(profile: Profile, now: string = new Date().toISOString()): ShareFileV1 {
  return {
    format: SHARE_FORMAT,
    formatVersion: SHARE_FORMAT_VERSION,
    mapVersion: profile.mapVersion,
    exportedAt: now,
    profile: {
      name: profile.name,
      wards: profile.wards.map((ward) => ({
        id: ward.id,
        x: ward.x,
        y: ward.y,
        name: ward.name,
        color: ward.color,
        categories: [...ward.categories],
        tags: [...ward.tags],
        description: ward.description,
        createdAt: ward.createdAt,
        updatedAt: ward.updatedAt,
      })),
    },
  };
}

export function serializeProfile(profile: Profile, now?: string): string {
  return JSON.stringify(encodeProfile(profile, now), null, 2);
}

export interface DecodedShare {
  name: string;
  mapVersion: string;
  wards: Ward[];
  mapVersionMismatch: boolean;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function fail(reason: string): never {
  throw new ShareFormatError(reason);
}

function expectString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') fail(`字段 ${field} 缺失或类型错误`);
  if (value.length > maxLength) fail(`字段 ${field} 超出长度限制`);
  return value;
}

export function decodeShare(text: string): DecodedShare {
  if (exceedsUtf8ByteLimit(text, MAX_SHARE_FILE_BYTES)) fail('文件过大，超出导入限制');
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail('文件不是有效的 JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) fail('文件结构不是有效的 Profile 分享格式');
  const root = data as Record<string, unknown>;
  if (root.format !== SHARE_FORMAT) fail('文件格式不是 Power Wards 分享文件');
  if (root.formatVersion !== SHARE_FORMAT_VERSION) fail(`不支持的格式版本：${String(root.formatVersion)}`);
  const mapVersion = expectString(root.mapVersion, 'mapVersion', 100);
  const profileNode = root.profile;
  if (typeof profileNode !== 'object' || profileNode === null || Array.isArray(profileNode)) fail('缺少 profile 数据');
  const profileData = profileNode as Record<string, unknown>;
  const name = expectString(profileData.name, 'profile.name', MAX_PROFILE_NAME_LENGTH).trim() || '导入的眼位';
  if (!Array.isArray(profileData.wards)) fail('缺少眼位列表');
  if (profileData.wards.length > MAX_WARDS_PER_PROFILE) fail(`眼位数量超出限制（${MAX_WARDS_PER_PROFILE}）`);

  const ids = new Set<string>();
  const wards: Ward[] = profileData.wards.map((raw, index) => {
    const where = `第 ${index + 1} 个眼位`;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) fail(`${where}数据无效`);
    const w = raw as Record<string, unknown>;
    const id = expectString(w.id, `${where} id`, 100);
    if (!id) fail(`${where} id 为空`);
    if (ids.has(id)) fail(`${where} id 重复`);
    ids.add(id);
    if (typeof w.x !== 'number' || typeof w.y !== 'number' || !Number.isFinite(w.x) || !Number.isFinite(w.y)) fail(`${where}坐标缺失或无效`);
    if (w.x < 0 || w.x > 1 || w.y < 0 || w.y > 1) fail(`${where}坐标超出地图范围`);
    const wardName = expectString(w.name, `${where}名称`, MAX_WARD_NAME_LENGTH).trim() || '未命名眼位';
    const color = expectString(w.color, `${where}颜色`, 20);
    if (!COLOR_RE.test(color)) fail(`${where}颜色格式无效`);
    if (!Array.isArray(w.categories)) fail(`${where}分类缺失`);
    const categories = [...new Set(w.categories.map((c) => (isCategoryKey(c) ? c : fail(`${where}包含未知分类`))))];
    if (!Array.isArray(w.tags)) fail(`${where}标签缺失`);
    if (w.tags.length > MAX_TAGS_PER_WARD) fail(`${where}标签数量超出限制`);
    const tags = [...new Set(w.tags.map((t) => expectString(t, `${where}标签`, MAX_TAG_LENGTH).trim()).filter(Boolean))];
    const description = expectString(w.description, `${where}说明`, MAX_DESCRIPTION_LENGTH);
    const createdAt = typeof w.createdAt === 'string' ? w.createdAt : new Date().toISOString();
    const updatedAt = typeof w.updatedAt === 'string' ? w.updatedAt : createdAt;
    return {
      id,
      x: w.x,
      y: w.y,
      name: wardName,
      color: color.toLowerCase(),
      categories,
      tags,
      description,
      screenshotIds: [],
      createdAt,
      updatedAt,
    };
  });

  return { name, mapVersion, wards, mapVersionMismatch: mapVersion !== CURRENT_MAP_VERSION };
}

export function importAsProfile(decoded: DecodedShare, existingNames: readonly string[], now: string = new Date().toISOString()): Profile {
  return {
    id: newId(),
    name: uniqueProfileName(decoded.name, existingNames),
    mapVersion: decoded.mapVersion,
    wards: decoded.wards.map((ward) => ({ ...ward, categories: [...ward.categories], tags: [...ward.tags], screenshotIds: [] })),
    createdAt: now,
    updatedAt: now,
  };
}
