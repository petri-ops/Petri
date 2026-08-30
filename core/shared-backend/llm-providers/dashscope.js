/**
 * DashScope Embedding Provider — 向量化 provider
 *
 * 从 biof3-server/helpers/memory-vectors.js 的 dashscopeEmbed 抽取，
 * 实现 LLMProvider 接口。apiKey 从参数传入（不再从 process.env 硬读）。
 *
 * 桌面版用户在设置页填 DashScope API key（阿里云百炼平台获取）。
 */

const https = require('https');
const logger = require('../logger');

const EMBEDDING_DIM = 1024;
const EMBEDDING_MODEL = 'text-embedding-v3';
const MAX_CONTENT_LEN = 1500;

// 断点1：ai-usage 经注入式 helper 获取，斩断对 biof3-server/helpers/ai-usage 的反向 require
const aiUsageHelper = require('../ai-usage-helper');
function getRecordAiUsage() {
  return aiUsageHelper.recordAiUsage;
}

class DashScopeEmbedProvider {
  get name() {
    return 'dashscope';
  }
  get capabilities() {
    return 'embedding';
  }

  /**
   * 文本向量化。
   * @param {string} apiKey - DashScope API key
   * @param {string[]} texts - 待向量化的文本数组
   * @param {object} telemetry - {userId?, conversationId?, kind?}
   * @returns {Promise<Float32Array[] | null>} - 向量数组，失败返回 null
   */
  async embed(apiKey, texts, _telemetry, options) {
    if (!apiKey) {
      logger.warn('[dashscope] API key 未配置，embedding 跳过');
      return { error: 'no_api_key', message: 'DashScope API key 未配置' };
    }
    if (!Array.isArray(texts) || texts.length === 0) return [];

    const _t = _telemetry || {};
    const _start = Date.now();
    const recordAiUsage = getRecordAiUsage();

    const truncated = texts.map((t) => (t || '').slice(0, MAX_CONTENT_LEN));
    const _approxTokens = truncated.reduce((s, t) => s + Math.ceil((t || '').length * 0.7), 0);
    const model = (options && options.model) || EMBEDDING_MODEL;
    const body = JSON.stringify({
      model,
      input: { texts: truncated },
      ...((options && options.parameters) || {}),
    });

    return new Promise((resolve) => {
      let buf = '';
      const r = https.request(
        {
          hostname: 'dashscope.aliyuncs.com',
          port: 443,
          path: '/api/v1/services/embeddings/text-embedding/text-embedding',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
            'Content-Length': Buffer.byteLength(body),
          },
          agent: false,
          timeout: 30000,
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            try {
              if (res.statusCode !== 200) {
                logger.warn(`[dashscope] HTTP ${res.statusCode}: ${buf.slice(0, 200)}`);
                recordAiUsage({
                  userId: _t.userId,
                  kind: _t.kind || 'embedding',
                  model,
                  promptTokens: _approxTokens,
                  latencyMs: Date.now() - _start,
                  errorCode: 'http_' + res.statusCode,
                  conversationId: _t.conversationId,
                });
                resolve({ error: 'http_error', message: `HTTP ${res.statusCode}`, status: res.statusCode });
                return;
              }
              const j = JSON.parse(buf);
              const arr = j?.output?.embeddings;
              if (!Array.isArray(arr)) {
                resolve({ error: 'api_error', message: 'Embedding 响应缺少向量数据' });
                return;
              }
              arr.sort((a, b) => (a.text_index || 0) - (b.text_index || 0));
              const out = arr.map((e) => Float32Array.from(e.embedding));
              recordAiUsage({
                userId: _t.userId,
                kind: _t.kind || 'embedding',
                model,
                promptTokens: _approxTokens,
                latencyMs: Date.now() - _start,
                conversationId: _t.conversationId,
              });
              resolve(out);
            } catch (e) {
              logger.warn(`[dashscope] parse err: ${e.message}`);
              resolve({ error: 'parse_error', message: e.message });
            }
          });
          res.on('error', (e) => resolve({ error: 'res_error', message: e.message }));
        }
      );
      r.on('error', (e) => {
        logger.warn(`[dashscope] req err: ${e.message}`);
        resolve({ error: 'req_error', message: e.message });
      });
      r.on('timeout', () => {
        try {
          r.destroy();
        } catch {}
        resolve({ error: 'timeout', message: 'Embedding 请求超时' });
      });
      r.write(body);
      r.end();
    });
  }

  /**
   * 健康检查（简单调一次 embedding 测试）。
   */
  async healthCheck(apiKey) {
    if (!apiKey) return false;
    const result = await this.embed(apiKey, ['test'], {});
    return result !== null && Array.isArray(result) && result.length > 0;
  }
}

module.exports = { DashScopeEmbedProvider, EMBEDDING_DIM, EMBEDDING_MODEL };
