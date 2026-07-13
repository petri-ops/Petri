import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

test('Agent step submission closes through task, tool_job and artifact truth', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-step-bridge-test-'));
  const script = `
    const fs = require('fs');
    const path = require('path');
    const registry = require('./vendor/biof3-core/r-server/mcp/registry');
    const db = require('./vendor/biof3-core/r-server/db');
    const taskStore = require('./vendor/biof3-core/r-server/task-store');
    const { syncStepToolCompleted } = require('./vendor/biof3-core/r-server/helpers/step-tool-job');
    (async () => {
      globalThis._biof3Plugins = new Map();
      const submitted = await registry.callTool('doublet', {
        ossInputUrl: 'https://example.test/input.rds',
        expectedDoubletRate: 0.08,
      }, { userId: 'agent-test', projectId: 'project-test' });
      const payload = JSON.parse(submitted.content[0].text);
      const task = taskStore.getTask(submitted.taskId);
      const resultDir = path.join(process.env.BIOF3_LOCAL_RESULTS_DIR, 'results', 'task-' + task.taskId);
      fs.mkdirSync(resultDir, { recursive: true });
      fs.writeFileSync(path.join(resultDir, 'plot_001_doublet.png'), 'png-data');
      fs.writeFileSync(path.join(resultDir, 'doublet_results.csv'), 'cell,doublet\\na,false\\n');
      syncStepToolCompleted(task, {
        plots: [{ name: 'Doublet Plot', filename: 'plot_001_doublet.png', url: '/api/files/plot' }],
        files: [{ name: 'doublet_results.csv', url: '/api/files/table' }],
        summary: { nCells: 1 },
      }, payload.execution);
      const job = db.getToolJob(submitted.toolJobId);
      process.stdout.write(JSON.stringify({
        submittedError: submitted.isError,
        taskType: task.type,
        linkedToolJobId: task.params.__harness.toolJobId,
        jobStatus: job.status,
        truth: job.result.artifactTruth,
        artifactNames: job.result.artifacts.map((item) => item.name),
      }));
    })().catch((error) => { console.error(error); process.exit(1); });
  `;
  const child = spawnSync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      BIOF3_DB_PATH: path.join(root, 'biof3.db'),
      BIOF3_RUN_MODE: 'platform',
      BIOF3_EXEC_MODE: 'local',
      BIOF3_STORAGE: 'local',
      BIOF3_TEMP_DIR: path.join(root, 'tasks'),
      BIOF3_LOCAL_RESULTS_DIR: path.join(root, 'results'),
    },
  });
  try {
    assert.equal(child.status, 0, child.stderr);
    const jsonStart = child.stdout.lastIndexOf('\n{');
    const payload = JSON.parse(child.stdout.slice(jsonStart >= 0 ? jsonStart + 1 : 0));
    assert.equal(payload.submittedError, false);
    assert.equal(payload.taskType, 'doublet');
    assert.match(payload.linkedToolJobId, /^tj_/);
    assert.equal(payload.jobStatus, 'completed');
    assert.equal(payload.truth.status, 'valid');
    assert.equal(payload.truth.validCount, 2);
    assert.deepEqual(payload.artifactNames.sort(), ['doublet_results.csv', 'plot_001_doublet.png']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
