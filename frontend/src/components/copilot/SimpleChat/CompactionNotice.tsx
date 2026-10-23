import React from 'react';
import { Icon } from '@/components/icons/Icon';

/**
 * BLOCK-95 B2/A5（BLOCK-248 抽件）— 压缩诚实提示：LLM 视图中更早上下文已折叠为摘要，
 * 本界面仍显示原文。抽成组件是为了让 SimpleChat 保持只减不增（code-size 棘轮）。
 */
export function CompactionNotice({
  coversCount,
  sourceTokens,
  summary,
}: {
  coversCount: number;
  sourceTokens: number;
  summary: string;
}): React.ReactElement {
  return (
    <div className="sc-compaction-notice" role="status" title={summary}>
      <Icon name="layers" size={13} />
      <span>
        上下文压缩视图：更早的 {coversCount} 条消息已折叠为摘要参与对话
        <span className="sc-compaction-notice-sub">（此处仍显示原文 · {sourceTokens} tokens 已压缩）</span>
      </span>
    </div>
  );
}
