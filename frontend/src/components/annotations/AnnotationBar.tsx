import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/icons/Icon';
import {
  ANNOTATION_COLORS,
  ANNOTATION_KINDS,
  ANNOTATION_KIND_LABELS,
  MAX_ANNOTATION_COMMENT_CHARS,
  MOSAIC_SHORT,
  describeAnnotationAnchor,
  describeAnnotationKind,
  supportsBackdropFilter,
  type AnnotationColor,
  type AnnotationKind,
  type ArtifactAnnotation,
} from '@/lib/annotations';
import styles from './AnnotationBar.module.css';

/**
 * AnnotationBar — BLOCK-219 Q6 批注工具条（绘制开关 / 颜色 / 评论 / 列表 / 加入上下文）。
 *
 * 边界：
 * - 不支持批注的面（Office/表格/pack 渲染面）只显示**原因**，不渲染死按钮；
 * - 评论在此处收集（拖拽只产生矩形），提交结果由父层裁决；
 * - 「加入上下文」不自己投递事件——父层用 `buildAnnotationTaskPrompt` + copilotAsk
 *   （compose：只入草稿不发送），保证只有一条进对话的通道。
 */

export interface AnnotationBarProps {
  annotations: readonly ArtifactAnnotation[];
  loading: boolean;
  error: string;
  limit: number;
  drawing: boolean;
  color: AnnotationColor;
  kind: AnnotationKind;
  /**
   * 'region'（默认）= PDF/图像，可拖拽画框；
   * 'text' = 工作区文本面，批注由选区产生（不渲染绘制开关/形状/颜色）。
   */
  mode?: 'region' | 'text';
  /**
   * UI-611 — 区域面三段式布局：'tools' = 图片左侧工具集，'actions' = 图片右侧执行区；
   * 'full'（默认）= 单条（文本锚点面 / 兼容既有调用）。
   */
  side?: 'full' | 'tools' | 'actions';
  /** false = 当前面不支持批注（只显示 cannotAnnotateReason）。 */
  canAnnotate: boolean;
  cannotAnnotateReason?: string;
  /** 已画好矩形、等待填写评论。 */
  pendingRect: boolean;
  /** 本次会话内是否有可撤销的批注操作（栈空时不渲染按钮，避免死按钮）。 */
  canUndo: boolean;
  /** 下一步撤销会做什么（按钮 title 如实说明，含「重建为新条目」）。 */
  undoLabel?: string;
  onUndo: () => void;
  onToggleDrawing: () => void;
  onColorChange: (color: AnnotationColor) => void;
  onKindChange: (kind: AnnotationKind) => void;
  onSubmitComment: (comment: string) => Promise<boolean>;
  onCancelPending: () => void;
  onRemove: (annotationId: string) => void;
  onAddToContext: () => void;
}

const COLOR_LABEL: Record<AnnotationColor, string> = {
  amber: '琥珀',
  sky: '天蓝',
  rose: '玫红',
};

/** UI-611 — 工具适配图标：左栏图标轨按工具压缩文字占用（标签进 aria/title）。 */
const KIND_ICONS: Record<AnnotationKind, IconName> = {
  region: 'square',
  ellipse: 'circle',
  arrow: 'arrow-up-right',
  text: 'type',
  mosaic: 'layout-grid',
  'text-selection': 'highlighter',
  freehand: 'pen-tool',
};

/** UI-611 — 工具少时单列窄轨，增多再两列/多列（列数由数量决定，不写死布局）。 */
export function annotationKindColumns(count: number): 1 | 2 | 3 {
  if (count <= 8) return 1;
  if (count <= 12) return 2;
  return 3;
}

const LIST_POPOVER_MAX_WIDTH = 420;
const LIST_POPOVER_MAX_HEIGHT = 320;
const POPOVER_MARGIN = 12;
const POPOVER_GAP = 6;

/**
 * UI-618 — 批注列表弹层定位：右栏工具条时向**左**展开（不挡面板/不被裁切），
 * 左右与上下都做视口钳制，保证整张列表完整可见。
 */
export function annotationListPopoverPosition(
  anchor: { left: number; top: number; right: number; bottom: number },
  viewport: { width: number; height: number },
): { left: number; top: number; width: number; placement: 'left' | 'right' } {
  const width = Math.min(LIST_POPOVER_MAX_WIDTH, Math.max(0, viewport.width - POPOVER_MARGIN * 2));
  const openLeft = anchor.right + POPOVER_GAP + width > viewport.width - POPOVER_MARGIN;
  const left = openLeft
    ? Math.max(POPOVER_MARGIN, Math.min(anchor.left - POPOVER_GAP - width, viewport.width - width - POPOVER_MARGIN))
    : Math.min(anchor.right + POPOVER_GAP, Math.max(POPOVER_MARGIN, viewport.width - width - POPOVER_MARGIN));
  const maxHeight = Math.min(LIST_POPOVER_MAX_HEIGHT, Math.max(160, viewport.height - POPOVER_MARGIN * 2));
  const top = Math.min(
    Math.max(POPOVER_MARGIN, anchor.top),
    Math.max(POPOVER_MARGIN, viewport.height - maxHeight - POPOVER_MARGIN),
  );
  return { left, top, width, placement: openLeft ? 'left' : 'right' };
}

export function AnnotationBar({
  annotations,
  loading,
  error,
  limit,
  drawing,
  color,
  kind,
  mode = 'region',
  side = 'full',
  canAnnotate,
  cannotAnnotateReason,
  pendingRect,
  canUndo,
  undoLabel,
  onUndo,
  onToggleDrawing,
  onColorChange,
  onKindChange,
  onSubmitComment,
  onCancelPending,
  onRemove,
  onAddToContext,
}: AnnotationBarProps): React.ReactElement {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 能力探测一次即可：CSS.supports 不随交互变化。
  const mosaicSupport = useMemo(() => supportsBackdropFilter(), []);
  const regionMode = mode !== 'text';
  const toolsSide = regionMode && side === 'tools';
  const actionsSide = regionMode && side === 'actions';
  const showTools = regionMode && !actionsSide;
  const showActions = !toolsSide;

  // UI-618 — 批注列表弹层：portal 到 body + fixed 定位，右栏向左展开，避免被面板裁切。
  const [listOpen, setListOpen] = useState(false);
  const [listPosition, setListPosition] = useState<ReturnType<typeof annotationListPopoverPosition> | null>(null);
  const listSummaryRef = useRef<HTMLElement | null>(null);
  const listPopoverRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!listOpen) return undefined;
    const close = () => setListOpen(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (listPopoverRef.current?.contains(target) || listSummaryRef.current?.contains(target)) return;
      close();
    };
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [listOpen]);

  if (!canAnnotate) {
    // 执行区没有可执行内容（原因只在工具区展示一次，避免两个栏各说一遍）。
    if (actionsSide) return <></>;
    return (
      <div className={styles.bar} data-testid="annotation-bar" data-annotatable="false" data-side={side}>
        <span className={styles.unavailable} data-testid="annotation-unavailable">
          {cannotAnnotateReason || '当前产物不支持批注（仅 PDF 与图像可批注）。'}
        </span>
      </div>
    );
  }

  const submit = async () => {
    const text = comment.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    const ok = await onSubmitComment(text);
    setSubmitting(false);
    if (ok) setComment('');
  };

  // UI-624 — 文本面空闲态不渲染空批注条：没有批注、没有待填锚点、也没有
  // 加载/错误/可撤销动作时，常驻的禁用输入框看起来像无效控件；入口在选区
  // 动作条的「批注」，选中文本后才出现输入区。
  if (!regionMode && !pendingRect && annotations.length === 0 && !loading && !error && !canUndo) {
    return <></>;
  }

  return (
    <div
      className={styles.bar}
      data-testid={actionsSide ? 'annotation-actions' : 'annotation-bar'}
      data-annotatable="true"
      data-mode={mode}
      data-side={side}
      data-kind-columns={regionMode && !actionsSide ? annotationKindColumns(ANNOTATION_KINDS.length) : undefined}
    >
      {regionMode && showActions && (
        <div className={styles.modes} role="group" aria-label="批注工具模式">
          <button
            type="button"
            className={drawing ? `${styles.toggle} ${styles.toggleActive}` : styles.toggle}
            data-testid="annotation-toggle"
            aria-pressed={drawing}
            aria-label="批注模式"
            onClick={() => { if (!drawing) onToggleDrawing(); }}
            title="批注模式（在图上拖拽新建批注）"
          >
            <Icon name="pencil" size={15} />
          </button>
          <button
            type="button"
            className={!drawing ? `${styles.toggle} ${styles.toggleActive}` : styles.toggle}
            data-testid="annotation-select-mode"
            aria-pressed={!drawing}
            aria-label="选择批注"
            onClick={() => { if (drawing) onToggleDrawing(); }}
            title="选择/移动批注（不新建）"
          >
            <Icon name="mouse-pointer" size={15} />
          </button>
        </div>
      )}

      {showActions && canUndo && (regionMode ? (
        <button
          type="button"
          className="petri-btn petri-btn--icon"
          data-testid="annotation-undo"
          aria-label="撤销上一步批注操作"
          title={undoLabel || '撤销上一步批注操作'}
          onClick={onUndo}
        >
          <Icon name="undo-2" size={15} />
        </button>
      ) : (
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="annotation-undo"
          title={undoLabel || '撤销上一步批注操作'}
          onClick={onUndo}
        >
          撤销
        </button>
      ))}

      {showTools && (
        <div className={styles.kinds} role="group" aria-label="批注形状">
          {ANNOTATION_KINDS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={styles.kind}
              data-testid={`annotation-kind-${candidate}`}
              data-kind={candidate}
              data-active={candidate === kind ? 'true' : 'false'}
              aria-label={`批注形状 ${ANNOTATION_KIND_LABELS[candidate]}`}
              aria-pressed={candidate === kind}
              title={ANNOTATION_KIND_LABELS[candidate]}
              onClick={() => onKindChange(candidate)}
            >
              <Icon name={KIND_ICONS[candidate]} size={15} />
            </button>
          ))}
        </div>
      )}

      {showTools && (
        <div className={styles.swatches} role="group" aria-label="批注颜色">
          {ANNOTATION_COLORS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              className={styles.swatch}
              data-testid={`annotation-swatch-${candidate}`}
              data-color={candidate}
              data-active={candidate === color ? 'true' : 'false'}
              aria-label={`批注颜色 ${COLOR_LABEL[candidate]}`}
              aria-pressed={candidate === color}
              onClick={() => onColorChange(candidate)}
            />
          ))}
        </div>
      )}

      {showTools && drawing && !pendingRect && (
        <span
          className={styles.hint}
          data-testid="annotation-hint"
          data-mosaic-fallback={kind === 'mosaic' ? String(!mosaicSupport) : undefined}
        >
          {kind === 'freehand'
            ? '在图上拖动绘制画笔路径，松开后在图上输入说明（可不填）'
            : kind === 'arrow'
            ? '拖拽画箭头（起点→终点），松开后在图上输入说明（可不填）'
            : kind === 'ellipse'
              ? '拖拽框选椭圆范围，松开后在图上输入说明（可不填）'
              : kind === 'text'
                ? '点击图上位置，就地输入文字（回车确认，可不填）'
                : kind === 'mosaic'
                  ? (mosaicSupport
                    ? `拖拽框选需要遮蔽的区域，松开后在图上输入说明（${MOSAIC_SHORT}；可不填）`
                    : `拖拽框选需要遮蔽的区域；当前环境不支持模糊，将改用不透明色块（${MOSAIC_SHORT}）`)
                  : '拖拽框选区域，松开后在图上输入说明（可不填）'}
        </span>
      )}

      {/* BLOCK-300 — 区域面的评论输入就地化（overlay inlineComposer 接管）；
          文本锚点面只在选区产生待填锚点后渲染评论框（UI-624：空闲不再常驻禁用框）。 */}
      {!regionMode && pendingRect && (
        <div className={styles.composer} data-testid="annotation-composer">
          <input
            type="text"
            className={styles.input}
            data-testid="annotation-comment-input"
            value={comment}
            maxLength={MAX_ANNOTATION_COMMENT_CHARS}
            placeholder="写下对这段文字的批注（会随「加入上下文」发给 Agent）"
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') onCancelPending();
            }}
          />
          {pendingRect && (
            <>
              <button
                type="button"
                className="petri-btn petri-btn--primary petri-btn--sm"
                data-testid="annotation-save"
                disabled={!comment.trim() || submitting}
                onClick={() => void submit()}
              >
                保存
              </button>
              <button
                type="button"
                className="petri-btn petri-btn--ghost petri-btn--sm"
                data-testid="annotation-cancel"
                onClick={onCancelPending}
              >
                取消
              </button>
            </>
          )}
        </div>
      )}

      {showActions && loading && (regionMode ? (
        <span
          className={styles.statusIcon}
          data-testid="annotation-loading"
          title="读取批注…"
          aria-label="读取批注…"
        >
          <Icon name="clock" size={14} />
        </span>
      ) : (
        <span className={styles.hint} data-testid="annotation-loading">读取批注…</span>
      ))}
      {showActions && error && (regionMode ? (
        <span
          className={`${styles.statusIcon} ${styles.statusError}`}
          role="alert"
          data-testid="annotation-error"
          title={error}
          aria-label={error}
        >
          <Icon name="alert-circle" size={14} />
        </span>
      ) : (
        <span className={styles.error} role="alert" data-testid="annotation-error">{error}</span>
      ))}

      {showActions && annotations.length > 0 && (
        <>
          <details
            className={styles.list}
            data-testid="annotation-list"
            open={listOpen}
            onToggle={(event) => {
              const nextOpen = event.currentTarget.open;
              const summary = listSummaryRef.current;
              if (nextOpen && summary) {
                const rect = summary.getBoundingClientRect();
                setListPosition(annotationListPopoverPosition(
                  { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
                  { width: window.innerWidth, height: window.innerHeight },
                ));
              }
              setListOpen(nextOpen);
            }}
          >
            <summary ref={listSummaryRef} title={regionMode ? `批注列表（${annotations.length} 条）` : undefined}>
              {regionMode ? (
                <>
                  <Icon name="list-details" size={15} />
                  <span className={styles.count}>{annotations.length}</span>
                </>
              ) : (drawing ? '批注列表' : `批注 ${annotations.length}`)}
            </summary>
          </details>
          {listOpen && listPosition && createPortal(
            <div
              ref={listPopoverRef}
              className={styles.items}
              data-testid="annotation-list-popover"
              data-placement={listPosition.placement}
              style={{ left: listPosition.left, top: listPosition.top, width: listPosition.width }}
            >
              {annotations.map((annotation, index) => (
                <div className={styles.item} key={annotation.annotationId} data-testid="annotation-item">
                  <span className={styles.dot} data-color={annotation.color} aria-hidden="true" />
                  <span className={styles.kindTag}>{describeAnnotationKind(annotation.kind)}</span>
                  <span className={styles.anchor}>{describeAnnotationAnchor(annotation)}</span>
                  <span className={styles.comment} title={annotation.comment}>{annotation.comment}</span>
                  <button
                    type="button"
                    className={styles.remove}
                    data-testid="annotation-remove"
                    aria-label={`删除批注 ${index + 1}`}
                    onClick={() => onRemove(annotation.annotationId)}
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className={styles.footer}>
                上限 {limit || annotations.length} 条 · 批注只存旁路元数据，不改原始产物
              </div>
            </div>,
            document.body,
          )}
        </>
      )}

      {showActions && (regionMode || annotations.length > 0) && (
        <button
          type="button"
          className={styles.addToTask}
          data-testid="annotation-add-to-task"
          disabled={annotations.length === 0}
          onClick={onAddToContext}
          aria-label="加入上下文"
          title="把批注作为结构化上下文加入对话草稿（按发送才启动任务）"
        >
          {regionMode ? <Icon name="message-circle" size={15} /> : '加入上下文'}
        </button>
      )}
    </div>
  );
}
