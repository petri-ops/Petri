// BLOCK-255 C4 — 逐消息统计的纯函数层（实时累加 + 面板视图模型）。
//
// 数据边界：
//   · 耗时/工具/迭代/字符来自消息本身（本地实测）；
//   · token 来自本轮 model usage 累加（后端 meta.usage 或实时 runUsage 事件）；
//   · 没有 usage 就说「未记录」，不把不可算写成 0。
import type { RunUsageDetail } from '@/lib/events';
import { formatTokens } from '../formatCount';
import type { MessageUsage, SimpleMessage } from './types';

function nonNegativeInt(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

/** 实时 usage 事件 → 本条合计（只数已发 usage 的调用；unmeasured 未知不写 0）。 */
export function accumulateMessageUsage(current: MessageUsage | null, detail: RunUsageDetail): MessageUsage {
  const base: MessageUsage = current ?? {
    calls: 0,
    promptTokens: 0,
    completionTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    durationMs: 0,
    models: [],
  };
  const models = [...base.models];
  if (detail.model && !models.includes(detail.model) && models.length < 5) models.push(detail.model);
  return {
    ...base,
    calls: base.calls + 1,
    promptTokens: base.promptTokens + nonNegativeInt(detail.promptTokens),
    completionTokens: base.completionTokens + nonNegativeInt(detail.completionTokens),
    cacheReadTokens: base.cacheReadTokens + nonNegativeInt(detail.cacheReadTokens),
    cacheCreationTokens: base.cacheCreationTokens + nonNegativeInt(detail.cacheCreationTokens),
    durationMs: base.durationMs + nonNegativeInt(detail.durationMs),
    models,
  };
}

export function formatStatsDuration(ms: number | undefined | null): string {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function iterationCount(message: SimpleMessage): number {
  const progress = (message.progressUpdates ?? []).reduce(
    (max, item) => Math.max(max, nonNegativeInt(item.iteration)),
    0,
  );
  const reasoning = Object.keys(message.reasoningByIteration ?? {}).reduce(
    (max, key) => Math.max(max, nonNegativeInt(key)),
    0,
  );
  const loop = message.loop?.iterations.length ?? 0;
  return Math.max(progress, reasoning, loop);
}

interface MessageStatsRow {
  label: string;
  value: string;
  title?: string;
}

export interface MessageStatsView {
  rows: MessageStatsRow[];
  note: string;
  hasUsage: boolean;
}

/**
 * 构造统计面板的行。只放本条真实可得的数据；模型/ token 缺失时明确「未记录」。
 * 行顺序：耗时 → 工具 → 迭代 → 字符 → 模型 → token → 缓存 → 调用 → 结果卡。
 */
export function buildMessageStatsView(message: SimpleMessage): MessageStatsView {
  const usage = message.usage;
  const hasUsage = Boolean(usage && usage.calls > 0);
  const calls = usage?.calls ?? 0;
  const unmeasured = usage?.unmeasuredCalls ?? 0;
  const models = usage?.models?.length
    ? usage.models.join(' / ')
    : (message.modelName || '未记录');
  const toolSteps = message.toolActivities?.length ?? 0;
  const iterations = iterationCount(message);
  const chars = Array.from(message.content ?? '').length;
  const rows: MessageStatsRow[] = [
    {
      label: '处理耗时',
      value: formatStatsDuration(message.processingDurationMs),
      title: '从发送到本轮结束的端到端耗时（含工具执行）。',
    },
    { label: '工具步数', value: `${toolSteps} 步` },
    { label: '模型迭代', value: iterations > 0 ? `${iterations} 轮` : '—' },
    { label: '字符数', value: `${chars} 字` },
    { label: '模型', value: models },
    {
      label: 'Token',
      value: hasUsage
        ? `输入 ${formatTokens(usage!.promptTokens)} · 输出 ${formatTokens(usage!.completionTokens)}`
        : '未记录',
      title: hasUsage
        ? '本条回复内模型调用 usage 合计（有 usage 的调用）；缓存读写另列。'
        : '本条没有可用的模型 usage（旧消息或渠道未返回）。',
    },
  ];
  if (hasUsage && (usage!.cacheReadTokens > 0 || usage!.cacheCreationTokens > 0)) {
    rows.push({
      label: '缓存',
      value: `读 ${formatTokens(usage!.cacheReadTokens)} · 写 ${formatTokens(usage!.cacheCreationTokens)}`,
    });
  }
  rows.push({
    label: '调用',
    value: hasUsage || unmeasured > 0
      ? `${calls} 次（有 usage）${unmeasured > 0 ? ` · ${unmeasured} 次未返回 usage` : ''}`
      : '未记录',
  });
  if (message.resultNodes && message.resultNodes.length > 0) {
    rows.push({ label: '结果卡', value: `${message.resultNodes.length} 个` });
  }

  let note: string;
  if (hasUsage) {
    note = unmeasured > 0
      ? `token 为本条回复内模型调用合计；另有 ${unmeasured} 次调用未返回 usage，未计入 token。`
      : 'token 为本条回复内模型调用合计（有 usage 的调用）；不含工具执行耗时。';
  } else if (unmeasured > 0) {
    note = '本条模型调用未返回 usage；耗时/工具/迭代仍为本地实测，token 不伪造 0。';
  } else {
    note = '本条未记录 token（旧消息或渠道未返回 usage）；耗时/工具/迭代仍为本地实测。';
  }
  return { rows, note, hasUsage };
}
