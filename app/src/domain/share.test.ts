import { describe, expect, it } from 'vitest';
import { createProfile, createWard } from './profile';
import { decodeShare, importAsProfile, serializeProfile, SHARE_FORMAT, SHARE_FORMAT_VERSION, ShareFormatError } from './share';
import { CURRENT_MAP_VERSION } from './types';

const NOW = '2026-09-23T00:00:00.000Z';

function richProfile() {
  const profile = createProfile('河道 & 高台 "眼位" <测试>', '7.41', NOW);
  const ward = createWard({ x: 0.123456, y: 0.654321, categories: ['radiant-offense', 'dire-defense'], name: '天辉中路进攻眼' }, NOW);
  ward.tags = ['需要砍树', '河道，高台', "引号'双\"都要"];
  ward.description = '插眼前需砍掉入口树木。\n第二行：插眼后砍左侧树扩大视野。\n特殊字符：\\t制表、emoji🌳、"引号"、\\反斜杠';
  ward.color = '#A1B2C3';
  ward.screenshotIds = ['shot-1', 'shot-2'];
  return { profile: { ...profile, wards: [ward] }, ward };
}

describe('分享 JSON 编解码（A08）', () => {
  it('导出再导入完整还原文本、位置、颜色、分类、标签与元数据', () => {
    const { profile } = richProfile();
    const text = serializeProfile(profile, NOW);
    const decoded = decodeShare(text);
    expect(decoded.name).toBe(profile.name);
    expect(decoded.mapVersion).toBe('7.41');
    expect(decoded.mapVersionMismatch).toBe(false);
    expect(decoded.wards).toHaveLength(1);
    const ward = decoded.wards[0];
    expect(ward.x).toBeCloseTo(0.123456, 6);
    expect(ward.y).toBeCloseTo(0.654321, 6);
    expect(ward.name).toBe('天辉中路进攻眼');
    expect(ward.color).toBe('#a1b2c3');
    expect(ward.categories).toEqual(['radiant-offense', 'dire-defense']);
    expect(ward.tags).toEqual(['需要砍树', '河道，高台', "引号'双\"都要"]);
    expect(ward.description).toContain('插眼前需砍掉入口树木。');
    expect(ward.description).toContain('第二行');
    expect(ward.description).toContain('🌳');
  });

  it('导出文件不含截图二进制、Base64 图片或本机路径', () => {
    const { profile } = richProfile();
    const text = serializeProfile(profile, NOW);
    expect(text).not.toContain('shot-1');
    expect(text).not.toContain('screenshotIds');
    expect(text).not.toContain('data:image');
    expect(text).not.toContain('base64');
    expect(text).not.toMatch(/[A-Za-z]:\\\\/);
    const parsed = JSON.parse(text);
    expect(parsed.format).toBe(SHARE_FORMAT);
    expect(parsed.formatVersion).toBe(SHARE_FORMAT_VERSION);
    expect(Object.keys(parsed.profile.wards[0]).sort()).toEqual(
      ['categories', 'color', 'createdAt', 'description', 'id', 'name', 'tags', 'updatedAt', 'x', 'y'].sort(),
    );
  });

  it('导入的眼位不带截图关联，接收端自行上传', () => {
    const { profile } = richProfile();
    const decoded = decodeShare(serializeProfile(profile, NOW));
    expect(decoded.wards[0].screenshotIds).toEqual([]);
  });
});

describe('分享 JSON 校验', () => {
  const { profile } = richProfile();
  const base = () => JSON.parse(serializeProfile(profile, NOW));
  const encode = (value: unknown) => JSON.stringify(value);

  it('拒绝非 JSON、错误 format、不支持的版本', () => {
    expect(() => decodeShare('not json')).toThrow(ShareFormatError);
    expect(() => decodeShare(encode({ ...base(), format: 'other' }))).toThrow(/格式/);
    expect(() => decodeShare(encode({ ...base(), formatVersion: 99 }))).toThrow(/版本/);
  });

  it('拒绝坐标缺失或超出 [0,1]', () => {
    for (const [x, y] of [[-0.1, 0.5], [1.1, 0.5], [0.5, -1], [0.5, 2], [NaN, 0.5]]) {
      const data = base();
      data.profile.wards[0].x = x;
      data.profile.wards[0].y = y;
      expect(() => decodeShare(encode(data)), `x=${x},y=${y}`).toThrow(ShareFormatError);
    }
  });

  it('拒绝重复 id、未知分类、非法颜色、超长字段', () => {
    const dup = base();
    dup.profile.wards.push({ ...dup.profile.wards[0] });
    expect(() => decodeShare(encode(dup))).toThrow(/重复/);

    const badCategory = base();
    badCategory.profile.wards[0].categories = ['radiant-offense', 'radiant-防守'];
    expect(() => decodeShare(encode(badCategory))).toThrow(ShareFormatError);

    const badColor = base();
    badColor.profile.wards[0].color = 'red';
    expect(() => decodeShare(encode(badColor))).toThrow(ShareFormatError);

    const longDesc = base();
    longDesc.profile.wards[0].description = 'x'.repeat(20001);
    expect(() => decodeShare(encode(longDesc))).toThrow(ShareFormatError);
  });

  it('拒绝超限数量与混入的截图字段被忽略', () => {
    const many = base();
    many.profile.wards = Array.from({ length: 2001 }, (_, i) => ({ ...base().profile.wards[0], id: `w${i}` }));
    expect(() => decodeShare(encode(many))).toThrow(/限制/);

    const withPhotos = base();
    withPhotos.profile.wards[0].photos = [{ data: 'data:image/png;base64,AAAA' }];
    withPhotos.profile.wards[0].screenshots = ['C:\\secret\\a.png'];
    const decoded = decodeShare(encode(withPhotos));
    expect(decoded.wards[0].screenshotIds).toEqual([]);
  });
});

describe('导入为独立 Profile（A09）', () => {
  it('同名自动加后缀、保留来源地图版本、生成新 id', () => {
    const { profile } = richProfile();
    const decoded = decodeShare(serializeProfile(profile, NOW));
    const first = importAsProfile(decoded, [], NOW);
    const second = importAsProfile(decoded, [first.name], NOW);
    expect(first.name).toBe(profile.name);
    expect(second.name).toBe(`${profile.name} (2)`);
    expect(second.id).not.toBe(first.id);
    expect(first.mapVersion).toBe('7.41');
  });

  it('异地图版本允许导入并标记提示', () => {
    const { profile } = richProfile();
    const text = serializeProfile({ ...profile, mapVersion: '7.40' }, NOW);
    const decoded = decodeShare(text);
    expect(decoded.mapVersionMismatch).toBe(true);
    const imported = importAsProfile(decoded, [], NOW);
    expect(imported.mapVersion).toBe('7.40');
    expect(CURRENT_MAP_VERSION).toBe('7.41');
  });
});
