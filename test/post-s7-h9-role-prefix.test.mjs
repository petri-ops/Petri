/**
 * B-03 回归钉：角色专职约束必须属于静态前缀（首条 system），不得落进动态尾块。
 *
 * 背景（2026-11-10 实测）：assembleMessages 把 dynamicContext 放末尾 system，
 * 而 trimMessagesToBudget 只保护 fullMessages[0]；角色块若拼在 systemPrompt 尾部
 * 会被 slice 进 dynamicContext → 上下文裁剪时整条丢掉 → 子 agent 实发 system 无角色指令。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { assembleMessages } = require(path.join(ROOT, 'core/petri-server/helpers/prompt-assembly.js'));
const { trimMessagesToBudget } = require(path.join(ROOT, 'core/petri-server/helpers/message-trimmer.js'));

const ROLE_BLOCK = '\n\n=== 子智能体角色专职约束 ===\n【角色：检索】优先使用只读检索工具。';

test('静态前缀携带角色块：裁剪后仍保留（修复形态）', () => {
  const messages = assembleMessages({
    staticPrefix: '你是格物（Petri）——跑在用户机器上的通用 agent' + ROLE_BLOCK,
    dynamicContext: '页面上下文：项目工作区',
    messages: [{ role: 'user', content: '检索相关代码' }],
  });
  assert.ok(messages[0].content.includes('【角色：检索】'));
  assert.ok(messages.at(-1).content.includes('页面上下文'));

  // 极小预算强制裁剪：首条 system 必须原样保留
  const trimmed = trimMessagesToBudget({
    fullMessages: messages,
    contextWindow: 120,
    headroom: 100,
    systemPromptTokens: 20,
  });
  assert.ok(trimmed.messages[0].content.includes('【角色：检索】'), '角色块被裁剪器挤掉了');
});

test('负测：角色块放在动态尾块时会被裁掉（旧缺陷形态，必须能被本测试识别）', () => {
  const messages = assembleMessages({
    staticPrefix: '你是格物（Petri）——跑在用户机器上的通用 agent',
    dynamicContext: ROLE_BLOCK + '\n页面上下文：项目工作区',
    messages: [{ role: 'user', content: '检索相关代码' }],
  });
  assert.equal(messages[0].content.includes('【角色：检索】'), false);
  assert.ok(messages.at(-1).content.includes('【角色：检索】'));
  const trimmed = trimMessagesToBudget({
    fullMessages: messages,
    contextWindow: 120,
    headroom: 100,
    systemPromptTokens: 20,
  });
  const survived = trimmed.messages.some((m) => String(m.content || '').includes('【角色：检索】'));
  assert.equal(survived, false, '旧形态下角色块应被裁掉；若没被裁说明本测试判据失效');
});

test('源码形态钉：agent-runner 在 staticPrefix 处注入 rolePrefix，不在 systemPrompt 尾部追加', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-runner.js'), 'utf8');
  assert.ok(src.includes('const staticPrefix = systemPrompt.slice(0, staticPrefixChars) + rolePrefix;'));
  assert.ok(src.includes("const rolePrefix = roleDirective ? '\\n\\n=== 子智能体角色专职约束 ===\\n' + roleDirective : '';"));
  assert.equal(/systemPrompt\s*\+=\s*'\\n\\n=== 子智能体角色专职约束/.test(src), false);
});
