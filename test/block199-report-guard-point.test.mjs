/**
 * BLOCK-199 P4② — `report-guard` 从"注册表外隐藏开关"收编进配置中心的契约测（离线）。
 *
 * 缺陷原状：`report-guard.js` 只认 `PETRI_JEV_REPORT_GUARD === '1'`，而该键不在
 * `decision-config.RUNTIME_POINTS` ⇒ 设置页看不见、不可持久化、语义还与其他接点相反。
 * 收编后必须同时成立：**默认关不变（零出站零行为变化）+ env 0/1 照旧 + 设置页能显式开并留痕**。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b199-guard-'));
process.env.PETRI_DECISION_CONFIG_PATH = path.join(sandbox, 'decision-config.json');
const decisionConfig = require(path.join(ROOT, 'core/petri-server/helpers/decision-config.js'));
const { isReportGuardEnabled } = require(path.join(ROOT, 'core/petri-server/helpers/report-guard.js'));

const ENV_KEY = 'PETRI_JEV_REPORT_GUARD';
const prevEnv = process.env[ENV_KEY];
const prevCfg = process.env.PETRI_DECISION_CONFIG_PATH;

test.after(() => {
  if (prevEnv === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = prevEnv;
  if (prevCfg === undefined) delete process.env.PETRI_DECISION_CONFIG_PATH; else process.env.PETRI_DECISION_CONFIG_PATH = prevCfg;
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
});

const setEnv = (v) => { if (v === undefined) delete process.env[ENV_KEY]; else process.env[ENV_KEY] = v; };

test('接点已注册：默认关，且 env 键名沿用既有的那个（不发明第二个开关）', () => {
  const all = decisionConfig.getAllPointConfigs();
  const guard = all.find((p) => p.point === 'report-guard');
  assert.ok(guard, `report-guard 未进注册表（现仅 ${all.map((p) => p.point).join(', ')}）`);
  assert.equal(guard.envKey, ENV_KEY);
  assert.equal(guard.enabledDefault, false, '默认必须关（P2 试点的零行为变化前提）');
});

test('无 env 无存储：仍关（默认关语义一字未改）', () => {
  setEnv(undefined);
  fs.rmSync(process.env.PETRI_DECISION_CONFIG_PATH, { force: true });
  assert.equal(isReportGuardEnabled(), false);
});

test('env=1 开 / env=0 关：与收编前完全一致', () => {
  setEnv('1');
  assert.equal(isReportGuardEnabled(), true);
  setEnv('0');
  assert.equal(isReportGuardEnabled(), false);
  setEnv('yes');
  assert.equal(isReportGuardEnabled(), false, '不被承认的字面量不激活（现状口径）');
});

test('新增能力：设置页显式开可持久化，且 env=0 仍能一票否决', () => {
  setEnv(undefined);
  decisionConfig.setPointConfig('report-guard', { enabled: true });
  assert.equal(isReportGuardEnabled(), true, '注册进配置中心后应可经设置面开启并留痕');
  const onDisk = JSON.parse(fs.readFileSync(process.env.PETRI_DECISION_CONFIG_PATH, 'utf8'));
  assert.equal(onDisk.points['report-guard'].enabled, true, '必须真的落盘（隐藏开关时代的"不可持久化"不得复发）');
  setEnv('0');
  assert.equal(isReportGuardEnabled(), false, '杀开关高于存储值');
});
