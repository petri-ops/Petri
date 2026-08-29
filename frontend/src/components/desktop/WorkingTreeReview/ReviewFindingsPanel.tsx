// BLOCK-25 — AI review findings panel for the Working Tree Review drawer.
//
// Presentational: state comes from useCodeReviewAgent; interactions bubble up
// via props (onSelectFinding → jump to the diff line; 修复选中项 → copilotAsk).

import { useMemo, useState } from 'react';

import { useAiSettings } from '@/hooks/useAiSettings';
import { reviewPriorityLabel } from '@/lib/review-types';
import type { ReviewFinding, ReviewTarget } from '@/lib/review-types';
import type { CodeReviewAgentApi } from './useCodeReviewAgent';

export interface ReviewFindingsPanelProps {
  agent: CodeReviewAgentApi;
  projectId: string | null;
  onSelectFinding: (finding: ReviewFinding) => void;
  onFixRequested: (prompt: string) => void;
}

function targetForRequest(formValue: string): ReviewTarget {
  if (formValue === 'uncommitted_changes') return { type: 'uncommitted_changes' };
  return { type: 'uncommitted_changes' };
}

export function ReviewFindingsPanel({
  agent,
  projectId,
  onSelectFinding,
  onFixRequested,
}: ReviewFindingsPanelProps) {
  const { presets, activeId } = useAiSettings();
  const [presetId, setPresetId] = useState<string | null>(null);
  const effectivePresetId = presetId ?? activeId;
  const running = agent.phase === 'launching' || agent.phase === 'running';
  const canLaunch = Boolean(projectId) && !running;

  const sortedFindings = useMemo(
    () =>
      agent.findings
        .map((finding, index) => ({ finding, index }))
        .sort((a, b) => {
          const pa = a.finding.priority ?? 9;
          const pb = b.finding.priority ?? 9;
          return pa - pb;
        }),
    [agent.findings]
  );

  const handleStart = () => {
    if (!projectId) return;
    void agent.start(projectId, targetForRequest('uncommitted_changes'), effectivePresetId);
  };

  const handleFixClick = () => {
    const prompt = agent.buildFixPrompt();
    if (prompt) onFixRequested(prompt);
  };

  return (
    <section className="wt-ai-review" aria-label="AI 审阅">
      <div className="wt-ai-review-header">
        <span className="wt-ai-review-title">AI 审阅</span>
        <select
          className="wt-ai-review-target"
          aria-label="审阅目标"
          defaultValue="uncommitted_changes"
          disabled={running}
        >
          <option value="uncommitted_changes">当前未提交变更</option>
        </select>
        <select
          className="wt-ai-review-target"
          aria-label="评审模型渠道"
          value={effectivePresetId}
          onChange={(e) => setPresetId(e.target.value)}
          disabled={running}
          title="评审使用的模型渠道（默认与聊天一致）"
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
        {running ? (
          <button type="button" className="wt-btn" onClick={agent.cancel}>
            取消
          </button>
        ) : (
          <button
            type="button"
            className="wt-btn wt-btn-commit"
            onClick={handleStart}
            disabled={!canLaunch}
            title={projectId ? '对当前工作区变更运行 AI 评审' : '需要打开项目后才能评审'}
          >
            {agent.phase === 'done' || agent.phase === 'error' ? '重新审阅' : '开始审阅'}
          </button>
        )}
      </div>

      {running && (
        <div className="wt-ai-review-status" role="status">
          <span className="wt-ai-review-spinner" aria-hidden="true" />
          {agent.statusText || '评审中…'}
        </div>
      )}

      {agent.phase === 'error' && (
        <div className="wt-ai-review-error" role="alert">
          评审失败：{agent.error}
        </div>
      )}

      {agent.phase === 'done' && agent.output && (
        <div className="wt-ai-review-verdict">
          <span
            className={`wt-ai-review-verdict-badge wt-ai-review-verdict-${agent.output.overallCorrectness === 'patch is correct' ? 'ok' : 'bad'}`}
          >
            {agent.output.overallCorrectness === 'patch is correct'
              ? 'patch is correct'
              : agent.output.overallCorrectness === 'patch is incorrect'
                ? 'patch is incorrect'
                : 'verdict unknown'}
          </span>
          {agent.output.overallExplanation && (
            <span className="wt-ai-review-verdict-text">{agent.output.overallExplanation}</span>
          )}
          {agent.output.droppedFindings > 0 && (
            <span className="wt-ai-review-dropped">
              ({agent.output.droppedFindings} 条结果格式无效已丢弃)
            </span>
          )}
        </div>
      )}

      {sortedFindings.length > 0 && (
        <>
          <ul className="wt-ai-review-list">
            {sortedFindings.map(({ finding, index }) => (
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
                    className="wt-ai-review-item-location"
                    onClick={() => onSelectFinding(finding)}
                  >
                    {finding.codeLocation.absoluteFilePath}:{finding.codeLocation.lineRange.start}-
                    {finding.codeLocation.lineRange.end}
                  </button>
                  <div className="wt-ai-review-item-body">{finding.body}</div>
                </div>
              </li>
            ))}
          </ul>
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
        </>
      )}

      {agent.phase === 'done' && agent.findings.length === 0 && (
        <div className="wt-ai-review-empty">评审完成：没有值得上报的问题。</div>
      )}
    </section>
  );
}
