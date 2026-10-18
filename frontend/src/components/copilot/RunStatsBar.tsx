/**
 * UI-523 — composer 运行计量条（Run Stats Strip）。
 *
 * 三条读数，各有唯一真源、各有范围限定词：
 *   本次  N 轮 · N 步 · 252 tok/s   ← 本次运行（迭代数 / 工具步数 / 最近一次调用实测）
 *   会话  6.4M tok · 缓存命中 98%   ← 本会话累计（ai_usage 聚合）
 *   ◐ 14%                          ← 上下文水位（token_budget，环本体是可点组件）
 *
 * 诚实边界：
 * - 不可算一律 `—`：无运行 / 渠道未返回 usage / 会话零调用 / 耗时 0；
 * - tok/s 是**最近一次调用**的端到端平均输出速率（含网络与 prefill），
 *   title 明写口径，不称「解码速度」；
 * - 纯展示组件：零数据依赖、零副作用，环由调用方注入（同一实例，单一真相）。
 */
import React from 'react';
import type { RunUsageDetail } from '@/lib/events';
import type { ConversationUsageSnapshot } from './SimpleChat/hooks/useConversationUsage';
import { formatPercent, formatRate, formatTokens } from './formatCount';
import styles from './RunStatsBar.module.css';

export interface RunStatsBarProps {
  /** 本次运行：模型迭代轮次（null = 本会话尚未产生运行） */
  rounds: number | null;
  /** 本次运行：工具调用步数 */
  steps: number | null;
  /** 最近一次模型调用实测（null = 尚无测量） */
  runUsage: RunUsageDetail | null;
  /** 本会话累计（null = 尚未取到） */
  conversationUsage: ConversationUsageSnapshot | null;
  /** 上下文水位百分比；null = 尚无 budget（与环一致显示 0%） */
  contextPct: number | null;
  /** 上下文预算环（由 SimpleChat 注入同一 ContextBudgetButton 实例） */
  contextSlot?: React.ReactNode;
  /** 窄容器：收起范围标签与缓存段，只留数字 */
  narrow?: boolean;
  /** 运行中：速率用强调色（纯视觉，不改读数） */
  running?: boolean;
  /** 会话标识：切换会话即归零「最近一次运行」记忆 */
  conversationId?: string | null;
}

function runUsageTokensPerSecond(usage: RunUsageDetail | null): number | null {
  if (!usage || usage.durationMs <= 0 || usage.completionTokens <= 0) return null;
  return usage.completionTokens / (usage.durationMs / 1000);
}

export function RunStatsBar({
  rounds,
  steps,
  runUsage,
  conversationUsage,
  contextPct,
  contextSlot,
  narrow = false,
  running = false,
  conversationId = null,
}: RunStatsBarProps): React.ReactElement {
  // 运行结束后 run 快照会被持久消息对账清除（useConversationResume），若直接读
  // 会导致「本次」段在读数为 1 轮/0 步之后突然变成只剩速率。这里记住最近一次
  // 观测到的轮/步（切会话即归零），让条内读数与「最近一次运行」语义一致。
  const [lastRun, setLastRun] = React.useState<{ key: string | null; rounds: number | null; steps: number | null }>({
    key: conversationId, rounds: null, steps: null,
  });
  if (lastRun.key !== conversationId) {
    setLastRun({ key: conversationId, rounds: null, steps: null });
  } else if ((rounds != null || steps != null)
    && (lastRun.rounds !== rounds || lastRun.steps !== steps)) {
    setLastRun({ key: conversationId, rounds: rounds ?? lastRun.rounds, steps: steps ?? lastRun.steps });
  }
  const shownRounds = rounds ?? lastRun.rounds;
  const shownSteps = steps ?? lastRun.steps;

  const hasRun = shownRounds != null || shownSteps != null || runUsage != null;
  const rate = formatRate(runUsageTokensPerSecond(runUsage));

  const hasConversation = Boolean(conversationUsage && conversationUsage.calls > 0);
  const totalTokens = hasConversation
    ? (conversationUsage as ConversationUsageSnapshot).inputTokens + (conversationUsage as ConversationUsageSnapshot).outputTokens
    : null;
  const cacheHit = hasConversation && (conversationUsage as ConversationUsageSnapshot).inputTokens > 0
    ? formatPercent((conversationUsage as ConversationUsageSnapshot).cacheHitRate)
    : '—';

  return (
    <div
      className={styles.strip}
      data-testid="run-stats-bar"
      data-state={running ? 'running' : 'idle'}
    >
      {hasRun && (
        <span
          className={styles.group}
          title="本次运行：轮=模型迭代轮次；步=工具调用步数；tok/s=最近一次调用的端到端平均输出速率（含网络与 prefill，非解码速度）"
          data-testid="run-stats-run"
        >
          {!narrow && <span className={styles.scope}>本次</span>}
          {shownRounds != null && <span>{shownRounds} 轮</span>}
          {shownRounds != null && shownSteps != null && <span className={styles.dot}>·</span>}
          {shownSteps != null && <span>{shownSteps} 步</span>}
          <span className={styles.dot}>·</span>
          <span className={styles.rate} data-testid="run-stats-rate">{rate}</span>
        </span>
      )}
      {hasRun && <span className={styles.divider} aria-hidden="true" />}
      <span
        className={styles.group}
        title="本会话累计：输入+输出 tokens（含缓存命中部分）；缓存命中率 = 缓存读取 ÷ 输入 tokens"
        data-testid="run-stats-conversation"
      >
        {!narrow && <span className={styles.scope}>会话</span>}
        <span data-testid="run-stats-total">{totalTokens == null ? '—' : formatTokens(totalTokens)} tok</span>
        {!narrow && (
          <>
            <span className={styles.dot}>·</span>
            <span data-testid="run-stats-cache">缓存命中 {cacheHit}</span>
          </>
        )}
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.group} title="上下文用量（点击圆环查看明细）" data-testid="run-stats-context">
        {contextSlot}
        <span>{contextPct ?? 0}%</span>
      </span>
    </div>
  );
}
