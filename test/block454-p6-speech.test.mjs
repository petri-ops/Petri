/**
 * BLOCK-454 P6 — ASR/TTS 语音窄口 + DeepSeek adapter + agent 工具消费面。
 *
 * 用户裁决 2026-11-17「剩下没做的一次性搞完」= P6 需求场景裁决到位，正式启动（覆盖 D7 暂缓）。
 * 场景（plan P6 原文）：语音输入（ASR）→ agent 听音频转写；朗读回复（TTS）→ agent 产出音频产物。
 *
 * 契约源（findings §2，VERIFIED）：
 *   ASR：POST https://api.deepseek.com/v1/tools/asr，multipart/form-data，Bearer；
 *        file（16bit PCM WAV 或 Ogg Opus）；≤8MiB/120 秒；19 种语言自动识别；
 *        响应 {text, duration_ms}；50 并发。
 *   TTS：POST https://api.deepseek.com/v1/tools/tts（整段）/ wss://（流式，本期不接）；
 *        Bearer；JSON {text ≤10000 计费字符, voice_id: stella 女|tide 男, format: wav|pcm,
 *        filter_markdown}；10 种语言自动识别；响应=音频二进制。
 *
 * 窄口契约（工具语义，不进 registerProvider capabilities；沿用 OCR 窄口 P3 同款纪律）：
 *   默认关（云调用=付费副作用 P5-a）· key 走凭据族 · 诚实失败（格式/长度/白名单/HTTP）
 *   · 成本计量（cost.requests/bytes/chars）· WS 流式留接口不实现（留痕）。
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

// ---------- A) ASR 窄口契约 ----------

const { transcribeAudio, ASR_ENDPOINT, ASR_MAX_UPLOAD_BYTES } = require('../core/petri-server/helpers/asr-provider.js');
const { synthesizeSpeech, TTS_ENDPOINT, TTS_VOICES, TTS_FORMATS, TTS_MAX_TEXT_CHARS } = require('../core/petri-server/helpers/tts-provider.js');

const ENABLED = { enabled: true, provider: 'deepseek', timeoutMs: 30000 };

function mockFetch(responder) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    return responder(calls.length, { url, init });
  };
  impl.calls = calls;
  return impl;
}

/** 16bit PCM WAV 最小头（RIFF/WAVE 魔数 + 44 字节标准头，测试用假数据足够过格式守卫）。 */
function minimalWav() {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(0, 40);
  return header;
}

function minimalOgg() {
  return Buffer.concat([Buffer.from('OggS', 'utf8'), Buffer.alloc(28)]);
}

test('P6-A0 — 常量契约：端点/8MiB 上限/TTS 声音与格式白名单/10000 计费字符', () => {
  assert.equal(ASR_ENDPOINT, 'https://api.deepseek.com/v1/tools/asr');
  assert.equal(ASR_MAX_UPLOAD_BYTES, 8 * 1024 * 1024, 'findings：≤8MiB/120 秒');
  assert.equal(TTS_ENDPOINT, 'https://api.deepseek.com/v1/tools/tts');
  assert.deepEqual([...TTS_VOICES].sort(), ['stella', 'tide']);
  assert.deepEqual([...TTS_FORMATS].sort(), ['pcm', 'wav']);
  assert.equal(TTS_MAX_TEXT_CHARS, 10000);
});

test('P6-A1 — 默认关/未选渠道/无 key 诚实报且不发请求（P5-a 付费知情 + P3-b 失败诚实）', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const disabled = await transcribeAudio({
    buffer: minimalWav(), filename: 'note.wav',
    config: { ...ENABLED, enabled: false }, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(disabled.ok, false);
  assert.equal(disabled.code, 'asr_access_disabled');
  const none = await transcribeAudio({
    buffer: minimalWav(), filename: 'note.wav',
    config: { ...ENABLED, provider: 'none' }, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(none.code, 'asr_not_configured');
  const noKey = await transcribeAudio({
    buffer: minimalWav(), filename: 'note.wav',
    config: ENABLED, fetchImpl, getApiKeyFn: () => '',
  });
  assert.equal(noKey.code, 'asr_not_configured');
  assert.ok(noKey.message.includes('DeepSeek'), noKey.message);
  assert.equal(fetchImpl.calls.length, 0);
});

test('P6-A2 — 格式守卫：仅 16bit PCM WAV 与 Ogg Opus（魔数判定），其他 → asr_format_unsupported', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const mp3 = await transcribeAudio({
    buffer: Buffer.from('ID3 fake mp3 data'), filename: 'song.mp3',
    config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk',
  });
  assert.equal(mp3.ok, false);
  assert.equal(mp3.code, 'asr_format_unsupported');
  assert.ok(mp3.message.includes('WAV'), `指路文案须含支持格式: ${mp3.message}`);
  // WAV 与 Ogg 通过守卫并发出请求
  const okFetch = mockFetch(() => ({ ok: true, status: 200, text: async () => JSON.stringify({ text: '你好', duration_ms: 1200 }) }));
  const wav = await transcribeAudio({ buffer: minimalWav(), filename: 'a.wav', config: ENABLED, fetchImpl: okFetch, getApiKeyFn: () => 'sk' });
  assert.equal(wav.ok, true, JSON.stringify(wav));
  const ogg = await transcribeAudio({ buffer: minimalOgg(), filename: 'a.ogg', config: ENABLED, fetchImpl: okFetch, getApiKeyFn: () => 'sk' });
  assert.equal(ogg.ok, true);
  assert.equal(okFetch.calls.length, 2);
});

test('P6-A3 — 请求形态：POST 官方端点 + Bearer + multipart(file)；响应归一 text/durationMs + 成本计量', async () => {
  const fetchImpl = mockFetch(() => ({
    ok: true, status: 200,
    text: async () => JSON.stringify({ text: '这是一段测试语音', duration_ms: 2100 }),
  }));
  const buffer = minimalWav();
  const r = await transcribeAudio({ buffer, filename: 'memo.wav', config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk-test' });
  assert.equal(r.ok, true, JSON.stringify(r));
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, ASR_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer sk-test');
  const form = init.body;
  assert.ok(typeof form.get === 'function', 'body 必须是 FormData');
  assert.equal(form.get('file').size, buffer.length);
  assert.equal(r.text, '这是一段测试语音');
  assert.equal(r.durationMs, 2100);
  assert.equal(r.cost.requests, 1);
  assert.equal(r.cost.bytes, buffer.length);
});

test('P6-A4 — 8MiB 上限 → asr_too_large；401 → 不可重试 http_error；非 JSON → asr_bad_response', async () => {
  const tooBig = await transcribeAudio({
    buffer: minimalWav(), filename: 'big.wav', config: ENABLED,
    fetchImpl: mockFetch(() => { throw new Error('不应发起请求'); }), getApiKeyFn: () => 'sk',
    maxUploadBytes: 4,
  });
  assert.equal(tooBig.code, 'asr_too_large');
  const unauth = await transcribeAudio({
    buffer: minimalWav(), filename: 'a.wav', config: ENABLED,
    fetchImpl: mockFetch(() => ({ ok: false, status: 401, text: async () => '{}' })), getApiKeyFn: () => 'sk-bad',
  });
  assert.equal(unauth.code, 'asr_http_error');
  assert.equal(unauth.status, 401);
  assert.equal(unauth.retryable, false);
  const bad = await transcribeAudio({
    buffer: minimalWav(), filename: 'a.wav', config: ENABLED,
    fetchImpl: mockFetch(() => ({ ok: true, status: 200, text: async () => 'not-json' })), getApiKeyFn: () => 'sk',
  });
  assert.equal(bad.code, 'asr_bad_response');
});

// ---------- B) TTS 窄口契约 ----------

test('P6-B1 — 请求形态：JSON {text,voice_id,format,filter_markdown} + 响应二进制归一 + 成本计量', async () => {
  const wavBytes = Buffer.from('RIFFfake-audio-bytes');
  const fetchImpl = mockFetch(() => ({
    ok: true, status: 200,
    arrayBuffer: async () => wavBytes.buffer.slice(wavBytes.byteOffset, wavBytes.byteOffset + wavBytes.length),
  }));
  const r = await synthesizeSpeech({
    text: '你好，这是朗读测试。', voiceId: 'tide', format: 'wav',
    config: { ...ENABLED, filterMarkdown: true }, fetchImpl, getApiKeyFn: () => 'sk-tts',
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  const { url, init } = fetchImpl.calls[0];
  assert.equal(url, TTS_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.authorization, 'Bearer sk-tts');
  const body = JSON.parse(init.body);
  assert.deepEqual(body, { text: '你好，这是朗读测试。', voice_id: 'tide', format: 'wav', filter_markdown: true });
  assert.ok(Buffer.isBuffer(r.audio), '音频必须以 Buffer 返回');
  assert.equal(r.audio.length, wavBytes.length);
  assert.equal(r.voiceId, 'tide');
  assert.equal(r.format, 'wav');
  assert.equal(r.cost.requests, 1);
  assert.equal(r.cost.chars, '你好，这是朗读测试。'.length);
  assert.equal(r.cost.bytes, wavBytes.length);
});

test('P6-B2 — 诚实拒绝：voice/format 白名单外、text 空缺、超 10000 计费字符（均不发请求）', async () => {
  const fetchImpl = mockFetch(() => { throw new Error('不应发起请求'); });
  const badVoice = await synthesizeSpeech({ text: 'x', voiceId: 'morgan', config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk' });
  assert.equal(badVoice.code, 'tts_voice_invalid');
  const badFormat = await synthesizeSpeech({ text: 'x', voiceId: 'stella', format: 'mp3', config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk' });
  assert.equal(badFormat.code, 'tts_format_invalid');
  const noText = await synthesizeSpeech({ text: '   ', config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk' });
  assert.equal(noText.code, 'tts_text_missing');
  const tooLong = await synthesizeSpeech({ text: '长'.repeat(10001), config: ENABLED, fetchImpl, getApiKeyFn: () => 'sk' });
  assert.equal(tooLong.code, 'tts_text_too_long');
  assert.ok(tooLong.message.includes('10000'), tooLong.message);
  assert.equal(fetchImpl.calls.length, 0);
  const disabled = await synthesizeSpeech({ text: 'x', config: { ...ENABLED, enabled: false }, fetchImpl, getApiKeyFn: () => 'sk' });
  assert.equal(disabled.code, 'speech_access_disabled');
});

// ---------- C) speech config 族（治理面） ----------

const { CONFIG_FAMILIES } = require('../core/packages/shared-config/config-schema.js');

test('P6-C1 — config 族 speech 注册：默认关 + 五键 + 守卫拒绝非法 voice/format/provider', async () => {
  assert.ok(CONFIG_FAMILIES.speech, 'speech 族必须在注册表');
  assert.equal(CONFIG_FAMILIES.speech.store, 'file:speech-config.json');
  const { saveSpeechConfig, getEffectiveConfig } = require('../core/petri-server/helpers/speech-config.js');
  const defaults = getEffectiveConfig();
  assert.equal(defaults.enabled, false, '默认关（P5-a）');
  assert.equal(defaults.provider, 'none');
  assert.equal(defaults.ttsVoice, 'stella');
  assert.equal(defaults.ttsFormat, 'wav');
  assert.throws(() => saveSpeechConfig({ provider: 'openai' }), /config_value_rejected/);
  assert.throws(() => saveSpeechConfig({ ttsVoice: 'morgan' }), /config_value_rejected/);
  assert.throws(() => saveSpeechConfig({ ttsFormat: 'opus' }), /config_value_rejected/);
});

// ---------- D) agent 工具消费面（DB boot） ----------

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block454-p6-'));
process.env.PETRI_DB_PATH = path.join(tempRoot, 'petri.db');
process.env.PETRI_LOCAL_DATA_DIR = tempRoot;
process.on('exit', () => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
});
process.env.PETRI_BETTER_SQLITE3_ROOT = resolve(__dirname, '..', 'core', 'petri-server');
const { runMigrations } = require('../src/migration-runner.js');
await runMigrations(process.env.PETRI_DB_PATH, resolve(__dirname, '..', 'src', 'migrations'));
const db = require('../core/petri-server/db.js').getDatabase();
const { tool_transcribe_audio, tool_speak_text } = require('../core/petri-server/agent-tools/speech-tools.js');

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-p6-workspace-'));
db.prepare(
  "INSERT INTO projects (id, name, status, created_at, updated_at, workspace_path) VALUES ('p_speech', 'P6 语音夹具', 'active', ?, ?, ?)"
).run(new Date().toISOString(), new Date().toISOString(), workspace);
const CTX = { projectId: 'p_speech', userId: 'local-user' };

test('P6-D0 — 工具注册：transcribe_audio / speak_text 在 registry 与 tool-defs 双面在场', () => {
  const registry = require('../core/petri-server/agent-tools/registry.js');
  assert.equal(typeof registry.getToolHandler('transcribe_audio'), 'function', 'registry 必须有 transcribe_audio handler');
  assert.equal(typeof registry.getToolHandler('speak_text'), 'function', 'registry 必须有 speak_text handler');
  const tEntry = registry.getToolEntry('transcribe_audio');
  assert.ok(tEntry && tEntry.contract, 'transcribe_audio 必须带契约（出网=external-request）');
  const defs = require('../core/petri-server/agent-tools/tool-defs.js');
  const names = defs.TOOL_DEFS.map((d) => d.function.name);
  assert.ok(names.includes('transcribe_audio'), 'tool-defs 必须含 transcribe_audio');
  assert.ok(names.includes('speak_text'), 'tool-defs 必须含 speak_text');
});

test('P6-D1 — tool_transcribe_audio：工作区 wav → ASR（mock）→ text 返回 + 成本入账', async () => {
  fs.writeFileSync(path.join(workspace, 'memo.wav'), minimalWav());
  const asrCalls = [];
  const r = await tool_transcribe_audio(
    { filePath: 'memo.wav' },
    CTX,
    { asrFn: async (args) => { asrCalls.push(args); return { ok: true, provider: 'deepseek', text: '转写出的文本内容', durationMs: 1500, cost: { requests: 1, bytes: 44 } }; } },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.text, '转写出的文本内容');
  assert.equal(r.durationMs, 1500);
  assert.equal(asrCalls.length, 1);
  assert.ok(Buffer.isBuffer(asrCalls[0].buffer), '读取的是工作区音频 buffer');
  // 路径穿越拒绝
  const escape = await tool_transcribe_audio({ filePath: '../outside.wav' }, CTX, { asrFn: async () => ({ ok: true, text: 'x' }) });
  assert.equal(escape.ok, false);
  assert.equal(escape.code, 'workspace_path_invalid');
  // 文件缺失
  const missing = await tool_transcribe_audio({ filePath: 'nope.wav' }, CTX, { asrFn: async () => ({ ok: true, text: 'x' }) });
  assert.equal(missing.code, 'file_not_found');
});

test('P6-D2 — tool_speak_text：TTS（mock）→ 音频落盘 .petri/audio/<sha256>.wav + 幂等同路径', async () => {
  const wavBytes = Buffer.from('RIFFspeech-out');
  const r = await tool_speak_text(
    { text: '这是要朗读的一段回复。', voiceId: 'stella' },
    CTX,
    { ttsFn: async () => ({ ok: true, provider: 'deepseek', audio: wavBytes, format: 'wav', voiceId: 'stella', cost: { requests: 1, chars: 12, bytes: wavBytes.length } }) },
  );
  assert.equal(r.ok, true, JSON.stringify(r));
  const audioAbs = path.join(workspace, r.filePath);
  assert.ok(audioAbs.startsWith(path.join(workspace, '.petri', 'audio')), `产物必须落 .petri/audio: ${r.filePath}`);
  assert.ok(fs.existsSync(audioAbs));
  assert.equal(fs.readFileSync(audioAbs).length, wavBytes.length);
  // 幂等：同文本同声音 → 同一 sha256 路径
  const r2 = await tool_speak_text(
    { text: '这是要朗读的一段回复。', voiceId: 'stella' },
    CTX,
    { ttsFn: async () => ({ ok: true, audio: wavBytes, format: 'wav', voiceId: 'stella', cost: { requests: 1, chars: 12, bytes: wavBytes.length } }) },
  );
  assert.equal(r2.filePath, r.filePath, '同文本同声音幂等（X3）');
  // 空文本诚实拒
  const noText = await tool_speak_text({ text: '' }, CTX, { ttsFn: async () => ({ ok: true, audio: wavBytes, format: 'wav' }) });
  assert.equal(noText.ok, false);
});
