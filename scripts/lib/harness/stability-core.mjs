/**
 * BLOCK-119 P0 — 稳定性探针（k 次重放一致率；BLOCK-110/111 A/B 一致率方法论固化）。
 *
 * 契约（plan §1）：稳定性是测出来的不是判出来的——同一输入重放 k 次，统计多数结果占比。
 *  - fn(i) 返回可 JSON 规范化的结果（对象/标量）；异常计为失败样本不中断探针。
 *  - agreementRate = 多数键占比（成功样本内）；verdict 阈值 2/3（k=3 时 2/3 起判稳）。
 *  - 并发执行（k≤5，与校准 harness 同界）；永不 throw。
 */
export async function probeStability(fn, k = 3) {
  const n = Math.max(2, Math.min(5, Number(k) || 3));
  const results = await Promise.all(
    Array.from({ length: n }, (_, i) =>
      Promise.resolve()
        .then(() => fn(i))
        .catch((err) => ({ __probeError: String((err && err.message) || err) }))
    )
  );
  const okResults = results.filter((r) => !r || !r.__probeError);
  const counts = new Map();
  for (const r of okResults) {
    const key = _stableKey(r);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const modal = counts.size ? Math.max(...counts.values()) : 0;
  const agreementRate = okResults.length ? Number((modal / okResults.length).toFixed(4)) : null;
  return {
    k: n,
    successCount: okResults.length,
    errorCount: n - okResults.length,
    distinctResults: counts.size,
    agreementRate,
    verdict: agreementRate == null ? 'error' : agreementRate >= 2 / 3 ? 'stable' : 'unstable',
  };
}

/** 稳定键：对象按键排序后序列化（规避键序抖动）。 */
function _stableKey(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return '[' + value.map(_stableKey).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + _stableKey(value[k])).join(',') + '}';
}
