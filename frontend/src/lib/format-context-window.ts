/**
 * parseContextWindow / formatContextWindow — convert between raw token
 * integers and the short human-readable form ("128K", "1M") used in the
 * model endpoint settings UI.
 *
 * The on-disk value is always a non-negative integer (token count). The
 * string form is purely a UI affordance; we never persist the string.
 */

const TOKEN_RE = /^\s*([0-9]+(?:\.[0-9]+)?)\s*([KkMm]?)\s*$/;

export function parseContextWindow(input: unknown): number | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number' && Number.isFinite(input)) {
    return input > 0 ? Math.round(input) : undefined;
  }
  if (typeof input !== 'string') return undefined;
  const match = TOKEN_RE.exec(input.trim());
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2];
  const multiplier = unit === 'M' || unit === 'm' ? 1_000_000 : unit === 'K' || unit === 'k' ? 1_000 : 1;
  return Math.round(value * multiplier);
}

export function formatContextWindow(tokens: number | undefined | null): string {
  if (!tokens || tokens <= 0) return '';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(2).replace(/\.?0+$/, '')}M`;
  }
  if (tokens >= 1_000) {
    return `${Math.round(tokens / 1_000)}K`;
  }
  return String(tokens);
}