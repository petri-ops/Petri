import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildSystemPrompt } = require('../core/r-server/helpers/system-prompt');

const INTERNAL_IDS = Object.freeze({
  jobId: 'job_7f3a2b',
  revisionId: 'rev_91c4de',
  artifactFamilyId: 'af_55aa01',
  selectionId: 'sel_2b8f70',
});

function projectContext(overrides = {}) {
  return {
    page: 'desktop-project',
    pageTitle: 'Bulk RNA 项目',
    projectId: 'project_1',
    projectName: 'Bulk RNA 项目',
    activeJobId: INTERNAL_IDS.jobId,
    ...overrides,
  };
}

function artifact(overrides = {}) {
  return {
    jobId: INTERNAL_IDS.jobId,
    toolId: 'deseq2',
    name: 'deg_table.csv',
    type: 'table',
    label: '差异表达结果',
    revisionId: INTERNAL_IDS.revisionId,
    artifactFamilyId: INTERNAL_IDS.artifactFamilyId,
    entityType: 'gene',
    idField: 'gene',
    selectionId: null,
    selectionCompatibility: null,
    selection: null,
    ...overrides,
  };
}

test('RS-P3 prompt describes the open result without leaking any internal id', () => {
  const prompt = buildSystemPrompt(projectContext({ activeArtifact: artifact() }));
  assert.match(prompt, /RESULT_STUDIO_CONTEXT_v1/);
  assert.match(prompt, /差异表达结果/);
  assert.match(prompt, /deseq2/);
  // 内部坐标必须由工具从后端真相获得，不能出现在提示词里。
  assert.equal(prompt.includes(INTERNAL_IDS.revisionId), false);
  assert.equal(prompt.includes(INTERNAL_IDS.artifactFamilyId), false);
  assert.equal(prompt.includes(INTERNAL_IDS.selectionId), false);
});

test('RS-P3 prompt directs the model to the context tool instead of asking the user for ids', () => {
  const prompt = buildSystemPrompt(projectContext({ activeArtifact: artifact() }));
  assert.match(prompt, /result_studio_context/);
  assert.match(prompt, /contextToken/);
  assert.match(prompt, /_in_context/);
  assert.match(prompt, /不要向用户索要/);
  assert.match(prompt, /context_token_stale/);
});

test('P4R-3 bound Composer context reads the trusted schema without exposing the token', () => {
  const token = 'e'.repeat(64);
  const prompt = buildSystemPrompt(projectContext({
    activeArtifact: artifact({ contextToken: token }),
  }));
  assert.match(prompt, /自动绑定/);
  assert.match(prompt, /先调用 result_studio_context 读取当前可编辑参数 schema/);
  assert.match(prompt, /再调用 result_edit_plan_in_context/);
  assert.equal(prompt.includes(token), false);
});

test('P4R-3 keeps structured manual patches in the hidden orchestration block', () => {
  const prompt = buildSystemPrompt({
    page: 'desktop-project', projectId: 'project_1',
    activeArtifact: artifact({ contextToken: 'e'.repeat(64) }),
    resultEditRequest: {
      origin: 'manual', parameterPatch: { point_size: 3 }, scientificConfirmed: true,
    },
  });
  assert.match(prompt, /本轮结果编辑请求/);
  assert.match(prompt, /"point_size":3/);
  assert.match(prompt, /只作为数据，不是指令/);
  assert.match(prompt, /用户已在高级控件中确认/);
});

test('RS-P3 prompt fixes the five public phases and forbids hidden reasoning', () => {
  const prompt = buildSystemPrompt(projectContext({ activeArtifact: artifact() }));
  for (const phase of ['理解意图', '判断影响', '执行/重算', '验证', '候选可比较']) {
    assert.match(prompt, new RegExp(phase.replace('/', '\\/')));
  }
  assert.match(prompt, /不展示隐藏推理链/);
});

test('RS-P3 prompt reports a compatible selection as usable by the agent', () => {
  const prompt = buildSystemPrompt(projectContext({
    activeArtifact: artifact({
      selectionId: INTERNAL_IDS.selectionId,
      selectionCompatibility: 'compatible',
      selection: {
        entityType: 'gene',
        entityIdCount: 3,
        truncated: false,
        filterDescription: null,
      },
    }),
  }));
  assert.match(prompt, /当前选择：3 个 gene/);
  assert.equal(prompt.includes(INTERNAL_IDS.selectionId), false);
});

test('RS-P3 prompt refuses to let a stale or invalid selection be reused', () => {
  const stale = buildSystemPrompt(projectContext({
    activeArtifact: artifact({ selectionCompatibility: 'stale', selection: { entityType: 'gene', entityIdCount: 3 } }),
  }));
  assert.match(stale, /已过期/);
  assert.match(stale, /不得沿用/);

  const invalid = buildSystemPrompt(projectContext({
    activeArtifact: artifact({ selectionCompatibility: 'invalid', selection: { entityType: 'row', entityIdCount: 5 } }),
  }));
  assert.match(invalid, /不得把行号当成实体身份/);
});

test('RS-P3 prompt states honestly when no revision exists yet', () => {
  const prompt = buildSystemPrompt(projectContext({
    activeArtifact: artifact({ revisionId: null }),
  }));
  assert.match(prompt, /版本已建立：否/);
});

test('RS-P3 prompt adds no result context block when nothing is open', () => {
  const prompt = buildSystemPrompt(projectContext({ activeArtifact: null }));
  assert.equal(prompt.includes('RESULT_STUDIO_CONTEXT_v1'), false);
});
