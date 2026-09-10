export function formatDate(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * T83 — progressive relative time for AI message meta ("模型名 · 回复时间").
 * 1 分钟内 → 刚刚；当天 → HH:MM；更早 → MM-DD HH:MM。
 */
export function formatRelativeTime(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diffMin < 1) return '刚刚';
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) return hhmm;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hhmm}`;
}

/**
 * UI-331 — 左栏会话行右侧短式相对时间（对标 ZCode 形态）。
 * <1 分钟 → 刚刚；<60 分钟 → N分；<24 小时 → N小时；<7 天 → N天；更早 → M/D。
 */
export function formatRelativeShort(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  if (diffMs <= 0) return '刚刚';
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin}分`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}小时`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}天`;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}
