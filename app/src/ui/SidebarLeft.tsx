import { FACTION_LABELS, Faction, PURPOSE_LABELS, ProfileMeta, Purpose } from '../domain/types';
import { FilterState } from './controller';

interface SidebarLeftProps {
  profiles: ProfileMeta[];
  currentId: string | null;
  filters: FilterState;
  allTags: string[];
  visibleCount: number;
  totalCount: number;
  mapVersion: string;
  onSwitchProfile: (id: string) => void;
  onCreateProfile: () => void;
  onImport: () => void;
  onRenameProfile: (id: string) => void;
  onDeleteProfile: (id: string) => void;
  onToggleFaction: (faction: Faction) => void;
  onTogglePurpose: (purpose: Purpose) => void;
  onToggleTag: (tag: string) => void;
  onResetFilters: () => void;
}

const FACTIONS: Faction[] = ['radiant', 'dire'];
const PURPOSES: Purpose[] = ['offense', 'defense'];

export function SidebarLeft(props: SidebarLeftProps) {
  const { filters } = props;
  const tagSelected = (tag: string) => props.filters.tagSelection === null || props.filters.tagSelection.has(tag);

  return (
    <aside className="sidebar-left">
      <section className="panel-section">
        <div className="section-title">PROFILE</div>
        <div className="profile-row">
          <select
            value={props.currentId ?? ''}
            onChange={(event) => props.onSwitchProfile(event.target.value)}
            aria-label="切换 Profile"
          >
            {props.profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </div>
        <div className="profile-actions">
          <button type="button" onClick={props.onCreateProfile}>新建</button>
          <button type="button" onClick={props.onImport}>导入</button>
          <button type="button" onClick={() => props.currentId && props.onRenameProfile(props.currentId)}>重命名</button>
          <button type="button" className="danger-text" onClick={() => props.currentId && props.onDeleteProfile(props.currentId)}>
            删除
          </button>
        </div>
        <p className="muted tiny">地图版本 {props.mapVersion} · 本地保存，互不同步</p>
      </section>

      <section className="panel-section">
        <div className="section-title">筛选</div>
        <div className="filter-group">
          <div className="filter-label">阵营</div>
          <div className="filter-options">
            {FACTIONS.map((faction) => (
              <label key={faction} className="check-option">
                <input type="checkbox" checked={filters.factions.has(faction)} onChange={() => props.onToggleFaction(faction)} />
                <span className={`faction-dot ${faction}`} />
                {FACTION_LABELS[faction]}
              </label>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <div className="filter-label">用途</div>
          <div className="filter-options">
            {PURPOSES.map((purpose) => (
              <label key={purpose} className="check-option">
                <input type="checkbox" checked={filters.purposes.has(purpose)} onChange={() => props.onTogglePurpose(purpose)} />
                {PURPOSE_LABELS[purpose]}
              </label>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <div className="filter-label">自定义标签</div>
          {props.allTags.length === 0 ? (
            <p className="muted tiny">暂无标签，可在眼位详情中添加。</p>
          ) : (
            <div className="chips">
              {props.allTags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className={`chip${tagSelected(tag) ? ' active' : ''}`}
                  onClick={() => props.onToggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="reset-button" onClick={props.onResetFilters}>
          ⟳ 重置筛选
        </button>
        <p className="muted tiny result-count">
          显示 <b>{props.visibleCount}</b> / {props.totalCount} 个眼位
        </p>
      </section>
    </aside>
  );
}
