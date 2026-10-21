/**
 * BLOCK-234 Q-DOMAIN P4-C S5：scientific profiles 下沉 pack。
 * 钉住装载器边界（启用/停用、路径逃逸、分段 fail-closed、多包稳定覆盖），
 * 以及 compare/rerun 引擎确实消费 pack 数据而非核心硬编码。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadScientificProfiles } = require(path.join(ROOT, 'core/shared-backend/pack-scientific-profiles.js'));
const { compareScientificTables } = require(path.join(ROOT, 'core/shared-backend/result-scientific-compare.js'));
const { loadRerunProfile } = require(path.join(ROOT, 'core/shared-backend/result-scientific-rerun.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function profiles() {
  return {
    version: 1,
    comparisons: [{
      artifactIds: ['fixture_table'],
      kind: 'fixture_comparison',
      mode: 'threshold',
      idColumns: ['id'],
      effectColumns: ['effect'],
      significanceColumns: ['q'],
      thresholdParameters: { significance: ['q_cutoff'], effect: ['effect_cutoff'] },
      reasons: {
        thresholdsUnavailable: 'fixture_thresholds_unavailable',
        schemaInvalid: 'fixture_schema_invalid',
      },
    }],
    rerun: {
      rootArtifactId: 'fixture_root',
      directChildPrimaryArtifacts: { 'fixture-child': 'fixture_output' },
    },
    cohort: {
      rootArtifactId: 'fixture_root',
      rootToolId: 'fixture-root-tool',
      childToolId: 'fixture-child',
      childArtifactId: 'fixture_output',
      childInputId: 'fixture_root',
    },
    selectionConsumers: {
      fixture_action: {
        toolId: 'fixture-tool',
        label: 'Fixture',
        entityType: 'entity',
        fileInput: 'fixture_input',
        defaultParams: { mode: 'default' },
        argMappings: { argMode: 'mode' },
        requiredSourceActions: ['fixture_action'],
        deriveFromRevision: { sourceArtifactId: 'fixture_root', idField: 'id' },
      },
    },
    planner: {
      rules: [{
        toolId: 'fixture-planner',
        when: { rolesAll: ['counts'], any: [{ questionTypes: ['fixture_question'] }, { originalRequest: true }] },
        rationale: 'fixture rationale',
        prerequisites: ['fixture_input'],
        risks: ['fixture risk'],
        order: 5,
      }],
    },
    heavyTools: ['fixture-heavy'],
    interpret: { standardAnalysisTypes: ['fixture_standard'] },
  };
}

function makePack(dataDir, packId, content, extra = {}) {
  const packRoot = path.join(dataDir, packId);
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    provides: extra.provides === undefined
      ? { scientificProfiles: 'scientific-profiles.json' }
      : extra.provides,
  }));
  if (content !== null) {
    fs.writeFileSync(path.join(packRoot, 'scientific-profiles.json'), JSON.stringify(content));
  }
  return { packId, packRoot, enabled: extra.enabled !== false, version: '1.0.0' };
}

function withPacks(packs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'packs', 'installed.json'), JSON.stringify(packs));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  return () => {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
  };
}

test('启用包装载 comparisons/rerun/cohort；停用包被忽略', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const enabled = makePack(dataDir, 'a-enabled', profiles());
  const disabled = makePack(dataDir, 'b-disabled', profiles(), { enabled: false });
  const restore = withPacks([enabled, disabled]);
  try {
    const loaded = loadScientificProfiles();
    assert.deepEqual(Object.keys(loaded.comparisons), ['fixture_table']);
    assert.deepEqual(loaded.rerun, {
      rootArtifactId: 'fixture_root',
      directChildPrimaryArtifacts: { 'fixture-child': 'fixture_output' },
    });
    assert.equal(loaded.cohort.childToolId, 'fixture-child');
    assert.equal(loaded.selectionConsumers.fixture_action.toolId, 'fixture-tool');
    assert.equal(loaded.selectionConsumers.fixture_action.deriveFromRevision.sourceArtifactId, 'fixture_root');
    assert.deepEqual(loaded.plannerRules.map((rule) => rule.toolId), ['fixture-planner']);
    assert.deepEqual(loaded.plannerRules[0].when.any, [
      { questionTypes: ['fixture_question'] },
      { originalRequest: true },
    ]);
    assert.deepEqual(loaded.heavyTools, ['fixture-heavy']);
    assert.deepEqual(loaded.interpret, { standardAnalysisTypes: ['fixture_standard'] });
    assert.deepEqual(loaded.warnings, []);
  } finally {
    restore();
  }
});

test('路径逃逸拒绝装载并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'escape', null, {
    provides: { scientificProfiles: '../escape.json' },
  });
  fs.writeFileSync(path.join(dataDir, 'escape.json'), JSON.stringify(profiles()));
  const restore = withPacks([pack]);
  try {
    const loaded = loadScientificProfiles();
    assert.deepEqual(loaded.comparisons, {});
    assert.equal(loaded.rerun, null);
    assert.ok(loaded.warnings.some((warning) => warning.code === 'path_outside_pack'), JSON.stringify(loaded.warnings));
  } finally {
    restore();
  }
});

test('坏 comparison 整段忽略，rerun/cohort 仍装载（分段 fail-closed）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const content = profiles();
  content.comparisons.push({
    artifactIds: ['bad_mode'],
    kind: 'bad',
    mode: 'not_a_mode',
    idColumns: ['id'],
  });
  content.planner.rules.push({ toolId: 'bad-planner', when: { unknown: true }, rationale: 'bad' });
  content.selectionConsumers.bad = { toolId: 'bad' };
  content.heavyTools.push(42);
  const pack = makePack(dataDir, 'mixed', content);
  const restore = withPacks([pack]);
  try {
    const loaded = loadScientificProfiles();
    assert.deepEqual(Object.keys(loaded.comparisons), ['fixture_table']);
    assert.equal(loaded.rerun.rootArtifactId, 'fixture_root');
    assert.deepEqual(loaded.plannerRules.map((rule) => rule.toolId), ['fixture-planner']);
    assert.equal(loaded.selectionConsumers.fixture_action.toolId, 'fixture-tool');
    assert.deepEqual(loaded.heavyTools, []);
    assert.ok(loaded.warnings.some((warning) => warning.code === 'comparison_mode_invalid'), JSON.stringify(loaded.warnings));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'planner_rule_when_invalid_unknown'), JSON.stringify(loaded.warnings));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'selection_consumer_entity_invalid'), JSON.stringify(loaded.warnings));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'heavy_tools_invalid'), JSON.stringify(loaded.warnings));
  } finally {
    restore();
  }
});

test('多包同 artifact/rerun 覆盖按 packId 稳定后者胜出并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const first = profiles();
  first.comparisons[0].kind = 'first_kind';
  first.rerun.rootArtifactId = 'first_root';
  const second = profiles();
  second.comparisons[0].kind = 'second_kind';
  second.rerun.rootArtifactId = 'second_root';
  const a = makePack(dataDir, 'a-pack', first);
  const b = makePack(dataDir, 'b-pack', second);
  const restore = withPacks([b, a]);
  try {
    const loaded = loadScientificProfiles();
    assert.equal(loaded.comparisons.fixture_table.kind, 'second_kind');
    assert.equal(loaded.rerun.rootArtifactId, 'second_root');
    assert.ok(loaded.warnings.some((warning) => warning.code === 'comparison_overridden'));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'rerun_overridden'));
  } finally {
    restore();
  }
});

test('compare 引擎经装载器消费 pack profile（无显式注入）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'compare', profiles());
  const restore = withPacks([pack]);
  const filesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-files-'));
  tempDirs.push(filesDir);
  const beforePath = path.join(filesDir, 'before.csv');
  const afterPath = path.join(filesDir, 'after.csv');
  fs.writeFileSync(beforePath, 'id,effect,q\nA,2,0.01\nB,0.5,0.01\n');
  fs.writeFileSync(afterPath, 'id,effect,q\nA,2,0.01\nB,-2,0.04\n');
  try {
    const result = compareScientificTables({
      artifactId: 'fixture_table',
      beforePath,
      afterPath,
      beforeParameters: { q_cutoff: 0.05, effect_cutoff: 1 },
      afterParameters: { q_cutoff: 0.05, effect_cutoff: 1 },
    });
    assert.equal(result.status, 'available');
    assert.equal(result.kind, 'fixture_comparison');
    assert.deepEqual(result.significantGenes.before, { significantCount: 1, upCount: 1, downCount: 0 });
    assert.deepEqual(result.significantGenes.after, { significantCount: 2, upCount: 1, downCount: 1 });
    assert.deepEqual(result.significantGenes.membership.gained, ['B']);
  } finally {
    restore();
  }
});

test('rerun 引擎经装载器消费 pack profile', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-sci-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'rerun', profiles());
  const restore = withPacks([pack]);
  try {
    assert.deepEqual(loadRerunProfile(), {
      rootArtifactId: 'fixture_root',
      directChildPrimaryArtifacts: { 'fixture-child': 'fixture_output' },
    });
  } finally {
    restore();
  }
});
