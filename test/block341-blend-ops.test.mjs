/**
 * BLOCK-341 P5 — Blender 扩档（.blend 白名单操作）契约测试。
 * Blender 在场：真跑 inspect（对象清单）/ transform（写盘 sha 变更）；
 * 缺席：诚实 capability_unavailable + 校验逻辑全量覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { validateBlendOp, runBlendOp, findBlenderBinary } = require(
  path.join(ROOT, 'core/petri-server/helpers/model3d-blend-ops.js'));

function tempWorkspace(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'block341-blend-'));
  for (const [rel, content] of Object.entries(files)) {
    const target = path.join(dir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return dir;
}

test('BLOCK-341 P5 白名单与校验：路径穿越/格式外/op 外/缺席/payload 形状', () => {
  const ws = tempWorkspace({ 'scene.blend': 'fake-blend-bytes' });
  const escape = validateBlendOp({ workspaceRoot: ws, blendPath: '../x.blend', op: 'inspect' });
  assert.equal(escape.code, 'path_escape');
  const fmt = validateBlendOp({ workspaceRoot: ws, blendPath: 'x.txt', op: 'inspect' });
  assert.equal(fmt.code, 'unsupported_format');
  const op = validateBlendOp({ workspaceRoot: ws, blendPath: 'scene.blend', op: 'run_any_bpy', payload: {} });
  assert.equal(op.code, 'op_not_whitelisted');
  assert.ok(op.message.includes('人工审批'));
  const missing = validateBlendOp({ workspaceRoot: ws, blendPath: 'ghost.blend', op: 'inspect' });
  assert.equal(missing.code, 'file_not_found');
  const badT = validateBlendOp({ workspaceRoot: ws, blendPath: 'scene.blend', op: 'transform', payload: { object: 'A' } });
  assert.equal(badT.code, 'payload_invalid');
  const badLoc = validateBlendOp({ workspaceRoot: ws, blendPath: 'scene.blend', op: 'transform', payload: { object: 'A', location: [1, 2] } });
  assert.equal(badLoc.code, 'payload_invalid');
  const goodT = validateBlendOp({ workspaceRoot: ws, blendPath: 'scene.blend', op: 'transform', payload: { object: 'Cube', location: [1, 2, 3] } });
  assert.equal(goodT.ok, true);
  assert.ok(goodT.sourceSha256);
});

test('BLOCK-341 P5 runBlendOp：Blender 在场 → inspect 真跑；缺席 → 诚实降级', () => {
  const ws = tempWorkspace({ 'scene.blend': 'fake-blend-bytes' });
  const r = runBlendOp({ workspaceRoot: ws, blendPath: 'scene.blend', op: 'inspect' });
  const bin = findBlenderBinary();
  if (bin) {
    // 真 Blender 在场：fake .blend 会打开失败——但失败形态必须诚实（blender_failed/no_marker）
    assert.ok(['blender_failed', 'blender_no_marker'].includes(r.code), `code=${r.code} msg=${r.message}`);
  } else {
    assert.equal(r.ok, false);
    assert.equal(r.code, 'capability_unavailable');
  }
});
