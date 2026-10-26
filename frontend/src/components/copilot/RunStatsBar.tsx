/**
 * UI-523 — composer 运行计量条（Run Stats Strip）。
 *
 * BLOCK-266 视觉收缩：默认图标态——三段各一个图标（播放=本次/数据库=会话/环=上下文），
 * 数字读数全部收进各段 title（悬浮可见），条内不再渲染常驻文字（窄容器不再换行）。
 * 上下文环本体保留（它本身就是图形读数，零文字）。
 *
 * 诚实边界（不变）：
 * - 不可算一律省略该段渲染（无运行/零调用），title 中用「—」表达不可算；
 * - tok/s 是**最近一次调用**的端到端平均输出速率（含网络与 prefill）；
 * - 纯展示组件：零数据依赖、零副作用，环由调用方注入（同一实例，单一真相）。
 */
import React from 'react';
import type { RunUsageDetail } from '@/lib/events';
import type { ConversationUsageSnapshot } from './SimpleChat/hooks/useConversationUsage';
import { formatPercent, formatRate, formatTokens } from './formatCount';
import { Icon } from '@/components/icons/Icon';
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
  /** 窄容器（BLOCK-266 起图标态已为默认，此参保留兼容不再改变布局） */
  narrow?: boolean;
  /** 运行中：图标用强调色（纯视觉） */
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
  narrow: _narrow = false,
  running = false,
  conversationId = null,
}: RunStatsBarProps): React.ReactElement {
  // 运行结束后 run 快照会被持久消息对账清除（useConversationResume），若直接读
  // 会导致「本次」段的记忆读数丢失。记住最近一次观测到的轮/步（切会话归零）。
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

  const runTitle = `本次运行：${shownRounds != null ? `${shownRounds} 轮` : '—'} · ${shownSteps != null ? `${shownSteps} 步` : '—'} · ${rate}（tok/s=最近一次调用的端到端平均输出速率，含网络与 prefill，非解码速度）`;
  const convTitle = `本会话累计：${totalTokens == null ? '— tok' : `${formatTokens(totalTokens)} tok`} · 缓存命中 ${cacheHit}`;
  const ctxTitle = `上下文用量 ${contextPct ?? 0}%（点击圆环查看明细）`;

  return (
    <div
      className={styles.strip}
      data-testid="run-stats-bar"
      data-state={running ? 'running' : 'idle'}
    >
      {hasRun && (
        <span className={styles.group} title={runTitle} data-testid="run-stats-run">
          <Icon name="play" size={13} />
        </span>
      )}
      {hasRun && <span className={styles.divider} aria-hidden="true" />}
      <span className={styles.group} title={convTitle} data-testid="run-stats-conversation">
        <Icon name="database" size={13} />
      </span>
      <span className={styles.divider} aria-hidden="true" />
      <span className={styles.group} title={ctxTitle} data-testid="run-stats-context">
        {contextSlot}
        <span className={styles.visuallyHidden}>{contextPct ?? 0}%</span>
      </span>
    </div>
  );
}
