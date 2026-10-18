/**
 * UI-523 — 计量数字的单一格式源（composer 计量条 + 上下文预算面板共用）。
 *
 * 口径：
 * - token 阶梯走十进制 K/M/B，仅在必要时保留一位小数（980K / 6.4M / 1.2B）；
 * - 速率不可算（null / ≤0 / 非有限）时返回 `—`——**不是 0**（BLOCK-79 口径：
 *   tok/s 是端到端平均输出速率，渠道未返回 usage 时应当说"不可算"）；
 * - 百分比入参是 0–1 比率，默认取整（计量条）/ 可要求一位（面板）。
 */

function trimDecimal(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, '');
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '0';
  if (n >= 1_000_000_000) return `${trimDecimal(n / 1_000_000_000)}B`;
  if (n >= 1_000_000) return `${trimDecimal(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

export function formatRate(tokensPerSecond: number | null | undefined): string {
  if (tokensPerSecond == null || !Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return '—';
  return `${Math.round(tokensPerSecond)} tok/s`;
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${(ratio * 100).toFixed(digits)}%`;
}
