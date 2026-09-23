import { useState } from 'react';
import { CATEGORY_KEYS, CategoryKey, categoryLabel } from '../domain/types';

interface AddWardPanelProps {
  onConfirm: (categories: CategoryKey[]) => void;
  onCancel: () => void;
}

export function AddWardPanel({ onConfirm, onCancel }: AddWardPanelProps) {
  const [checked, setChecked] = useState<Set<CategoryKey>>(new Set());

  const toggle = (key: CategoryKey) => {
    const next = new Set(checked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChecked(next);
  };

  return (
    <div className="add-ward-panel" role="dialog" aria-label="新增眼位">
      <div className="add-ward-title">
        新增眼位 · 选择适用分类
        <button type="button" className="icon-button" aria-label="取消新增" onClick={onCancel}>×</button>
      </div>
      <div className="category-grid">
        {CATEGORY_KEYS.map((key) => (
          <label key={key} className={`check-option category-${key.split('-')[0]}`}>
            <input type="checkbox" checked={checked.has(key)} onChange={() => toggle(key)} />
            {categoryLabel(key)}
          </label>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>取消</button>
        <button type="button" className="primary" disabled={checked.size === 0} onClick={() => onConfirm([...checked])}>
          确认
        </button>
      </div>
    </div>
  );
}
