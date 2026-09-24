import { describe, expect, it } from 'vitest';
import { visibleWards, wardMatchesCategory, wardMatchesTags } from './filter';
import { CATEGORY_KEYS, CategoryKey, Faction, Purpose, Ward, splitCategoryKey } from './types';

function wardWith(categories: CategoryKey[], tags: string[] = []): Pick<Ward, 'categories' | 'tags'> {
  return { categories, tags };
}

const f = (factions: Faction[], purposes: Purpose[]) => ({ factions: new Set(factions), purposes: new Set(purposes) });

describe('组合分类筛选（A04）', () => {
  const ward = wardWith(['radiant-offense', 'dire-defense']);

  it('同一组合内命中才可见，不产生交叉误匹配', () => {
    expect(wardMatchesCategory(ward, f(['radiant'], ['offense']))).toBe(true);
    expect(wardMatchesCategory(ward, f(['dire'], ['defense']))).toBe(true);
    expect(wardMatchesCategory(ward, f(['radiant'], ['defense']))).toBe(false);
    expect(wardMatchesCategory(ward, f(['dire'], ['offense']))).toBe(false);
  });

  it('任一维度全不选时无结果', () => {
    expect(wardMatchesCategory(ward, f(['radiant'], []))).toBe(false);
    expect(wardMatchesCategory(ward, f(['dire'], []))).toBe(false);
    expect(wardMatchesCategory(ward, f([], ['offense']))).toBe(false);
    expect(wardMatchesCategory(ward, f([], ['defense']))).toBe(false);
  });

  it('两组全选时匹配已有组合，两组全不选时无结果', () => {
    expect(wardMatchesCategory(ward, f([], []))).toBe(false);
    expect(wardMatchesCategory(ward, f(['radiant', 'dire'], ['offense', 'defense']))).toBe(true);
  });

  it('多选时同一组合内同时命中即可', () => {
    expect(wardMatchesCategory(ward, f(['radiant', 'dire'], ['defense']))).toBe(true);
    expect(wardMatchesCategory(ward, f(['radiant'], ['offense', 'defense']))).toBe(true);
  });

  it('无分类眼位不匹配分类筛选', () => {
    const uncategorized = wardWith([]);
    expect(wardMatchesCategory(uncategorized, f([], []))).toBe(false);
    expect(wardMatchesCategory(uncategorized, f(['radiant', 'dire'], ['offense', 'defense']))).toBe(false);
    expect(wardMatchesCategory(uncategorized, f(['radiant'], []))).toBe(false);
    expect(wardMatchesCategory(uncategorized, f([], ['offense']))).toBe(false);
  });

  it('穷举：所有眼位组合 × 所有筛选组合与参考实现一致', () => {
    const allCategorySets: CategoryKey[][] = [[]];
    for (let mask = 1; mask < 16; mask++) allCategorySets.push(CATEGORY_KEYS.filter((_, i) => mask & (1 << i)));
    const factionSets: Faction[][] = [[], ['radiant'], ['dire'], ['radiant', 'dire']];
    const purposeSets: Purpose[][] = [[], ['offense'], ['defense'], ['offense', 'defense']];

    for (const categories of allCategorySets) {
      for (const factions of factionSets) {
        for (const purposes of purposeSets) {
          const expected =
            factions.length > 0 && purposes.length > 0 &&
            categories.some((key) => {
              const [faction, purpose] = splitCategoryKey(key);
              return factions.includes(faction) && purposes.includes(purpose);
            });
          expect(wardMatchesCategory(wardWith(categories), f(factions, purposes)), `${categories} × ${factions}/${purposes}`).toBe(expected);
        }
      }
    }
  });
});

describe('标签筛选（A13）', () => {
  const tagged = wardWith([], ['河道', '高台']);
  const untagged = wardWith([], []);

  it('全部眼位（null）不限制，含无标签眼位', () => {
    expect(wardMatchesTags(tagged, null)).toBe(true);
    expect(wardMatchesTags(untagged, null)).toBe(true);
  });

  it('部分选择时任一命中即可（OR）', () => {
    expect(wardMatchesTags(tagged, new Set(['河道']))).toBe(true);
    expect(wardMatchesTags(tagged, new Set(['高台', '肉山']))).toBe(true);
    expect(wardMatchesTags(tagged, new Set(['肉山']))).toBe(false);
  });

  it('显式选择标签时无标签眼位不显示，即使所有标签都被选中', () => {
    expect(wardMatchesTags(untagged, new Set(['河道']))).toBe(false);
    expect(wardMatchesTags(untagged, new Set(['河道', '高台']))).toBe(false);
  });

  it('全部不选时无结果', () => {
    expect(wardMatchesTags(tagged, new Set())).toBe(false);
    expect(wardMatchesTags(untagged, new Set())).toBe(false);
  });

  it('visibleWards 同时应用分类与标签', () => {
    const wards = [
      wardWith(['radiant-offense'], ['河道']),
      wardWith(['radiant-offense'], ['高台']),
      wardWith(['radiant-offense'], []),
    ];
    const result = visibleWards(wards, f(['radiant'], ['offense']), new Set(['河道']));
    expect(result).toEqual([wards[0]]);
    expect(visibleWards(wards, f(['radiant'], ['offense']), new Set(['高台']))).toEqual([wards[1]]);
    expect(visibleWards(wards, f(['radiant'], ['offense']), new Set(['河道', '高台']))).toEqual([wards[0], wards[1]]);
    expect(visibleWards(wards, f(['radiant'], ['offense']), null)).toEqual(wards);
    expect(visibleWards(wards, f(['radiant'], ['offense']), new Set())).toEqual([]);
    expect(visibleWards(wards, f([], ['offense']), null)).toEqual([]);
  });
});
