/**
 * DashScope Vision Provider — 多模态看图 provider
 *
 * 走阿里云百炼 qwen-vl-max（multimodal-generation 端点），让 agent 能看 PNG。
 * agent-led 阶段2 Task4：tool_read_image 拿图 base64 → 喂本 provider → agent 解读图内容。
 *
 * apiKey 复用 DashScope embedding 同一个 key（getApiKey('dashscope')）。
 * 端点：POST dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation
 *      Header: Authorization: Bearer <key>（DashScope 用 Bearer）
 * body: { model, input: { messages: [{role, content: [{type:'text',text},{type:'image',image:'data:image/png;base64,...'}]}] } }
 *
 * 注意：qwen-vl 不走 OpenAI 兼容的 /chat/completions，是 DashScope 原生 multimodal 端点，
 * 请求/响应格式与 deepseek chat 不同，本 provider 单独适配。
 */

const https = require('https');
const logger = require('../logger');

// 断点1：ai-usage 经注入式 helper 获取，斩断对 petri-server/helpers/ai-usage 的反向 require
const aiUsageHelper = require('../ai-usage-helper');
function getRecordAiUsage() {
  return aiUsageHelper.recordAiUsage;
}

const DEFAULT_MODEL = 'qwen-vl-max';

class DashScopeVisionProvider {
  get name() {
    return 'dashscope-vision';
  }
  get capabilities() {
    return 'vision';
  }

  /**
   * 多模态对话（看图）。
   * @param {string} apiKey - DashScope API key
   * @param {object} body - { model?, messages: [{role, content: [{type:'text'|'image', text|image}]}], ... }
   * @param {object} telemetry - {userId?, conversationId?, kind?}
   * @returns {Promise<{ok, content, usage}|{error, message}>}
   */
  async chat(apiKey, body, _telemetry) {
    if (!apiKey) {
      return { error: 'no_api_key', message: 'DashScope API key 未配置' };
    }

    const _t = _telemetry || {};
    const _start = Date.now();
    const recordAiUsage = getRecordAiUsage();
    const model = (body && body.model) || DEFAULT_MODEL;

    // 适配 DashScope multimodal 格式：input.messages
    const messages = (body && body.messages) || [];
    const reqBody = JSON.stringify({
      model,
      input: { messages },
      parameters: body.parameters || {},
    });

    return new Promise((resolve) => {
      let buf = '';
      const r = https.request(
        {
          hostname: 'dashscope.aliyuncs.com',
          port: 443,
          path: '/api/v1/services/aigc/multimodal-generation/generation',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + apiKey,
            'Content-Length': Buffer.byteLength(reqBody),
          },
          agent: false,
          timeout: 120000, // vision 请求比纯文本慢，给 2min
        },
        (res) => {
          res.setEncoding('utf8');
          res.on('data', (c) => (buf += c));
          res.on('end', () => {
            const latency = Date.now() - _start;
            try {
              const parsed = JSON.parse(buf);
              if (parsed && parsed.code && parsed.message) {
                // DashScope 错误格式：{ code, message, request_id }
                logger.warn(`[dashscope-vision] API error: ${parsed.code} ${parsed.message}`);
                recordAiUsage({
                  userId: _t.userId,
                  kind: _t.kind || 'vision',
                  model,
                  latencyMs: latency,
                  errorCode: 'api_error',
                  conversationId: _t.conversationId,
                });
                return resolve({
                  error: 'api_error',
                  providerCode: parsed.code,
                  message: parsed.message,
                  status: res.statusCode,
                });
              }
              // 成功格式：{ output: { choices: [{ message: { content: [...] } }] }, usage: {...} }
              const choice =
                parsed && parsed.output && parsed.output.choices && parsed.output.choices[0];
              const contentParts = (choice && choice.message && choice.message.content) || [];
              // content 是 [{text}, {image}, ...] 数组，拼成文本
              const text = contentParts
                .map((p) => (typeof p === 'string' ? p : p.text || ''))
                .join('\n');
              const u = (parsed && parsed.usage) || {};
              recordAiUsage({
                userId: _t.userId,
                kind: _t.kind || 'vision',
                model,
                promptTokens: u.input_tokens || 0,
                completionTokens: u.output_tokens || 0,
                latencyMs: latency,
                conversationId: _t.conversationId,
              });
              resolve({
                ok: true,
                content: text,
                usage: {
                  prompt_tokens: u.input_tokens || 0,
                  completion_tokens: u.output_tokens || 0,
                },
              });
            } catch (e) {
              logger.warn(`[dashscope-vision] parse error: ${e.message} buf=${buf.slice(0, 200)}`);
              recordAiUsage({
                userId: _t.userId,
                kind: _t.kind || 'vision',
                model,
                latencyMs: latency,
                errorCode: 'parse_error',
                conversationId: _t.conversationId,
              });
              resolve({ error: 'parse_error', message: e.message, raw: buf.slice(0, 500) });
            }
          });
        }
      );
      r.on('error', (e) => {
        recordAiUsage({
          userId: _t.userId,
          kind: _t.kind || 'vision',
          model,
          latencyMs: Date.now() - _start,
          errorCode: 'network_error',
          conversationId: _t.conversationId,
        });
        resolve({ error: 'network_error', message: e.message });
      });
      r.on('timeout', () => {
        try {
          r.destroy();
        } catch {}
        resolve({ error: 'timeout', message: 'vision 请求超时（>120s）' });
      });
      r.write(reqBody);
      r.end();
    });
  }
}

module.exports = { DashScopeVisionProvider };
