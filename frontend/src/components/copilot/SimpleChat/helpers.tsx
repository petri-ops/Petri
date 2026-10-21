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
import { getBridge } from '@/lib/desktopBridge';
import { formatRelativeTime } from '@/lib/format';
import {
  DEFAULT_EXAMPLE_PROMPTS,
  type ExamplePrompt,
  type ExamplePromptsProps,
} from './types';

// DEFAULT_EXAMPLE_PROMPTS canonical 定义在 ./types（通用卡 + 包声明示例卡）；
// 此处 re-export 仅为向后兼容旧内部导入路径。
// 2026-09-18 曾在此文件与 types.ts 各存一份拷贝（双维护陷阱），已收编单源。

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

export function normalizePackExamplePrompts(packs: unknown): ExamplePrompt[] {
  if (!Array.isArray(packs)) return [];
  return packs
    .flatMap((pack) => {
      const examples = (pack as { examples?: unknown } | null)?.examples;
      return Array.isArray(examples) ? (examples as unknown[]) : [];
    })
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as { icon?: unknown; title?: unknown; description?: unknown; prompt?: unknown };
      const title = typeof record.title === 'string' ? record.title.trim() : '';
      const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
      if (!title || !prompt) return [];
      return [{
        icon: (typeof record.icon === 'string' && record.icon.trim()
          ? record.icon.trim()
          : 'zap') as ExamplePrompt['icon'],
        title,
        description: typeof record.description === 'string' ? record.description.trim() : '',
        prompt,
      }];
    })
    .slice(0, 6);
}

// 2026-09-18 历史残留清理 — 领域感知示例卡：默认渲染通用卡，后台查已装领域
// 包（桌面 IPC packs.listInstalled / 投影 HTTP 桥同形）读取包声明的示例卡。
// 桥缺失/查询失败一律停留在通用卡（无包不提领域，BLOCK-86 哲学同款）；
// 查询失败静默降级不弹错。
export function useDomainExamplePrompts(): ExamplePrompt[] {
  const [prompts, setPrompts] = useState<ExamplePrompt[]>(DEFAULT_EXAMPLE_PROMPTS);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const packsBridge = getBridge('packs') as
          | { listInstalled?: () => Promise<unknown> }
          | null;
        const result = await packsBridge?.listInstalled?.();
        // L4-2 形状勘误同款：桌面 IPC pack:list-installed 返回 { ok, packs } 信封
        //（非裸数组），双形状兼容防信封误判成「无包」。
        const packs = Array.isArray(result)
          ? result
          : (result as { packs?: unknown } | null)?.packs;
        if (!alive) return;
        const extra = normalizePackExamplePrompts(packs);
        if (extra.length > 0) setPrompts([...DEFAULT_EXAMPLE_PROMPTS, ...extra]);
      } catch {
        // 桥缺失/查询失败 = 通用卡兜底，不打扰用户
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return prompts;
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