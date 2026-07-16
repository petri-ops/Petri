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

module.exports = { normalizeUsage };
