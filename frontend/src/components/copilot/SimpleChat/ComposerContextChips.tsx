// ============================================================
// ComposerContextChips.tsx — BLOCK-245 P2：composer 上下文引用条渲染面
// （原 SimpleChat.tsx 的 selectionRefs / imageRefs 两段内联 JSX 原样平移，
//  零行为变化；class 名与 CSS 归属不变，simple-chat.css 不动。）
// ============================================================
import { Icon } from '@/components/icons/Icon';
import {
  imageReferenceSourceLine,
  type ImageReference,
} from './imageReferences';
import {
  selectionReferenceChipLabel,
  selectionReferenceLocation,
  type SelectionReference,
} from './selectionReferences';
import type { ComposerContextItem } from './contextItems';

export interface ComposerContextChipsProps {
  selections: SelectionReference[];
  images: ImageReference[];
  /** BLOCK-245 P4 — `@` 菜单产出的其余引用（文件/技能/连接器/智能体/结果/知识空间/会话）。 */
  others?: ComposerContextItem[];
  onRemove: (id: string) => void;
  /** BLOCK-245 P5 — 上限/去重提示（文案单源 = contextLimits；null = 无异常）。 */
  notice?: string | null;
}

export function ComposerContextChips({ selections, images, others = [], onRemove, notice }: ComposerContextChipsProps) {
  return (
    <>
      {notice ? <div className="sc-attachment-notice" role="status">{notice}</div> : null}
      {selections.length > 0 && (
        <div className="sc-selection-refs">
          {selections.map((ref) => (
            <div
              key={ref.id}
              className="sc-selection-ref"
              title={`${selectionReferenceLocation(ref)}\n${ref.text}`}
            >
              <Icon name="file" size={12} />
              <span className="sc-selection-ref-loc">{selectionReferenceLocation(ref)}</span>
              <span className="sc-selection-ref-text">{selectionReferenceChipLabel(ref)}</span>
              <button
                type="button"
                className="sc-selection-ref-remove"
                onClick={() => onRemove(ref.id)}
                title="移除引用"
                aria-label="移除引用"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="sc-selection-refs">
          {others.map((item) => (
            <div
              key={item.id}
              className="sc-selection-ref"
              data-context-kind={item.kind}
              title={item.lines.join('\n')}
            >
              <Icon name="file" size={12} />
              <span className="sc-selection-ref-loc">{item.label}</span>
              <span className="sc-selection-ref-text">{item.source}</span>
              <button
                type="button"
                className="sc-selection-ref-remove"
                onClick={() => onRemove(item.id)}
                title="移除引用"
                aria-label="移除上下文引用"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {images.length > 0 && (
        <div className="sc-image-refs">
          {images.map((ref: ImageReference) => (
            <div
              key={ref.id}
              className="sc-image-ref"
              title={imageReferenceSourceLine(ref)}
            >
              <img
                src={ref.url}
                alt={ref.name}
                className="sc-image-ref-thumb"
                draggable={false}
              />
              <span className="sc-image-ref-name" title={ref.name}>{ref.name}</span>
              <span className="sc-image-ref-source">{imageReferenceSourceLine(ref)}</span>
              <button
                type="button"
                className="sc-image-ref-remove"
                onClick={() => onRemove(ref.id)}
                title="移除图片引用"
                aria-label="移除图片引用"
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
