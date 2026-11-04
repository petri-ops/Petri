export function sum(items) {
  return items.reduce((a, b) => a + b, 0);
}

export function average(items) {
  // 均值：保留小数精度，空数组返回 0
  if (items.length === 0) return 0;
  return sum(items) / items.length;
}

export function maxPair(a, b) {
  return a > b ? a : b;
}
