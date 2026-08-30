import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const tempRoot = mkdtempSync(join(tmpdir(), 'biof3-project-memory-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'memory.db');

const dbMod = require('../core/biof3-server/db.js');
const sqlite = dbMod.getDatabase();
const memories = require('../core/biof3-server/helpers/memory-vectors.js');
const facts = require('../core/biof3-server/helpers/user-facts.js');
const summaries = require('../core/biof3-server/helpers/chat-summary.js');
const { buildSiteSnapshotAsync } = require('../core/biof3-server/helpers/site-snapshot.js');
const { tool_query, tool_search } = require('../core/biof3-server/agent-tools/query-tools.js');

const userId = 'user-memory-test';
const projectA = 'project-memory-a';
const projectB = 'project-memory-b';
const now = new Date().toISOString();

sqlite.prepare('INSERT INTO projects(id, name, description, created_at, updated_at, user_id) VALUES (?,?,?,?,?,?)')
  .run(projectA, '项目 A', '', now, now, userId);
sqlite.prepare('INSERT INTO projects(id, name, description, created_at, updated_at, user_id) VALUES (?,?,?,?,?,?)')
  .run(projectB, '项目 B', '', now, now, userId);

test.after(() => {
  try { sqlite.close(); } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
});

test('vector memories are retrieved only inside their exact project scope', () => {
  const vec = new Float32Array([1, 0, 0, 0]);
  memories.saveMemoryVector({ userId, projectId: projectA, kind: 'chat_turn', content: 'A 项目记忆', vec });
  memories.saveMemoryVector({ userId, projectId: projectB, kind: 'chat_turn', content: 'B 项目记忆', vec });
  memories.saveMemoryVector({ userId, kind: 'chat_turn', content: '全局旧记忆', vec });

  assert.deepEqual(memories.retrieveMemories(userId, vec, 10, 0, projectA).map((item) => item.content), ['A 项目记忆']);
  assert.deepEqual(memories.retrieveMemories(userId, vec, 10, 0, projectB).map((item) => item.content), ['B 项目记忆']);
  assert.deepEqual(memories.retrieveMemories(userId, vec, 10, 0).map((item) => item.content), ['全局旧记忆']);
});

test('structured facts and summaries remain independent per project', async () => {
  await facts.upsertUserFactAsync({ userId, projectId: projectA, category: 'note', content: 'A 项目事实' });
  await facts.upsertUserFactAsync({ userId, projectId: projectB, category: 'note', content: 'B 项目事实' });
  await facts.upsertUserFactAsync({ userId, category: 'preference', content: '全局偏好' });

  assert.match(await facts.buildFactsBlockAsync(userId, 1200, projectA), /A 项目事实/);
  assert.doesNotMatch(await facts.buildFactsBlockAsync(userId, 1200, projectA), /B 项目事实|全局偏好/);
  assert.match(await facts.buildFactsBlockAsync(userId, 1200), /全局偏好/);

  await summaries.saveChatSummaryAsync(userId, projectA, 'A 项目摘要', 12);
  await summaries.saveChatSummaryAsync(userId, projectB, 'B 项目摘要', 8);
  await summaries.saveChatSummaryAsync(userId, null, '全局摘要', 4);

  assert.equal((await summaries.getChatSummaryAsync(userId, projectA)).summary, 'A 项目摘要');
  assert.equal((await summaries.getChatSummaryAsync(userId, projectB)).summary, 'B 项目摘要');
  assert.equal((await summaries.getChatSummaryAsync(userId)).summary, '全局摘要');
});

test('Agent query/search tools cannot read another project memory', async () => {
  const queryCtxA = { userId, projectId: projectA };
  const factRows = await tool_query({ resource: 'facts', limit: 20 }, queryCtxA);
  const memoryRows = await tool_query({ resource: 'memories', limit: 20 }, queryCtxA);
  assert.deepEqual(factRows.map((row) => row.content), ['A 项目事实']);
  assert.deepEqual(memoryRows.map((row) => row.content), ['A 项目记忆']);

  const searchRows = await tool_search(
    { q: '项目记忆', scope: 'memories', topK: 10 },
    {
      ...queryCtxA,
      dashscopeEmbed: async () => [new Float32Array([1, 0, 0, 0])],
      cosineSim: memories.cosineSim,
    }
  );
  assert.equal(searchRows.length, 1);
  assert.match(searchRows[0].summary, /A 项目记忆/);
});

test('project prompt snapshot contains only the active project resources', async () => {
  const snapshot = await buildSiteSnapshotAsync(userId, { projectId: projectA });
  assert.equal(snapshot.scopeProjectId, projectA);
  assert.deepEqual(snapshot.projects.map((project) => project.id), [projectA]);
});
