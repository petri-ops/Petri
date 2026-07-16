/**
 * Model Gateway — the single provider dispatch boundary.
 *
 * Callers choose a task role (or an explicit profile id). The gateway resolves
 * the ModelProfile, validates capabilities, obtains the referenced credential,
 * and invokes one registered transport adapter. It never owns conversation,
 * tool-job, or artifact state.
 */

const { normalizeModelConfig, resolveModelProfile } = require('./model-profile');

function gatewayError(error, message, details) {
  return { error, message, ...(details || {}) };
}

class ModelGateway {
  constructor({ getSettings, getCredential, getProvider }) {
    if (typeof getSettings !== 'function') throw new Error('ModelGateway requires getSettings');
    if (typeof getCredential !== 'function') throw new Error('ModelGateway requires getCredential');
    if (typeof getProvider !== 'function') throw new Error('ModelGateway requires getProvider');
    this._getSettings = getSettings;
    this._getCredential = getCredential;
    this._getProvider = getProvider;
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

  async chat({ role = 'chat', profileId, body, telemetry, onEvent, signal, apiKeyOverride } = {}) {
    const prepared = this._prepare(role, profileId, apiKeyOverride);
    if (prepared.error) return prepared;
    const { profile, provider, apiKey } = prepared;
    if (typeof provider.chat !== 'function') {
      return gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 chat`, {
        profileId: profile.id,
      });
    }
    const requestBody = {
      ...(profile.parameters || {}),
      ...(body || {}),
      model: profile.model,
    };
    const options = { baseUrl: profile.baseUrl, signal, profile };
    if (typeof onEvent === 'function' && typeof provider.chatStream === 'function') {
      return provider.chatStream(apiKey, requestBody, telemetry || {}, onEvent, options);
    }
    const result = await provider.chat(apiKey, requestBody, telemetry || {}, options);
    if (typeof onEvent === 'function' && result && !result.error) {
      const content = result.choices && result.choices[0] && result.choices[0].message
        ? result.choices[0].message.content || ''
        : '';
      if (content) onEvent({ type: 'content_delta', content });
      onEvent({ type: 'done', usage: result.usage });
    }
    return result;
  }

  async vision({ profileId, body, telemetry, apiKeyOverride } = {}) {
    const prepared = this._prepare('vision', profileId, apiKeyOverride);
    if (prepared.error) return prepared;
    const { profile, provider, apiKey } = prepared;
    if (typeof provider.chat !== 'function') {
      return gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 vision`, {
        profileId: profile.id,
      });
    }
    return provider.chat(
      apiKey,
      { ...(body || {}), model: profile.model },
      telemetry || {},
      { baseUrl: profile.baseUrl, profile }
    );
  }

  async embed({ profileId, texts, telemetry, apiKeyOverride } = {}) {
    const prepared = this._prepare('embedding', profileId, apiKeyOverride);
    if (prepared.error) return prepared;
    const { profile, provider, apiKey } = prepared;
    if (typeof provider.embed !== 'function') {
      return gatewayError('provider_method_missing', `Provider ${profile.provider} 不支持 embedding`, {
        profileId: profile.id,
      });
    }
    return provider.embed(apiKey, texts, telemetry || {}, {
      baseUrl: profile.baseUrl,
      model: profile.model,
      parameters: profile.parameters,
      profile,
    });
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

module.exports = { ModelGateway, gatewayError };
