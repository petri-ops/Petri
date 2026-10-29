'use strict';

/**
 * BLOCK-321b / UI-628 — 发送/停止单钮态机（composer 右下角同一位置）。
 *
 * 状态矩阵（用户裁决 2026-10-29）：
 *   空闲           → 发送（空输入禁用）
 *   流式中+空输入   → 停止生成（单钮形态：发送钮不在场）
 *   流式中+有新输入 → 发送（BLOCK-316 排队语义；Ctrl/Alt+Enter 直接插话）
 *
 * 语义源：useChatStream（stop/submitComposer steer）——本契约只钉渲染层形态，
 * 静态断言先例=block59 适配器契约 / block130 队列契约。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = fs.readFileSync(path.join(ROOT, 'frontend/src/components/copilot/SimpleChat.tsx'), 'utf8');

test('UI-628 发送/停止不并存：Stop 渲染条件含「流式中且输入为空」（单钮形态）', () => {
  // 旧形态：{streaming && (<button ... data-testid="chat-stop">)}——Stop 与 Send 并存。
  // 新形态：Stop 分支必须带空输入条件，二者互斥同位。
  assert.match(
    SRC,
    /\{streaming && !input\.trim\(\) \? \(/,
    'Stop 渲染必须是三元单钮形态：streaming && !input.trim()',
  );
  assert.ok(!/\{streaming && \(\s*\n\s*<button[^]*?chat-stop/.test(SRC), '旧并存形态必须退场');
});

test('UI-628 Stop 钮保留语义锚：chat-stop testid / onClick={stop} / 停止生成 aria', () => {
  assert.ok(SRC.includes('data-testid="chat-stop"'), 'chat-stop testid 保留（探针与测试锚）');
  assert.ok(/onClick=\{stop\}/.test(SRC), 'Stop 点击直连 hook stop（后端级联取消）');
  assert.ok(SRC.includes('aria-label="停止生成"'), '停止生成 aria-label 保留');
});

test('UI-628 流式中发送排队语义不回退：BLOCK-316 title/steer 保留', () => {
  assert.ok(SRC.includes('加入消息排队'), '流式中发送的排队 title 保留（BLOCK-316）');
  assert.ok(SRC.includes('steer: e.ctrlKey || e.altKey'), 'Ctrl/Alt+Enter 直接插话保留（BLOCK-316）');
});
