// ============================================================
// AgentProgress — Agent 阶段公开结论行
//
// UI-305 P0.1 原为 SimpleChat.tsx 尾部整簇平移（`AgentProgressList`，一条列表收编
// 全部阶段）。BLOCK-107 P2c（D5 裁决）把阶段进度按 iteration 插入会话时间线脊线后，
// 分组列表形态不再需要，本文件只保留单行渲染件，由时间线逐段调用。
//
// UI-305 两条语义原样保留，判定点随结构移到调用方：
//   ① 首条 progress 是意图而非结论 → 省略（原 `updates.slice(1)` → 现 `meta.isFirst`）；
//   ② 运行中在末条后补「当前阶段执行中」（原 `pending` prop → 现 `meta.isLast && pending`）。
// 之所以由调用方判定：时间线上「首/末」是分段位置，不再等于数组下标。
// ============================================================
import React from 'react';

import { CopilotMarkdown } from '../copilotMarkdown';
import { compactStageConclusion } from './helpers';
import type { FileReferenceClickDetail } from '@/lib/chat-file-references';

/** 单条阶段公开结论（首条意图由调用方挡在门外，此处不做省略判断）。 */
export function AgentProgressItem({
  content,
  onFileReferenceClick,
}: {
  content: string;
  onFileReferenceClick: (detail: FileReferenceClickDetail) => void;
}): React.ReactElement | null {
  const conclusion = compactStageConclusion(content);
  if (!conclusion) return null;
  return (
    <div className="sc-agent-progress-item">
      <span className="sc-agent-progress-dot" aria-hidden="true" />
      <CopilotMarkdown
        text={conclusion}
        onFileReferenceClick={onFileReferenceClick}
        resolveContext={null}
      />
    </div>
  );
}

/** UI-305 ② — 本轮仍在跑时挂在末条结论后的运行中标记。 */
export function AgentProgressPendingRow(): React.ReactElement {
  return (
    <div className="sc-agent-progress-item sc-agent-progress-current">
      <span className="sc-agent-progress-dot" aria-hidden="true" />
      <span>当前阶段执行中</span>
    </div>
  );
}
