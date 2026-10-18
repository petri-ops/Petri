/**
 * BLOCK-209（runlist W7d）— 外部 Agent 配置导入预览契约测。
 *
 * 钉四件事：
 *  ① **零写入零网络**：预览返回 `wrote:false`/`dryRun:true`，patch 只是建议值；
 *  ② **凭据零自动导入（D-2）**：键名或值形态命中 ⇒ 只进 `credentialsDetected`，**绝不进 patch**；
 *  ③ **映射的键真实存在**：patch 里每个 `family::path` 都能在 shared-config 找到；
 *  ④ **不静默吞**：不认识的键/结构进 `unsupported`；解析失败 `ok:false` + diagnostics。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const importer = require(path.join(ROOT, 'core/shared-backend/external-agent-import.js'));
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

const codex = (body) => importer.mapToPetri({ source: 'codex', content: body, schema });
const zcode = (text) => importer.mapToPetri({ source: 'zcode', content: text, schema });

test('BLOCK-209 — 格式识别：显式 source 优先，其次按内容判断，认不出=ok:false', () => {
  assert.equal(importer.detectFormat('{"a":1}'), 'zcode');
  assert.equal(importer.detectFormat('model = "x"'), 'codex');
  assert.equal(importer.detectFormat('hello world'), null);
  assert.equal(importer.detectFormat('{"a":1}', 'codex'), 'codex', '显式 source 覆盖自动判断');
  const unknown = importer.mapToPetri({ content: 'hello', schema });
  assert.equal(unknown.ok, false);
  assert.ok(unknown.diagnostics.some((d) => d.code === 'unknown-format'));
});

test('BLOCK-209 — Codex 解析：注释/引号/布尔/数字/节；复杂结构进 unsupported', () => {
  const parsed = importer.parseCodexConfig(`
# 注释
model = "gpt-5"   # 行内注释
notify = true
retries = 3
[history]
persistence = 'save-all'
[[mcp_servers]]
name = "x"
inline = { a = 1 }
`);
  assert.equal(parsed.values.model, 'gpt-5');
  assert.equal(parsed.values.notify, true);
  assert.equal(parsed.values.retries, 3);
  assert.equal(parsed.values['history.persistence'], 'save-all');
  assert.ok(parsed.unsupported.some((u) => u.includes('mcp_servers')), '数组表不猜，列 unsupported');
  assert.ok(parsed.unsupported.some((u) => u.includes('inline')), '内联表是复杂值，列 unsupported');
});

test('BLOCK-209 — Codex 映射：approval_policy/sandbox_mode → 四档（取更严），model/provider/baseUrl 只进 notes', () => {
  const onlyApproval = codex('approval_policy = "on-request"');
  assert.equal(onlyApproval.patch['runtime::approvalDefaultMode'], 'workspace-write');

  const onlySandbox = codex('sandbox_mode = "read-only"');
  assert.equal(onlySandbox.patch['runtime::approvalDefaultMode'], 'read');

  const both = codex('approval_policy = "never"\nsandbox_mode = "read-only"');
  assert.equal(both.patch['runtime::approvalDefaultMode'], 'read', '两者冲突取更严（never=full 被 read-only 压回 read）');

  const modelOnly = codex('model = "gpt-5"\nmodel_provider = "openai"\nopenai_base_url = "https://x/v1"');
  assert.deepEqual(modelOnly.patch, {}, '模型/渠道信息可能改变计费与协议，v1 只提示不自动写');
  assert.ok(modelOnly.notes.some((n) => n.what === 'model' && n.value === 'gpt-5'));
  assert.ok(modelOnly.notes.some((n) => n.what === 'base_url'));
});

test('BLOCK-209 — D-2：凭据（键名或值形态）绝不进 patch', () => {
  const byName = codex('api_key = "anything"\nazure_token = "t"\nmodel = "x"');
  assert.deepEqual(byName.patch, {});
  assert.deepEqual(byName.credentialsDetected.map((c) => c.path).sort(), ['api_key', 'azure_token']);
  assert.ok(byName.credentialsDetected.every((c) => !JSON.stringify(byName.patch).includes(c.path)));

  const byValue = codex('custom_field = "sk-abcdefgh12345678"');
  assert.ok(byValue.credentialsDetected.some((c) => c.path === 'custom_field'), '值形似 API Key 也要识别');
  assert.deepEqual(byValue.patch, {});

  const z = zcode(JSON.stringify({ apiKey: 'sk-xyz123456789', model: 'm' }));
  assert.ok(z.credentialsDetected.some((c) => c.path === 'apiKey'));
  assert.ok(!JSON.stringify(z.patch).includes('sk-xyz123456789'), '凭据值不得出现在 patch 里');
});

test('BLOCK-209 — ZCode 映射：最小可核对集 + 其余如实 unsupported', () => {
  const mapped = zcode(JSON.stringify({
    model: 'z-model',
    provider: { baseUrl: 'https://z/v1' },
    approvalPolicy: 'on-failure',
    editor: { tabSize: 2 },
    theme: 'midnight',
  }));
  assert.equal(mapped.patch['runtime::approvalDefaultMode'], 'workspace-write');
  assert.ok(mapped.notes.some((n) => n.what === 'model' && n.value === 'z-model'));
  assert.ok(mapped.notes.some((n) => n.what === 'base_url'));
  const unsupported = mapped.unsupported.join(' | ');
  assert.ok(unsupported.includes('editor.tabSize'), '无等价物的键要如实列出');
  assert.ok(unsupported.includes('theme'));
});

test('BLOCK-209 — patch 的每个键都能在注册表里找到（映射表 ↔ schema 不漂移）', () => {
  const r = codex('approval_policy = "never"');
  for (const key of Object.keys(r.patch)) {
    const [family, ...rest] = key.split('::');
    assert.ok(schema.findEntryByPath(family, rest.join('::')), `注册表缺少 ${key}`);
  }
  // 反向：映射出一个不存在的键会被诊断抓住（防手工改坏映射表）
  const bogus = importer.mapToPetri({ source: 'codex', content: 'approval_policy = "never"', schema: { findEntryByPath: () => null } });
  assert.equal(bogus.ok, false);
  assert.ok(bogus.diagnostics.some((d) => d.code === 'unknown-key'));
});

test('BLOCK-209 — 无效输入：坏 JSON 有诊断、ok:false（不抛）', () => {
  const bad = zcode('{not json');
  assert.equal(bad.ok, false);
  assert.ok(bad.diagnostics.some((d) => d.code === 'parse-error'));
  assert.deepEqual(bad.patch, {});
});

test('BLOCK-209 — HTTP 预览面：空内容/超长 400；正常 200 且明确 wrote:false', async () => {
  const express = require('express');
  const app = express();
  require(path.join(ROOT, 'core/petri-server/routes/external-import.js')).registerExternalImportRoutes(app);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const empty = await fetch(`${base}/api/import/external-agent/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '' }),
    });
    assert.equal(empty.status, 400);

    const ok = await fetch(`${base}/api/import/external-agent/preview`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'codex', content: 'approval_policy = "on-request"\napi_key = "sk-zzzzzzzzzzzz"' }),
    });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.dryRun, true);
    assert.equal(body.wrote, false, '预览绝不写盘');
    assert.equal(body.patch['runtime::approvalDefaultMode'], 'workspace-write');
    assert.ok(body.credentialsDetected.length >= 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
