// BLOCK-26 P1 — AI review findings panel v2.
//
// Codex-parity presentation: verdict summary header with severity counts and
// elapsed time, findings grouped by file with collapsible bodies, live tool
// activity during the run, and polished empty/error states. Interactions
// bubble up via props (onSelectFinding → jump; onFixRequested → chat).

import { useEffect, useMemo, useState } from 'react';

import { useAiSettings } from '@/hooks/useAiSettings';
import { fetchRecentBranches, fetchRecentCommits, type RecentBranches, type RecentCommit } from '@/lib/review-client';
import { reviewPriorityLabel } from '@/lib/review-types';
import type { ReviewFinding, ReviewTarget } from '@/lib/review-types';
import type { CodeReviewAgentApi } from './useCodeReviewAgent';

const CHANNEL_STORAGE_KEY = 'biof3_review_preset_id';

export interface ReviewFindingsPanelProps {
  agent: CodeReviewAgentApi;
  projectId: string | null;
  onSelectFinding: (finding: ReviewFinding) => void;
  onFixRequested: (prompt: string) => void;
}

const TARGET_OPTIONS: Array<{ value: string; label: string; hint: string }> = [
  { value: 'uncommitted_changes', label: '当前未提交变更', hint: '工作区 staged + unstaged' },
  { value: 'base_branch', label: '对比 base 分支 (PR Style)', hint: '最近一次 merge-base 以来的变更' },
  { value: 'commit', label: '指定提交', hint: '最近 100 个提交' },
  { value: 'custom', label: '自定义审阅指令', hint: '用自己的话描述审阅范围' },
];

function severityCounts(findings: ReviewFinding[]): Record<string, number> {
  const counts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of findings) {
    const key = finding.priority === null || finding.priority < 0 || finding.priority > 3 ? 'P?' : `P${finding.priority}`;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function elapsedLabel(startedAt: number | null, running: boolean): string | null {
  if (!startedAt) return null;
  const seconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  if (!running) return `${seconds}s`;
  return `${seconds}s`;
}

export function ReviewFindingsPanel({
  agent,
  projectId,
  onSelectFinding,
  onFixRequested,
}: ReviewFindingsPanelProps) {
  const { presets, activeId } = useAiSettings();
  const [targetType, setTargetType] = useState('uncommitted_changes');
  const [customText, setCustomText] = useState('');
  const [branchName, setBranchName] = useState('');
  const [commitSha, setCommitSha] = useState('');
  const [branches, setBranches] = useState<RecentBranches | null>(null);
  const [commits, setCommits] = useState<RecentCommit[] | null>(null);
  const [pickerError, setPickerError] = useState<string | null>(null);
  // BLOCK-26 P2: persist the last-used review channel per workspace.
  const [presetId, setPresetId] = useState<string | null>(() => {
    try { return localStorage.getItem(CHANNEL_STORAGE_KEY); } catch { return null; }
  });
  const [collapsedBodies, setCollapsedBodies] = useState<Set<number>>(new Set());
  const [nowTick, setNowTick] = useState(0);
  const effectivePresetId = presetId ?? activeId;
  const running = agent.phase === 'launching' || agent.phase === 'running';
  const canLaunch = Boolean(projectId) && !running;

  const changePreset = (id: string) => {
    setPresetId(id);
    try { localStorage.setItem(CHANNEL_STORAGE_KEY, id); } catch {}
  };

  // Lazy-load picker data when the corresponding target is chosen.
  useEffect(() => {
    if (targetType !== 'base_branch' || branches) return;
    fetchRecentBranches().then(setBranches).catch((e) => setPickerError(String(e?.message || e)));
  }, [targetType, branches]);
  useEffect(() => {
    if (targetType !== 'commit' || commits) return;
    fetchRecentCommits(100).then(setCommits).catch((e) => setPickerError(String(e?.message || e)));
  }, [targetType, commits]);


  // Elapsed clock while a run is active.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNowTick((v) => v + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);
  void nowTick;

  const grouped = useMemo(() => {
    const groups = new Map<string, Array<{ finding: ReviewFinding; index: number }>>();
    agent.findings
      .map((finding, index) => ({ finding, index }))
      .sort((a, b) => {
        const pa = a.finding.priority ?? 9;
        const pb = b.finding.priority ?? 9;
        return pa - pb;
      })
      .forEach(({ finding, index }) => {
        const file = finding.codeLocation.absoluteFilePath.split('/').slice(-2).join('/');
        if (!groups.has(file)) groups.set(file, []);
        groups.get(file)!.push({ finding, index });
      });
    return [...groups.entries()].sort((a, b) => {
      const pa = Math.min(...a[1].map((x) => x.finding.priority ?? 9));
      const pb = Math.min(...b[1].map((x) => x.finding.priority ?? 9));
      return pa - pb;
    });
  }, [agent.findings]);

  const counts = useMemo(() => severityCounts(agent.findings), [agent.findings]);
  const hasCounts = agent.findings.length > 0;

  const handleStart = () => {
    if (!projectId) return;
    let target: ReviewTarget = { type: 'uncommitted_changes' };
    if (targetType === 'custom' && customText.trim()) target = { type: 'custom', instructions: customText.trim() };
    else if (targetType === 'base_branch' && branchName.trim()) target = { type: 'base_branch', branch: branchName.trim() };
    else if (targetType === 'commit' && commitSha.trim()) {
      const hit = commits?.find((c) => c.sha === commitSha.trim() || c.shortSha === commitSha.trim());
      target = { type: 'commit', sha: hit?.sha || commitSha.trim().toLowerCase(), title: hit?.subject || null };
    }
    const label = presets.find((p) => p.id === effectivePresetId)?.label ?? null;
    void agent.start(projectId, target, effectivePresetId, label);
  };
  const handleFixClick = () => {
    const prompt = agent.buildFixPrompt();
    if (prompt) onFixRequested(prompt);
  };

  const toggleBody = (index: number) => {
    setCollapsedBodies((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const elapsed = elapsedLabel(agent.startedAt, running);

  return (
    <section className="wt-ai-review" aria-label="AI 审阅">
      <div className="wt-ai-review-header">
        <span className="wt-ai-review-title">AI 审阅</span>
        <select
          className="wt-ai-review-target"
          aria-label="审阅目标"
          value={targetType}
          onChange={(e) => setTargetType(e.target.value)}
          disabled={running}
        >
          {TARGET_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {targetType === 'base_branch' && (
          <>
            <input
              className="wt-ai-review-input"
              aria-label="base 分支名"
              placeholder="选择或输入分支"
              list="wt-review-branch-options"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              disabled={running}
            />
            <datalist id="wt-review-branch-options">
              {(branches?.branches || []).map((branch) => (
                <option key={branch} value={branch}>
                  {branches?.current ? `${branches.current} -> ${branch}` : branch}
                </option>
              ))}
            </datalist>
          </>
        )}
        {targetType === 'commit' && (
          <>
            <input
              className="wt-ai-review-input"
              aria-label="提交 sha 或主题"
              placeholder="选择或输入提交"
              list="wt-review-commit-options"
              value={commitSha}
              onChange={(e) => setCommitSha(e.target.value)}
              disabled={running}
            />
            <datalist id="wt-review-commit-options">
              {(commits || []).map((commit) => (
                <option key={commit.sha} value={commit.sha}>
                  {commit.shortSha} {commit.subject}（{commit.authoredRel}）
                </option>
              ))}
            </datalist>
          </>
        )}
        {targetType === 'custom' && (
          <input
            className="wt-ai-review-input"
            aria-label="自定义审阅指令"
            placeholder="例如：只看安全问题"
            value={customText}
            onChange={(e) => setCustomText(e.target.value)}
            disabled={running}
          />
        )}
        <select
          className="wt-ai-review-target"
          aria-label="评审模型渠道"
          value={effectivePresetId}
          onChange={(e) => changePreset(e.target.value)}
          disabled={running}
          title="评审使用的模型渠道（默认与聊天一致，选择后记住）"
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>{preset.label}</option>
          ))}
        </select>
        {pickerError && <span className="wt-ai-review-picker-error" title={pickerError}>⚠</span>}
        {running ? (
          <button type="button" className="wt-btn" onClick={agent.cancel}>取消</button>
        ) : (
          <button
            type="button"
            className="wt-btn wt-btn-commit"
            onClick={handleStart}
            disabled={!canLaunch || (targetType === 'custom' && !customText.trim())}
            title={projectId ? '运行 AI 评审' : '需要打开项目后才能评审'}
          >
            {agent.phase === 'done' || agent.phase === 'error' ? '重新审阅' : '开始审阅'}
          </button>
        )}
      </div>

      {running && (
        <div className="wt-ai-review-status" role="status">
          <span className="wt-ai-review-spinner" aria-hidden="true" />
          <span>{agent.statusText || '评审中…'}</span>
          {elapsed && <span className="wt-ai-review-elapsed">{elapsed}</span>}
          {agent.channelLabel && <span className="wt-ai-review-channel">{agent.channelLabel}</span>}
        </div>
      )}
      {running && agent.activity.length > 0 && (
        <div className="wt-ai-review-activity" aria-label="评审活动">
          {agent.activity.slice(-4).map((entry, i) => (
            <div key={`${entry.at}-${i}`} className="wt-ai-review-activity-line">· {entry.label}</div>
          ))}
        </div>
      )}

      {agent.phase === 'error' && (
        <div className="wt-ai-review-error" role="alert">
          <span>评审失败：{agent.error}</span>
          <button type="button" className="wt-btn" onClick={handleStart} disabled={!canLaunch}>重试</button>
        </div>
      )}

      {agent.phase === 'done' && agent.output && (
        <div className={`wt-ai-review-verdict wt-ai-review-verdict-${agent.output.overallCorrectness === 'patch is correct' ? 'ok' : 'bad'}`}>
          <div className="wt-ai-review-verdict-row">
            <span className="wt-ai-review-verdict-badge">
              {agent.output.overallCorrectness === 'patch is correct'
                ? '✓ patch is correct'
                : agent.output.overallCorrectness === 'patch is incorrect'
                  ? '✕ patch is incorrect'
                  : 'verdict unknown'}
            </span>
            {hasCounts && (
              <span className="wt-ai-review-counts">
                {(['P0', 'P1', 'P2', 'P3'] as const).map((key) => (
                  counts[key] > 0 ? (
                    <span key={key} className={`wt-ai-review-count wt-ai-review-count-${key.slice(1)}`}>
                      {key}×{counts[key]}
                    </span>
                  ) : null
                ))}
              </span>
            )}
            {elapsed && <span className="wt-ai-review-elapsed">{elapsed}</span>}
            {agent.channelLabel && <span className="wt-ai-review-channel">{agent.channelLabel}</span>}
          </div>
          {agent.output.overallExplanation && (
            <div className="wt-ai-review-verdict-text">{agent.output.overallExplanation}</div>
          )}
          {agent.output.droppedFindings > 0 && (
            <div className="wt-ai-review-dropped">（{agent.output.droppedFindings} 条结果格式无效已丢弃）</div>
          )}
        </div>
      )}

      {grouped.length > 0 && (
        <div className="wt-ai-review-groups">
          {grouped.map(([file, entries]) => (
            <div key={file} className="wt-ai-review-group">
              <div className="wt-ai-review-group-head">
                <span className="wt-ai-review-group-file">{file}</span>
                <span className="wt-ai-review-group-count">{entries.length}</span>
              </div>
              <ul className="wt-ai-review-list">
                {entries.map(({ finding, index }) => {
                  const collapsed = collapsedBodies.has(index);
                  return (
                    <li key={index} className="wt-ai-review-item">
                      <label className="wt-ai-review-check">
                        <input
                          type="checkbox"
                          checked={agent.selected.has(index)}
                          onChange={() => agent.toggleFinding(index)}
                          aria-label={`选择: ${finding.title}`}
                        />
                      </label>
                      <div className="wt-ai-review-item-main">
                        <div className="wt-ai-review-item-row">
                          <button
                            type="button"
                            className="wt-ai-review-item-title"
                            onClick={() => onSelectFinding(finding)}
                            title="点击跳转到 diff 对应行"
                          >
                            <span className={`wt-ai-review-priority wt-ai-review-priority-${finding.priority ?? 'unknown'}`}>
                              {reviewPriorityLabel(finding.priority)}
                            </span>
                            <span className="wt-ai-review-item-title-text">{finding.title}</span>
                          </button>
                          <button
                            type="button"
                            className="wt-ai-review-item-toggle"
                            onClick={() => toggleBody(index)}
                            aria-expanded={!collapsed}
                            title={collapsed ? '展开说明' : '收起说明'}
                          >
                            {collapsed ? '▾' : '▴'}
                          </button>
                        </div>
                        <button
                          type="button"
                          className="wt-ai-review-item-location"
                          onClick={() => onSelectFinding(finding)}
                        >
                          {finding.codeLocation.absoluteFilePath.split('/').pop()}:
                          {finding.codeLocation.lineRange.start}-{finding.codeLocation.lineRange.end}
                          {finding.confidenceScore !== null && (
                            <span className="wt-ai-review-confidence"> · {Math.round(finding.confidenceScore * 100)}%</span>
                          )}
                        </button>
                        {!collapsed && <div className="wt-ai-review-item-body">{finding.body}</div>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
          <div className="wt-ai-review-footer">
            <button
              type="button"
              className="wt-btn wt-btn-commit"
              onClick={handleFixClick}
              disabled={agent.selected.size === 0}
              title="把选中的发现作为修复请求发送到聊天"
            >
              修复选中项 ({agent.selected.size})
            </button>
          </div>
        </div>
      )}

      {agent.phase === 'done' && agent.findings.length === 0 && (
        <div className="wt-ai-review-empty">
          {agent.output?.overallExplanation || '评审完成：没有值得上报的问题。'}
        </div>
      )}
    </section>
  );
}
