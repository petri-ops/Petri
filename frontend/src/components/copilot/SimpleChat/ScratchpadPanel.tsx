// ============================================================
// ScratchpadPanel.tsx — BLOCK-246 C13 速记板面板（composer 上方浮层）
//
// 形态：与 ContextMentionMenu 同族（composer 上方同一个 `.sc-slash-*` 规格），
// 但它是**用户资产**面而不是候选面：能搜、能引用、能删。
//
// 诚实性：
//   · 空态分两种（还没记过 / 搜不到），不混成一句"暂无数据"；
//   · 失败给可见错误 + 重试，不吞异常；
//   · 上限与清洗在后端单源（store），本面板只原样展示后端返回的原因。
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
// BLOCK-254 P6 — 速记图片批注：复用既有批注宿主（旁路表 + 唯一落库通道）
import { AnnotatableImagePane } from '@/components/annotations/AnnotatableImagePane';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';
import type { AnnotationScope, AnnotationTaskTarget } from '@/lib/annotations';
import {
  listScratchpad,
  removeScratchpad,
  type ScratchpadEntry,
} from '@/lib/scratchpadClient';

export interface ScratchpadApi {
  list: typeof listScratchpad;
  remove: typeof removeScratchpad;
}

export interface ScratchpadPanelProps {
  onClose: () => void;
  /** 引用一条速记进 composer（唯一通道：宿主把它变成 ComposerContextItem）。 */
  onQuote: (entry: ScratchpadEntry) => void;
  /** 当前项目：条目自身没有 projectId 时，用作图片批注 scope 的兜底。 */
  projectId?: string | null;
  /** 测试注入点；默认走 REST 客户端。 */
  api?: ScratchpadApi;
}

const SEARCH_DEBOUNCE_MS = 250;

function entryPreview(entry: ScratchpadEntry): string {
  if (entry.kind === 'image') return '图片速记';
  const text = entry.body.replace(/\s+/g, ' ').trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

function entryMeta(entry: ScratchpadEntry): string {
  const sourceLabel: Record<string, string> = {
    manual: '手动',
    conversation: '会话',
    file: '文件',
    selection: '选区',
  };
  const kindLabel = entry.kind === 'image' ? '图片' : '片段';
  const source = sourceLabel[entry.sourceKind] ?? entry.sourceKind;
  const ref = entry.sourceRef ? ` · ${entry.sourceRef}` : '';
  return `${kindLabel} · ${source}${ref}`;
}

export function ScratchpadPanel({ onClose, onQuote, projectId = null, api }: ScratchpadPanelProps) {
  const client = useRef<ScratchpadApi>(api ?? { list: listScratchpad, remove: removeScratchpad });
  /** 打开大图（并在其上批注）的条目；null = 显示列表。 */
  const [viewing, setViewing] = useState<ScratchpadEntry | null>(null);
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState<ScratchpadEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async (nextQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await client.current.list({ query: nextQuery });
      setEntries(result.entries);
      setTotal(result.total);
    } catch (err) {
      setEntries([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : '速记加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  // 首载 + 搜索防抖（输入每个字符都打一次后端没必要，但**结果**必须对应最后输入）。
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(query.trim()); }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleRemove = useCallback(async (entryId: string) => {
    setBusyId(entryId);
    setError(null);
    try {
      await client.current.remove(entryId);
      setEntries((prev) => prev.filter((entry) => entry.entryId !== entryId));
      setTotal((prev) => Math.max(0, prev - 1));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    } finally {
      setBusyId(null);
    }
  }, []);

  // 批注 scope：条目自带项目优先，其次宿主当前项目；都没有则不具备批注条件（诚实禁用）。
  const annotationProjectId = viewing ? (viewing.projectId || projectId || '') : '';
  const annotationScope: AnnotationScope | null = viewing && annotationProjectId
    ? { projectId: annotationProjectId, surface: 'scratchpad-entry', entryId: viewing.entryId }
    : null;
  const annotationTarget: AnnotationTaskTarget = {
    surface: 'scratchpad-entry',
    artifactName: viewing?.title || '速记图片',
  };
  const handleAnnotationAddToContext = useCallback((prompt: string) => {
    if (!prompt) return;
    // 与其他批注面同一条进对话通道（copilotAsk）；UI-612 起只入草稿不发送。
    dispatchPetriEvent(petriEvents.copilotAsk, { prompt, compose: true });
  }, []);

  return (
    <div className="sc-scratch-panel" data-testid="sc-scratch-panel" role="dialog" aria-label="速记板">
      <div className="sc-slash-header">
        <span className="sc-slash-title">速记板</span>
        <span className="sc-slash-hint">{total > 0 ? `${total} 条` : 'Esc 关闭'}</span>
      </div>
      <div className="sc-scratch-search">
        <Icon name="search" size={13} />
        <input
          className="sc-scratch-search-input"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索速记内容"
          aria-label="搜索速记"
          data-testid="sc-scratch-search"
        />
      </div>
      {viewing && (
        <div className="sc-scratch-viewer" data-testid="sc-scratch-viewer">
          <div className="sc-scratch-viewer-head">
            <span className="sc-slash-item-label">{viewing.title || '速记图片'}</span>
            <button
              type="button"
              className="sc-scratch-action"
              data-testid="sc-scratch-viewer-close"
              onClick={() => setViewing(null)}
            >
              返回列表
            </button>
          </div>
          {annotationScope ? (
            <AnnotatableImagePane
              src={viewing.body}
              alt={viewing.title || '速记图片'}
              scope={annotationScope}
              target={annotationTarget}
              onAddToContext={handleAnnotationAddToContext}
            />
          ) : (
            <p className="sc-scratch-viewer-note" data-testid="sc-scratch-viewer-no-project">
              这条速记没有项目归属，无法添加批注：批注按项目隔离，请先在项目内重新保存这张图。
            </p>
          )}
        </div>
      )}
      <div className="sc-slash-list">
        {loading && entries.length === 0 && <div className="sc-slash-empty">正在读取速记…</div>}
        {!loading && error && (
          <div className="sc-slash-empty" data-testid="sc-scratch-error">
            {error}
            <button
              type="button"
              className="sc-scratch-retry"
              onClick={() => void load(query.trim())}
            >
              重试
            </button>
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="sc-slash-empty" data-testid="sc-scratch-empty">
            {query.trim()
              ? `没有匹配「${query.trim()}」的速记`
              : '速记板还是空的：文件预览里选中文字可「加入速记」，或在下方输入后保存要点'}
          </div>
        )}
        {entries.map((entry) => (
          <div className="sc-scratch-item" key={entry.entryId} data-testid="sc-scratch-item">
            {entry.kind === 'image' && /^data:|^https?:/.test(entry.body) && (
              <button
                type="button"
                className="sc-scratch-thumb-btn"
                title="打开大图并批注"
                aria-label={`打开 ${entry.title || '速记图片'}`}
                data-testid="sc-scratch-open-image"
                onClick={() => setViewing(entry)}
              >
                <img className="sc-scratch-thumb" src={entry.body} alt={entry.title || '速记图片'} />
              </button>
            )}
            <div className="sc-scratch-body">
              <span className="sc-slash-item-label" title={entry.title || entryPreview(entry)}>
                {entry.title || entryPreview(entry)}
              </span>
              <span className="sc-slash-item-desc">{entryMeta(entry)}</span>
            </div>
            <div className="sc-scratch-actions">
              <button
                type="button"
                className="sc-scratch-action"
                title="引用到对话"
                aria-label={`引用 ${entry.title || entryPreview(entry)}`}
                data-testid="sc-scratch-quote"
                onClick={() => onQuote(entry)}
              >
                引用
              </button>
              <button
                type="button"
                className="sc-scratch-action sc-scratch-action-danger"
                title="删除这条速记"
                aria-label="删除"
                data-testid="sc-scratch-remove"
                disabled={busyId === entry.entryId}
                onClick={() => void handleRemove(entry.entryId)}
              >
                <Icon name="trash" size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="sc-slash-help-hint">引用后的速记会作为一条上下文出现在输入框上方，可随时移除</div>
    </div>
  );
}
