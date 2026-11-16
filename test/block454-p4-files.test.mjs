/**
 * BLOCK-454 P4 — DeepSeek Files API + 对话内联文件块协议归一 + file_id 归属校验。
 *
 * 契约源（findings §1 文件输入 + 2026-11-17 官方文档补抓，VERIFIED）：
 *   POST https://api.deepseek.com/files，multipart，purpose 必填且**须在 file 之前**（400 强约束）；
 *   purpose ∈ text_recognition | rich_layout_recognition | user_data；
 *   响应 {id:"file-api-*", object:"file", bytes, created_at, filename, purpose}；
 *   引用块：Chat {type:"file",file_id} / Responses {type:"input_file",file_id} /
 *           Messages {type:"document",source:{type:"file",file_id}}（需 header anthropic-beta: files-api-2025-04-14）；
 *   ≤100MiB（413）/1000 页；120s 上传/解析时限；同时上传 ≤15（429）；每请求引用 ≤20 文档。
 *
 * BLOCK-196 教训落点：file_id 归属校验**不空转**——未知/外来 id fail-closed，
 * 注册表不可读 fail-closed（诚实错误码，绝不静默放行）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const {
  uploadFile,
  fileContentBlockForProtocol,
  PROTOCOLS,
  FILE_PURPOSES,
  FILES_ENDPOINT,
  FILES_BETA_HEADER,
  bodyHasFileReference,
} = require('../core/petri-server/helpers/files-provider.js');
const filesRegistry = require('../core/petri-server/helpers/files-registry.js');

// ---------- A) Files API 上传契约 ----------

function mockFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length, { url, init });
  };
  impl.calls = calls;
  return impl;
}

const ENABLED = { timeoutMs: 30000 };

test('P4-A0 — 常量契约：端点/purpose 白名单/协议清单/beta header', () => {
  assert.equal(FILES_ENDPOINT, 'https://api.deepseek.com/files');
  assert.deepEqual([...FILE_PURPOSES].sort(), ['rich_layout_recognition', 'text_recognition', 'user_data']);
  assert.deepEqual([...PROTOCOLS].sort(), ['chat', 'messages', 'responses']);
  assert.equal(FILES_BETA_HEADER, 'files-api-2025-04-14');
});

test('P4-A1 — 请求形态：multipart 且 purpose 字段在 file 之前（官方 400 强约束）+ Bearer', async () => {
  const fetchImpl = mockFetch(() => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ id: 'file-api-abc123', object: 'file', bytes: 4, created_at: 1, filename: 'doc.pdf', purpose: 'text_recognition' }),
  }));
  const r = await uploadFile({
    buffer: Buffer.from('%PDF'), filename: 'doc.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk-test-key',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fetchImpl.calls[0].url, FILES_ENDPOINT);
  assert.equal(fetchImpl.calls[0].init.method, 'POST');
  assert.equal(fetchImpl.calls[0].init.headers.authorization, 'Bearer sk-test-key');
  const form = fetchImpl.calls[0].init.body;
  const order = [...form.keys ? form.keys() : []];
  assert.ok(typeof form.get === 'function', 'body 必须是 FormData');
  const keys = [...order];
  assert.equal(keys.indexOf('purpose'), 0, `purpose 必须第一（官方 400 强约束）：${keys.join(',')}`);
  assert.ok(keys.indexOf('file') > keys.indexOf('purpose'), `file 必须在 purpose 之后：${keys.join(',')}`);
  assert.equal(form.get('purpose'), 'text_recognition');
  assert.equal(r.fileId, 'file-api-abc123');
  assert.equal(r.object, 'file');
  assert.equal(r.cost.requests, 1);
});

test('P4-A2 — purpose 白名单外 → files_purpose_invalid；无 key → files_not_configured（均不发请求）', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const badPurpose = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'made_up',
    config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(badPurpose.ok, false);
  assert.equal(badPurpose.code, 'files_purpose_invalid');
  const noKey = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl, getApiKeyFn: () => '',
  });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.code, 'files_not_configured');
  assert.ok(noKey.message.includes('DeepSeek'), noKey.message);
  assert.equal(fetchImpl.calls.length, 0);
});

test('P4-A3 — 100MiB 上限 → files_too_large（不发请求）；413/429/401 → 诚实错误映射', async () => {
  const fetchImpl = mockFetch((_n, { }) => ({
    ok: false, status: 413, text: async () => JSON.stringify({ error: { message: 'too large' } }),
  }));
  const tooBig = await uploadFile({
    buffer: Buffer.alloc(8), filename: 'big.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk', maxUploadBytes: 4,
  });
  assert.equal(tooBig.ok, false);
  assert.equal(tooBig.code, 'files_too_large');
  const http413 = await uploadFile({
    buffer: Buffer.from('x'), filename: 'big.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(http413.ok, false);
  assert.equal(http413.code, 'files_http_error');
  assert.equal(http413.status, 413);
  assert.ok(http413.message.includes('100 MiB'), `413 文案须带契约上限: ${http413.message}`);
  const r429 = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl: mockFetch(() => ({ ok: false, status: 429, text: async () => '{}' })), getApiKeyFn: () => 'sk',
  });
  assert.equal(r429.code, 'files_http_error');
  assert.ok(r429.message.includes('同时上传数'), `429 文案须提示并发上限: ${r429.message}`);
  const r401 = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl: mockFetch(() => ({ ok: false, status: 401, text: async () => '{}' })), getApiKeyFn: () => 'sk-bad',
  });
  assert.equal(r401.code, 'files_http_error');
  assert.equal(r401.retryable, false, '401 重试无意义（配置面）');
});

test('P4-A4 — 响应缺 id → files_bad_response（不静默成功）；非 JSON → 同码', async () => {
  const noId = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl: mockFetch(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ object: 'file' }) })), getApiKeyFn: () => 'sk',
  });
  assert.equal(noId.ok, false);
  assert.equal(noId.code, 'files_bad_response');
  const notJson = await uploadFile({
    buffer: Buffer.from('x'), filename: 'd.pdf', purpose: 'text_recognition',
    config: ENABLED, fetchImpl: mockFetch(() => ({ ok: true, status: 200, text: async () => 'oops' })), getApiKeyFn: () => 'sk',
  });
  assert.equal(notJson.code, 'files_bad_response');
});

// ---------- B) 协议归一（纯函数） ----------

test('P4-B1 — 三协议引用块形状（官方逐字契约）+ 未知协议诚实拒', () => {
  assert.deepEqual(fileContentBlockForProtocol('file-api-x', 'chat'), { type: 'file', file_id: 'file-api-x' });
  assert.deepEqual(fileContentBlockForProtocol('file-api-x', 'responses'), { type: 'input_file', file_id: 'file-api-x' });
  assert.deepEqual(fileContentBlockForProtocol('file-api-x', 'messages'), { type: 'document', source: { type: 'file', file_id: 'file-api-x' } });
  assert.throws(() => fileContentBlockForProtocol('file-api-x', 'unknown-protocol'), /unknown_protocol/);
});

test('P4-B2 — bodyHasFileReference 探针：chat file 块命中；纯文本/空体不命中', () => {
  assert.equal(bodyHasFileReference({ messages: [{ role: 'user', content: [{ type: 'file', file_id: 'f1' }] }] }), true);
  assert.equal(bodyHasFileReference({ messages: [{ role: 'user', content: '纯文本' }] }), false);
  assert.equal(bodyHasFileReference({}), false);
  assert.equal(bodyHasFileReference(undefined), false);
  // image/file 混排也能命中
  assert.equal(bodyHasFileReference({ messages: [{ role: 'user', content: [
    { type: 'text', text: '看这个' },
    { type: 'file', file_id: 'f2' },
  ] }] }), true);
});

// ---------- C) file_id 归属注册表（BLOCK-196 教训：不空转） ----------

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block454-p4-'));
process.env.PETRI_LOCAL_DATA_DIR = tempRoot;
process.on('exit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});

function registryPath() {
  return path.join(tempRoot, 'files-registry.json');
}

test('P4-C1 — 记录 + 归属校验：自有 id 放行；未知 id fail-closed（file_id_unowned 不空转）', () => {
  filesRegistry.recordUploadedFile({
    storePath: registryPath(),
    entry: { fileId: 'file-api-owned', purpose: 'text_recognition', filename: 'doc.pdf', bytes: 10, docId: 'kdoc_a', sha256: 'ab12' },
  });
  const owned = filesRegistry.assertFileUsable('file-api-owned', { storePath: registryPath(), conversationId: 'conv_1' });
  assert.equal(owned.ok, true, JSON.stringify(owned));
  const foreign = filesRegistry.assertFileUsable('file-api-never-uploaded', { storePath: registryPath(), conversationId: 'conv_1' });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.code, 'file_id_unowned', '未知 id 必须 fail-closed，绝不静默放行');
  assert.ok(foreign.message.length > 10);
});

test('P4-C2 — 注册表损坏 → fail-closed files_registry_unreadable（BLOCK-196：校验不空转）', () => {
  const corruptPath = path.join(tempRoot, 'files-registry-corrupt.json');
  fs.writeFileSync(corruptPath, '{not-json');
  const r = filesRegistry.assertFileUsable('file-api-x', { storePath: corruptPath, conversationId: 'c' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'files_registry_unreadable', `注册表损坏必须诚实拒（不静默放行）: ${JSON.stringify(r)}`);
});

test('P4-C3 — docId 归属：按知识文档登记后可按 docId 校验', () => {
  const hit = filesRegistry.assertFileUsable('file-api-owned', { storePath: registryPath(), docId: 'kdoc_a' });
  assert.equal(hit.ok, true);
  const miss = filesRegistry.assertFileUsable('file-api-owned', { storePath: registryPath(), docId: 'kdoc_other' });
  assert.equal(miss.ok, false);
  assert.equal(miss.code, 'file_id_doc_mismatch');
});

// ---------- D) knowledge 对接 + Anthropic header 注入 ----------

test('P4-D1 — uploadKnowledgeDocumentForChat：读取 doc 原件 → 上传 → 注册表留痕（docId 归属）', async () => {
  process.env.PETRI_DB_PATH = path.join(tempRoot, 'petri.db');
  process.env.PETRI_BETTER_SQLITE3_ROOT = resolve(__dirname, '..', 'core', 'petri-server');
  const { runMigrations } = require('../src/migration-runner.js');
  await runMigrations(process.env.PETRI_DB_PATH, resolve(__dirname, '..', 'src', 'migrations'));
  const ks = require('../core/petri-server/helpers/knowledge-space.js');
  const ingest = require('../core/petri-server/helpers/knowledge-ingest.js');
  const doc = await ingest.createDocument({ name: 'report.txt', buffer: Buffer.from('知识库文档正文'), autoIngest: false });
  const regPath = path.join(tempRoot, 'files-registry-knowledge.json');
  const uploadCalls = [];
  const result = await ingest.uploadKnowledgeDocumentForChat(doc.id, {
    purpose: 'user_data',
    registryPath: regPath,
    uploadFn: async (args) => {
      uploadCalls.push(args);
      return { ok: true, fileId: 'file-api-kdoc1', object: 'file', bytes: 8, filename: 'report.txt', purpose: 'user_data', cost: { requests: 1, bytes: 8 } };
    },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.fileId, 'file-api-kdoc1');
  assert.equal(uploadCalls.length, 1);
  assert.equal(uploadCalls[0].purpose, 'user_data');
  assert.ok(Buffer.isBuffer(uploadCalls[0].buffer), '上传的是 doc 原件 buffer');
  assert.ok(uploadCalls[0].filename.endsWith('report.txt'));
  // 注册表留痕 + docId 归属校验
  const owned = filesRegistry.assertFileUsable('file-api-kdoc1', { storePath: regPath, docId: doc.id });
  assert.equal(owned.ok, true, JSON.stringify(owned));
  assert.equal(filesRegistry.assertFileUsable('file-api-kdoc1', { storePath: regPath, docId: 'kdoc_other' }).code, 'file_id_doc_mismatch');
  // doc 不存在 → 诚实拒
  const missing = await ingest.uploadKnowledgeDocumentForChat('kdoc_missing', { purpose: 'user_data', registryPath: regPath, uploadFn: async () => ({ ok: true, fileId: 'x' }) });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'knowledge_document_not_found');
});

test('P4-D2 — anthropic.js：body 含 file 块 → 请求带 anthropic-beta files header + document 块转换', async () => {
  const anthropicMod = require('../core/shared-backend/llm-providers/anthropic.js');
  const provider = new anthropicMod.AnthropicProvider();
  const sentRequests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    sentRequests.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: 'msg_1', type: 'message', role: 'assistant', model: 'deepseek-flash',
        content: [{ type: 'text', text: '文档已读' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
      headers: new Map(),
    };
  };
  try {
    const r = await provider.chat('sk-x', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: [
        { type: 'text', text: '总结这份文档' },
        { type: 'file', file_id: 'file-api-abc' },
      ] }],
    }, {}, { baseUrl: 'https://api.deepseek.com/anthropic' });
    assert.equal(r.error, undefined, JSON.stringify(r));
    assert.equal(sentRequests.length, 1);
    const headers = sentRequests[0].init.headers;
    assert.equal(headers['anthropic-beta'], FILES_BETA_HEADER, `Messages 协议必须带 files beta header: ${JSON.stringify(headers)}`);
    const body = JSON.parse(sentRequests[0].init.body);
    const block = body.messages[0].content.find((b) => b.type === 'document');
    assert.ok(block, '转换后必须出现 document 块');
    assert.deepEqual(block.source, { type: 'file', file_id: 'file-api-abc' });
    // 对照：无 file 块的请求不带 beta header
    sentRequests.length = 0;
    await provider.chat('sk-x', {
      model: 'deepseek-flash',
      messages: [{ role: 'user', content: '纯文本' }],
    }, {}, { baseUrl: 'https://api.deepseek.com/anthropic' });
    assert.equal(sentRequests[0].init.headers['anthropic-beta'], undefined, '无 file 块不得多带 beta header');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
