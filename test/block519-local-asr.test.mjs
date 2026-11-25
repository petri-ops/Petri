/**
 * BLOCK-519 阶段一 — 本地 ASR（SenseVoice/sherpa-onnx）契约，HK-01 红绿先行。
 *
 * 判据：
 *  1. 模型管理以真实落盘为准（未下载不冒充使用中）；下载原语函数级复用
 *     capability-provisioning 的 download/SHA256，原子移动 + 不挂 ledger。
 *  2. speech-config additive：provider_chain/local_model 白名单收窄，旧数据零行为变化。
 *  3. asr-provider provider 链：local→deepseek，成功带 provider 来源与回退轨迹，
 *     全失败诚实报错；transcribe_audio 自动获得本地 provider（config 透传）。
 *  4. native 依赖单一 wrapper（worker 子进程隔离 DYLD_LIBRARY_PATH），
 *     SenseVoice 原生多语，language:auto 只作配置/回执元数据。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

// speech-tools 在模块加载期触达 better-sqlite3（既有形态）→ 测试前先建隔离库并迁移。
const dbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-db-'));
process.env.PETRI_DB_PATH = path.join(dbDir, 'petri.db');
const { runMigrations } = require(path.join(ROOT, 'src/migration-runner.js'));
await runMigrations(process.env.PETRI_DB_PATH, path.join(ROOT, 'src/migrations'));

const {
  LOCAL_ASR_MODELS,
  listLocalAsrModels,
  downloadLocalAsrModel,
  deleteLocalAsrModel,
  resolveLocalAsrModel,
} = require(path.join(ROOT, 'core/petri-server/helpers/local-asr-model.js'));
const { buildLocalRecognizeConfig, transcribeWithLocalAsr } = require(path.join(ROOT, 'core/petri-server/helpers/local-asr.js'));
const { transcribeAudio } = require(path.join(ROOT, 'core/petri-server/helpers/asr-provider.js'));
const { tool_transcribe_audio } = require(path.join(ROOT, 'core/petri-server/agent-tools/speech-tools.js'));

const MODEL_ID = 'sensevoice-small-int8-2024-07-17';
const WAV = Buffer.concat([Buffer.from('RIFF____WAVE'), Buffer.alloc(16)]);

function fakeExtract(...dirs) {
  return async (_tmpFile, installDir) => {
    fs.mkdirSync(installDir, { recursive: true });
    for (const file of dirs) fs.writeFileSync(path.join(installDir, file), 'fake');
  };
}

test('BLOCK-519 模型目录：真实落盘才算可用（未下载不冒充使用中）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-models-'));
  const descriptor = LOCAL_ASR_MODELS.find((m) => m.id === MODEL_ID);
  assert.ok(descriptor, 'SenseVoice-small int8 应在 catalog 中');

  const empty = listLocalAsrModels({ modelsDir: dir });
  assert.equal(empty.find((m) => m.id === MODEL_ID).installed, false);
  assert.equal(resolveLocalAsrModel(MODEL_ID, { modelsDir: dir }), null);

  let downloads = 0;
  const opts = {
    modelsDir: dir,
    download: async (_url, dest) => { downloads += 1; fs.writeFileSync(dest, 'fake-payload'); return dest; },
    hash: async () => 'abc123def456',
    extract: fakeExtract('model.int8.onnx', 'tokens.txt'),
  };
  const first = await downloadLocalAsrModel(MODEL_ID, opts);
  assert.equal(first.ok, true);
  assert.equal(first.installed, true);
  assert.equal(first.sha256, 'abc123def456');
  assert.equal(downloads, 1);
  const ready = resolveLocalAsrModel(MODEL_ID, { modelsDir: dir });
  assert.ok(fs.existsSync(ready.modelPath));
  assert.ok(fs.existsSync(ready.tokensPath));

  // 幂等：同 sha 已落盘不再下载
  const second = await downloadLocalAsrModel(MODEL_ID, opts);
  assert.equal(second.downloaded, false);
  assert.equal(downloads, 1);

  // manifest 存在但模型文件缺失 → 诚实回落未安装
  fs.unlinkSync(ready.modelPath);
  assert.equal(listLocalAsrModels({ modelsDir: dir }).find((m) => m.id === MODEL_ID).installed, false);

  const removed = deleteLocalAsrModel(MODEL_ID, { modelsDir: dir });
  assert.equal(removed.ok, true);
  assert.equal(listLocalAsrModels({ modelsDir: dir }).find((m) => m.id === MODEL_ID).installed, false);
});

test('BLOCK-519 speech-config additive：provider_chain/local_model 收窄，旧字段不变', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-config-'));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dir;
  try {
    const { saveSpeechConfig, getSnapshot } = require(path.join(ROOT, 'core/petri-server/helpers/speech-config.js'));
    const snap = saveSpeechConfig({
      provider: 'chain',
      provider_chain: ['local', 'deepseek', 'bogus', 'local'],
      local_model: { modelId: MODEL_ID, language: 'auto', bogus: 'drop-me' },
    });
    assert.deepEqual(snap.effective.provider_chain, ['local', 'deepseek']);
    assert.deepEqual(snap.effective.local_model, { modelId: MODEL_ID, language: 'auto' });
    assert.equal(snap.effective.enabled, false, '默认关不回归');
    assert.equal(snap.effective.ttsVoice, 'stella');
    // 非法 provider 仍在共享 schema 边界被拒（白名单不放宽）
    assert.throws(() => saveSpeechConfig({ provider: 'bogus' }), /config_value_rejected/);
    // 旧配置（无新字段）零行为变化：effective 带默认链、stored 不凭空长出链
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-old-'));
    process.env.PETRI_LOCAL_DATA_DIR = oldDir;
    fs.writeFileSync(path.join(oldDir, 'speech-config.json'), JSON.stringify({ enabled: true, provider: 'deepseek' }));
    const old = getSnapshot();
    assert.equal(old.effective.provider, 'deepseek');
    assert.equal(old.stored.provider_chain, undefined);
  } finally {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
  }
});

test('BLOCK-519 provider 链：local 失败→deepseek 成功，回执带来源与回退轨迹', async () => {
  const calls = [];
  const result = await transcribeAudio({
    buffer: WAV,
    filename: 'a.wav',
    config: { enabled: true, provider: 'chain', provider_chain: ['local', 'deepseek'], timeoutMs: 1000 },
    localFn: async () => { calls.push('local'); return { ok: false, code: 'local_asr_unavailable', provider: 'local' }; },
    getApiKeyFn: () => 'test-key',
    fetchImpl: async (_url, init) => {
      calls.push('deepseek');
      assert.ok(init.headers.authorization.includes('test-key'));
      return { ok: true, text: () => Promise.resolve(JSON.stringify({ text: '云转写', duration_ms: 42 })) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.text, '云转写');
  assert.equal(result.provider, 'deepseek');
  assert.deepEqual(result.fallbacks, ['local']);
  assert.deepEqual(calls, ['local', 'deepseek']);
});

test('BLOCK-519 provider 链：local 成功零云调用；全失败诚实报错', async () => {
  const localOk = await transcribeAudio({
    buffer: WAV,
    filename: 'a.wav',
    config: { enabled: true, provider: 'chain', provider_chain: ['local', 'deepseek'] },
    localFn: async () => ({ ok: true, text: '本地转写', durationMs: 7, provider: 'local', cost: { requests: 0, bytes: WAV.length } }),
    fetchImpl: async () => { throw new Error('cloud-should-not-be-called'); },
  });
  assert.equal(localOk.ok, true);
  assert.equal(localOk.provider, 'local');
  assert.deepEqual(localOk.fallbacks, []);
  assert.equal(localOk.cost.requests, 0);

  const allFail = await transcribeAudio({
    buffer: WAV,
    filename: 'a.wav',
    config: { enabled: true, provider: 'chain', provider_chain: ['local', 'deepseek'] },
    localFn: async () => ({ ok: false, code: 'local_asr_unavailable', provider: 'local' }),
    getApiKeyFn: () => 'test-key',
    fetchImpl: async () => ({ ok: false, status: 401, text: () => Promise.resolve('') }),
  });
  assert.equal(allFail.ok, false);
  assert.equal(allFail.attempts.length, 2);
  assert.ok(allFail.message.includes('本地') || allFail.message.includes('转写'));
});

test('BLOCK-519 窄口工具自动获得本地 provider：speechConfig 透传 provider_chain/local_model', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-tool-'));
  fs.writeFileSync(path.join(dir, 'a.wav'), WAV);
  let seen = null;
  const result = await tool_transcribe_audio(
    { filePath: 'a.wav' },
    { projectId: 'p1' },
    {
      resolveWorkspaceFn: () => ({ workspaceRoot: dir, target: path.join(dir, 'a.wav') }),
      speechConfig: { enabled: true, provider: 'chain', provider_chain: ['local', 'deepseek'], local_model: { modelId: MODEL_ID, language: 'auto' } },
      asrFn: async (input) => { seen = input.config; return { ok: true, text: 'ok', durationMs: 1, cost: { requests: 0, bytes: 1 } }; },
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.text, 'ok');
  assert.deepEqual(seen.provider_chain, ['local', 'deepseek']);
  assert.deepEqual(seen.local_model, { modelId: MODEL_ID, language: 'auto' });
});

test('BLOCK-519 REST 面：模型列表/下载/删除三口，错误诚实 400', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-routes-'));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dir;
  try {
    const mountRuntimeConfig = require(path.join(ROOT, 'core/petri-server/routes/runtime-config.js'));
    const routes = {};
    const record = (method) => (route, ...handlers) => { routes[`${method} ${route}`] = handlers[handlers.length - 1]; };
    mountRuntimeConfig({
      get: record('GET'), put: record('PUT'), post: record('POST'), delete: record('DELETE'),
    });
    const makeRes = () => ({
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    });

    const listRes = makeRes();
    routes['GET /api/speech/local-models']({}, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.body.status, 'ok');
    assert.equal(listRes.body.models.find((m) => m.id === MODEL_ID).installed, false);

    const badDownload = makeRes();
    await routes['POST /api/speech/local-models/:id/download']({ params: { id: 'unknown' } }, badDownload);
    assert.equal(badDownload.statusCode, 400);
    assert.equal(badDownload.body.error, 'model_not_found');

    const badDelete = makeRes();
    routes['DELETE /api/speech/local-models/:id']({ params: { id: MODEL_ID } }, badDelete);
    assert.equal(badDelete.statusCode, 400);
    assert.equal(badDelete.body.error, 'not_installed');

    await downloadLocalAsrModel(MODEL_ID, {
      download: async (_url, dest) => fs.writeFileSync(dest, 'x'),
      hash: async () => 'sha',
      extract: fakeExtract('model.int8.onnx', 'tokens.txt'),
    });
    const deleteRes = makeRes();
    routes['DELETE /api/speech/local-models/:id']({ params: { id: MODEL_ID } }, deleteRes);
    assert.equal(deleteRes.statusCode, 200);
    assert.equal(deleteRes.body.removed, true);
  } finally {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
  }
});

test('BLOCK-519 worker 包装：native 配置单源 + DYLD_LIBRARY_PATH 子进程隔离', async () => {
  const modelDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b519-worker-'));
  fs.writeFileSync(path.join(modelDir, 'model.int8.onnx'), 'fake');
  fs.writeFileSync(path.join(modelDir, 'tokens.txt'), 'fake');
  const config = buildLocalRecognizeConfig({ modelDir, language: 'auto' });
  assert.equal(config.modelConfig.senseVoice.model, path.join(modelDir, 'model.int8.onnx'));
  assert.equal(config.modelConfig.senseVoice.useInverseTextNormalization, 1);
  assert.equal(config.modelConfig.tokens, path.join(modelDir, 'tokens.txt'));
  assert.equal(config.modelConfig.provider, 'cpu');
  assert.ok(!('language' in config.modelConfig), 'SenseVoice 原生多语，language:auto 只作元数据不进 native 配置');

  let envSeen = null;
  const result = await transcribeWithLocalAsr({
    buffer: WAV,
    filename: 'a.wav',
    model: { modelId: MODEL_ID, modelDir },
    language: 'auto',
    spawnFn: (_cmd, _args, options) => {
      envSeen = options.env;
      return { status: 0, stdout: JSON.stringify({ ok: true, text: '本地转写', durationMs: 11 }) };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.provider, 'local');
  assert.equal(result.modelId, MODEL_ID);
  assert.equal(result.language, 'auto');
  assert.equal(result.cost.requests, 0);
  assert.ok(envSeen.DYLD_LIBRARY_PATH, 'native lib 搜索路径只在 worker 子进程设置');
});
