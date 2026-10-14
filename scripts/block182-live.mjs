#!/usr/bin/env node
/**
 * scripts/block182-live.mjs — BLOCK-182 记忆生命周期实机探针（隔离后端+mock provider）。
 *
 * 三链：
 *  A 审批门：mock 模型调 workspace_write .petri/MEMORY.md → deny 信封 memory guardKey →
 *    探针以用户身份 guard-ack 放行一次 → 重试真实写入（文件落盘）。
 *  B 纠错流：POST 事实 → PUT 改内容 → 旧行 superseded 链+新行 active（免费直生效）+审计。
 *  C 惰性衰减：DB 直改 updated_at 至 91 天前 → GET facts 触发惰性衰减 → status=decayed。
 * 证据=acceptance/block-182/block182-live.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  spawnIsolatedBackend, startMockProvider, collectTaskEvents, defaultTmpDir, AUTH,
} from './lib/evals-harness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmpDir = defaultTmpDir('petri-block182-');
const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 200)}`);
}

async function api(apiBase, method, url, body) {
  const r = await fetch(apiBase + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

const mock = startMockProvider();
const mockPort = await mock.ready;
process.env.PETRI_EVALS_BASE_URL = `http://127.0.0.1:${mockPort}/v1`; // 必须先于后端 spawn（preset 种子在 spawn 时写盘）
const backend = await spawnIsolatedBackend({ root, tmpDir });
console.log(`[block182] backend=${backend.ok ? 'up' : 'DOWN'} @${backend.port} mock=${mockPort}`);
const apiBase = backend.api;

try {
  if (!backend.ok) throw new Error('backend DOWN');
  const project = await api(apiBase, 'POST', '/api/data/projects', { name: 'block182' });
  const projectId = project.json?.project?.id || project.json?.data?.id;
  const conv = await api(apiBase, 'POST', '/api/ai/conversations', { title: 'block182', project_id: projectId });
  const conversationId = conv.json?.conversation?.id || conv.json?.data?.conversation?.id || conv.json?.data?.id;

  // ── A. 审批门全链：MEMORY.md 写入 → deny(requestId) → approve once → 真实写入 ──
  // 档案提取 sink 置队首（其请求体含全部会话历史标记，会抢 toolCalls 回合——批次B 教训）。
  mock.push(
    { whenIncludes: '用户档案抽取助手', content: '[]' },
    { whenIncludes: '用户档案抽取助手', content: '[]' },
    { whenIncludes: 'BLOCK182A', toolCalls: [{ name: 'workspace_write', arguments: { path: '.petri/MEMORY.md', content: '# 项目记忆\n\n用户长期使用 Python 生态做单细胞分析。' } }] },
    { whenIncludes: 'BLOCK182A', delayMs: 2500, toolCalls: [{ name: 'workspace_write', arguments: { path: '.petri/MEMORY.md', content: '# 项目记忆\n\n用户长期使用 Python 生态做单细胞分析。' } }] },
    { whenIncludes: 'BLOCK182A', content: '项目记忆已写入（经用户审批放行）。BLOCK182A' },
  );
  const start = await api(apiBase, 'POST', '/api/ai/agent', {
    conversationId,
    modelPresetId: 'evals-provider',
    messages: [{ role: 'user', content: '请把「用户长期使用 Python 生态做单细胞分析」写入项目记忆文件。BLOCK182A' }],
    context: { accessMode: 'full', projectId },
  });
  const taskId = start.json?.taskId;
  record('A.task-started', Boolean(taskId), `taskId=${taskId}`);
  let approved = false;
  const events = await collectTaskEvents(apiBase, taskId, {
    timeoutMs: 90_000,
    onEvent: async (ev) => {
      const data = ev.toolResult && ev.toolResult.data;
      if (!approved && data && data.error === 'dynamic_guard_triggered' && data.requestId && String(data.guardKey || '').startsWith('memory:')) {
        approved = true;
        const ack = await api(apiBase, 'POST', `/api/ai/agent/task/${encodeURIComponent(taskId)}/guard-ack`, { requestId: data.requestId, decision: 'approve' });
        record('A.guard-ack', ack.status === 200, `requestId=${data.requestId} status=${ack.status}`);
      }
    },
  });
  const denyEv = events.find((e) => e.toolResult?.data?.error === 'dynamic_guard_triggered' && String(e.toolResult?.data?.guardKey || '').startsWith('memory:'));
  record('A.deny-envelope', Boolean(denyEv), denyEv ? `guardKey=${denyEv.toolResult.data.guardKey} requestId=${denyEv.toolResult.data.requestId}` : '无 memory 维度拦截');
  const execEv = events.find((e) => e.event === 'tool_result' && e.name === 'workspace_write' && e.toolResult?.status === 'success');
  record('A.approved-exec', Boolean(execEv) && approved, approved ? '审批后真实执行' : '审批未发生即执行');
  const memoryFile = (function find(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { const hit = find(full); if (hit) return hit; }
      else if (full.replaceAll('\\', '/').endsWith('/.petri/MEMORY.md')) return full;
    }
    return null;
  })(tmpDir);
  record('A.file-written', Boolean(memoryFile), memoryFile ? `内容含 Python=${fs.readFileSync(memoryFile, 'utf8').includes('Python')}` : 'MEMORY.md 未落盘');

  // ── B. 纠错流：POST → PUT 改内容 → superseded 链 + 审计 ──
  const created = await api(apiBase, 'POST', '/api/ai/facts', { category: 'preference', content: '用户使用 Stan 做贝叶斯建模', source: 'auto' });
  const factId = created.json?.fact?.id;
  record('B.fact-created', Boolean(factId), `id=${factId}`);
  const corrected = await api(apiBase, 'PUT', `/api/ai/facts/${encodeURIComponent(factId)}`, { content: '用户使用 PyMC 做贝叶斯建模' });
  const cf = corrected.json?.fact || {};
  record('B.correction-applied', corrected.status === 200 && cf.status === 'active' && /PyMC/.test(String(cf.content || '')), `newId=${cf.id} correctedFrom=${cf.correctedFrom}`);
  const oldRow = (await api(apiBase, 'GET', '/api/ai/facts')).json?.facts?.find((f) => f.id === factId);
  record('B.old-superseded', oldRow && oldRow.status === 'superseded' && oldRow.superseded_by === cf.id, `old.status=${oldRow?.status} → ${oldRow?.superseded_by}`);
  const audit = (await api(apiBase, 'GET', '/api/ai/memory-audit')).json?.events || [];
  record('B.audit-chain', audit.some((e) => e.action === 'correction') && audit.some((e) => e.action === 'supersede'), `audit n=${audit.length} actions=${[...new Set(audit.map((e) => e.action))].join(',')}`);

  // ── C. 惰性衰减：91 天前的 auto 事实经 GET facts 触发 decay ──
  const stale = await api(apiBase, 'POST', '/api/ai/facts', { category: 'task_state', content: '用户正在做旧任务', source: 'auto' });
  const staleId = stale.json?.fact?.id;
  const Database = (await import('node:module')).createRequire(import.meta.url)('better-sqlite3');
  const db = new Database(path.join(tmpDir, 'petri.db'));
  const oldTs = new Date(Date.now() - 91 * 86400_000).toISOString();
  db.prepare("UPDATE user_facts SET updated_at=?, created_at=? WHERE id=?").run(oldTs, oldTs, staleId);
  db.close();
  const afterDecay = await api(apiBase, 'GET', '/api/ai/facts');
  const staleRow = afterDecay.json?.facts?.find((f) => f.id === staleId);
  record('C.lazy-decay', staleRow && staleRow.status === 'decayed', `status=${staleRow?.status}`);
  const decayAudit = (await api(apiBase, 'GET', '/api/ai/memory-audit')).json?.events || [];
  record('C.decay-audit', decayAudit.some((e) => e.action === 'decay' && e.factId === staleId), 'decay 动作入审计');

  const ok = results.every((r) => r.ok);
  console.log(`\n[block182] 总体：${ok ? 'PASS' : 'FAIL'}`);
  process.exitCode = ok ? 0 : 1;
} finally {
  const evidenceDir = path.join(root, 'acceptance', 'block-182');
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'block182-live.json'), JSON.stringify({ at: new Date().toISOString(), results }, null, 2));
  await backend.cleanup();
  await mock.close();
}
