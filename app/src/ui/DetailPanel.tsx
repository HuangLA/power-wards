import { useEffect, useRef, useState } from 'react';
import {
  CATEGORY_KEYS,
  CategoryKey,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  MAX_WARD_NAME_LENGTH,
  SCREENSHOT_ACCEPT,
  WARD_COLORS,
  Ward,
  categoryLabel,
} from '../domain/types';
import { AppController } from './controller';

function ScreenshotImage({ controller, screenshotId, alt, onClick }: { controller: AppController; screenshotId: string; alt: string; onClick?: (url: string) => void }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    controller.getScreenshotBlob(screenshotId).then((blob) => {
      if (!blob || cancelled) return;
      revoked = URL.createObjectURL(blob);
      setUrl(revoked);
    });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [controller, screenshotId]);

  if (!url) return <div className="shot-thumb loading">…</div>;
  return (
    <img
      src={url}
      alt={alt}
      className="shot-thumb"
      onClick={() => onClick?.(url)}
    />
  );
}

interface DetailPanelProps {
  ward: Ward;
  controller: AppController;
  moveMode: boolean;
  onToggleMove: () => void;
  onClose: () => void;
}

export function DetailPanel({ ward, controller, moveMode, onToggleMove, onClose }: DetailPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [tagInput, setTagInput] = useState('');
  const [lightbox, setLightbox] = useState<string | null>(null);

  const patch = (value: Parameters<AppController['patchWard']>[1]) => controller.patchWard(ward.id, value);

  const addTag = () => {
    const tag = tagInput.trim().slice(0, MAX_TAG_LENGTH);
    setTagInput('');
    if (!tag || ward.tags.includes(tag)) return;
    if (ward.tags.length >= 50) return;
    patch({ tags: [...ward.tags, tag] });
  };

  const toggleCategory = (key: CategoryKey) => {
    const next = ward.categories.includes(key) ? ward.categories.filter((c) => c !== key) : [...ward.categories, key];
    patch({ categories: next });
  };

  return (
    <aside className="sidebar-right">
      <div className="detail-header">
        <input
          className="detail-name"
          value={ward.name}
          maxLength={MAX_WARD_NAME_LENGTH}
          onChange={(event) => patch({ name: event.target.value })}
          aria-label="眼位名称"
        />
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭详情">×</button>
      </div>

      <section className="panel-section">
        <div className="section-title-row">
          <span className="section-title">实战截图</span>
          <span className="muted tiny">{ward.screenshotIds.length} 张 · 不随分享导出</span>
        </div>
        <div className="shot-grid">
          {ward.screenshotIds.map((id) => (
            <div key={id} className="shot-item">
              <ScreenshotImage controller={controller} screenshotId={id} alt={`${ward.name} 截图`} onClick={setLightbox} />
              <button type="button" className="shot-remove" aria-label="删除截图" onClick={() => controller.removeScreenshot(ward.id, id)}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="shot-add" onClick={() => fileRef.current?.click()}>
            ＋ 上传本地截图
          </button>
          <input
            ref={fileRef}
            type="file"
            accept={SCREENSHOT_ACCEPT.join(',')}
            multiple
            hidden
            onChange={(event) => {
              const files = [...(event.target.files ?? [])];
              event.target.value = '';
              if (files.length > 0) void controller.addScreenshots(ward.id, files);
            }}
          />
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">标记颜色</div>
        <div className="color-row">
          {WARD_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className={`color-swatch${ward.color === color ? ' active' : ''}`}
              style={{ backgroundColor: color }}
              aria-label={`颜色 ${color}`}
              onClick={() => patch({ color })}
            />
          ))}
          <input type="color" value={ward.color} onChange={(event) => patch({ color: event.target.value })} aria-label="自定义颜色" />
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">适用分类</div>
        <div className="category-grid">
          {CATEGORY_KEYS.map((key) => (
            <label key={key} className={`check-option category-${key.split('-')[0]}`}>
              <input type="checkbox" checked={ward.categories.includes(key)} onChange={() => toggleCategory(key)} />
              {categoryLabel(key)}
            </label>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">自定义标签</div>
        <div className="chips">
          {ward.tags.map((tag) => (
            <span key={tag} className="chip active">
              {tag}
              <button type="button" aria-label={`移除标签 ${tag}`} onClick={() => patch({ tags: ward.tags.filter((t) => t !== tag) })}>
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="tag-input-row">
          <input
            value={tagInput}
            maxLength={MAX_TAG_LENGTH}
            placeholder="添加标签，如：需要砍树"
            onChange={(event) => setTagInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addTag();
              }
            }}
          />
          <button type="button" onClick={addTag} disabled={!tagInput.trim()}>
            添加
          </button>
        </div>
      </section>

      <section className="panel-section grow">
        <div className="section-title-row">
          <span className="section-title">详细说明</span>
          <span className="muted tiny">
            {ward.description.length} / {MAX_DESCRIPTION_LENGTH}
          </span>
        </div>
        <textarea
          value={ward.description}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="如何抵达？插眼前需砍树吗？插眼后砍哪棵树扩大视野？适用时机与特殊条件……"
          onChange={(event) => patch({ description: event.target.value })}
        />
      </section>

      <section className="panel-section detail-footer">
        <button type="button" className={moveMode ? 'primary' : ''} onClick={onToggleMove}>
          {moveMode ? '取消重新定位' : '重新定位'}
        </button>
        <button type="button" className="danger" onClick={() => controller.deleteWard(ward.id)}>
          删除眼位
        </button>
        <p className="muted tiny">坐标 x {ward.x.toFixed(4)} · y {ward.y.toFixed(4)}（相对地图）</p>
      </section>

      {lightbox && (
        <div className="dialog-backdrop" onClick={() => setLightbox(null)} role="presentation">
          <img src={lightbox} alt="截图放大" className="lightbox" />
        </div>
      )}
    </aside>
  );
}
