#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const resources = process.env.G0_PACKAGED_RESOURCES;
if (!resources) throw new Error('G0_PACKAGED_RESOURCES is required');

const dbMod = require(path.join(resources, 'core/biof3-server/db.js'));
// Ensure the production conversation tables exist before inserting the
// sanitized fixture. This is the same module used by the real route layer.
require(path.join(resources, 'core/biof3-server/helpers/conversations.js'));
const {
  buildLoopRun,
  buildIteration,
} = require(path.join(resources, 'core/shared-backend/loop-contract.js'));

const db = dbMod.getDatabase();
const now = new Date().toISOString();
const project = db.prepare('SELECT * FROM projects ORDER BY updated_at DESC LIMIT 1').get();
if (!project) throw new Error('visual_fixture_project_missing');

db.prepare('UPDATE projects SET name=?, description=?, updated_at=? WHERE id=?')
  .run('LF12 脱敏 Bulk RNA 分析', '只含合成示例数据的资格验收项目', now, project.id);

const conversationId = 'conv_lf12_visual';
const taskId = 'task_lf12_visual';
const loopRunId = 'loop_lf12_visual';
const userId = 'local-user';

db.prepare(`
  INSERT OR REPLACE INTO copilot_conversations(
    id, user_id, title, status, last_page, project_id, message_count, created_at, updated_at
  ) VALUES (?, ?, ?, 'active', '/workspace', ?, 2, ?, ?)
`).run(conversationId, userId, 'Bulk RNA 差异分析与交付', project.id, now, now);

db.prepare('DELETE FROM copilot_messages WHERE conversation_id=?').run(conversationId);
db.prepare(`
  INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  'msg_lf12_user',
  conversationId,
  'user',
  '请对脱敏示例 count 矩阵完成差异分析，并交付图、表与可复现脚本。',
  '{}',
  now,
);
db.prepare(`
  INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts)
  VALUES (?, ?, ?, ?, ?, ?)
`).run(
  'msg_lf12_assistant',
  conversationId,
  'assistant',
  '分析目标已完成：DESeq2 结果、差异基因表和报告均已通过 Artifact 校验；输入、参数、脚本与 Provenance 已保留，可直接复现。',
  JSON.stringify({
    processingDurationMs: 48210,
    progressUpdates: [
      { iteration: 1, content: '开始检查脱敏输入结构。' },
      { iteration: 2, content: '输入结构与样本设计已确认。' },
      { iteration: 3, content: 'DESeq2 分析与 Artifact 校验已完成。' },
      { iteration: 4, content: '图、表、报告与独立脚本已交付。' },
    ],
    toolActivities: [
      { key: 'lf12-read', name: 'workspace_read', status: 'success', durationMs: 18, actionLabel: '已读取', actionDetail: 'data/demo-counts.csv' },
      { key: 'lf12-deseq2', name: 'run_tool', status: 'success', durationMs: 41120, actionLabel: '已运行', actionDetail: 'deseq2', sideEffects: { createdFiles: 8 } },
      { key: 'lf12-validate', name: 'run_tool', status: 'success', durationMs: 920, actionLabel: '已验证', actionDetail: 'artifact truth' },
      { key: 'lf12-report', name: 'workspace_read', status: 'success', durationMs: 31, actionLabel: '已读取', actionDetail: 'results/report.html' },
    ],
  }),
  new Date(Date.now() + 1000).toISOString(),
);

db.prepare(`
  INSERT OR REPLACE INTO tasks(id, type, params, status, created_at, finished_at, error, user_id, agent_status)
  VALUES (?, 'agent_loop', ?, 'completed', ?, ?, NULL, ?, 'done')
`).run(
  taskId,
  JSON.stringify({
    conversationId,
    context: { projectId: project.id },
    accessMode: 'full',
    fixture: 'g0-lf12-sanitized-visual',
  }),
  now,
  now,
  userId,
);

const run = buildLoopRun({
  loopRunId,
  projectId: project.id,
  conversationId,
  taskSpecRef: 'lf12-visual-task@1',
  automationMode: 'trusted',
  executionIntent: 'task_execute',
  loopStatus: 'completed',
  createdAt: now,
  updatedAt: now,
  metadata: { fixture: 'sanitized-visual', taskId },
});
db.prepare('DELETE FROM loop_iterations WHERE loop_run_id=?').run(loopRunId);
db.prepare('DELETE FROM loop_runs WHERE loop_run_id=?').run(loopRunId);
dbMod.persistLoopRun(run);

const conclusions = [
  ['continue', 'VALID_INPUTS_CONFIRMED', '脱敏输入结构与样本设计已确认。'],
  ['continue', 'TOOL_SUCCEEDED', 'DESeq2 分析完成，正式 Artifact 已生成。'],
  ['continue', 'TOOL_VERIFIED', '图、表、参数、脚本与 Provenance 已通过校验。'],
  ['complete', 'GOAL_ACHIEVED', '任务目标已达成，可复现结果已交付。'],
];
let parentIterationHash = null;
for (let index = 0; index < conclusions.length; index += 1) {
  const [decision, reason, publicConclusion] = conclusions[index];
  const iteration = buildIteration({
    iterationId: `iter_lf12_${index + 1}`,
    loopRunId,
    sequence: index + 1,
    observedStateDigest: `lf12-visual-state-${index + 1}`,
    goalGapIds: decision === 'complete' ? [] : [`lf12-gap-${index + 1}`],
    decision,
    decisionReasonCode: reason,
    publicConclusion,
    status: 'succeeded',
    parentIterationHash,
    createdAt: new Date(Date.now() + (index + 2) * 1000).toISOString(),
  });
  dbMod.persistLoopIteration(iteration);
  parentIterationHash = iteration.hash;
}

const workspace = project.workspace_path;
if (workspace) {
  fs.mkdirSync(path.join(workspace, 'data'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'results'), { recursive: true });
  fs.writeFileSync(path.join(workspace, 'README.md'), '# LF12 脱敏资格项目\n\n所有数据均为合成示例。\n');
  fs.writeFileSync(path.join(workspace, 'data', 'sample-metadata.csv'), 'sample,condition\nS1,Control\nS2,Treatment\n');
}

console.log(JSON.stringify({ seeded: true, projectCount: 1, conversationCount: 1, iterationCount: conclusions.length }));
