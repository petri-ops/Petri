// ============================================================
// LoopStatusPanel — Agent 任务循环状态面板
//
// UI-305 P0.1 从 SimpleChat.tsx 尾部整簇平移（原 2055-2111 行），零行为变化。
// 折叠摘要显示循环状态 + 轮次；展开列出各轮公开结论（不含隐藏推理）。
// ============================================================
import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { deriveLoopDisplay, loopDecisionLabel } from '@/lib/loop-client';
import type { ConversationLoopState } from '../conversationRunStore';
import { compactStageConclusion } from './helpers';

export function LoopStatusPanel({
  loop,
  pending,
}: {
  loop: ConversationLoopState;
  pending: boolean;
}): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const display = deriveLoopDisplay(loop, pending);
  // UI-437 v5.17 — completed 态不渲染（用户裁决「已完成条没用就取消」）：
  // 「已完成 · N 轮 · 一句套话」与时间线运行摘要行（执行工具 N 次 · X 轮 · 耗时）
  // 和紧随的回答正文三重冗余，且永久驻留会话。运行中/重试中/已阻断/已取消/
  // 等待中仍渲染——实时反馈与失败可见性才是本面板的真实价值。
  if (display.status === 'completed') return null;
  const iterations = loop.iterations || [];
  // Only surface public conclusions — never hidden reasoning. The backend
  // already redacts these; blocked/failed turns must read as "not complete".
  const conclusions = iterations.filter(
    (it) => it.publicConclusion && it.publicConclusion.trim()
  );

  return (
    <div className={`sc-loop-panel sc-loop-tone-${display.tone}`} aria-label="任务循环状态">
      <button
        type="button"
        className="sc-loop-summary"
        aria-expanded={expanded}
        aria-controls="sc-loop-iterations"
        aria-label={expanded ? '收起循环详情' : '展开循环详情'}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="sc-loop-status-dot" aria-hidden="true" />
        <span className="sc-loop-status-label">{display.label}</span>
        {display.attempts > 0 && (
          <span className="sc-loop-attempts">· {display.attempts} 轮</span>
        )}
        {loop.latestConclusion && (
          <span className="sc-loop-latest">
            · {compactStageConclusion(loop.latestConclusion, 80)}
          </span>
        )}
        {conclusions.length > 0 && <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size={13} />}
      </button>
      {expanded && conclusions.length > 0 && (
        <div className="sc-loop-iterations">
          {conclusions.map((it) => (
            <div
              key={it.iterationId}
              className={`sc-loop-iteration sc-loop-iteration-${it.status}`}
            >
              <span className="sc-loop-iteration-seq" aria-hidden="true">#{it.sequence}</span>
              <span className="sc-loop-iteration-decision">{loopDecisionLabel(it.decision)}</span>
              <span className="sc-loop-iteration-conclusion">
                {compactStageConclusion(it.publicConclusion, 200)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
