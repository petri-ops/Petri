/**
 * Model Gateway — the single provider dispatch boundary.
 *
 * Callers choose a task role (or an explicit profile id). The gateway resolves
 * the ModelProfile, validates capabilities, obtains the referenced credential,
 * and invokes one registered transport adapter. It never owns conversation,
 * tool-job, or artifact state.
 */

const { normalizeModelConfig, resolveModelProfile } = require('./model-profile');
// BLOCK-81 P1 — 思考档位：中性档位→上游参数的单一映射点 + 去参重试判据
const { thinkingParamsFor, isUnknownParameterError } = require('./thinking-level');

function gatewayError(error, message, details) {
  return { error, message, ...(details || {}) };
}

const RETRYABLE_ERROR_CODES = new Set([
  'network_error',
  'req_error',
  'res_error',
  'timeout',
  'parse_error',
  'http_error',
  'api_error',
]);

function errorCode(result) {
  if (!result || !result.error) return '';
  if (typeof result.error === 'string') return result.error;
  return String(result.error.code || result.error.type || 'api_error');
}

/**
 * BLOCK-150 加映（用户裁决「不想用 Qwen VL Max 渠道，设置上可选择」）—
 * vision 角色可绑 openai 系通道（deepseek/openai-compatible/ollama/lmstudio/vllm）。
 * vision 调用体是 dashscope 原生图片部件（{type:'image', image:<url>}）；这些通道
 * 的 chat 原样 JSON.stringify 透传（OpenAI 规范为 image_url）——此处统一转换，
 * 让「换绑识图模型」真正可用。dashscope-vision / anthropic 不在白名单，原生直传。
 */
const OPENAI_FAMILY_PROVIDERS = new Set(['deepseek', 'openai', 'openai-compatible', 'ollama', 'lmstudio', 'vllm']);

/**
 * BLOCK-150 加映三 — openai 系 vision 响应归一化：DeepSeek 系 chat() 返回原始
 * API 信封（choices[0].message），而 vision 消费方（agent-tools/vision-tools.js）
 * 读 result.content——字段错位曾致「消耗 token 却空描述」。content 空时回退
 * reasoning_content（推理型模型把答案写进推理字段的形态）。dashscope-vision
 * provider 本就返回归一化形态，不在白名单不动。
 */
function normalizeVisionResultForProvider(result, providerName) {
  if (!OPENAI_FAMILY_PROVIDERS.has(providerName) || !result || result.error || !Array.isArray(result.choices)) {
    return result;
  }
  const message = (result.choices[0] && result.choices[0].message) || {};
  const content = typeof message.content === 'string' && message.content.trim()
    ? message.content
    : (typeof message.reasoning_content === 'string' ? message.reasoning_content : '');
  return { ...result, content };
}

function convertVisionBodyForProvider(body, providerName) {
  if (!OPENAI_FAMILY_PROVIDERS.has(providerName) || !body || !Array.isArray(body.messages)) return body;
  let converted = false;
  const messages = body.messages.map((message) => {
    if (!message || !Array.isArray(message.content)) return message;
    const parts = message.content;
    const hasNativeImage = parts.some((p) => p && p.type === 'image');
    const hasImageUrl = parts.some((p) => p && p.type === 'image_url');
    if (!hasNativeImage || hasImageUrl) return message;
    converted = true;
    return {
      ...message,
      content: parts.map((p) => (p && p.type === 'image'
        ? { type: 'image_url', image_url: { url: p.image || p.url || '' } }
        : p)),
    };
  });
  return converted ? { ...body, messages } : body;
}

function isRetryableProviderError(result) {
  const code = errorCode(result);
  if (!code || code === 'aborted' || code === 'no_api_key' || code === 'serialize_error') return false;
  const status = Number(result && (result.status || result.statusCode));
  if (Number.isFinite(status)) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }
  return RETRYABLE_ERROR_CODES.has(code);
}

function routingReason(result) {
  const status = Number(result && (result.status || result.statusCode));
  return {
    code: errorCode(result) || 'provider_failure',
    ...(Number.isFinite(status) ? { status } : {}),
  };
}

// BLOCK-37 — 单条 transcript 保留的 delta 帧样本上限（超限诚实计数，聚合响应不受影响）
const MAX_TRANSCRIPT_FRAMES = 2000;

class ModelGateway {
  constructor({ getSettings, getCredential, getProvider, recordRouting, recordTranscript }) {
    if (typeof getSettings !== 'function') throw new Error('ModelGateway requires getSettings');
    if (typeof getCredential !== 'function') throw new Error('ModelGateway requires getCredential');
    if (typeof getProvider !== 'function') throw new Error('ModelGateway requires getProvider');
    this._getSettings = getSettings;
    this._getCredential = getCredential;
    this._getProvider = getProvider;
    this._recordRouting = typeof recordRouting === 'function' ? recordRouting : () => {};
    // BLOCK-37 — 模型 I/O 信息流落盘（fire-and-forget，绝不影响调用主链路）
    this._recordTranscript = typeof recordTranscript === 'function' ? recordTranscript : null;
  }

  /** BLOCK-37 — 一次 provider 交互的 transcript 组装与提交（含 fallback 的每次 attempt 独立记录）。 */
  _emitTranscript({
    role, attemptIndex, profile, requestBody, telemetry, result, frames, framesCount, framesTruncated, durationMs,
  }) {
    if (!this._recordTranscript) return;
    try {
      this._recordTranscript({
        telemetry: telemetry || {},
        requestBody: requestBody || {},
        result,
        frames,
        framesCount,
        framesTruncated,
        provider: profile.provider,
        profileId: profile.id,
        role,
        attemptIndex,
        model: requestBody && requestBody.model,
        durationMs,
      });
    } catch {
      // transcript 永不影响调用主链路
    }
  }

  getConfig() {
    return normalizeModelConfig(this._getSettings() || {});
  }

  resolve(role, profileId) {
    return resolveModelProfile(this.getConfig(), role, profileId);
  }

  _prepare(role, profileId, apiKeyOverride) {
    const resolved = this.resolve(role, profileId);
    if (resolved.error) return resolved;
    const profile = resolved.profile;
    const provider = this._getProvider(profile.provider);
    if (!provider) {
      return gatewayError(
        'provider_not_registered',
        `模型 Provider 未注册: ${profile.provider}`,
        { profileId: profile.id, provider: profile.provider }
      );
    }
    const apiKey = apiKeyOverride || this._getCredential(profile.credentialRef, profile) || '';
    return { profile, provider, apiKey };
  }

  _fallbackProfileIds(role, primaryId) {
    const config = this.getConfig();
    if (!config.fallbackEnabled) return [];
    const candidates = config.fallbackBindings[role] || [];
    return candidates.filter((id) => id !== primaryId);
  }

  _withRouting(result, role, profileId, fallbackFrom, reason) {
    if (!result || typeof result !== 'object') return result;
    return {
      ...result,
      modelRouting: {
        role,
        profileId,
        ...(fallbackFrom ? { fallbackFrom, fallbackReason: reason } : {}),
      },
    };
  }

  _recordFallback(role, fromProfileId, toProfileId, reason) {
    const event = { role, fromProfileId, toProfileId, reason };
    try {
      this._recordRouting({ type: 'model_fallback', ...event });
    } catch {}
    return event;
  }

  async chat({ role = 'chat', profileId, modelOverride, body, telemetry, onEvent, signal, apiKeyOverride, fallbackWhen, disableFallback, thinkingLevel, __dropThinking = false } = {}) {
    const primary = this._prepare(role, profileId, apiKeyOverride);
    if (primary.error) return primary;
    // BLOCK-56 P1 — 任务级降级续跑的任务传 disableFallback: true：
    // 降级任务已是「单级降级」的最后一搏，请求级 fallback 必须关闭，防止 A→B→C 连环。
    const attempts = disableFallback
      ? [primary.profile.id]
      : [primary.profile.id, ...this._fallbackProfileIds(role, primary.profile.id)];
    let lastResult;
    let previousProfileId;
    let previousReason;
    for (let index = 0; index < attempts.length; index += 1) {
      const prepared = index === 0 ? primary : this._prepare(role, attempts[index]);
      if (prepared.error) {
        lastResult = prepared;
        continue;
      }
      const { profile, provider, apiKey } = prepared;
      // BLOCK-79 P1 — 供应商归因注入：遥测携带「本次实际 attempt」的 provider，
      // 经 provider 层 usageArgs 落 ai_usage.provider（fallback 换档即换归因）。
      if (telemetry && typeof telemetry === 'object' && !telemetry.provider) {
        telemetry.provider = profile.provider;
      }
      const canStream = typeof onEvent === 'function' && typeof provider.chatStream === 'function';
      if (typeof provider.chat !== 'function' && !canStream) {
        lastResult = gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 chat`, {
          profileId: profile.id,
        });
        continue;
      }
      if (index > 0 && typeof onEvent === 'function') {
        const fallback = this._recordFallback(role, previousProfileId, profile.id, previousReason);
        onEvent({
          type: 'model_fallback',
          ...fallback,
        });
      } else if (index > 0) {
        this._recordFallback(role, previousProfileId, profile.id, previousReason);
      }
      // BLOCK-81 P1 / D3 双保险①：仅当 profile 声明 capabilities.reasoning 且档位
      // 非 standard 时才发思考参数（thinkingParamsFor 内部门控）→ 未启用渠道零行为变化。
      // __dropThinking：去参重试时置真，跳过注入。
      const thinkingParams = __dropThinking
        ? {}
        : thinkingParamsFor({
          level: thinkingLevel,
          protocol: profile.protocol,
          capabilities: profile.capabilities,
        });
      const requestBody = {
        ...(profile.parameters || {}),
        ...thinkingParams,
        ...(body || {}),
        model: index === 0 && modelOverride ? modelOverride : profile.model,
      };
      const options = { baseUrl: profile.baseUrl, signal, profile };
      let emittedOutput = false;
      let result;
      // BLOCK-37 — 流式分支 tee delta 帧（上限内保留样本，超限诚实计数）
      const transcriptFrames = [];
      let framesOverflow = 0;
      const startedAt = Date.now();
      if (canStream) {
        result = await provider.chatStream(apiKey, requestBody, telemetry || {}, (event) => {
          if (event && (event.type === 'content_delta' || event.type === 'tool_call_delta')) emittedOutput = true;
          // Hold a failed attempt's terminal error until the gateway decides
          // whether it will switch. Output and successful events remain live.
          if (!event || event.type !== 'error') {
            if (event && transcriptFrames.length < MAX_TRANSCRIPT_FRAMES) transcriptFrames.push(event);
            else if (event) framesOverflow += 1;
            onEvent(event);
          }
        }, options);
      } else {
        result = await provider.chat(apiKey, requestBody, telemetry || {}, options);
      }
      this._emitTranscript({
        role,
        attemptIndex: index,
        profile,
        requestBody,
        telemetry,
        result,
        frames: transcriptFrames.length > 0 ? transcriptFrames : undefined,
        framesCount: transcriptFrames.length + framesOverflow,
        framesTruncated: framesOverflow > 0,
        durationMs: Date.now() - startedAt,
      });
      // BLOCK-81 P1 / D3 双保险②：上游 400 且文案是「未知/非法参数」且本轮确实
      // 注入了思考参数 → **去参重试一次**（同 profile、禁用 fallback，优先于换档 fallback）。
      // 覆盖面：网关不认 reasoning_effort / thinking / enable_thinking 的严格实现。
      const status400 = Number(result && (result.status || result.statusCode)) === 400;
      if (
        !emittedOutput
        && Object.keys(thinkingParams).length > 0
        && status400
        && isUnknownParameterError(result && (result.message || result.error))
      ) {
        const stripped = await this.chat({
          role,
          profileId: profile.id,
          modelOverride,
          body,
          telemetry,
          onEvent,
          signal,
          apiKeyOverride,
          fallbackWhen,
          disableFallback: true,
          __dropThinking: true,
        });
        return this._withRouting(stripped, role, profile.id, index > 0 ? previousProfileId : undefined, previousReason);
      }
      let resultFallbackReason = null;
      if (!emittedOutput && typeof fallbackWhen === 'function') {
        try {
          resultFallbackReason = fallbackWhen(result) || null;
        } catch {}
      }
      const canFallback = !emittedOutput && (
        isRetryableProviderError(result) || resultFallbackReason
      ) && index < attempts.length - 1;
      if (canFallback) {
        previousProfileId = profile.id;
        previousReason = resultFallbackReason || routingReason(result);
        lastResult = result;
        continue;
      }
      if (typeof onEvent === 'function' && result && result.error) {
        onEvent({ type: 'error', error: errorCode(result), message: result.message });
      } else if (typeof onEvent === 'function' && result && !result.error && typeof provider.chatStream !== 'function') {
        const content = result.choices && result.choices[0] && result.choices[0].message
          ? result.choices[0].message.content || ''
          : '';
        if (content) onEvent({ type: 'content_delta', content });
        onEvent({ type: 'done', usage: result.usage });
      }
      return this._withRouting(result, role, profile.id, index > 0 ? previousProfileId : undefined, previousReason);
    }
    return lastResult;
  }

  async vision({ profileId, body, telemetry, apiKeyOverride, onEvent } = {}) {
    const primary = this._prepare('vision', profileId, apiKeyOverride);
    if (primary.error) return primary;
    const attempts = [primary.profile.id, ...this._fallbackProfileIds('vision', primary.profile.id)];
    let previousProfileId;
    let previousReason;
    let lastResult;
    for (let index = 0; index < attempts.length; index += 1) {
      const prepared = index === 0 ? primary : this._prepare('vision', attempts[index]);
      if (prepared.error) {
        lastResult = prepared;
        continue;
      }
      const { profile, provider, apiKey } = prepared;
      if (typeof provider.chat !== 'function') {
        lastResult = gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 vision`, {
          profileId: profile.id,
        });
        continue;
      }
      if (index > 0) {
        const fallback = this._recordFallback('vision', previousProfileId, profile.id, previousReason);
        if (typeof onEvent === 'function') onEvent({ type: 'model_fallback', ...fallback });
      }
      const visionBody = convertVisionBodyForProvider({ ...(body || {}), model: profile.model }, profile.provider);
      const startedAt = Date.now();
      const result = await provider.chat(
        apiKey,
        visionBody,
        telemetry || {},
        { baseUrl: profile.baseUrl, profile }
      );
      this._emitTranscript({
        role: 'vision',
        attemptIndex: index,
        profile,
        requestBody: visionBody,
        telemetry,
        result,
        durationMs: Date.now() - startedAt,
      });
      if (isRetryableProviderError(result) && index < attempts.length - 1) {
        previousProfileId = profile.id;
        previousReason = routingReason(result);
        lastResult = result;
        continue;
      }
      return this._withRouting(normalizeVisionResultForProvider(result, profile.provider), 'vision', profile.id, index > 0 ? previousProfileId : undefined, previousReason);
    }
    return lastResult;
  }

  async embed({ profileId, texts, telemetry, apiKeyOverride, onEvent } = {}) {
    const primary = this._prepare('embedding', profileId, apiKeyOverride);
    if (primary.error) return primary;
    const attempts = [primary.profile.id, ...this._fallbackProfileIds('embedding', primary.profile.id)];
    let previousProfileId;
    let previousReason;
    let lastResult;
    for (let index = 0; index < attempts.length; index += 1) {
      const prepared = index === 0 ? primary : this._prepare('embedding', attempts[index]);
      if (prepared.error) {
        lastResult = prepared;
        continue;
      }
      const { profile, provider, apiKey } = prepared;
      if (typeof provider.embed !== 'function') {
        lastResult = gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 embedding`, {
          profileId: profile.id,
        });
        continue;
      }
      if (index > 0) {
        const fallback = this._recordFallback('embedding', previousProfileId, profile.id, previousReason);
        if (typeof onEvent === 'function') onEvent({ type: 'model_fallback', ...fallback });
      }
      const result = await provider.embed(apiKey, texts, telemetry || {}, {
        baseUrl: profile.baseUrl,
        model: profile.model,
        parameters: profile.parameters,
        profile,
      });
      if (isRetryableProviderError(result) && index < attempts.length - 1) {
        previousProfileId = profile.id;
        previousReason = routingReason(result);
        lastResult = result;
        continue;
      }
      return result && result.error ? null : result;
    }
    return lastResult && lastResult.error ? null : lastResult;
  }

  async healthCheck(profileId, apiKeyOverride) {
    const config = this.getConfig();
    const profile = config.profiles.find((candidate) => candidate.id === profileId);
    if (!profile) return gatewayError('model_profile_not_found', `模型配置不存在: ${profileId}`);
    const provider = this._getProvider(profile.provider);
    if (!provider) return gatewayError('provider_not_registered', `模型 Provider 未注册: ${profile.provider}`);
    if (typeof provider.healthCheck !== 'function') {
      return gatewayError('health_check_unsupported', `Provider ${profile.provider} 不支持连通性测试`);
    }
    const apiKey = apiKeyOverride || this._getCredential(profile.credentialRef, profile) || '';
    const ok = await provider.healthCheck(apiKey, { baseUrl: profile.baseUrl, model: profile.model, profile });
    return { ok: !!ok, profileId: profile.id, provider: profile.provider, model: profile.model };
  }
}

module.exports = { ModelGateway, gatewayError, isRetryableProviderError };
