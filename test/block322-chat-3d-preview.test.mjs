/**
 * BLOCK-322 产品洞察 — 聊天内嵌 3D 预览卡（红绿先行）。
 *
 * 产品原则（用户洞察 2026-10-30）：聊天时间线是一等交互面——agent 产出的富内容
 * 应在聊天内直接可交互，而非引导到结果面板。
 *
 * 第一片：model3d_export 完成后，工具活动行下展开内嵌 3D 预览（Model3DScene 复用）。
 * 数据：GLB 路径来自工具结果 outputs，经 /api/files/ 路由读取。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('P3-03 v2b 聊天 3D 预览卡 — 组件文件与依赖在库', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(import.meta.url.replace(/^file:\/\//, ''), '../..');
  const componentPath = path.join(root, 'frontend/src/components/copilot/SimpleChat/ChatTool3DPreview.tsx');
  assert.ok(fs.existsSync(componentPath), `组件文件必须在库：${componentPath}`);
  const content = fs.readFileSync(componentPath, 'utf8');
  assert.ok(content.includes('Model3DScene'), '必须复用 Model3DScene（不建第二渲染器）');
  assert.ok(content.includes('data-testid="chat-tool-3d-preview"'), '必须有 testid');
});

test('P3-03 v2b 聊天 3D 预览卡 — ToolsSegment 渲染接线在库', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(import.meta.url.replace(/^file:\/\//, ''), '../..');
  const listPath = path.join(root, 'frontend/src/components/copilot/ToolActivityList.tsx');
  const content = fs.readFileSync(listPath, 'utf8');
  assert.ok(content.includes('ChatTool3DPreview') || content.includes('ChatTool3D'),
    'ToolActivityList 必须接 3D 预览卡');
});
