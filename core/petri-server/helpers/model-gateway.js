/**
 * R-server configured Model Gateway.
 *
 * The shared gateway owns dispatch. This host adapter supplies local settings,
 * credential resolution, and the built-in provider registry.
 */

const providers = require('../../shared-backend/llm-providers');
const logger = require('../../shared-backend/logger');
const { createIoTranscriptSink } = require('../../shared-backend/llm-providers/io-transcript');
const aiSettings = require('./ai-settings');

function getCredential(credentialRef, profile) {
  const ref = String(credentialRef || '');
  const separator = ref.indexOf(':');
  if (separator >= 0 && ref.slice(separator + 1)) return aiSettings.getApiKey(ref.slice(separator + 1));
  return aiSettings.getApiKey((profile && profile.provider) || ref);
}

// BLOCK-37 — 模型 I/O 信息流落盘：<PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl
const localDataRoot = process.env.PETRI_LOCAL_DATA_DIR
  || require('path').join(require('os').homedir(), 'Documents', 'Petri-Local');
const ioTranscriptSink = createIoTranscriptSink({ dataDir: localDataRoot });

function recordTranscript(entry) {
  // fire-and-forget：sink 内部吞错，这里再兜一层
  try {
    ioTranscriptSink.record(entry);
  } catch (err) {
    logger.warn('[model-gateway] llm transcript record failed', { error: String(err && err.message) });
  }
}

const modelGateway = new providers.ModelGateway({
  getSettings: aiSettings.getAiSettings,
  getCredential,
  getProvider: providers.getProvider,
  recordRouting(event) {
    logger.warn('[model-gateway] explicit fallback', event);
  },
  recordTranscript,
});

module.exports = { modelGateway, getCredential };
