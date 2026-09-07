// ============================================================
// AgentProgressList — Agent 阶段公开结论流
//
// UI-305 P0.1 从 SimpleChat.tsx 尾部整簇平移（原 2113-2150 行），零行为变化。
// 首条 progress 是意图而非结论，刻意从结论链中省略。
// ============================================================
import React from 'react';
import { CopilotMarkdown } from '../copilotMarkdown';
import { compactStageConclusion } from './helpers';
import type { AgentProgressUpdate } from './types';
import type { FileReferenceClickDetail } from '@/lib/chat-file-references';

export function AgentProgressList({
  updates,
  pending,
  onFileReferenceClick,
}: {
  updates: AgentProgressUpdate[];
  pending: boolean;
  onFileReferenceClick: (detail: FileReferenceClickDetail) => void;
}): React.ReactElement {
  // Every progress update after the first starts with the previous stage's
  // public conclusion (enforced by the agent prompt). The first update is only
  // an intention, so it is deliberately omitted from the conclusion trail.
  const conclusions = updates.slice(1).map((progress) => ({
    key: `${progress.iteration}:${progress.content}`,
    content: compactStageConclusion(progress.content),
  })).filter((item) => item.content);

  return (
    <div className="sc-agent-progress" aria-label="阶段结论">
      {conclusions.map((conclusion) => (
        <div key={conclusion.key} className="sc-agent-progress-item">
          <span className="sc-agent-progress-dot" aria-hidden="true" />
          <CopilotMarkdown
            text={conclusion.content}
            onFileReferenceClick={onFileReferenceClick}
            resolveContext={null}
          />
        </div>
      ))}
      {pending && (
        <div className="sc-agent-progress-item sc-agent-progress-current">
          <span className="sc-agent-progress-dot" aria-hidden="true" />
          <span>当前阶段执行中</span>
        </div>
      )}
    </div>
  );
}
