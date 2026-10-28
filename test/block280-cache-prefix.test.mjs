import test from 'node:test';
import assert from 'node:assert/strict';
import { openAIToAnthropicRequest } from '../core/shared-backend/llm-providers/protocol-conversion.js';
import { TOOL_DEFS } from '../core/petri-server/agent-tools/tool-defs.js';
import { buildSystemPromptParts } from '../core/petri-server/helpers/system-prompt.js';

// BLOCK-280 — C-34 复核证伪 + 缓存健壮性加固（HK-01：加固部分红绿先行）。
//
// C-34 判词「静态前缀仅 215 tokens ⇒ cache_control 失效」复核结论：**前提不成立**。
// Anthropic 缓存断点覆盖的是**累计前缀**（tools → system → messages），而本仓
// Anthropic 请求恒带 92 个工具定义（≈21k tokens）——system[0] 断点的缓存条目实际
// 覆盖 tools+system ≈ 22k tokens，远超最小可缓存（1024；Haiku 3.5=2048）。
// 本文件把它量化钉住（锚），并加固一处真实缺口：tools 数组自身没有断点，
// system 文本一旦因版本/身份变化，tools 段的缓存也一并失效——给**最后一个工具**
// 补 ephemeral 断点（两段式：tools 段独立可复用）。

/** 保守 token 估算：CJK≈1.2 token/字，其余≈0.25 token/字符（Anthropic 中文分词 1~2 char/token）。 */
function estimateTokens(text) {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  return Math.ceil(cjk * 1.2 + (text.length - cjk) / 4);
}

test('BLOCK-280 锚 — 累计可缓存前缀（工具定义 + 静态 system 前缀）≥ 2048 tokens', () => {
  const toolsJson = JSON.stringify(TOOL_DEFS);
  const { staticPrefix } = buildSystemPromptParts({}, {});
  const cumulative = estimateTokens(toolsJson) + estimateTokens(staticPrefix);
  // 证据留痕：工具面 ≈21k + system 前缀 ≈0.6k，累计远超最小可缓存。
  assert.ok(cumulative >= 2048, `累计可缓存前缀估算 ${cumulative} tokens，低于 Haiku 3.5 最小值 2048——缓存前提被破坏`);
});

test('BLOCK-280 红绿 — tools 数组最后一个工具带 ephemeral 断点（加固前红）', () => {
  const body = {
    model: 'claude-test',
    messages: [{ role: 'user', content: 'hi' }],
    system: '静态前缀',
    tools: [
      { type: 'function', function: { name: 'tool_a', description: 'A', parameters: { type: 'object' } } },
      { type: 'function', function: { name: 'tool_b', description: 'B', parameters: { type: 'object' } } },
    ],
  };
  const req = openAIToAnthropicRequest(body);
  assert.ok(Array.isArray(req.tools) && req.tools.length === 2);
  assert.deepEqual(
    req.tools[req.tools.length - 1].cache_control,
    { type: 'ephemeral' },
    '最后一个工具应带 ephemeral 断点（tools 段独立缓存条目）',
  );
  assert.equal(req.tools[0].cache_control, undefined, '只有最后一个工具带断点（省断点配额）');
});

test('BLOCK-280 — 无 tools 时行为不变（system 断点照旧）', () => {
  const req = openAIToAnthropicRequest({
    model: 'claude-test',
    messages: [
      { role: 'system', content: '只此一段' },
      { role: 'user', content: 'hi' },
    ],
  });
  assert.deepEqual(req.system, [{ type: 'text', text: '只此一段', cache_control: { type: 'ephemeral' } }]);
  assert.equal(req.tools, undefined);
});
