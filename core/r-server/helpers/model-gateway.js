/**
 * R-server configured Model Gateway.
 *
 * The shared gateway owns dispatch. This host adapter supplies local settings,
 * credential resolution, and the built-in provider registry.
 */

const providers = require('../../shared-backend/llm-providers');
const logger = require('../../shared-backend/logger');
const aiSettings = require('./ai-settings');

function getCredential(credentialRef, profile) {
  const ref = String(credentialRef || '');
  if (ref.startsWith('provider:')) return aiSettings.getApiKey(ref.slice('provider:'.length));
  return aiSettings.getApiKey((profile && profile.provider) || ref);
}

const modelGateway = new providers.ModelGateway({
  getSettings: aiSettings.getAiSettings,
  getCredential,
  getProvider: providers.getProvider,
  recordRouting(event) {
    logger.warn('[model-gateway] explicit fallback', event);
  },
});

module.exports = { modelGateway, getCredential };
