export function sum(items) {
  return items.reduce((a, b) => a + b, 0);
}

export function average(items) {
  // 均值：当前实现把结果向下取整（bug）
  if (items.length === 0) return 0;
  return Math.floor(sum(items) / items.length);
}

export function maxPair(a, b) {
  return a > b ? a : b;
}
