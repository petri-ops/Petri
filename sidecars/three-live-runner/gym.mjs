#!/usr/bin/env node
'use strict';

/**
 * sidecars/three-live-runner/gym.mjs — BLOCK-467 / 3D P4 Agent Gym 编排首片。
 *
 * three-live@1.4.0（外部工具，B-2 裁决：隔离 sidecar + adapter、capability 默认关、
 * 零产品依赖——install root 见 README）。编排 one episode：
 *   gym reset --session <tmp> <GLB>  →  gym step --session <tmp> --actions <json> --ticks 30 ×N  →  finalize
 *
 * "close" 语义（R3）：three-live CLI 只有 reset/step/play 子命令，MCP 侧有
 * three_live_gym_close（tools/list 实测）；本编排层不引 MCP transport，改以 session 文件
 * finalize（读回 steps + 封存证据）表征 episode close，缺口如实登记于 payload.sessionNote。
 * 只编排与证据 —— 不引训练框架、不做策略学习（R3 红线）。
 *
 * stdout 单行 JSON 为唯一机器出口；失败诚实（fail→exit 1）。
 * digest = sha256(确定性字段集 {tool, glbSha256, steps 摘要})，时间戳/会话临时路径不入→双跑一致。
 *
 * 用法：
 *   node gym.mjs --glb <ws-relative .glb> --out <ws-relative dir> [--steps N] [--actions <json>]
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

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
    if (token === '--glb' || token === '--out' || token === '--steps' || token === '--actions' || token === '--ticks') {
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
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text) || text.split('/').some((part) => part === '..' || part === '')) {
    fail('path_outside_workspace', { path: text });
  }
  return text;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function observeSummary(stdout) {
  // three-live gym observation 顶层键：step/tick/timeSec/bodies/scenarioState/reward/score/done/events/...
  // CLI 输出为多行 pretty JSON（首行 `{`）——先整体解析，再退化为单行末行解析。
  let obs;
  try {
    obs = JSON.parse(String(stdout || ''));
  } catch {
    const line = String(stdout || '').split('\n').filter((l) => l.trim().startsWith('{')).pop();
    if (!line) return null;
    try { obs = JSON.parse(line); } catch { return null; }
  }
  try {
    return {
      step: obs.step,
      tick: obs.tick,
      timeSec: obs.timeSec,
      bodyCount: Array.isArray(obs.bodies) ? obs.bodies.length : 0,
      reward: obs.reward,
      score: obs.score,
      done: obs.done,
      eventCount: Array.isArray(obs.events) ? obs.events.length : 0,
    };
  } catch {
    return null;
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.glb) fail('usage', { usage: 'node gym.mjs --glb <ws-relative .glb> --out <ws-relative dir> [--steps N] [--actions <json>]' });
  const glbRel = safeWorkspaceRelative(args.glb, 'glb');
  if (!glbRel.toLowerCase().endsWith('.glb')) fail('glb_format_unsupported', { path: glbRel });
  const outRel = safeWorkspaceRelative(args.out ?? path.posix.join(path.posix.dirname(glbRel), 'gym'), 'out');
  const stepsN = Number.parseInt(args.steps ?? '1', 10);
  if (!Number.isInteger(stepsN) || stepsN < 0 || stepsN > 600) fail('steps_invalid', { steps: args.steps });
  let actions = '[]';
  if (args.actions !== undefined) {
    try {
      const parsed = JSON.parse(args.actions);
      if (!Array.isArray(parsed)) fail('actions_invalid', { hint: '--actions 必须是 JSON 数组' });
      actions = args.actions;
    } catch {
      fail('actions_invalid', { raw: String(args.actions).slice(0, 200) });
    }
  }
  const ticks = Number.parseInt(args.ticks ?? '30', 10);
  if (!Number.isInteger(ticks) || ticks < 1 || ticks > 600) fail('ticks_invalid', { ticks: args.ticks });

  const root = repoRoot();
  const glbAbs = path.join(root, glbRel);
  const outAbs = path.join(root, outRel);
  if (!fs.existsSync(glbAbs)) fail('asset_missing', { path: glbRel });
  const cliAbs = path.join(root, INSTALL_ROOT);
  if (!fs.existsSync(cliAbs)) fail('tool_missing', { hint: 'three-live 未安装——见 sidecars/three-live-runner/README.md bootstrap' });
  fs.mkdirSync(outAbs, { recursive: true });

  const glbSha256 = sha256File(glbAbs);
  const sessionAbs = path.join(outAbs, `.gym-session-${process.pid}.json`);

  // ① reset：起 episode，产 session 文件 + t0 observation
  const reset = spawnSync(process.execPath, [cliAbs, 'gym', 'reset', '--session', sessionAbs, glbAbs], { cwd: root, encoding: 'utf8', timeout: 180000 });
  const resetObs = observeSummary(reset.stdout);
  const resetOk = reset.status === 0 && resetObs !== null && fs.existsSync(sessionAbs);
  if (!resetOk) {
    fs.rmSync(sessionAbs, { force: true });
    fail('gym_reset_failed', { exitCode: reset.status, stderr: String(reset.stderr || '').slice(-300) });
  }

  // ② step×N：推进仿真（每步读 session 续接），累计 observation 摘要
  const observations = [resetObs];
  const stepExits = [];
  for (let i = 0; i < stepsN; i += 1) {
    const step = spawnSync(process.execPath, [cliAbs, 'gym', 'step', '--session', sessionAbs, '--actions', actions, '--ticks', String(ticks)], { cwd: root, encoding: 'utf8', timeout: 180000 });
    const obs = observeSummary(step.stdout);
    stepExits.push(step.status);
    if (step.status !== 0 || obs === null) {
      fs.rmSync(sessionAbs, { force: true });
      fail('gym_step_failed', { index: i, exitCode: step.status, stderr: String(step.stderr || '').slice(-300) });
    }
    observations.push(obs);
  }

  // ③ finalize（"close" 语义）：读回 session 步数，封存证据，删临时 session
  const session = JSON.parse(fs.readFileSync(sessionAbs, 'utf8'));
  const recordedSteps = Array.isArray(session.steps) ? session.steps.length : null;
  const finalizeOk = recordedSteps === stepsN;
  fs.rmSync(sessionAbs, { force: true });
  const pass = resetOk && finalizeOk && stepExits.every((code) => code === 0);

  // digest：确定性字段集（不含时间/临时会话路径/step 的 timeSec）
  const digest = crypto.createHash('sha256').update(JSON.stringify({
    tool: TOOL_VERSION,
    glbSha256,
    steps: stepsN,
    ticks,
    actions,
    observations: observations.map((o) => ({ step: o.step, tick: o.tick, reward: o.reward, score: o.score, done: o.done, bodyCount: o.bodyCount })),
  })).digest('hex');

  const payload = {
    ok: pass,
    verdict: pass ? 'pass' : 'fail',
    tool: TOOL_VERSION,
    glb: glbRel,
    glbSha256,
    digest,
    steps: {
      reset: { ok: resetOk, observation: observations[0] },
      iterations: stepsN,
      stepExits,
      observations,
      finalize: { ok: finalizeOk, recordedSteps },
    },
    sessionNote: 'three-live CLI 仅 reset/step/play；MCP 侧有 three_live_gym_close。本编排以 session 文件读回+封存表征 episode close，不引 MCP transport（R3 只编排与证据）。',
    at: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outAbs, 'gym-evidence.json'), `${JSON.stringify(payload, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(pass ? 0 : 1);
}

main();
