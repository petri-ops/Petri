#!/usr/bin/env node
/**
 * C-56 合成夹具端到端演练驱动（2026-11-23）。
 *
 * 用户裁决「用合成夹具跑通 Skill 端到端演练，明确非真实稿件、不改判据语义」。
 * 本驱动走真实 Skill 链路（tool_skill_discover → tool_skill_get）读回 paper-writing
 * system.md，再对 jia1 合成夹具做保真不变量的机械复核，产出结构化演练证据。
 *
 * 红线：输入是合成夹具（非真实论文），不替代手册 §9「真实稿件须用户给路径+完整读取」
 * 判据语义；不改手册/Skill 本体。零新依赖。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { tool_skill_discover, tool_skill_get } = require(
  path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'skill-tools.js'),
);
const OUT = process.env.C56_DRILL_OUT
  || path.join(ROOT, 'acceptance', 'c56-synthetic-drill', 'drill-result.json');

const SYNTHETIC_INPUT = '随着深度学习技术的快速发展，基于预训练模型的方法被广泛进行了研究。综上所述，该方法具有重要的理论意义和应用价值，为后续研究奠定了坚实的基础。实验表明模型性能得到了显著提升，准确率达到了98.7%。（注：本句数字为演练夹具）';

function check(name, condition, detail) {
  return { name, pass: Boolean(condition), detail };
}

async function main() {
  const result = {
    schemaVersion: 1,
    capability: 'c56-synthetic-drill',
    inputOrigin: 'synthetic-fixture',
    nonRealManuscript: true,
    criterionSemanticsUnchanged: true,
    note: '合成夹具端到端演练；非真实论文稿件，不替代手册 §9 真实稿件路径判据',
    checks: [],
  };

  // 1. 真实 Skill 链路：发现 → 读取
  const discovered = await tool_skill_discover({ search: 'paper-writing' });
  result.checks.push(check('skill_discover', discovered.ok
    && discovered.skills.some((skill) => skill.id === 'paper-writing'),
  discovered.ok ? 'paper-writing found' : JSON.stringify(discovered).slice(0, 200)));
  const got = await tool_skill_get({ id: 'paper-writing' });
  result.checks.push(check('skill_get', got.ok && got.skill?.prompts?.system === 'prompts/system.md',
    got.ok ? 'system.md resolved' : JSON.stringify(got).slice(0, 200)));
  const system = readFileSync(path.join(ROOT, 'resources', 'skills', 'paper-writing', 'prompts', 'system.md'), 'utf8');

  // 2. skill 内容四保护 + 十节 + F 六项 + 数字锁定 + provenance（deterministic 读回后断言）
  result.checks.push(check('four_protections',
    ['确定程度保护', '归因保护', '完成状态保护', '数字锁定'].every((k) => system.includes(k)),
    'determination/attribution/completion/number-lock sections in system.md'));
  const fTokens = Array.from({ length: 6 }, (_, i) => `F${i + 1}`);
  result.checks.push(check('F1_F6', fTokens.every((k) => system.includes(k)), 'F1..F6 present'));
  result.checks.push(check('逐字符对照', system.includes('逐字符') && system.includes('原句 → 改写句 → 保真说明'),
    'three-column fidelity contract present'));
  result.checks.push(check('provenance', system.includes('〈未覆盖：') && system.includes('provenance'),
    'provenance/uncovered markers present'));
  result.checks.push(check('英文论文另批', system.includes('英文论文覆盖另批'), 'English scope deferred'));

  // 3. 夹具保真不变量：数字锁定（98.7% 原文在案且演练稿未改）
  const drillDraft = readFileSync(
    path.join(ROOT, 'acceptance', 'block503-outputs', 'jia1-c56-rewrite.md'), 'utf8',
  );
  result.checks.push(check('input_has_number', SYNTHETIC_INPUT.includes('98.7%'), 'fixture carries 98.7%'));
  result.checks.push(check('number_locked_in_drill',
    drillDraft.includes('98.7%') && !/>[\s\S]*?97\.\d%[\s\S]*?98\.7%/.test(drillDraft),
    '98.7% present in drill, no conflicting uplift'));
  result.checks.push(check('non_real_label', /合成夹具|演练夹具|非真实/.test(drillDraft),
    'drill draft marks fixture as synthetic'));
  result.checks.push(check('manual_criterion_unchanged',
    readFileSync(path.join(ROOT, 'docs', 'c56-paper-writing-manual-draft-2026-11-19.md'), 'utf8')
      .includes('用户给出文件路径'),
    '§9 real-manuscript path criterion intact'));

  result.passed = result.checks.every((c) => c.pass);
  result.summary = {
    total: result.checks.length,
    passed: result.checks.filter((c) => c.pass).length,
    failed: result.checks.filter((c) => !c.pass).map((c) => c.name),
  };
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  console.log(`[c56-drill] passed=${result.passed} ${result.summary.passed}/${result.summary.total} -> ${OUT}`);
  if (!result.passed) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[c56-drill] error:', error?.stack || error);
  process.exitCode = 1;
});
