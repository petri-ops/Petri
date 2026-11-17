#!/usr/bin/env node
'use strict';

/**
 * sidecars/three-live-runner/verify.mjs — BLOCK-462 L4 verification adapter。
 *
 * three-live@1.4.0（外部工具，B-2 裁决：隔离 sidecar + adapter、capability 默认关、
 * 零产品依赖——安装于 .petri-dev-user-data/three-live，bootstrap 见 README）。
 * 编排：info → render → sim 三步验证工作区内 GLB 产物，产诊断 JSON 契约
 *（stdout 唯一机器出口）；verdict=pass 当且仅当三步全过；失败诚实（exit 1）。
 *
 * digest = sha256(确定性字段集 {glbSha256, renderSha256, renderBytes, simExit, simNodes,
 * toolVersion, sceneDigest?})——headless 渲染双跑一致已实测（同 GLB → 同 PNG sha256），
 * 因此 digest 可复现；--append-truth 时以 digest 去重追加 verifierResults 进
 * SceneSpec metadata.provenance（单一真相，不建第二份）。
 *
 * 用法：
 *   node verify.mjs --glb <ws-relative .glb> --out <ws-relative dir> [--append-truth <ws-relative .scene3d.json>]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const TOOL_VERSION = 'three-live@1.4.0';
const INSTALL_ROOT = path.join('.petri-dev-user-data', 'three-live', 'node_modules', 'three-live', 'dist', 'three-live-cli.js');

function fail(error, details) {
  process.stdout.write(`${JSON.stringify({ ok: false, verdict: 'fail', error, ...(details ? { details } : {}) })}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--glb' || token === '--out' || token === '--append-truth') {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function repoRoot() {
  return path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
}

function safeWorkspaceRelative(value, label) {
  const text = String(value || '').trim().replace(/\\/g, '/');
  if (!text) fail(`${label}_path_invalid`, { path: String(value || '') });
  // 越界/绝对路径统一 path_outside_workspace（沿 scene3d-import 既有错误码约定）
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.split('/').some((part) => part === '..' || part === '')) {
    fail('path_outside_workspace', { path: text });
  }
  return text;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.glb) fail('usage', { usage: 'node verify.mjs --glb <ws-relative .glb> --out <ws-relative dir> [--append-truth <ws-relative .scene3d.json>]' });
  const glbRel = safeWorkspaceRelative(args.glb, 'glb');
  if (!glbRel.toLowerCase().endsWith('.glb')) fail('glb_format_unsupported', { path: glbRel });
  const outRel = safeWorkspaceRelative(args.out ?? path.posix.join(path.posix.dirname(glbRel), 'verify'), 'out');
  const root = repoRoot();
  const glbAbs = path.join(root, glbRel);
  const outAbs = path.join(root, outRel);
  if (!fs.existsSync(glbAbs)) fail('asset_missing', { path: glbRel });
  fs.mkdirSync(outAbs, { recursive: true });

  const cliAbs = path.join(root, INSTALL_ROOT);
  if (!fs.existsSync(cliAbs)) fail('tool_missing', { hint: 'three-live 未安装——见 sidecars/three-live-runner/README.md bootstrap' });
  const glbSha256 = sha256File(glbAbs);

  // ① info：容器结构
  const info = spawnSync(process.execPath, [cliAbs, 'info', glbAbs], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const infoOk = info.status === 0 && /GLB Container Info/.test(info.stdout || '');
  // ② render：headless 渲染证据（双跑一致已实测）
  const renderOutName = `${path.basename(glbRel, '.glb')}-render.png`;
  const renderAbs = path.join(outAbs, renderOutName);
  const render = spawnSync(process.execPath, [cliAbs, 'render', glbAbs, '-o', renderAbs], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const renderOk = render.status === 0 && fs.existsSync(renderAbs);
  const renderSha256 = renderOk ? sha256File(renderAbs) : null;
  const renderBytes = renderOk ? fs.statSync(renderAbs).size : 0;
  // ③ sim：60Hz 节点状态报告（KHR_interactivity/orbit/explode 场景；s3d_joint GLB 无 KHR 交互时
  //    sim 走 orbit/explode 兜底场景仍产出节点状态——实测 exit=0）
  const sim = spawnSync(process.execPath, [cliAbs, 'sim', glbAbs], { cwd: root, encoding: 'utf8', timeout: 120000 });
  const simNodes = String(sim.stdout || '').split('\n').filter((line) => /^\s*\[\d+\]\s/.test(line)).length;
  const simOk = sim.status === 0;

  const steps = {
    info: { ok: infoOk, exitCode: info.status, summary: infoOk ? (info.stdout || '').split('\n').slice(0, 5).join(' | ').trim() : (info.stderr || '').slice(-200) },
    render: { ok: renderOk, exitCode: render.status, path: path.posix.join(outRel, renderOutName), sha256: renderSha256, bytes: renderBytes },
    sim: { ok: simOk, exitCode: sim.status, nodes: simNodes },
  };
  const pass = infoOk && renderOk && simOk;

  // digest = 确定性字段集的 sha256（时间戳/路径不入——保证跨目录复现一致）
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    tool: TOOL_VERSION,
    glbSha256,
    renderSha256,
    renderBytes,
    simExit: sim.status,
    simNodes,
  })).digest('hex');

  const payload = {
    ok: pass,
    verdict: pass ? 'pass' : 'fail',
    tool: TOOL_VERSION,
    glb: glbRel,
    glbSha256,
    steps,
    digest,
    at: new Date().toISOString(),
  };

  // --append-truth：verifierResults 以 digest 去重追加进 SceneSpec metadata.provenance
  if (args['append-truth']) {
    const sceneRel = safeWorkspaceRelative(args['append-truth'], 'scene');
    const sceneAbs = path.join(root, sceneRel);
    if (!fs.existsSync(sceneAbs)) fail('scene_missing', { path: sceneRel });
    const spec = JSON.parse(fs.readFileSync(sceneAbs, 'utf8'));
    spec.metadata = spec.metadata && typeof spec.metadata === 'object' ? spec.metadata : {};
    spec.metadata.provenance = spec.metadata.provenance && typeof spec.metadata.provenance === 'object' ? spec.metadata.provenance : {};
    const results = Array.isArray(spec.metadata.provenance.verifierResults) ? spec.metadata.provenance.verifierResults : [];
    if (!results.some((row) => row && row.digest === digest)) {
      results.push({ tool: TOOL_VERSION, verdict: payload.verdict, diagnosticsRef: path.posix.join(outRel, 'diagnostics.json'), digest, at: payload.at });
      spec.metadata.provenance.verifierResults = results;
      fs.writeFileSync(sceneAbs, `${JSON.stringify(spec, null, 2)}\n`);
      payload.truthAppended = { scene: sceneRel, verifierResults: results.length };
    }
  }

  // 诊断 JSON 落盘（与 JSON stdout 同内容；truth 链 diagnosticsRef 指向它）
  fs.writeFileSync(path.join(outAbs, 'diagnostics.json'), `${JSON.stringify(payload, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(pass ? 0 : 1);
}

main();
