'use strict';

/**
 * BLOCK-132（G0-PLATFORM PL-6）— token 出 URL 契约。
 *
 * 事实核查修正修法：'desktop-local' 是前端硬编码常量（authClient.getToken），
 * 后端 authMiddleware 无条件放行（桌面单用户 admin；真边界=回环绑定+Host
 * 白名单 server.js）——URL query 里的 token 不提供任何鉴权价值，纯属
 * 日志/引用/历史污染（评估 D7 标记的红线按「移除冗余」收口而非换签名）。
 * files.js 的 DRAG_OUT_TOKEN 是 Origin 白名单兜底（有真实判定语义）不在本刀。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('result artifact URLs no longer append a token query parameter', () => {
  const client = read('frontend/src/components/result-studio/resultStudioClient.ts');
  assert.ok(!/revisionArtifactUrl[\s\S]{0,400}\?token=/.test(client),
    'revisionArtifactUrl must not append ?token=');
  const shell = read('frontend/src/components/workspace-panels/ResultArtifactShell.tsx');
  assert.ok(!/tokenQs|buildUrl[\s\S]{0,300}\?token=/.test(shell),
    'ResultArtifactShell buildUrl must not append ?token=');
});

test('SSE stream URLs no longer carry the token constant', () => {
  const stream = read('frontend/src/components/copilot/copilotClient/agentTaskStream.ts');
  assert.ok(!/[?&]token=/.test(stream), 'agent task stream URL must not carry ?token=');
});

// BLOCK-150 ⑥ — /m 移动页任务 SSE 对齐主链（BLOCK-132 拔除主链四处时漏了移动页）：
// public/index.html 曾以 EventSource('?afterSeq=0&session=' + token) 把会话 token
// 放 URL——日志/引用/历史污染面与主链同款。修法对齐主链 = fetch + Authorization
// Bearer 头（EventSource 无法携带自定义头，fetch 流可）。
test('mobile /m page task stream must not put the session token in the URL', () => {
  const mobilePage = read('core/petri-server/mobile-gateway/public/index.html');
  assert.ok(!/[?&]session=/.test(mobilePage),
    '/m 页事件流 URL 不得携带 ?session=（token 出 URL，对齐 BLOCK-132 主链方案）');
  // 对齐主链形态：fetch 流 + Bearer 头在位（不是简单删参导致认证失联）
  assert.ok(/Authorization['"]?\s*[:=]/.test(mobilePage) || /Bearer/.test(mobilePage),
    '/m 页事件流必须改走 Authorization 头认证');
});

test('files.js drag-out Origin fallback (real semantics) stays untouched', () => {
  const files = read('core/petri-server/routes/files.js');
  assert.ok(files.includes('DRAG_OUT_TOKEN'), 'drag-out Origin fallback retained (has real check semantics)');
});
