/**
 * scripts/block172-w2-live.mjs — BLOCK-172 W2 波实机探针（CP-7 出口断言）。
 *
 * A[CP-7] 真实 agent 任务运行期间捕获 token_budget 事件（每轮发放，trimmed=false
 *         在场且 pct>0=预算环实数）；任务终态后事件数 ≥2 或含非危机发放。
 * B[CP-7] POST /ai/conversations/:id/compact 端点四态语义（below_threshold 诚实）。
 * C[CP-7] GET/PUT /ai/generation-defaults 往返（保存→回读一致→恢复）。
 */
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const API = 'http://localhost:3001/api';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = ROOT + '/acceptance/block-172';

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 140)}`);
};
async function api(method, url, body) {
  const response = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}
async function waitFor(fn, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 800));
  }
}

// 种子项目+会话
const project = await api('POST', '/data/projects', { name: 'BLOCK-172 W2 探针项目' });
const projectId = project.data?.id;
const conversation = await api('POST', '/ai/conversations', { title: 'BLOCK-172 W2 计量探针', project_id: projectId });
const conversationId = conversation.data?.conversation?.id || conversation.data?.id;
if (!conversationId) throw new Error('seed failed');

// A：启动真实任务（模型做两轮工具调用保证多迭代），轮询 task API 的 SSE 快照不可行
// （探针面直查 DB task_events：token_budget 事件计数与 trimmed=false 占比）。
const start = await api('POST', '/ai/agent', {
  conversationId,
  messages: [{ role: 'user', content: '分别用 workspace_list 和 workspace_search 两个工具查看当前项目结构，然后简短总结（不要做其他事）' }],
  context: { accessMode: 'read' },
});
const taskId = start.data?.taskId;
if (!taskId) {
  record('A.token-budget-stream', false, 'agent start 无 taskId: ' + JSON.stringify(start.data).slice(0, 140));
} else {
  await waitFor(async () => {
    const meta = await api('GET', `/ai/agent/task/${taskId}/meta`);
    const s = meta.data?.status || meta.data?.agentStatus;
    return ['done', 'failed', 'cancelled'].includes(String(s)) ? s : null;
  }, 120000);
  const Database = (await import('node:module')).createRequire(import.meta.url)(ROOT + '/node_modules/better-sqlite3');
  const db = new Database(ROOT + '/.petri-dev-user-data/data/petri.db', { readonly: true });
  const rows = db.prepare(
    "SELECT payload FROM task_events WHERE task_id = ? AND event_type = 'token_budget' ORDER BY seq"
  ).all(taskId);
  const payloads = rows.map((r) => { try { return JSON.parse(r.payload); } catch { return {}; } });
  const nonTrim = payloads.filter((p) => p.trimmed === false && (p.pct || 0) > 0);
  record('A.token-budget-stream', nonTrim.length >= 1,
    `token_budget 事件 ${payloads.length} 条（非危机发放 ${nonTrim.length} 条，pct 样本 ${nonTrim[0]?.pct ?? '—'}）`);
  db.close();
}

// B：compact 端点（新会话必然 below_threshold=诚实拒绝压缩）
const compact = await api('POST', `/ai/conversations/${conversationId}/compact`);
record('B.compact-endpoint', compact.status === 200 && compact.data?.status === 'ok' && compact.data?.compacted === false
  , `reason=${compact.data?.reason || JSON.stringify(compact.data).slice(0, 80)}`);

// C：generation-defaults 往返
const put = await api('PUT', '/ai/generation-defaults', { temperature: 0.7, maxTokens: 8192 });
const get1 = await api('GET', '/ai/generation-defaults');
record('C.generation-roundtrip', put.status === 200 && get1.data?.generation?.temperature === 0.7 && get1.data?.generation?.maxTokens === 8192,
  JSON.stringify(get1.data?.generation || {}));
// 恢复缺省（清空=删除键：save 空对象不会清——直接写回环境缺省形态：不保存 temperature/maxTokens）
const reset = await api('PUT', '/ai/generation-defaults', { temperature: null, maxTokens: null });
const get2 = await api('GET', '/ai/generation-defaults');
record('C.generation-reset', reset.status === 200 && get2.data?.generation && !('temperature' in get2.data.generation) && !('maxTokens' in get2.data.generation),
  JSON.stringify(get2.data?.generation || {}));

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
{
  const fs = await import('node:fs');
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_DIR + '/w2-live.json', JSON.stringify(summary, null, 2) + '\n');
}
console.log(`
W2 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-172/w2-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
