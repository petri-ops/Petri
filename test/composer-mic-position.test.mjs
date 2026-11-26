/**
 * 试用反馈⑨（owner msg_91d38f2e2664）：composer 麦克风按钮图标修正（play→mic）
 * + 与速记板（ScratchpadDock）位置对换。HK-01 静态契约。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const mic = read('frontend/src/components/copilot/SimpleChat/ComposerMicButton.tsx');
const chat = read('frontend/src/components/copilot/SimpleChat.tsx');

test('HK-01-1：空闲态麦克风图标为 mic（不再是 play 三角）', () => {
  assert.match(mic, /mic\.recording \? 'square' : 'mic'/);
  assert.doesNotMatch(mic, /'square' : 'play'/);
});

test('HK-01-2：录音中仍为 square 停止图标（状态语义不变）', () => {
  assert.match(mic, /mic\.recording \? 'square'/);
});

test('HK-01-3：速记板（ScratchpadDock）在 JSX 中位于麦克风之前（位置对换）', () => {
  const scratch = chat.indexOf('<ScratchpadDock');
  const micBtn = chat.indexOf('<ComposerMicButton');
  assert.ok(scratch > -1 && micBtn > -1, '两个按钮都应挂载');
  assert.ok(scratch < micBtn, `速记板(${scratch}) 应在麦克风(${micBtn}) 之前`);
});

test('HK-01-4：两套按钮的语义（onTranscript/onQuote）保持、未误删', () => {
  assert.match(chat, /<ComposerMicButton[\s\S]{0,200}onTranscript/);
  assert.match(chat, /<ScratchpadDock onQuote=/);
});
