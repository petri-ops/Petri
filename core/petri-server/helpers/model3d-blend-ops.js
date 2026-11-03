'use strict';

/**
 * helpers/model3d-blend-ops.js — BLOCK-341 P5 对现有 .blend 工程的白名单受治理操作。
 *
 * 边界（plan P5 + 用户裁决 2026-11-03「按 plan 预答执行」）：
 *   - .blend 视为**外部资产**：provenance（源 sha256 / Blender 版本 / 操作清单）入 manifest，
 *     不产生第二场景真值（与 BLOCK-322 SceneSpec 单真值正交——SceneSpec 管受控构建，
 *     本模块管现有工程的只读检查 + 白名单变换）；
 *   - 经 Blender CLI（--python-expr 受限表达式 / --python 固定脚本）执行，**不开放任意 bpy**；
 *   - 白名单：inspect（对象清单/统计，只读）/ transform（对象平移旋转缩放）/ render（指定相机出图）。
 *   - import/export 已由 blender_scene.py 的 import_mesh_reference / export_formats 覆盖，不重复。
 *
 * 引擎缺席诚实降级（findBlenderBinary 复用 BLOCK-322 探测）。
 */

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ALLOWED_OPS = new Set(['inspect', 'transform', 'render']);
const BLENDEXT_RE = /\.(blend|blend1)$/i;

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function findBlenderBinary() {
  const candidates = [];
  if (process.env.PETRI_BLENDER_BIN) candidates.push(process.env.PETRI_BLENDER_BIN);
  candidates.push(process.platform === 'win32' ? 'blender.exe' : 'blender');
  if (process.platform === 'darwin') {
    candidates.push('/Applications/Blender.app/Contents/MacOS/Blender');
  }
  for (const candidate of candidates) {
    try {
      if (candidate.includes(path.sep)) {
        if (fs.existsSync(candidate)) return candidate;
        continue;
      }
      const resolved = execFileSync(
        process.platform === 'win32' ? 'where' : 'which',
        [candidate],
        { encoding: 'utf8', timeout: 5000 },
      ).split(/\r?\n/).map((l) => l.trim()).find(Boolean);
      if (resolved && fs.existsSync(resolved)) return resolved;
    } catch { /* try next */ }
  }
  return null;
}

/** 白名单操作校验（propose 侧；transform 的 payload 形状在此钉死）。 */
function validateBlendOp({ workspaceRoot, blendPath, op, payload }) {
  const rel = String(blendPath || '');
  const resolved = path.resolve(workspaceRoot, rel);
  if (!resolved.startsWith(path.resolve(workspaceRoot) + path.sep)) {
    return { ok: false, code: 'path_escape', message: '文件路径必须在工作区内' };
  }
  if (!BLENDEXT_RE.test(resolved)) {
    return { ok: false, code: 'unsupported_format', message: '仅支持 .blend / .blend1' };
  }
  if (!ALLOWED_OPS.has(String(op))) {
    return { ok: false, code: 'op_not_whitelisted', message: `操作「${op}」不在白名单（inspect / transform / render）——须走人工审批` };
  }
  if (!fs.existsSync(resolved)) {
    return { ok: false, code: 'file_not_found', message: `.blend 不存在: ${blendPath}` };
  }
  if (op === 'transform') {
    if (!payload || !payload.object) {
      return { ok: false, code: 'payload_invalid', message: 'transform 需要 payload.object（对象名）' };
    }
    const { location, rotation, scale } = payload;
    if (!location && !rotation && !scale) {
      return { ok: false, code: 'payload_invalid', message: 'transform 至少需要 location / rotation / scale 之一（各为 [x,y,z] 数组）' };
    }
    for (const [key, arr] of Object.entries({ location, rotation, scale })) {
      if (arr !== undefined && (!Array.isArray(arr) || arr.length !== 3 || arr.some((v) => typeof v !== 'number'))) {
        return { ok: false, code: 'payload_invalid', message: `${key} 须为 [x,y,z] 数字数组` };
      }
    }
  }
  if (op === 'render' && (!payload || !payload.outputPath)) {
    return { ok: false, code: 'payload_invalid', message: 'render 需要 payload.outputPath（workspace 相对，png）' };
  }
  return { ok: true, blendPath: rel, op, payload: payload || {}, sourceSha256: sha256(fs.readFileSync(resolved)) };
}

/** 生成受限 --python-expr 表达式（逐字白名单拼装；值经 JSON 序列化转义）。 */
function buildExpr(op, payload, workspaceRoot) {
  const obj = JSON.stringify(String(payload.object));
  if (op === 'inspect') {
    return [
      'import bpy, json',
      'objs = [{"name": o.name, "type": o.type, "verts": len(o.data.vertices) if hasattr(o.data, "vertices") else 0} for o in bpy.data.objects]',
      'print("B341_INSPECT " + json.dumps({"objects": objs, "count": len(objs)}))',
    ].join('\n');
  }
  if (op === 'transform') {
    const lines = [
      'import bpy, json, math',
      `obj = bpy.data.objects.get(${obj})`,
      'assert obj is not None, "b341_object_not_found"',
    ];
    if (payload.location) lines.push(`obj.location = (${payload.location.join(', ')})`);
    if (payload.rotation) lines.push(`obj.rotation_euler = (math.radians(${payload.rotation[0]}), math.radians(${payload.rotation[1]}), math.radians(${payload.rotation[2]}))`);
    if (payload.scale) lines.push(`obj.scale = (${payload.scale.join(', ')})`);
    // 实机抓真：--python-expr 不会自动保存 .blend——不显式 save 则改动丢失（语义检查 location 仍为旧值）
    lines.push('bpy.ops.wm.save_mainfile()');
    lines.push('print("B341_TRANSFORM_DONE")');
    return lines.join('\n');
  }
  // render：指定输出 png + 渲染一帧（outputPath 为 workspace 相对 → 转绝对传 Blender；
  // Blender 以 .blend 所在目录为 CWD，相对路径会写错位置）
  const out = JSON.stringify(path.resolve(workspaceRoot, String(payload.outputPath)));
  return [
    'import bpy',
    `bpy.context.scene.render.filepath = ${out}`,
    'bpy.ops.render.render(write_still=True)',
    'print("B341_RENDER_DONE")',
  ].join('\n');
}

/**
 * 执行白名单 .blend 操作（真 Blender CLI --background --python-expr）。
 * transform 会写盘（保存到原文件，源 sha256 变更如实返回）；inspect/render 只读或产新文件。
 */
function runBlendOp({ workspaceRoot, blendPath, op, payload }) {
  const proposal = validateBlendOp({ workspaceRoot, blendPath, op, payload });
  if (!proposal.ok) return proposal;
  const bin = findBlenderBinary();
  if (!bin) {
    return { ok: false, code: 'capability_unavailable', message: 'Blender 未安装或不在常见路径（PETRI_BLENDER_BIN 可显式指定）——诚实不可用' };
  }
  const resolved = path.resolve(workspaceRoot, blendPath);
  const beforeSha = proposal.sourceSha256;
  let version = '';
  try {
    version = String(execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 })).split('\n')[0].trim();
  } catch { /* version best-effort */ }

  const expr = buildExpr(op, proposal.payload, workspaceRoot);
  let stdout = '';
  let failed = null;
  try {
    stdout = execFileSync(bin, ['--background', resolved, '--python-expr', expr], { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  } catch (error) {
    failed = String((error && error.message) || error).slice(0, 300);
  }

  const marked = /B341_INSPECT|B341_TRANSFORM_DONE|B341_RENDER_DONE/.test(stdout);
  if (failed && !marked) {
    return { ok: false, code: 'blender_failed', message: failed, stdoutTail: stdout.slice(-300) };
  }
  if (!marked) {
    return { ok: false, code: 'blender_no_marker', message: 'Blender 执行完成但未输出操作标记（可能断言失败，如对象不存在）', stdoutTail: stdout.slice(-400) };
  }

  const manifest = {
    ok: true,
    op,
    blendPath,
    blender: version,
    beforeSha256: beforeSha,
    provenance: {
      sourceSha256: beforeSha,
      engine: version,
      op,
      payload: proposal.payload,
      executedAt: new Date().toISOString(),
    },
  };
  if (op === 'inspect') {
    const m = /B341_INSPECT (.*)/.exec(stdout);
    try { manifest.inspection = JSON.parse(m ? m[1] : '{}'); } catch { manifest.inspection = null; }
  }
  if (op === 'transform') {
    const afterBuf = fs.readFileSync(resolved);
    manifest.afterSha256 = sha256(afterBuf);
    manifest.changed = manifest.afterSha256 !== beforeSha;
    // 语义自检（实机抓真：--python-expr 不自动保存，须显式 save_mainfile；读回位置确认写盘生效）
    try {
      const verifyOut = execFileSync(bin, ['--background', resolved, '--python-expr',
        'import bpy, json\nobj = bpy.data.objects.get(' + JSON.stringify(String(proposal.payload.object)) + ')\nprint("B341_VERIFY " + json.dumps({"loc": list(obj.location)}) )'],
        { encoding: 'utf8', timeout: 60_000 });
      const m = /B341_VERIFY (.*)/.exec(verifyOut);
      manifest.semanticVerify = m ? JSON.parse(m[1]) : null;
    } catch { manifest.semanticVerify = null; }
    manifest.semanticDiffHead = manifest.changed ? `对象 ${proposal.payload.object} transform 已写回 .blend（语义自检 loc=${JSON.stringify(manifest.semanticVerify && manifest.semanticVerify.loc)}）` : '(no change)';
  }
  if (op === 'render') {
    const outAbs = path.resolve(workspaceRoot, String(proposal.payload.outputPath));
    manifest.renderedFile = String(proposal.payload.outputPath);
    manifest.renderedSha256 = fs.existsSync(outAbs) ? sha256(fs.readFileSync(outAbs)) : null;
    manifest.rendered = Boolean(manifest.renderedSha256);
  }
  return manifest;
}

module.exports = {
  ALLOWED_OPS,
  validateBlendOp,
  runBlendOp,
  findBlenderBinary,
};
