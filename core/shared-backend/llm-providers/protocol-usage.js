/** Adapted from api-failover-proxy (MIT): provider-neutral usage fields. */

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizeUsage(rawUsage) {
  const usage = rawUsage && typeof rawUsage === 'object' ? rawUsage : {};
  let input = positiveNumber(usage.input_tokens ?? usage.prompt_tokens);
  const output = positiveNumber(usage.output_tokens ?? usage.completion_tokens);
  const cacheRead = positiveNumber(
    usage.cache_read_input_tokens ??
      usage.prompt_cache_hit_tokens ??
      (usage.prompt_tokens_details && usage.prompt_tokens_details.cached_tokens) ??
      usage.cached_tokens
  );
  const cacheCreation = positiveNumber(
    usage.cache_creation_input_tokens ?? usage.prompt_cache_miss_tokens
  );
  if (cacheRead > input) input += cacheRead;
  return { input, output, cacheRead, cacheCreation };
}

/**
 * BLOCK-95 B3 — 从原始或已归一的 usage 形状提取 prompt cache 字段。
 * 兼容：OpenAI prompt_tokens_details.cached_tokens / DeepSeek prompt_cache_hit_tokens /
 * Anthropic cache_read_input_tokens / stream-aggregate 归一后的 cache_read_tokens。
 * 断链后果（实测）：ai_usage.cache_read_tokens 恒 0，cache 命中率无法度量。
 */
function extractCacheFields(usage) {
  const u = usage && typeof usage === 'object' ? usage : {};
  const cacheReadTokens = positiveNumber(
    u.cache_read_tokens ??
      u.cache_read_input_tokens ??
      u.prompt_cache_hit_tokens ??
      (u.prompt_tokens_details && u.prompt_tokens_details.cached_tokens) ??
      u.cached_tokens
  );
  const cacheCreationTokens = positiveNumber(
    u.cache_creation_tokens ?? u.cache_creation_input_tokens ?? u.prompt_cache_miss_tokens
  );
  return { cacheReadTokens, cacheCreationTokens };
}

module.exports = { normalizeUsage, extractCacheFields };
