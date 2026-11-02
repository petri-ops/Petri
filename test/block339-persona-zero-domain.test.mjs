/**
 * BLOCK-339 P3 — 人设零域词契约（防 215 式漏网回潮）。
 *
 * 215 的词表只收「工具名词」（DESeq2/Seurat…），漏了「角色名词」（助手/伙伴/生物信息学）——
 * 用户体感是「AI 还是生信工程师」。本测把三条**旁路**一起锁死：
 *   ① 主 system prompt（baseRole + principles）
 *   ② 推理身份块（runtimeIdentity 注入的透明披露段）
 *   ③ 闲聊快路径 CHITCHAT_SYSTEM_PROMPT（高置信直答，绕过主 prompt）
 * 既断言「零角色域词」，也断言「正面人设在场」——防「清干净了但没人设」这种反向事故。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { buildSystemPrompt } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js'));
const { CHITCHAT_SYSTEM_PROMPT } = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'chitchat-fast-path.js'));

/** 角色名词表（工具名词表在 scripts/model-surface-baseline.mjs 的 RETIRED_TERMS）。 */
const ROLE_TERMS = ['生物信息', '生信', '科研伙伴', 'bioinformatic', 'research partner'];

function domainHits(text) {
  const lower = String(text || '').toLowerCase();
  return ROLE_TERMS.filter((term) => lower.includes(term.toLowerCase()));
}

test('BLOCK-339 主 system prompt 零角色域词（含 baseRole + principles）', () => {
  const prompt = buildSystemPrompt(null);
  assert.ok(prompt.length > 500, '主 prompt 非空（防扫描器空转）');
  assert.deepEqual(domainHits(prompt), [], `主 prompt 仍含角色域词：${domainHits(prompt).join(', ')}`);
});

test('BLOCK-339 推理身份块零角色域词（透明披露段不得把身份写成领域助手）', () => {
  const prompt = buildSystemPrompt(null, { provider: 'deepseek', model: 'deepseek-chat', providerLabel: 'DeepSeek' });
  assert.ok(prompt.includes('当前推理身份'), '身份块应在场（否则本断言假绿）');
  assert.deepEqual(domainHits(prompt), [], `身份块仍含角色域词：${domainHits(prompt).join(', ')}`);
});

test('BLOCK-339 闲聊快路径零角色域词（高置信直答是用户体感主因）', () => {
  assert.ok(CHITCHAT_SYSTEM_PROMPT.length > 20);
  assert.deepEqual(domainHits(CHITCHAT_SYSTEM_PROMPT), [],
    `chitchat prompt 仍含角色域词：${domainHits(CHITCHAT_SYSTEM_PROMPT).join(', ')}`);
});

test('BLOCK-339 正面人设在场：主 prompt 与 chitchat 都自报「格物（Petri）· 通用 agent」', () => {
  const prompt = buildSystemPrompt(null);
  for (const text of [prompt, CHITCHAT_SYSTEM_PROMPT]) {
    assert.ok(text.includes('格物（Petri）'), '应自报产品身份');
    assert.ok(text.includes('通用 agent'), '应自报通用 agent 定位（不是领域助手）');
  }
});
