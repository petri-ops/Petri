/**
 * BLOCK-37 P1 — 模型 I/O 信息流落盘（io-transcript sink + ModelGateway 埋点）。
 *
 * 覆盖：
 * - sink：按会话 JSONL 追加 / unattributed 归档 / 路径安全 / 8MB 三级截断纪律 /
 *   帧上限 / 写失败不抛
 * - gateway：流式 tee 帧且 onEvent 语义不变 / 非流式 / 错误结果 / vision /
 *   fallback 每 attempt 独立记录
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

const { createIoTranscriptSink, normalizeResponse, applyTruncation } = await import(
  `file://${resolve('core/shared-backend/llm-providers/io-transcript.js')}`
);
const { ModelGateway } = await import(
  `file://${resolve('core/shared-backend/llm-providers/model-gateway.js')}`
);

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-block37-'));
}

function readRecords(file) {
  const raw = fs.readFileSync(file, 'utf8').trim();
  return raw ? raw.split('\n').map((line) => JSON.parse(line)) : [];
}

const PROFILE = {
  id: 'deepseek-chat',
  provider: 'deepseek',
  model: 'deepseek-chat',
  capabilities: ['chat', 'streaming', 'tools'],
};

function makeGateway({ provider, transcripts }) {
  return new ModelGateway({
    getSettings: () => ({ model_profiles: [PROFILE] }),
    getCredential: () => 'sk-test',
    getProvider: () => provider,
    recordTranscript(entry) {
      transcripts.push(entry);
    },
  });
}

describe('io-transcript sink (BLOCK-37 P1)', () => {
  it('appends one JSONL record per call, partitioned by conversationId; null id goes to unattributed', () => {
    const dir = tmpDir();
    const sink = createIoTranscriptSink({ dataDir: dir });

    sink.record({
      telemetry: { conversationId: 'conv-1', kind: 'agent_iter', userId: 'u1' },
      requestBody: { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hello' }] },
      result: {
        choices: [{
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'hi', reasoning_content: 'think', tool_calls: [{ id: 'c1' }] },
        }],
        usage: { total_tokens: 9 },
      },
      provider: 'deepseek',
      model: 'deepseek-chat',
      frames: [{ type: 'content_delta', content: 'hi' }, { type: 'done' }],
      framesCount: 2,
    });
    sink.record({ telemetry: {}, requestBody: { messages: [{ role: 'user', content: 'x' }] }, result: { choices: [] } });

    const convRecords = readRecords(path.join(dir, 'llm-transcripts', 'conv-1.jsonl'));
    assert.equal(convRecords.length, 1);
    assert.equal(convRecords[0].conversationId, 'conv-1');
    assert.equal(convRecords[0].kind, 'agent_iter');
    assert.deepEqual(convRecords[0].request.messages, [{ role: 'user', content: 'hello' }]);
    assert.equal(convRecords[0].response.content, 'hi');
    assert.equal(convRecords[0].response.reasoningContent, 'think');
    assert.deepEqual(convRecords[0].response.toolCalls, [{ id: 'c1' }]);
    assert.deepEqual(convRecords[0].response.usage, { total_tokens: 9 });
    assert.equal(convRecords[0].error, null);
    assert.deepEqual(convRecords[0].frames, [{ type: 'content_delta', content: 'hi' }, { type: 'done' }]);
    assert.equal(convRecords[0].truncated, false);

    const unattr = readRecords(path.join(dir, 'llm-transcripts', 'unattributed.jsonl'));
    assert.equal(unattr.length, 1);
    assert.equal(unattr[0].conversationId, null);
  });

  it('sanitizes unsafe conversation ids into path-safe file names', () => {
    const dir = tmpDir();
    const sink = createIoTranscriptSink({ dataDir: dir });
    sink.record({ telemetry: { conversationId: '../../evil' }, requestBody: { messages: [] }, result: { choices: [] } });
    const files = fs.readdirSync(path.join(dir, 'llm-transcripts'));
    assert.deepEqual(files, ['evil.jsonl']);
  });

  it('drops frames first and collapses message middle under the size cap, with honest markers', () => {
    const big = 'x'.repeat(200 * 1024);
    const record = {
      request: {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: big },
          { role: 'user', content: big },
          { role: 'user', content: big },
          { role: 'user', content: big },
          { role: 'user', content: big },
          { role: 'user', content: big },
          { role: 'user', content: 'last' },
        ],
      },
      response: { content: 'ok' },
      frames: [{ type: 'content_delta', content: big }],
      framesCount: 1,
      framesTruncated: false,
      truncated: false,
      messagesTruncated: 0,
    };
    applyTruncation(record, 1024 * 1024); // 1MB 上限：大消息必然超限
    assert.equal(record.frames.length, 0);
    assert.equal(record.framesTruncated, true);
    // 7 条消息不足 head4+tail16 保留窗，中段不折叠，走第三级逐条截断
    assert.equal(record.messagesTruncated, 0);
    assert.equal(record.truncated, true);
    assert.ok(JSON.stringify(record).length <= 1024 * 1024 + 4096, 'record should be near cap');
  });

  it('BLOCK-155 P2-2：image_url 部件的 data URL 超限逐条截断（chat 内联链多轮落盘防放大）', () => {
    const dataUrl = `data:image/png;base64,${'A'.repeat(600 * 1024)}`;
    const record = {
      request: {
        messages: [
          { role: 'system', content: 'sys' },
          { role: 'user', content: [{ type: 'text', text: '看图' }, { type: 'image_url', image_url: { url: dataUrl } }] },
          { role: 'user', content: [{ type: 'text', text: '再看' }, { type: 'image_url', image_url: { url: dataUrl } }] },
        ],
      },
      response: { content: 'ok' },
      frames: [],
      framesCount: 0,
      framesTruncated: false,
      truncated: false,
      messagesTruncated: 0,
    };
    applyTruncation(record, 256 * 1024); // 256KB 上限：两条 600KB data URL 必然超限
    assert.equal(record.truncated, true);
    for (const m of record.request.messages) {
      if (!Array.isArray(m.content)) continue;
      for (const part of m.content) {
        if (part && part.type === 'image_url' && part.image_url) {
          assert.ok(part.image_url.url.length <= 2000 + 32, `image_url.url 应被截断到 clip 上限，实际 ${part.image_url.url.length}`);
          assert.ok(part.image_url.url.endsWith('…[BLOCK-37 截断]'), '截断标记在场');
        }
      }
    }
    assert.ok(JSON.stringify(record).length <= 256 * 1024 + 4096, 'record should be near cap');
  });

  it('collapses message middle when message count exceeds head+tail keep window', () => {
    const big = 'y'.repeat(300 * 1024);
    const messages = [{ role: 'system', content: 'sys' }];
    for (let i = 0; i < 30; i += 1) messages.push({ role: 'user', content: big });
    messages.push({ role: 'user', content: 'last' });
    const record = { request: { messages }, response: { content: 'ok' }, frames: [], framesTruncated: false, truncated: false, messagesTruncated: 0 };
    applyTruncation(record, 2 * 1024 * 1024);
    assert.equal(record.messagesTruncated, 12); // 32 条 = sys + 30 + last，保首 4 尾 16，中段折叠 12
    assert.equal(record.request.messages.length, 4 + 1 + 16); // head4 + 折叠占位 + tail16
    assert.equal(record.truncated, true);
  });

  it('write failures never throw', () => {
    const sink = createIoTranscriptSink({
      dataDir: tmpDir(),
      fs: { mkdirSync: () => {}, statSync: () => { throw new Error('no'); }, appendFileSync: () => { throw new Error('disk full'); } },
    });
    assert.doesNotThrow(() => {
      sink.record({ telemetry: { conversationId: 'c' }, requestBody: { messages: [] }, result: { choices: [] } });
    });
  });

  it('normalizeResponse returns null for error results and extracts bounded fields', () => {
    assert.equal(normalizeResponse({ error: 'timeout' }), null);
    assert.equal(normalizeResponse(null), null);
    const ok = normalizeResponse({ choices: [{ finish_reason: 'tool_calls', message: { content: 'a', tool_calls: [] } }], usage: {} });
    assert.equal(ok.finishReason, 'tool_calls');
    assert.equal(ok.reasoningContent, undefined);
  });
});

describe('ModelGateway transcript hooks (BLOCK-37 P1)', () => {
  it('streams to onEvent unchanged and records frames + aggregated response', async () => {
    const transcripts = [];
    const events = [
      { type: 'content_delta', content: 'he' },
      { type: 'content_delta', content: 'llo' },
      { type: 'done', usage: { total_tokens: 5 } },
    ];
    const gateway = makeGateway({
      transcripts,
      provider: {
        chatStream: async (apiKey, body, telemetry, onEvent) => {
          for (const event of events) onEvent(event);
          return { choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }], usage: { total_tokens: 5 } };
        },
      },
    });
    const seen = [];
    const result = await gateway.chat({
      role: 'agent',
      body: { messages: [{ role: 'user', content: 'say hi' }] },
      telemetry: { conversationId: 'conv-gw', kind: 'agent_iter' },
      onEvent: (event) => seen.push(event),
    });
    assert.deepEqual(seen, events);
    assert.equal(result.choices[0].message.content, 'hello');

    assert.equal(transcripts.length, 1);
    const entry = transcripts[0];
    assert.equal(entry.telemetry.conversationId, 'conv-gw');
    assert.equal(entry.provider, 'deepseek');
    assert.equal(entry.attemptIndex, 0);
    assert.deepEqual(entry.requestBody.messages, [{ role: 'user', content: 'say hi' }]);
    assert.deepEqual(entry.frames, events);
    assert.equal(entry.framesCount, 3);
    assert.equal(entry.framesTruncated, false);
  });

  it('records non-stream chat and error results with honest error field', async () => {
    const transcripts = [];
    const gateway = makeGateway({
      transcripts,
      provider: {
        chat: async () => ({ error: 'timeout', message: 'upstream timeout' }),
      },
    });
    const result = await gateway.chat({
      role: 'chat',
      body: { messages: [{ role: 'user', content: 'x' }] },
      telemetry: { conversationId: 'conv-err' },
    });
    assert.equal(result.error, 'timeout');
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].result.error, 'timeout');
    assert.equal(transcripts[0].frames, undefined);
  });

  it('records vision role calls', async () => {
    const transcripts = [];
    const gateway = new ModelGateway({
      getSettings: () => ({
        model_profiles: [{ ...PROFILE, id: 'vl-model', capabilities: ['vision'], roles: ['vision'] }],
      }),
      getCredential: () => 'sk-test',
      getProvider: () => ({
        chat: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'saw it' } }], usage: { total_tokens: 3 } }),
      }),
      recordTranscript(entry) { transcripts.push(entry); },
    });
    await gateway.vision({
      profileId: 'vl-model',
      body: { messages: [{ role: 'user', content: [{ type: 'text', text: '看图' }] }] },
      telemetry: { conversationId: 'conv-vis', kind: 'vision' },
    });
    assert.equal(transcripts.length, 1);
    assert.equal(transcripts[0].role, 'vision');
    assert.equal(transcripts[0].result.choices[0].message.content, 'saw it');
  });

  it('records each fallback attempt separately with attemptIndex', async () => {
    const transcripts = [];
    // fallback 需要第二个候选 profile + fallbackEnabled
    const gateway = new ModelGateway({
      getSettings: () => ({
        model_fallback_enabled: true,
        model_profiles: [
          PROFILE,
          { ...PROFILE, id: 'deepseek-backup', model: 'deepseek-backup' },
        ],
        model_fallback_bindings: { chat: ['deepseek-backup'] },
      }),
      getCredential: () => 'sk-test',
      getProvider: () => ({
        chat: async (apiKey, body) => (body.model === 'deepseek-chat'
          ? { error: 'http_error', status: 500 }
          : { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }),
      }),
      recordTranscript(entry) { transcripts.push(entry); },
    });
    const result = await gateway.chat({
      role: 'chat',
      body: { messages: [{ role: 'user', content: 'x' }] },
      telemetry: { conversationId: 'conv-fb' },
    });
    assert.equal(result.choices[0].message.content, 'ok');
    assert.equal(transcripts.length, 2);
    assert.equal(transcripts[0].attemptIndex, 0);
    assert.equal(transcripts[0].result.error, 'http_error');
    assert.equal(transcripts[1].attemptIndex, 1);
    assert.equal(transcripts[1].result.choices[0].message.content, 'ok');
  });

  it('recordTranscript throwing never breaks the model call', async () => {
    const gateway = new ModelGateway({
      getSettings: () => ({ model_profiles: [PROFILE] }),
      getCredential: () => 'sk-test',
      getProvider: () => ({
        chat: async () => ({ choices: [{ finish_reason: 'stop', message: { content: 'fine' } }] }),
      }),
      recordTranscript() { throw new Error('sink exploded'); },
    });
    const result = await gateway.chat({ body: { messages: [{ role: 'user', content: 'x' }] } });
    assert.equal(result.choices[0].message.content, 'fine');
  });
});
