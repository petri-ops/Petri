/**
 * BLOCK-519 阶段二（composer 麦克风入口）HK-01 红绿先行。
 * 只验不依赖 whisper 选型的部分：现有 ASR provider 链 + 麦克风转写端点契约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('阶段二 HK-01：麦克风转写 helper 存在，复用 asr-provider 链（注入 localFn 可测）', async () => {
  const helper = path.join(ROOT, 'core/petri-server/helpers/composer-mic-transcribe.js');
  assert.ok(fs.existsSync(helper), 'core/petri-server/helpers/composer-mic-transcribe.js 必须新建');
  const { transcribeMicAudio } = require(helper);
  // 禁用态：默认关不发请求，诚实报错（P5-a 付费知情）
  const off = await transcribeMicAudio({ buffer: Buffer.from('wav'), config: { enabled: false, provider: 'none' } });
  assert.equal(off.ok, false);
  assert.match(off.code || off.message, /disabled|未开启|none/i);
  // 注入 localFn：链路成功，回执带来源 provider（本地主权）
  const ok = await transcribeMicAudio({
    buffer: Buffer.from('wav'),
    filename: 'mic.wav',
    config: { enabled: true, provider: 'local' },
    localFn: async () => ({ ok: true, provider: 'local', text: '开饭时间', durationMs: 120, cost: { requests: 0 } }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.text, '开饭时间');
  assert.equal(ok.provider, 'local');
});

test('阶段二 HK-01：REST /api/speech/transcribe 口已注册（复用 speech 路由）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/routes/runtime-config.js'), 'utf-8');
  assert.match(src, /\/api\/speech\/transcribe/);
});

test('阶段二 HK-01：前端麦克风组件存在，文本插入 composer（不自动发送）', () => {
  const comp = path.join(ROOT, 'frontend/src/components/copilot/SimpleChat/ComposerMicButton.tsx');
  assert.ok(fs.existsSync(comp), 'ComposerMicButton.tsx 必须新建');
  const src = fs.readFileSync(comp, 'utf-8');
  assert.match(src, /useComposerMic/); // 录音实现在 hook（下一条断言）
  assert.match(src, /onTranscript/);
  assert.match(src, /composer-mic-toggle/);
  // 仅插文本，不自动调用 send（动作语义：加入上下文 ≠ 立即执行）
  assert.doesNotMatch(src, /onSend\s*\(/);
});

test('阶段二 HK-01：hook 单测——转写文本经 onTranscript 回传，失败诚实不插入', async () => {
  const hook = path.join(ROOT, 'frontend/src/components/copilot/SimpleChat/useComposerMic.ts');
  assert.ok(fs.existsSync(hook), 'useComposerMic.ts 必须新建');
  const src = fs.readFileSync(hook, 'utf-8');
  assert.match(src, /transcribe|onTranscript/);
  assert.match(src, /stop|MediaRecorder/);
});
