import { Faction, Purpose, Ward, splitCategoryKey } from './types';

export interface CategoryFilter {
  factions: ReadonlySet<Faction>;
  purposes: ReadonlySet<Purpose>;
}

export function wardMatchesCategory(ward: Pick<Ward, 'categories'>, filter: CategoryFilter): boolean {
  const { factions, purposes } = filter;
  if (factions.size === 0 && purposes.size === 0) return true;
  return ward.categories.some((key) => {
    const [faction, purpose] = splitCategoryKey(key);
    const factionOk = factions.size === 0 || factions.has(faction);
    const purposeOk = purposes.size === 0 || purposes.has(purpose);
    return factionOk && purposeOk;
  });
}

/**
 * 标签筛选：selected 为 null 表示不限制（初始全选 / 全部选中 / 全部不选）。
 * 部分选择时任一所选标签命中即可（OR）；无标签眼位在部分选择时不显示。
 */
export function wardMatchesTags(ward: Pick<Ward, 'tags'>, selected: ReadonlySet<string> | null): boolean {
  if (selected === null) return true;
  if (selected.size === 0) return true;
  return ward.tags.some((tag) => selected.has(tag));
}

export function effectiveTagSelection(selected: ReadonlySet<string>, allTags: readonly string[]): ReadonlySet<string> | null {
  if (selected.size === 0) return null;
  if (allTags.every((tag) => selected.has(tag))) return null;
  return selected;
}

export function collectAllTags(wards: readonly Pick<Ward, 'tags'>[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const ward of wards) {
    for (const tag of ward.tags) {
      if (!seen.has(tag)) {
        seen.add(tag);
        result.push(tag);
      }
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

export function visibleWards<T extends Pick<Ward, 'categories' | 'tags'>>(
  wards: readonly T[],
  category: CategoryFilter,
  selectedTags: ReadonlySet<string> | null,
): T[] {
  return wards.filter((ward) => wardMatchesCategory(ward, category) && wardMatchesTags(ward, selectedTags));
}
