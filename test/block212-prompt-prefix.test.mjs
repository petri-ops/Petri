/**
 * BLOCK-212 — 提示词缓存前缀契约测。
 *
 * 钉四件事：
 *  ① 静态前缀跨任意 context **逐字节恒定**（前缀缓存的前提）；
 *  ② 动态上下文**不在静态前缀里**（项目/结果/Harness 摘要不得回到头部）；
 *  ③ 组装后 messages：首条=静态前缀，动态块在**末尾**且**恰好一次**；
 *  ④ Anthropic 请求的 system 是 block 数组、**只有静态段**带 `cache_control:{type:'ephemeral'}`；
 *  ⑤ 公开 API 行为不变（`buildSystemPrompt` == staticPrefix + dynamicContext）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sp = require(path.join(ROOT, 'core/petri-server/helpers/system-prompt.js'));
const { assembleMessages } = require(path.join(ROOT, 'core/petri-server/helpers/prompt-assembly.js'));
const { openAIToAnthropicRequest } = require(path.join(ROOT, 'core/shared-backend/llm-providers/protocol-conversion.js'));

const identity = { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-chat' };

const projectContext = (n) => ({
  page: 'desktop-project',
  projectId: `p-${n}`,
  pageTitle: `项目 ${n}`,
  projectDatasets: [{ id: `ds-${n}`, name: `数据集 ${n}`, rows: n, type: 'csv' }],
  projectJobs: [{ id: `job-${n}`, name: `任务 ${n}`, status: n % 2 ? 'done' : 'running', toolId: 'x' }],
});

test('BLOCK-212 — 静态前缀跨不同 context 逐字节恒定', () => {
  const a = sp.buildSystemPromptParts(projectContext(1), identity);
  const b = sp.buildSystemPromptParts(projectContext(2), identity);
  const c = sp.buildSystemPromptParts(null, identity);
  assert.equal(a.staticPrefix, b.staticPrefix, '项目不同 ⇒ 静态前缀必须完全一致');
  assert.equal(a.staticPrefix, c.staticPrefix, '无 context ⇒ 静态前缀仍一致');
  assert.notEqual(a.dynamicContext, b.dynamicContext, '动态段应当不同（否则本测无意义）');
});

test('BLOCK-212 — 动态内容不得出现在静态前缀里', () => {
  const parts = sp.buildSystemPromptParts(projectContext(3), identity);
  assert.ok(!parts.staticPrefix.includes('【项目数据集】'), '项目数据集不得回到头部');
  assert.ok(!parts.staticPrefix.includes('p-3'), 'projectId 不得出现在静态前缀');
  assert.ok(parts.dynamicContext.includes('【项目数据集】'), '动态段应承载项目数据集');
  assert.ok(parts.dynamicContext.includes('p-3'));
});

test('BLOCK-212 — 公开 API 行为不变（旧调用方零影响）', () => {
  const ctx = projectContext(4);
  const legacy = sp.buildSystemPrompt(ctx, identity);
  const parts = sp.buildSystemPromptParts(ctx, identity);
  assert.equal(legacy, parts.staticPrefix + parts.dynamicContext, '拼接后必须与旧返回值逐字节相同');
});

test('BLOCK-212 — 组装：首条=静态前缀，动态块在末尾且恰好一次', () => {
  const history = [
    { role: 'user', content: '第一个问题' },
    { role: 'assistant', content: '第一个回答' },
    { role: 'user', content: '第二个问题' },
  ];
  const msgs = assembleMessages({ staticPrefix: 'STATIC', dynamicContext: 'DYN', messages: history });
  assert.equal(msgs[0].role, 'system');
  assert.equal(msgs[0].content, 'STATIC');
  assert.deepEqual(msgs.slice(1, 4), history, '历史必须原样保留在中间');
  assert.equal(msgs.length, 5);
  assert.equal(msgs[4].role, 'system');
  assert.ok(msgs[4].content.includes('DYN'));
  assert.equal(msgs.filter((m) => String(m.content).includes('DYN')).length, 1, '动态块恰好一次');

  const noDyn = assembleMessages({ staticPrefix: 'S', dynamicContext: '   ', messages: history });
  assert.equal(noDyn.length, 4, '空动态段不注入空 system');
});

test('BLOCK-212 — Anthropic：system 是 block 数组，只有静态段带 cache_control', () => {
  const body = {
    model: 'claude-3-7',
    messages: assembleMessages({ staticPrefix: 'STATIC-PREFIX', dynamicContext: 'DYN-CTX', messages: [{ role: 'user', content: 'hi' }] }),
  };
  const req = openAIToAnthropicRequest(body);
  assert.ok(Array.isArray(req.system), 'Anthropic system 必须是 block 数组');
  assert.equal(req.system.length, 2);
  assert.equal(req.system[0].text, 'STATIC-PREFIX');
  assert.deepEqual(req.system[0].cache_control, { type: 'ephemeral' }, '静态段必须有断点');
  assert.ok(String(req.system[1].text).includes('DYN-CTX'));
  assert.equal(req.system[1].cache_control, undefined, '动态段不得打断点（否则每轮写新缓存）');
  // 历史只留在 messages 里，system 段不再包含历史
  assert.equal(req.messages.length, 1);
  assert.equal(req.messages[0].role, 'user');
});

test('BLOCK-212 — Anthropic：单条 system 也带断点（无动态段时不退化）', () => {
  const req = openAIToAnthropicRequest({
    model: 'claude-3-7',
    messages: [{ role: 'system', content: 'ONLY-STATIC' }, { role: 'user', content: 'hi' }],
  });
  assert.deepEqual(req.system, [{ type: 'text', text: 'ONLY-STATIC', cache_control: { type: 'ephemeral' } }]);
});

test('BLOCK-212 — 离线量化：连续两轮的消息前缀复用比例（本包的核心收益）', () => {
  const common = (a, b) => {
    const n = Math.min(a.length, b.length);
    let i = 0;
    while (i < n && a[i] === b[i]) i += 1;
    return i;
  };
  // 用**真实比例**的会话（长历史 + 小动态块）：历史 20 条，动态段一段。
  const history = [];
  for (let i = 0; i < 10; i += 1) {
    history.push({ role: 'user', content: `问题 ${i}：` + 'x'.repeat(200) });
    history.push({ role: 'assistant', content: `回答 ${i}：` + 'y'.repeat(400) });
  }
  const dynamicN = '【项目数据集】数据集 A（rows=1000）\n【项目分析历史】[done] 任务 1';
  const dynamicN1 = '【项目数据集】数据集 A（rows=1000）\n【项目分析历史】[done] 任务 1、[running] 任务 2';
  const turnN = assembleMessages({ staticPrefix: 'STATIC-HEAD-' + 'z'.repeat(600), dynamicContext: dynamicN, messages: history });
  const turnN1 = assembleMessages({
    staticPrefix: 'STATIC-HEAD-' + 'z'.repeat(600),
    dynamicContext: dynamicN1,
    messages: [...history, { role: 'user', content: '接着来' }],
  });
  const serializedN = JSON.stringify(turnN);
  const serializedN1 = JSON.stringify(turnN1);
  const reuse = common(serializedN, serializedN1) / serializedN.length;
  assert.ok(reuse > 0.9, `长历史场景下连续轮次前缀复用应 >90%，实得 ${(reuse * 100).toFixed(1)}%`);

  // 对照：旧布局（动态段在 system 头部）——动态一变，前缀在"数据集"处就断了
  const legacySystem = (dyn) => [{ role: 'system', content: 'STATIC-HEAD-' + 'z'.repeat(600) + '\n' + dyn }];
  const legacyN = JSON.stringify([...legacySystem(dynamicN), ...history]);
  const legacyN1 = JSON.stringify([...legacySystem(dynamicN1), ...history, { role: 'user', content: '接着来' }]);
  const legacyReuse = common(legacyN, legacyN1) / legacyN.length;
  assert.ok(legacyReuse < 0.2, `旧布局复用应很低，实得 ${(legacyReuse * 100).toFixed(1)}%`);
  assert.ok(reuse > legacyReuse * 3, `新布局应显著优于旧布局（${(reuse * 100).toFixed(1)}% vs ${(legacyReuse * 100).toFixed(1)}%）`);
});
