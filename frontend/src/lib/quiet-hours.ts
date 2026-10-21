/**
 * quiet-hours — BLOCK-226 免打扰时段（纯函数）。
 *
 * 形态 `HH:MM-HH:MM`；空串=关闭。支持跨午夜（22:00-08:00）。
 * 非法输入由设置面拒绝；归一化时非法值一律视为关闭（主进程不因脏值丢通知）。
 */

export interface QuietWindow {
  startMinutes: number;
  endMinutes: number;
}

const QUIET_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseQuietHours(value: unknown): QuietWindow | null {
  const text = toText(value);
  const match = QUIET_PATTERN.exec(text);
  if (!match) return null;
  return {
    startMinutes: Number(match[1]) * 60 + Number(match[2]),
    endMinutes: Number(match[3]) * 60 + Number(match[4]),
  };
}

export function normalizeQuietHours(value: unknown): string {
  const text = toText(value);
  return QUIET_PATTERN.test(text) ? text : '';
}

export function validateQuietHoursInput(value: unknown): string | null {
  const text = toText(value);
  if (!text) return null;
  return QUIET_PATTERN.test(text) ? null : '格式应为 HH:MM-HH:MM（例如 22:00-08:00）';
}

export function isQuietTime(value: unknown, date: Date = new Date()): boolean {
  const window = parseQuietHours(value);
  if (!window || window.startMinutes === window.endMinutes) return false;
  const now = date.getHours() * 60 + date.getMinutes();
  if (window.startMinutes < window.endMinutes) {
    return now >= window.startMinutes && now < window.endMinutes;
  }
  return now >= window.startMinutes || now < window.endMinutes;
}
