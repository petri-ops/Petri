// ============================================================
// system-prompt-rejects.test.mjs — BLOCK-16 PHASE 3 verification
//
// 验证 renderWorkingTreeRejectsForPrompt / loadWorkingTreeRejectEntries 在以下场景：
// - 空 entries 返回空字符串
// - 含 entries 返回包含块标记 + 反馈摘要
// - 超过 limit 的 entries 被截断
// - 超过 charBudget 的 entries 被截断
// - 文件读取失败不抛错
// - JSON 解析失败被忽略
// - TTL 过期文件被 unlink
// ============================================================

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const helper = await import('../core/petri-server/helpers/system-prompt.js');
const {
  renderWorkingTreeRejectsForPrompt,
  loadWorkingTreeRejectEntries,
} = helper;

test('renderWorkingTreeRejectsForPrompt returns empty for non-array', () => {
  assert.equal(renderWorkingTreeRejectsForPrompt(undefined), '');
  assert.equal(renderWorkingTreeRejectsForPrompt(null), '');
  assert.equal(renderWorkingTreeRejectsForPrompt([]), '');
  assert.equal(renderWorkingTreeRejectsForPrompt('not-array'), '');
});

test('renderWorkingTreeRejectsForPrompt renders entries with feedback and code snippets', () => {
  const entries = [
    {
      taskId: 'task-123',
      file: 'src/foo.ts',
      hunkIndex: 0,
      feedback: 'use snake_case instead of camelCase',
      oldText: 'const fooBar = 1;\n',
      newText: 'const foo_bar = 1;\n',
      rejectedAt: '2026-08-19T10:00:00.000Z',
    },
  ];
  const out = renderWorkingTreeRejectsForPrompt(entries);
  assert.match(out, /WORKING_TREE_REJECTS_v1/);
  assert.match(out, /task=task-123/);
  assert.match(out, /file=src\/foo\.ts/);
  assert.match(out, /hunk#0/);
  assert.match(out, /use snake_case/);
  assert.match(out, /原内容/);
  assert.match(out, /改写为/);
});

test('renderWorkingTreeRejectsForPrompt skips entries with non-string file', () => {
  const entries = [
    { taskId: 'a', file: null, hunkIndex: 0, feedback: 'x' },
    { taskId: 'b', file: 'ok.ts', hunkIndex: 0, feedback: 'ok' },
  ];
  const out = renderWorkingTreeRejectsForPrompt(entries);
  assert.doesNotMatch(out, /task=a/);
  assert.match(out, /task=b/);
});

test('renderWorkingTreeRejectsForPrompt truncates by char budget', () => {
  const longFeedback = 'A'.repeat(8000);
  const entries = Array.from({ length: 20 }, (_, i) => ({
    taskId: `task-${i}`,
    file: `src/file-${i}.ts`,
    hunkIndex: i,
    feedback: longFeedback,
    oldText: 'x'.repeat(200),
    newText: 'y'.repeat(200),
    rejectedAt: '2026-08-19T10:00:00.000Z',
  }));
  const out = renderWorkingTreeRejectsForPrompt(entries);
  // Limit caps at 10
  const matches = out.match(/task=task-/g) || [];
  assert.ok(matches.length <= 10, `expected <=10 task entries, got ${matches.length}`);
});

test('renderWorkingTreeRejectsForPrompt treats missing feedback as (无反馈)', () => {
  const entries = [
    { taskId: 't', file: 'f.ts', hunkIndex: 0, feedback: '' },
  ];
  const out = renderWorkingTreeRejectsForPrompt(entries);
  assert.match(out, /\(无反馈\)/);
});

test('loadWorkingTreeRejectEntries returns [] when dir absent', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-reject-'));
  try {
    const out = loadWorkingTreeRejectEntries(tmp);
    assert.deepEqual(out, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadWorkingTreeRejectEntries reads + sorts by rejectedAt desc + unlinks expired', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-reject-'));
  const dir = path.join(tmp, 'working-tree-review', 'rejects');
  fs.mkdirSync(dir, { recursive: true });

  const fresh = {
    taskId: 'fresh',
    file: 'src/x.ts',
    hunkIndex: 0,
    feedback: 'recent',
    oldText: 'a',
    newText: 'b',
    rejectedAt: new Date().toISOString(),
  };
  const old = {
    taskId: 'old',
    file: 'src/y.ts',
    hunkIndex: 0,
    feedback: 'stale',
    oldText: 'c',
    newText: 'd',
    rejectedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const bad = '{ not-json }';

  fs.writeFileSync(path.join(dir, 'fresh.json'), JSON.stringify(fresh));
  fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify(old));
  fs.writeFileSync(path.join(dir, 'bad.json'), bad);

  try {
    const out = loadWorkingTreeRejectEntries(tmp, { limit: 10 });
    assert.equal(out.length, 1);
    assert.equal(out[0].taskId, 'fresh');
    // old.json should have been unlinked
    assert.ok(!fs.existsSync(path.join(dir, 'old.json')), 'stale file should be pruned');
    assert.ok(fs.existsSync(path.join(dir, 'fresh.json')), 'fresh file should remain');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadWorkingTreeRejectEntries returns [] for non-directory path', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-reject-'));
  const file = path.join(tmp, 'a-file');
  fs.writeFileSync(file, 'x');
  try {
    assert.deepEqual(loadWorkingTreeRejectEntries(file), []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadWorkingTreeRejectEntries returns [] for invalid userDataDir', () => {
  assert.deepEqual(loadWorkingTreeRejectEntries(''), []);
  assert.deepEqual(loadWorkingTreeRejectEntries(null), []);
  assert.deepEqual(loadWorkingTreeRejectEntries(undefined), []);
  assert.deepEqual(loadWorkingTreeRejectEntries(123), []);
});

test('buildSystemPrompt injects reject block when ctxForPrompt carries entries', () => {
  const ctx = {
    page: 'desktop-project',
    pageTitle: 'demo',
    projectId: 'p-1',
    projectModality: 'single-cell',
    projectDatasets: [],
    projectJobs: [],
    projectHarnessSummary: null,
    activeJobHarnessSummary: null,
    workingTreeRejects: [
      { taskId: 't', file: 'src/x.ts', hunkIndex: 0, feedback: 'use 2-space indent' },
    ],
  };
  const out = helper.buildSystemPrompt(ctx, { provider: 'mock', providerLabel: 'mock', model: 'mock' });
  assert.match(out, /WORKING_TREE_REJECTS_v1/);
  assert.match(out, /use 2-space indent/);
});

test('buildSystemPrompt does not break when workingTreeRejects absent', () => {
  const ctx = {
    page: 'desktop-project',
    projectId: 'p-2',
    projectDatasets: [],
    projectJobs: [],
    projectHarnessSummary: null,
    activeJobHarnessSummary: null,
  };
  const out = helper.buildSystemPrompt(ctx, { provider: 'mock', providerLabel: 'mock', model: 'mock' });
  assert.doesNotMatch(out, /WORKING_TREE_REJECTS_v1/);
  // Still renders result / file-reference blocks
  assert.match(out, /CHAT_FILE_REF_URI_v1/);
});