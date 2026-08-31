// ============================================================
// AgentChangesCard — BLOCK-28.7 聊天区「工作区改动」卡片
//
// 主 agent 任务收尾（biof3:agent-task-done）后拉取 git:working-tree
// status/diff，展示每文件 +N −M 明细；点击文件行派发 biof3:review-open-file
// （ProjectWorkspace 监听打开审阅 tab，useWorkingTreeReview 监听选中文件）。
// 非 desktop 环境（bridge 不可用）或工作区无改动时整卡隐藏。
// git 是唯一事实源：每次刷新都重查 status/diff，提交/还原后自动消失。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
import { biof3Events, dispatchBioF3Event, subscribeBioF3Event } from '@/lib/events';
import { computeFileDiffStats } from '@/components/desktop/WorkingTreeReview/reviewModeHelpers';
import { CodeMirrorDiffView } from '@/components/desktop/WorkingTreeReview/CodeMirrorDiffView';
import { HoverPreviewPopover } from '@/components/desktop/WorkingTreeReview/HoverPreviewPopover';
import type { DiffFile } from '@/components/desktop/WorkingTreeReview/useWorkingTreeReview';

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

export function AgentChangesCard(): React.ReactElement | null {
  const [entries, setEntries] = useState<ChangeEntry[] | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  // UI-252 — 行 diff 数据保留供悬停预览复用（与审阅详情同源）
  const [diffFiles, setDiffFiles] = useState<Map<string, DiffFile>>(() => new Map());

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

  const refresh = useCallback(async () => {
    const bridge = getBridge('workingTreeReview');
    if (!bridge) return;
    try {
      const [statusRes, diffRes] = await Promise.all([bridge.status(), bridge.diff({})]);
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
      subscribeBioF3Event(biof3Events.agentTaskDone, () => void refresh()),
      subscribeBioF3Event(biof3Events.reviewOpenFile, () => void refresh()),
    ];
    return () => unsubs.forEach((u) => u());
  }, [refresh]);

  if (!entries || entries.length === 0 || dismissed) return null;

  const totalAdded = entries.reduce((acc, e) => acc + e.added, 0);
  const totalRemoved = entries.reduce((acc, e) => acc + e.removed, 0);

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
        <span className="sc-changes-title">工作区改动</span>
        <span className="sc-changes-count">{entries.length} 个文件</span>
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
      {expanded && (
        <div className="sc-changes-list">
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              className="sc-changes-row"
              title={`${entry.path} — 点击在审阅中查看`}
              onMouseEnter={(e) => scheduleHoverPreview(entry.path, e.currentTarget)}
              onMouseLeave={scheduleHoverClose}
              onClick={() =>
                dispatchBioF3Event(biof3Events.reviewOpenFile, { filePath: entry.path })
              }
            >
              <span className={STATUS_CLASS[entry.status] ?? 'sc-changes-badge'}>
                {entry.status}
              </span>
              <span className="sc-changes-row-path">{entry.path}</span>
              <span className="sc-changes-add">+{entry.added}</span>
              <span className="sc-changes-del">−{entry.removed}</span>
            </button>
          ))}
          <button
            type="button"
            className="sc-changes-row sc-changes-row-all"
            onClick={() => dispatchBioF3Event(biof3Events.reviewOpenFile, { filePath: '' })}
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
