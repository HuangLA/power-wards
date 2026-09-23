import { describe, expect, it } from 'vitest';
import { cloneProfileAs, createProfile, createWard, removeWard, restoreWard, uniqueProfileName, updateWard } from './profile';

const NOW = '2026-09-23T00:00:00.000Z';

function sampleProfile() {
  const profile = createProfile('测试', '7.41', NOW);
  const a = createWard({ x: 0.3, y: 0.4, categories: ['radiant-offense'] }, NOW);
  const b = createWard({ x: 0.6, y: 0.7, categories: ['dire-defense'] }, NOW);
  return { profile: { ...profile, wards: [a, b] }, a, b };
}

describe('Profile 操作', () => {
  it('uniqueProfileName：无冲突用原名，冲突自动加后缀（A09）', () => {
    expect(uniqueProfileName('我的眼位', [])).toBe('我的眼位');
    expect(uniqueProfileName('我的眼位', ['我的眼位'])).toBe('我的眼位 (2)');
    expect(uniqueProfileName('我的眼位', ['我的眼位', '我的眼位 (2)'])).toBe('我的眼位 (3)');
    expect(uniqueProfileName('  ', [])).toBe('未命名 Profile');
  });

  it('createWard：记录独立分类组合与默认值', () => {
    const ward = createWard({ x: 0.5, y: 0.5, categories: ['radiant-offense', 'dire-defense', 'radiant-offense'] }, NOW);
    expect(ward.categories).toEqual(['radiant-offense', 'dire-defense']);
    expect(ward.tags).toEqual([]);
    expect(ward.screenshotIds).toEqual([]);
    expect(ward.x).toBe(0.5);
  });

  it('updateWard：保留 id 与 createdAt', () => {
    const { profile, a } = sampleProfile();
    const next = updateWard(profile, a.id, { name: '新名字', id: '篡改', createdAt: '篡改' } as never, '2026-09-24T00:00:00.000Z');
    const updated = next.wards.find((w) => w.id === a.id)!;
    expect(updated.name).toBe('新名字');
    expect(updated.createdAt).toBe(NOW);
    expect(updated.updatedAt).toBe('2026-09-24T00:00:00.000Z');
  });

  it('cloneProfileAs：新 id、深拷贝，原 Profile 不受影响（A03）', () => {
    const { profile, a } = sampleProfile();
    const copy = cloneProfileAs(profile, '测试', ['测试'], '2026-09-24T00:00:00.000Z');
    expect(copy.id).not.toBe(profile.id);
    expect(copy.name).toBe('测试 (2)');
    copy.wards[0].tags.push('改动');
    copy.wards[0].categories.push('dire-offense');
    expect(a.tags).toEqual([]);
    expect(a.categories).toEqual(['radiant-offense']);
  });

  it('removeWard / restoreWard：完整恢复位置与顺序（A15）', () => {
    const { profile, a, b } = sampleProfile();
    const { profile: after, removed } = removeWard(profile, a.id, NOW);
    expect(after.wards.map((w) => w.id)).toEqual([b.id]);
    expect(removed).toEqual({ ward: a, index: 0 });
    const restored = restoreWard(after, removed!, NOW);
    expect(restored.wards.map((w) => w.id)).toEqual([a.id, b.id]);
    expect(restored.wards[0]).toEqual(a);
  });

  it('restoreWard：同 id 已存在时不重复恢复', () => {
    const { profile, a } = sampleProfile();
    const restored = restoreWard(profile, { ward: a, index: 0 }, NOW);
    expect(restored.wards.filter((w) => w.id === a.id)).toHaveLength(1);
  });
});
