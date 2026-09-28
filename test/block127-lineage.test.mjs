'use strict';

/**
 * BLOCK-127（BIO-3 P1）— lineage 投影契约。
 *
 * 数据真相=result_workflow_graphs 表（Job/Revision/Selection 真值投影的权威
 * 图）。本包补的是「用户可见的祖先链」投影纯函数 + 按项目列图的仓库方法 +
 * 只读端点。纯函数不猜语义：job 不在图中诚实返回 null。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const require = createRequire(import.meta.url);
const { buildLineageChain } = require('../core/shared-backend/result-studio-lineage.js');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository.js');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema.js');
const {
  ensureResultWorkflowGraphSchema,
  workflowGraphDigest,
} = require('../core/shared-backend/result-workflow-graph.js');

// 图按内容寻址持久化（sourceDigest/graphId 由 workflowGraphDigest 派生），
// fixture 必须走同一派生；节点字段集/SHA256 provenanceHash/有序唯一数组
// 均为 verifyWorkflowGraphIntegrity 的硬校验。
const mkNode = (toolJobId, toolId, dependsOn = []) => ({
  id: `job:${toolJobId}`,
  toolJobId,
  toolId,
  artifactIds: ['artifact_main'],
  provenanceHash: 'a'.repeat(64),
  dependsOn: [...dependsOn].sort(),
});
// 图按内容寻址持久化（sourceDigest/graphId 由 workflowGraphDigest 派生）且
// verifyWorkflowGraphIntegrity 硬校验节点字段集/SHA256/有序唯一数组/边与
// dependsOn 一致——fixture 从节点依赖自动派生合法 artifact 边，不手拼假值。
const graph = (nodes) => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = [];
  for (const node of nodes) {
    for (const parentId of node.dependsOn) {
      const parent = byId.get(parentId);
      edges.push({
        kind: 'artifact',
        fromNodeId: parent.id,
        toNodeId: node.id,
        sourceToolJobId: parent.toolJobId,
        sourceRevisionId: `rev_${parent.toolJobId}`,
        sourceArtifactId: parent.artifactIds[0],
        sourceOutputHash: 'b'.repeat(64),
        selectionId: null,
        selectionHash: null,
        inputId: null,
      });
    }
  }
  const base = {
    projectId: 'p1',
    rootToolJobId: nodes[0].toolJobId,
    contractVersion: 1,
    validationStatus: 'valid',
    nodes,
    edges,
  };
  const sourceDigest = workflowGraphDigest(base);
  return { ...base, sourceDigest, graphId: `wfg_${sourceDigest.slice(0, 24)}` };
};

test('buildLineageChain returns ancestor chain upstream-first with the current node last', () => {
  const chain = buildLineageChain(graph([
    mkNode('j1', 'validator'),
    mkNode('j2', 'deseq2', ['job:j1']),
    mkNode('j3', 'go-kegg', ['job:j2']),
  ]), 'j3');
  assert.ok(chain, 'job in graph must resolve');
  assert.deepEqual(chain.chain.map((n) => n.toolJobId), ['j1', 'j2', 'j3']);
  assert.equal(chain.chain[2].isCurrent, true);
  assert.equal(chain.chain[0].isCurrent, false);
  assert.equal(chain.downstreamCount, 0, 'terminal node has no downstream');
});

test('buildLineageChain reports direct downstream for a mid-chain job', () => {
  const chain = buildLineageChain(graph([
    mkNode('j1', 'validator'),
    mkNode('j2', 'deseq2', ['job:j1']),
    mkNode('j3', 'go-kegg', ['job:j2']),
    mkNode('j4', 'volcano-plot', ['job:j2']),
  ]), 'j2');
  assert.deepEqual(chain.chain.map((n) => n.toolJobId), ['j1', 'j2']);
  assert.equal(chain.downstreamCount, 2, 'two direct children depend on j2');
});

test('buildLineageChain survives dependency cycles without hanging or lying', () => {
  const chain = buildLineageChain(graph([
    mkNode('a', 't', ['job:b']),
    mkNode('b', 't', ['job:a']),
  ]), 'a');
  assert.ok(Array.isArray(chain.chain) && chain.chain.length >= 1);
  assert.equal(chain.chain[chain.chain.length - 1].toolJobId, 'a');
});

test('buildLineageChain returns null for a job not present in the graph', () => {
  assert.equal(buildLineageChain(graph([
    mkNode('j1', 't'),
  ]), 'missing'), null);
  assert.equal(buildLineageChain(null, 'j1'), null);
});

test('repository lists project workflow graphs newest-first and the projection finds the containing graph', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'block127-'));
  const sqlite = new Database(path.join(root, 'biof3.db'));
  sqlite.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY, workspace_path TEXT NOT NULL);`);
  ensureResultStudioSchema(sqlite);
  ensureResultWorkflowGraphSchema(sqlite);
  const repository = createResultStudioRepository(sqlite, { ensureSchema: false });
  repository.saveWorkflowGraph(graph([
    mkNode('j1', 'deseq2'),
  ]));
  const listed = repository.listProjectWorkflowGraphs('p1');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].nodes[0].toolJobId, 'j1');

  // 多图场景：含目标 job 的新图命中。
  repository.saveWorkflowGraph(graph([
    mkNode('j1', 'deseq2'),
    mkNode('j2', 'go-kegg', ['job:j1']),
  ]));
  const listed2 = repository.listProjectWorkflowGraphs('p1');
  assert.equal(listed2.length, 2);
  const hit = listed2.map((g) => buildLineageChain(g, 'j2')).find(Boolean);
  assert.ok(hit, 'newer graph containing j2 is found');
  assert.equal(hit.chain[hit.chain.length - 1].toolJobId, 'j2');
  sqlite.close();
});
