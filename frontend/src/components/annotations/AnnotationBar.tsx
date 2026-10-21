import React, { useState } from 'react';
import {
  ANNOTATION_COLORS,
  ANNOTATION_KINDS,
  ANNOTATION_KIND_LABELS,
  MAX_ANNOTATION_COMMENT_CHARS,
  describeAnnotationAnchor,
  describeAnnotationKind,
  type AnnotationColor,
  type AnnotationKind,
  type ArtifactAnnotation,
} from '@/lib/annotations';
import styles from './AnnotationBar.module.css';

/**
 * AnnotationBar — BLOCK-219 Q6 批注工具条（绘制开关 / 颜色 / 评论 / 列表 / 加入任务）。
 *
 * 边界：
 * - 不支持批注的面（Office/表格/pack 渲染面）只显示**原因**，不渲染死按钮；
 * - 评论在此处收集（拖拽只产生矩形），提交结果由父层裁决；
 * - 「加入任务」不自己投递事件——父层用 `buildAnnotationTaskPrompt` + copilotAsk，
 *   保证只有一条进对话的通道。
 */

export interface AnnotationBarProps {
  annotations: readonly ArtifactAnnotation[];
  loading: boolean;
  error: string;
  limit: number;
  drawing: boolean;
  color: AnnotationColor;
  kind: AnnotationKind;
  /** false = 当前面不支持批注（只显示 cannotAnnotateReason）。 */
  canAnnotate: boolean;
  cannotAnnotateReason?: string;
  /** 已画好矩形、等待填写评论。 */
  pendingRect: boolean;
  onToggleDrawing: () => void;
  onColorChange: (color: AnnotationColor) => void;
  onKindChange: (kind: AnnotationKind) => void;
  onSubmitComment: (comment: string) => Promise<boolean>;
  onCancelPending: () => void;
  onRemove: (annotationId: string) => void;
  onAddToTask: () => void;
}

const COLOR_LABEL: Record<AnnotationColor, string> = {
  amber: '琥珀',
  sky: '天蓝',
  rose: '玫红',
};

export function AnnotationBar({
  annotations,
  loading,
  error,
  limit,
  drawing,
  color,
  kind,
  canAnnotate,
  cannotAnnotateReason,
  pendingRect,
  onToggleDrawing,
  onColorChange,
  onKindChange,
  onSubmitComment,
  onCancelPending,
  onRemove,
  onAddToTask,
}: AnnotationBarProps): React.ReactElement {
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!canAnnotate) {
    return (
      <div className={styles.bar} data-testid="annotation-bar" data-annotatable="false">
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

  return (
    <div className={styles.bar} data-testid="annotation-bar" data-annotatable="true">
      <button
        type="button"
        className={drawing ? `${styles.toggle} ${styles.toggleActive}` : styles.toggle}
        data-testid="annotation-toggle"
        aria-pressed={drawing}
        onClick={onToggleDrawing}
        title={drawing ? '退出批注模式' : '在图上拖拽框选区域添加批注'}
      >
        批注{annotations.length > 0 ? ` ${annotations.length}` : ''}
      </button>

      {drawing && (
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
              onClick={() => onKindChange(candidate)}
            >
              {ANNOTATION_KIND_LABELS[candidate]}
            </button>
          ))}
        </div>
      )}

      {drawing && (
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

      {drawing && !pendingRect && (
        <span className={styles.hint} data-testid="annotation-hint">
          {kind === 'arrow'
            ? '拖拽框选箭头范围（沿矩形对角线绘制），松开后填写评论'
            : kind === 'ellipse'
              ? '拖拽框选椭圆范围，松开后填写评论'
              : '拖拽框选区域，松开后填写评论'}
        </span>
      )}

      {pendingRect && (
        <div className={styles.composer} data-testid="annotation-composer">
          <input
            type="text"
            className={styles.input}
            data-testid="annotation-comment-input"
            value={comment}
            maxLength={MAX_ANNOTATION_COMMENT_CHARS}
            placeholder="写下这条批注的含义（会随「加入任务」发给 Agent）"
            onChange={(event) => setComment(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void submit();
              if (event.key === 'Escape') onCancelPending();
            }}
          />
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
        </div>
      )}

      {loading && <span className={styles.hint} data-testid="annotation-loading">读取批注…</span>}
      {error && (
        <span className={styles.error} role="alert" data-testid="annotation-error">{error}</span>
      )}

      {annotations.length > 0 && (
        <details className={styles.list} data-testid="annotation-list">
          <summary>{drawing ? '批注列表' : `批注 ${annotations.length}`}</summary>
          <div className={styles.items}>
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
          </div>
        </details>
      )}

      <button
        type="button"
        className={styles.addToTask}
        data-testid="annotation-add-to-task"
        disabled={annotations.length === 0}
        onClick={onAddToTask}
        title="把这些批注作为结构化引用加入 Agent 对话"
      >
        加入任务
      </button>
    </div>
  );
}
