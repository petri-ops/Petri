#!/usr/bin/env node
/**
 * UI-523 验收用最小 OpenAI 兼容 mock provider（仅本地回环，零外网、零真实 key）。
 *
 * 用途：composer 运行计量条的实机腿需要一条真实模型调用才能点亮 tok/s 与会话累计；
 * 本机无 Provider 凭据时（G0 开发期常态），用本地 mock 证明代码链，证据必须标注
 * `provider=mock`，不得表述为「真实 Provider 已验」。
 *
 * 口径固定：prompt_tokens=1200 / completion_tokens=80 / prompt_cache_hit_tokens=1000
 * （⇒ 缓存命中率 83.3%），断言端据此对账。
 *
 * 用法：UI523_MOCK_PORT=39001 node scripts/ui523-mock-provider.mjs
 */
import { createServer } from 'node:http';

const MOCK_USAGE = { prompt_tokens: 1200, completion_tokens: 80, prompt_cache_hit_tokens: 1000 };

function createMockProviderServer() {
  return createServer((req, res) => {
    const url = String(req.url || '');
    if (req.method === 'GET' && /\/models$/.test(url)) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-chat', object: 'model' }] }));
      return;
    }
    if (req.method === 'POST' && /\/chat\/completions$/.test(url)) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (!/"stream"\s*:\s*true/.test(body)) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({
            id: 'mock-1',
            object: 'chat.completion',
            choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
            usage: MOCK_USAGE,
          }));
          return;
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const sse = (payload) => res.write(`data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`);
        sse({ id: 'mock-1', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] });
        setTimeout(() => {
          sse({ id: 'mock-1', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: MOCK_USAGE });
          sse('[DONE]');
          res.end();
        }, 120);
      });
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not_found' }));
  });
}

const port = Number(process.env.UI523_MOCK_PORT || 39001);
createMockProviderServer().listen(port, '127.0.0.1', () => {
  console.log(`ui523 mock provider on http://127.0.0.1:${port}`);
});
