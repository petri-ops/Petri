/**
 * 科学数值的展示层格式化（UI-452 / BIO-1）。
 *
 * 只改显示不改真相：调用方（表格单元格）保留原始字符串在 title / 协议载荷里，
 * 本函数仅决定人眼读什么——p 值一类极值用两位小数科学计数，常规范围保留
 * 4 位有效数字；非数值输入（NA、文本）原样返回，不做猜测。
 */
export function formatScientificValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '—';
  // 单元格载荷是 string/number；出现其他类型时不猜，按缺值处理。
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' || typeof raw === 'bigint' || typeof raw === 'boolean' ? String(raw) : '—';
  if (!text.trim()) return '—';
  const value = Number(text);
  if (!Number.isFinite(value)) return text;
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-3) return value.toExponential(2);
  return String(Number(value.toPrecision(4)));
}
