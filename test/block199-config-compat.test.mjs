/**
 * BLOCK-199 P0 — 拆前行为基线（scoped refactor 的对账锚，BLOCK-92 先例）。
 *
 * 本文件在**重构前**写下并跑绿，钉住三族配置的现有优先级与取值语义；此后无论
 * `config/schema.js` + `config-service.js` 内部怎么改，**本文件一个字都不许动**——
 * 它红了就等于"统一实现改变了用户可感行为"，必须回退而不是改测试。
 *
 * 覆盖的现状语义（逐条实码读来，不是文档转述）：
 *  · feature-flags（helpers/feature-flags.js:79-88）：env 1/true→开、0/false→关 > 持久化布尔 > 默认 true；
 *    未知键读与写都抛 `feature_flag_unknown`。
 *  · ai-settings generation（helpers/ai-settings.js:315-329）：env 数值 > 文件 `generation` > 不返回该键
 *    （loop 内置 0.4/16384 是隐式缺省，不出现在返回体）；temperature 0..2、maxTokens ≥256 且取整，非法即丢键。
 *  · cost-cap（helpers/cost-cap.js:20-26）：env > 文件 > null；上限必须 >0 且两位小数取整。
 *  · decision-config（helpers/decision-config.js）：**BLOCK-211（C-32）已按注释语义修正**——
 *    env '0' 杀开关最高 > 文件 > **env '1' 仅作首载种子** > 注册表默认。此前是「env '1' 运行时强制开」，
 *    与文件头注释相反；本基线在同一提交里随 C-32 一起显式改写（留因：修的是"设置页关不掉"的治理缺陷，
 *    不是放宽判据）。`tool-route` 独享 defaultOn；threshold 已存值赢注册表、gates 只做既有键部分覆盖。
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

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b199-compat-'));
process.env.PETRI_LOCAL_DATA_DIR = sandbox;
process.env.PETRI_DECISION_CONFIG_PATH = path.join(sandbox, 'decision-config.json');
const flagsFile = path.join(sandbox, 'feature-flags.json');
const decisionFile = path.join(sandbox, 'decision-config.json');

const flags = require(path.join(ROOT, 'core/petri-server/helpers/feature-flags.js'));
const costCap = require(path.join(ROOT, 'core/petri-server/helpers/cost-cap.js'));

test.after(() => {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
});

const writeFlags = (obj) => fs.writeFileSync(flagsFile, JSON.stringify({ flags: obj, updatedAt: new Date().toISOString() }));

test('feature-flags：env 杀开关 > 持久化布尔 > 默认 true（三档胜负关系冻结）', () => {
  writeFlags({ server_history_assembly: false, session_compaction: true, agent_resilience: false });
  assert.equal(flags.resolveFlag('server_history_assembly', { PETRI_SERVER_HISTORY_ASSEMBLY: '1' }), true, 'env=1 必须赢过已存 false');
  assert.equal(flags.resolveFlag('session_compaction', { PETRI_SESSION_COMPACTION: '0' }), false, 'env=0 必须赢过已存 true');
  assert.equal(flags.resolveFlag('agent_resilience', {}), false, '无 env 时以已存布尔为准');
  fs.rmSync(flagsFile, { force: true });
  assert.equal(flags.resolveFlag('agent_resilience', {}), true, '无已存值时回落默认 true（2026-09-18 裁决）');
  assert.equal(flags.resolveFlag('server_history_assembly', { PETRI_SERVER_HISTORY_ASSEMBLY: 'true' }), true, "'true' 字面量等价 1");
  assert.equal(flags.resolveFlag('server_history_assembly', { PETRI_SERVER_HISTORY_ASSEMBLY: 'yes' }), true, '非 0/false 的 env 值不改变胜负：回落已存/默认');
});

test('feature-flags：未知键读写都拒绝（现状就是拒绝，不是静默）', () => {
  assert.throws(() => flags.resolveFlag('nope_flag', {}), /feature_flag_unknown/);
  assert.throws(() => flags.setFlag('nope_flag', true), /feature_flag_unknown/);
  assert.throws(() => flags.setFlag('server_history_assembly', 'true'), /feature_flag_value_invalid/, '布尔之外的类型一律拒');
});

test('feature-flags：快照形状是设置页的契约面（字段名不得漂移）', () => {
  writeFlags({ server_history_assembly: false });
  const snap = flags.getFlagsSnapshot({ PETRI_SESSION_COMPACTION: '0' });
  assert.deepEqual(Object.keys(snap).sort(), ['agent_resilience', 'server_history_assembly', 'session_compaction']);
  assert.deepEqual(
    Object.keys(snap.server_history_assembly).sort(),
    ['default', 'description', 'enabled', 'env', 'envOverride', 'label', 'stored'],
  );
  assert.equal(snap.server_history_assembly.enabled, false);
  assert.equal(snap.server_history_assembly.envOverride, null);
  assert.equal(snap.session_compaction.enabled, false);
  assert.equal(snap.session_compaction.envOverride, false);
});

test('cost-cap：env > 文件 > null，且 >0 与两位小数取整的口径不变', () => {
  assert.equal(costCap.resolveCostCapCny({ costCapCny: 5 }, { PETRI_TASK_COST_CAP_CNY: '12' }), 12);
  assert.equal(costCap.resolveCostCapCny({ costCapCny: 5 }, {}), 5);
  assert.equal(costCap.resolveCostCapCny({ costCapCny: 5 }, { PETRI_TASK_COST_CAP_CNY: 'abc' }), 5, 'env 非法即回落文件');
  assert.equal(costCap.resolveCostCapCny({ costCapCny: 0 }, {}), null, '0 视为未配置=不熔断');
  assert.equal(costCap.resolveCostCapCny({ costCapCny: -3 }, {}), null);
  assert.equal(costCap.sanitizeCostCapCny('12.3456'), 12.35, '两位小数取整');
  assert.deepEqual(costCap.isCostCapExceeded({ capCny: 10, spentCny: 10 }), { exceeded: true, spentCny: 10, capCny: 10 }, 'spent ≥ cap 即超（含等于）');
  assert.equal(costCap.isCostCapExceeded({ capCny: null, spentCny: 999 }).exceeded, false);
});

test('ai-settings generation：env 覆盖文件、数值域外丢键、maxTokens 取整', () => {
  const ai = require(path.join(ROOT, 'core/petri-server/helpers/ai-settings.js'));
  const prev = { ...process.env };
  try {
    process.env.PETRI_LLM_TEMPERATURE = '0.7';
    process.env.PETRI_LLM_MAX_TOKENS = '8192';
    const gen = ai.getGenerationDefaults();
    assert.equal(gen.temperature, 0.7, 'env 赢文件');
    assert.equal(gen.maxTokens, 8192);
  } finally {
    delete process.env.PETRI_LLM_TEMPERATURE;
    delete process.env.PETRI_LLM_MAX_TOKENS;
  }
  fs.writeFileSync(path.join(sandbox, 'ai-settings.json'), JSON.stringify({ generation: { temperature: 3, maxTokens: 100, note: '未知键' }, provider: 'deepseek' }));
  const bad = ai.getGenerationDefaults();
  assert.deepEqual(bad, {}, '越界数值一律丢键（不clamp、不报错），未知子键也不外泄');
  assert.equal(Object.prototype.hasOwnProperty.call(bad, 'note'), false);
  fs.writeFileSync(path.join(sandbox, 'ai-settings.json'), JSON.stringify({ generation: { temperature: 0.25, maxTokens: 512.9 } }));
  const ok = ai.getGenerationDefaults();
  assert.equal(ok.temperature, 0.25);
  assert.equal(ok.maxTokens, 512, 'maxTokens 向下取整');
  if (prev.PETRI_LLM_TEMPERATURE === undefined) delete process.env.PETRI_LLM_TEMPERATURE;
}

);

test('decision-config：env 0 杀开关最高；env 1 只作首载种子（C-32 修正后语义）', () => {
  fs.writeFileSync(decisionFile, JSON.stringify({ version: 1, points: { 'knowledge-guard': { enabled: false }, 'tool-route': { enabled: false } } }));
  process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
  try {
    const dc = require(path.join(ROOT, 'core/petri-server/helpers/decision-config.js'));
    // C-32 修正：文件有值 ⇒ env=1 不再盖过设置页；这正是"我关掉了但它还开着"的根治点
    assert.equal(dc.getPointRuntime('knowledge-guard').enabled, false, 'env=1 是种子，不覆盖文件里的显式关');
    assert.equal(dc.getPointRuntime('knowledge-guard').envOverride, 'on', 'envOverride 仍如实暴露给 UI 提示');
    process.env.PETRI_JEV_KNOWLEDGE_GUARD = '0';
    assert.equal(dc.getPointRuntime('knowledge-guard').enabled, false, 'env=0 杀开关任何情况下最高');
    delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
    // 文件里没有该键时，env=1 仍能作为"默认开"的种子生效（dev 脚本用法不破）
    fs.rmSync(decisionFile, { force: true });
    process.env.PETRI_JEV_KNOWLEDGE_GUARD = '1';
    assert.equal(dc.getPointRuntime('knowledge-guard').enabled, true, '无文件配置时 env=1 作种子生效');
  } finally {
    delete process.env.PETRI_JEV_KNOWLEDGE_GUARD;
  }
});

test('decision-config：已存 threshold 赢注册表默认，defaultOn 只属于 tool-route', () => {
  fs.writeFileSync(decisionFile, JSON.stringify({
    version: 1,
    points: { 'tool-route': { threshold: 0.11 }, 'intent-route': { enabled: true, threshold: 0.33 } },
  }));
  const dc = require(path.join(ROOT, 'core/petri-server/helpers/decision-config.js'));
  const tool = dc.getPointRuntime('tool-route');
  assert.equal(tool.threshold, 0.11, '已存阈值必须生效（注册表默认让位于用户配置）');
  assert.equal(tool.enabled, true, 'tool-route 独享 defaultOn=true');
  assert.equal(tool.defaultOn, undefined, '现状不暴露 defaultOn 字段（形状冻结）');
  assert.equal(dc.getPointRuntime('intent-route').enabled, true);
  assert.equal(dc.getPointRuntime('intent-route').threshold, 0.33);
  assert.equal(dc.getPointRuntime('marker-celltype').enabled, false, '其余接点维持"显式存储才启用"');
  assert.equal(dc.getPointRuntime('nope-point'), null, '未知接点返回 null 不抛');
});

test('decision-config：gates 部分覆盖只接受注册表既有键与有限数值', () => {
  const thresholdsMod = require(path.join(ROOT, 'core/petri-server/helpers/decision-thresholds.js'));
  const registryGates = thresholdsMod['topic-shift'] && thresholdsMod['topic-shift'].gates;
  fs.writeFileSync(decisionFile, JSON.stringify({
    version: 1,
    points: { 'topic-shift': { enabled: true, gates: { ...registryGates, yes: 0.42, ghostKey: 0.9, bad: 'x' } } },
  }));
  const dc = require(path.join(ROOT, 'core/petri-server/helpers/decision-config.js'));
  const rt = dc.getPointRuntime('topic-shift');
  assert.equal(rt.gates.yes, 0.42, '注册表既有键可覆盖');
  assert.equal(rt.gates.ghostKey, undefined, '未知 gate 键静默丢弃（现状；写侧却会 throw——同族两语义，schema 层要统一）');
  assert.equal(rt.gates.bad, undefined);
  assert.notEqual(rt.defaultGates.yes, 0.42, 'defaultGates 恒暴露校准原值供对照');
});
