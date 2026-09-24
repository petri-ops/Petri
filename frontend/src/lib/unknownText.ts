/**
 * unknownText — 未知值的展示字符串化（BLOCK-105 §7 tail 定性批新增）。
 * 字符串原样；number/boolean/bigint 走 String()（保数字显示语义）；
 * 对象/数组/symbol/undefined 安全回退空串（替代 String() 的 '[object Object]'）。
 */
export function unknownText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  return '';
}
