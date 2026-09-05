// ============================================================
// AgentChangesCard — BLOCK-28.7 聊天区「工作区改动」卡片
//
// 主 agent 任务收尾（biof3:agent-task-done）后拉取 git:working-tree
// status/diff，展示每文件 +N −M 明细；点击文件行派发 biof3:review-open-file
// （ProjectWorkspace 监听打开审阅 tab，useWorkingTreeReview 监听选中文件）。
// 非 desktop 环境（bridge 不可用）或工作区无改动时整卡隐藏。
// git 是唯一事实源：每次刷新都重查 status/diff，提交/还原后自动消失。
//
// BLOCK-31 P3 会话作用域：conversationId 有归属记录时默认只显示**当前会话**
// 的改动（conversationChangesStore 索引），提供「本会话 / 全部」切换；
// 无归属记录（旧会话 / 索引为空）时保持全量视图。审阅面板仍是项目全景。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { gewuEvents, dispatchGewuEvent, subscribeGewuEvent } from '@/lib/events';
import { computeFileDiffStats } from '@/components/desktop/WorkingTreeReview/reviewModeHelpers';
import { CodeMirrorDiffView } from '@/components/desktop/WorkingTreeReview/CodeMirrorDiffView';
import { HoverPreviewPopover } from '@/components/desktop/WorkingTreeReview/HoverPreviewPopover';
import type { DiffFile } from '@/components/desktop/WorkingTreeReview/useWorkingTreeReview';
import {
  getConversationFileChanges,
  hydrateConversationFileChanges,
  subscribeConversationChanges,
} from './conversationChangesStore';

interface ChangeEntry {
  path: string;
  status: string;
  added: number;
  removed: number;
}

/** 文件状态字母徽标配色（A/M/D/U，复用状态语义 token）。 */
const STATUS_CLASS: Record<string, string> = {
  A: 'sc-changes-badge sc-changes-badge-add',
  M: 'sc-changes-badge sc-changes-badge-mod',
  D: 'sc-changes-badge sc-changes-badge-del',
  U: 'sc-changes-badge sc-changes-badge-untracked',
  '?': 'sc-changes-badge sc-changes-badge-untracked',
};

export function AgentChangesCard({
  conversationId,
}: {
  conversationId?: string | null;
}): React.ReactElement | null {
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  // BLOCK-31 P3 — 'conversation' 仅在有归属记录时生效（见 effectiveScope）
  const [scopePreference, setScopePreference] = useState<'conversation' | 'all'>('conversation');
  // UI-252 — 行 diff 数据保留供悬停预览复用（与审阅详情同源）
  const [diffFiles, setDiffFiles] = useState<Map<string, DiffFile>>(() => new Map());

  // BLOCK-32 — 项目级审阅隔离：projectId 取自当前路由（/project/:projectId）
  const routeParams = useParams<{ projectId?: string }>();
  const projectIdRef = useRef<string | null>(null);
  projectIdRef.current = routeParams.projectId ?? null;

  // BLOCK-31 P2 — 当前会话的改动文件索引（live 记录 + 权威清单对账）
  const conversationChanges = useSyncExternalStore(
    subscribeConversationChanges,
    () => getConversationFileChanges(conversationId)
  );
  const conversationPaths = useMemo(
    () => new Set(conversationChanges.map((c) => c.path)),
    [conversationChanges]
  );

  // UI-252/UI-255 — 悬停浮动预览：hover 350ms 弹出只读 diff（定位/尺寸由 HoverPreviewPopover 自适应）
  const [hoverPreview, setHoverPreview] = useState<{ path: string; anchor: DOMRect } | null>(null);
  const hoverOpenTimer = useRef<number | null>(null);
  const hoverCloseTimer = useRef<number | null>(null);

  const cancelHoverTimers = useCallback(() => {
    if (hoverOpenTimer.current !== null) {
      window.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
  }, []);

  const scheduleHoverClose = useCallback(() => {
    if (hoverOpenTimer.current !== null) {
      window.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = null;
    }
    if (hoverCloseTimer.current !== null) window.clearTimeout(hoverCloseTimer.current);
    hoverCloseTimer.current = window.setTimeout(() => setHoverPreview(null), 120);
  }, []);

  const scheduleHoverPreview = useCallback((path: string, el: HTMLElement) => {
    if (hoverCloseTimer.current !== null) {
      window.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = null;
    }
    if (hoverOpenTimer.current !== null) window.clearTimeout(hoverOpenTimer.current);
    hoverOpenTimer.current = window.setTimeout(() => {
      hoverOpenTimer.current = null;
      setHoverPreview({ path, anchor: el.getBoundingClientRect() });
    }, 350);
  }, []);

  // BLOCK-31 P3 — 会话归属记录存在时才启用会话过滤（旧会话 / 索引为空 → 全量视图）
  // 注意：以下派生值须在所有 hooks 之前计算（Hooks 不能位于条件 return 之后）
  const hasConversationScope = Boolean(conversationId) && conversationPaths.size > 0;

  // BLOCK-40 P2 — reload/冷启动后会话归属索引为空：从后端权威清单水合
  // （tasks.files_changed_json，store 内 in-flight + once 去重，失败静默）。
  // 水合成功后 hasConversationScope 变 true，视图自动切「本会话改动」。
  useEffect(() => {
    if (conversationId) void hydrateConversationFileChanges(conversationId);
  }, [conversationId]);

  const effectiveScope =
    hasConversationScope && scopePreference === 'conversation' ? 'conversation' : 'all';
  const entryList = entries ?? [];
  const visibleEntries =
    effectiveScope === 'conversation'
      ? entryList.filter((e) => conversationPaths.has(e.path))
      : entryList;

  // UI-273 — 会话作用域下按执行步骤（agent 迭代轮次）分组展示；未归属的排末尾
  const groupedRows = useMemo(() => {
    if (effectiveScope !== 'conversation') return null;
    const changeByPath = new Map(conversationChanges.map((c) => [c.path, c]));
    const groups: Array<{ key: string; iteration: number | null; label: string; rows: ChangeEntry[] }> = [];
    const byIteration = new Map<number, ChangeEntry[]>();
    const others: ChangeEntry[] = [];
    for (const entry of visibleEntries) {
      const change = changeByPath.get(entry.path);
      if (change && typeof change.iteration === 'number') {
        const bucket = byIteration.get(change.iteration) ?? [];
        bucket.push(entry);
        byIteration.set(change.iteration, bucket);
      } else {
        others.push(entry);
      }
    }
    for (const iteration of Array.from(byIteration.keys()).sort((a, b) => a - b)) {
      groups.push({
        key: `iter-${iteration}`,
        iteration,
        label: `第 ${iteration} 轮`,
        rows: byIteration.get(iteration) ?? [],
      });
    }
    if (others.length > 0) {
      groups.push({ key: 'other', iteration: null, label: '其他改动', rows: others });
    }
    return groups;
  }, [effectiveScope, conversationChanges, visibleEntries]);

  const renderRow = useCallback(
    (entry: ChangeEntry) => (
      <button
        key={entry.path}
        type="button"
        className="sc-changes-row"
        title={`${entry.path} — 点击在审阅中查看`}
        onMouseEnter={(e) => scheduleHoverPreview(entry.path, e.currentTarget)}
        onMouseLeave={scheduleHoverClose}
        onClick={() =>
          dispatchGewuEvent(gewuEvents.reviewOpenFile, { filePath: entry.path })
        }
      >
        <span className={STATUS_CLASS[entry.status] ?? 'sc-changes-badge'}>
          {entry.status}
        </span>
        <span className="sc-changes-row-path">{entry.path}</span>
        <span className="sc-changes-add">+{entry.added}</span>
        <span className="sc-changes-del">−{entry.removed}</span>
      </button>
    ),
    [scheduleHoverPreview, scheduleHoverClose]
  );

  const refresh = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    try {
      // BLOCK-32 — 项目级审阅隔离：改动卡片消费当前项目工作区仓库
      const pid = projectIdRef.current ?? undefined;
      const [statusRes, diffRes] = await Promise.all([bridge.status({ projectId: pid }), bridge.diff({ projectId: pid })]);
      if (!statusRes.ok || !statusRes.data) return;
      const byPath = new Map<string, DiffFile>();
      for (const f of (diffRes.ok && diffRes.data ? diffRes.data.files : []) as DiffFile[]) {
        byPath.set(f.path, f);
      }
      setDiffFiles(byPath);
      const list: ChangeEntry[] = (statusRes.data.files ?? []).map((f) => {
        const stats = computeFileDiffStats(byPath.get(f.path));
        return { path: f.path, status: f.status, added: stats.added, removed: stats.removed };
      });
      setEntries(list);
      if (list.length > 0) setDismissed(false);
    } catch {
      // bridge 异常不阻塞聊天区渲染
    }
  }, []);

  useEffect(() => {
    void refresh();
    // 任务收尾 / 用户打开审阅（提交后文件数会变）都触发重查，git 为准
    const unsubs = [
      subscribeGewuEvent(gewuEvents.agentTaskDone, () => void refresh()),
      subscribeGewuEvent(gewuEvents.reviewOpenFile, () => void refresh()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  if (!entries || entries.length === 0 || dismissed) return null;

  if (visibleEntries.length === 0) return null;

  const totalAdded = visibleEntries.reduce((acc, e) => acc + e.added, 0);
  const totalRemoved = visibleEntries.reduce((acc, e) => acc + e.removed, 0);

  return (
    <div className="sc-changes-card" data-testid="agent-changes-card">
      <button
        type="button"
        className="sc-changes-header"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        title={expanded ? '收起改动明细' : '展开改动明细'}
      >
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />
        <span className="sc-changes-title">
          {effectiveScope === 'conversation' ? '本会话改动' : '工作区改动'}
        </span>
        <span className="sc-changes-count">{visibleEntries.length} 个文件</span>
        <span className="sc-changes-total">
          <span className="sc-changes-add">+{totalAdded}</span>
          <span className="sc-changes-del">−{totalRemoved}</span>
        </span>
        <span
          className="sc-changes-dismiss"
          role="button"
          tabIndex={0}
          aria-label="关闭改动卡片"
          onClick={(e) => {
            e.stopPropagation();
            setDismissed(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.stopPropagation();
              setDismissed(true);
            }
          }}
        >
          <Icon name="x" size={12} />
        </span>
      </button>
      {hasConversationScope && (
        <div
          className="sc-changes-scope-toggle"
          role="tablist"
          aria-label="改动范围切换"
        >
          <button
            type="button"
            role="tab"
            aria-selected={effectiveScope === 'conversation'}
            className={`sc-changes-scope-btn${effectiveScope === 'conversation' ? ' sc-changes-scope-btn-active' : ''}`}
            onClick={() => setScopePreference('conversation')}
          >
            本会话
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={effectiveScope === 'all'}
            className={`sc-changes-scope-btn${effectiveScope === 'all' ? ' sc-changes-scope-btn-active' : ''}`}
            onClick={() => setScopePreference('all')}
          >
            全部
          </button>
        </div>
      )}
      {expanded && (
        <div className="sc-changes-list">
          {groupedRows
            ? groupedRows.map((group) => (
                <div key={group.key} className="sc-changes-group">
                  <div className="sc-changes-group-label" title="改动归属的执行步骤（agent 迭代轮次）">
                    <Icon name="wrench" size={11} />
                    <span>{group.label}</span>
                    <span className="sc-changes-group-count">{group.rows.length} 个文件</span>
                  </div>
                  {group.rows.map(renderRow)}
                </div>
              ))
            : visibleEntries.map(renderRow)}
          <button
            type="button"
            className="sc-changes-row sc-changes-row-all"
            onClick={() => dispatchGewuEvent(gewuEvents.reviewOpenFile, { filePath: '' })}
          >
            <Icon name="git-branch" size={12} />
            <span className="sc-changes-row-path">打开审阅查看全部改动</span>
          </button>
        </div>
      )}
      {/* UI-252/UI-255 — 悬停浮动预览：只读 diff + 状态统计头（定位/尺寸自适应） */}
      {hoverPreview && (() => {
        const previewDiff = diffFiles.get(hoverPreview.path);
        const previewEntry = entries.find((e) => e.path === hoverPreview.path);
        return (
          <HoverPreviewPopover
            anchor={hoverPreview.anchor}
            testid="agent-changes-hover-preview"
            className="sc-changes-hover-preview"
            onMouseEnter={cancelHoverTimers}
            onMouseLeave={scheduleHoverClose}
          >
            <div className="sc-changes-hover-head">
              <span className={STATUS_CLASS[previewEntry?.status ?? ''] ?? 'sc-changes-badge'}>
                {previewEntry?.status ?? '?'}
              </span>
              <span className="sc-changes-hover-path" title={hoverPreview.path}>{hoverPreview.path}</span>
              <span className="sc-changes-add">+{previewEntry?.added ?? 0}</span>
              <span className="sc-changes-del">−{previewEntry?.removed ?? 0}</span>
            </div>
            <div className="sc-changes-hover-body">
              {previewDiff && !previewDiff.binary ? (
                <CodeMirrorDiffView filePath={hoverPreview.path} isBinary={false} hunks={previewDiff.hunks} />
              ) : previewDiff?.binary ? (
                <div className="sc-changes-hover-empty">二进制文件，无文本差异可预览。</div>
              ) : (
                <div className="sc-changes-hover-empty">新增/未跟踪文件，点击行在审阅中查看内容。</div>
              )}
            </div>
          </HoverPreviewPopover>
        );
      })()}
    </div>
  );
}
