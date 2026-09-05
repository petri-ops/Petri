// ============================================================
// helpers.ts — SimpleChat pure helper functions + sub-components
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4. These helpers don't
// depend on SimpleChat's local state (useState/useRef/useEffect). The
// MessageMeta / ExamplePrompts / compactStageConclusion functions are
// self-contained; everything they read comes from props / imports.
// ============================================================

import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { formatRelativeTime } from '@/lib/format';
import type {
  ExamplePromptsProps,
  ExamplePrompt,
} from './types';

// DEFAULT_EXAMPLE_PROMPTS is also exported from ./types so the helper
// file below doesn't need to re-export it (consumer imports come from
// types). Re-export here for backward compatibility for any internal
// import that referenced the helpers path.

export const DEFAULT_EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    icon: 'bar-chart',
    title: '分析单细胞数据',
    description: '上传你的表达矩阵，我来帮你做降维可视化',
    prompt: '帮我分析这个单细胞RNA数据集',
  },
  {
    icon: 'folder',
    title: '解释项目结构',
    description: '了解代码库的设计与组织方式',
    prompt: '解释一下这个项目的代码结构',
  },
  {
    icon: 'zap',
    title: '快速开始',
    description: '查看 AI 能帮你做什么',
    prompt: 'Gewu Desktop 能帮我完成哪些任务？',
  },
];

/**
 * T83 — small header shown on every AI message: 模型名。
 * （UI-271 增补：回复时间移至底部操作行「创建分支」右侧，由 MessageTime 渲染）
 */
export function MessageMeta({ modelName }: { modelName?: string; ts?: string }): React.ReactElement | null {
  if (!modelName) return null;
  return (
    <div className="sc-msg-meta" aria-label="回复信息">
      <span className="sc-msg-meta-model">{modelName}</span>
    </div>
  );
}

/**
 * UI-271 增补 — 回复时间（底部操作行内）。
 * 时间渐进格式化（刚刚 → HH:MM → MM-DD HH:MM），30s 定时器让时间标签随时间自刷新。
 */
export function MessageTime({ ts }: { ts?: string }): React.ReactElement | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, []);
  if (!ts) return null;
  const time = formatRelativeTime(ts);
  if (!time) return null;
  return <span className="sc-msg-action-time">{time}</span>;
}

export function ExamplePrompts({ prompts, onSelect }: ExamplePromptsProps): React.ReactElement {
  return (
    <div className="sc-example-prompts">
      {prompts.map((item, index) => (
        <button
          type="button"
          key={index}
          className="sc-example-card"
          onClick={() => onSelect(item.prompt)}
          title="点击使用"
          aria-label={item.title}
        >
          <div className="sc-example-icon">
            <Icon name={item.icon} size={18} />
          </div>
          <div className="sc-example-content">
            <span className="sc-example-title">{item.title}</span>
            <span className="sc-example-desc">{item.description}</span>
          </div>
        </button>
      ))}
    </div>
  );
}

/**
 * Compact a verbose stage conclusion into a single-sentence lead.
 * Used by LoopStatusPanel / ResultEditProgressList for header summaries.
 */
export function compactStageConclusion(content: string, maxLength = 240): string {
  const normalized = String(content || '')
    .trim()
    .replace(/^(?:好的?|可以)[，,：:]\s*/u, '')
    .replace(/\s+/gu, ' ');
  if (!normalized) return '';

  const sentenceEnd = normalized.search(/[。！？]/u);
  const firstSentence = sentenceEnd >= 0
    ? normalized.slice(0, sentenceEnd + 1)
    : normalized;
  if (firstSentence.length <= maxLength) return firstSentence;
  return `${firstSentence.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}