import { Faction, Purpose, Ward, splitCategoryKey } from './types';

export interface CategoryFilter {
  factions: ReadonlySet<Faction>;
  purposes: ReadonlySet<Purpose>;
}

export function wardMatchesCategory(ward: Pick<Ward, 'categories'>, filter: CategoryFilter): boolean {
  const { factions, purposes } = filter;
  if (factions.size === 0 || purposes.size === 0) return false;
  return ward.categories.some((key) => {
    const [faction, purpose] = splitCategoryKey(key);
    return factions.has(faction) && purposes.has(purpose);
  });
}

/**
 * 标签筛选：null 表示“全部眼位”且不限制；空集合表示全不选且无结果。
 * 显式选择标签时任一所选标签命中即可（OR）；无标签眼位不显示。
 */
export function wardMatchesTags(ward: Pick<Ward, 'tags'>, selected: ReadonlySet<string> | null): boolean {
  if (selected === null) return true;
  if (selected.size === 0) return false;
  return ward.tags.some((tag) => selected.has(tag));
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
