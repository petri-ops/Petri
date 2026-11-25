/**
 * BLOCK-519 阶段二 whisper 并列 —— HK-01 红绿先行契约。
 * owner 裁决 msg_0077c4847060：@fugood/whisper.node@1.0.13（第2新依赖，精确钉扎）。
 * 红线：回退链零变化（sensevoice 默认路径逐字保留）、未落盘不冒充可用、worker 隔离。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('whisper HK-01：依赖精确钉扎 1.0.13（无 ^/rc）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8'));
  assert.equal(pkg.dependencies['@fugood/whisper.node'], '1.0.13');
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf-8'));
  assert.ok(lock.packages['node_modules/@fugood/whisper.node'], 'package-lock 须含 whisper.node');
});

test('whisper HK-01：独立模型管理模块 catalog（small/turbo-q5_0，单 .bin，官方 SHA）', () => {
  const f = path.join(ROOT, 'core/petri-server/helpers/whisper-model.js');
  assert.ok(fs.existsSync(f), 'whisper-model.js 必须新建（不动 SenseVoice 路径）');
  const m = require(f);
  assert.ok(Array.isArray(m.WHISPER_MODELS) && m.WHISPER_MODELS.length >= 2);
  const small = m.WHISPER_MODELS.find((x) => x.id === 'whisper-small');
  const turbo = m.WHISPER_MODELS.find((x) => x.id === 'whisper-large-v3-turbo-q5_0');
  assert.ok(small && turbo);
  assert.equal(small.sha256, '55356645c2b361a969dfd0ef2c5a50d530afd8d5');
  assert.equal(turbo.sha256, 'e050f7970618a659205450ad97eb95a18d69c9ee');
  assert.match(small.url, /huggingface\.co\/ggerganov\/whisper\.cpp/);
  // 未落盘不冒充可用
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'petri-w-model-'));
  const list = m.listWhisperModels({ modelsDir: dir });
  assert.ok(list.every((x) => x.installed === false));
  assert.equal(m.resolveWhisperModel('whisper-small', { modelsDir: dir }), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('whisper HK-01：本地 ASR 链按 engine 分派，默认 sensevoice 零变化', async () => {
  const f = path.join(ROOT, 'core/petri-server/helpers/local-asr.js');
  const src = fs.readFileSync(f, 'utf-8');
  assert.match(src, /whisper/i, 'local-asr 须识别 whisper engine 分派');
  assert.match(src, /engine/, '须按 engine 分派');
});

test('whisper HK-01：worker 隔离 + native addon 懒加载（不污染 owner 进程）', () => {
  const w = path.join(ROOT, 'core/petri-server/helpers/whisper-asr.js');
  assert.ok(fs.existsSync(w), 'whisper-asr.js 必须新建');
  const src = fs.readFileSync(w, 'utf-8');
  assert.match(src, /spawnSync|spawn\(/, '须子进程隔离');
  assert.match(src, /@fugood\/whisper\.node/, 'worker 内懒加载 native addon');
  const worker = path.join(ROOT, 'core/petri-server/helpers/whisper-asr-worker.js');
  assert.ok(fs.existsSync(worker), 'whisper-asr-worker.js 必须新建');
});

test('whisper HK-01：asr-provider 回退链零变化（PROVIDERS 与 local 默认不变）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/asr-provider.js'), 'utf-8');
  assert.match(src, /const PROVIDERS = \['local', 'deepseek'\]/);
  assert.match(src, /DEFAULT_LOCAL_MODEL_ID/); // 默认 SenseVoice 不变
});

test('whisper HK-01：worker 传 filePath 双键（1.0.13 native 实读字段）+ 解包 transcribeFile.promise', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/helpers/whisper-asr-worker.js'), 'utf-8');
  // README 写 { model }，native WhisperContext.cpp:369 实读 filePath —— 实测抓真后双键兼容
  assert.match(src, /filePath:\s*model/);
  assert.match(src, /call\.promise|typeof call\.promise/);
  assert.match(src, /initWhisper/);
});
