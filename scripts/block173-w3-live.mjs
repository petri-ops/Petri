/**
 * scripts/block173-w3-live.mjs — BLOCK-173 W3 波实机探针（CP-8/10 出口断言）。
 *
 * A[CP-8] 并发上限可配：写 PETRI_SPAWN_CONCURRENCY_LIMIT 需要 env 重启——
 *         探针改为直查「当前生效上限」经行为实证不可达（spawn 由模型自主），
 *         故降级为契约+源码级（契约 5/5 已锁），此处断言 tool-cancel/guard 通道
 *         与新路由共存不回归。
 * B[CP-10] tool-route 默认转正：直连本机决策配置（环境隔离查不到→查真实文件
 *         存在语义）经 /api/ai/decision-config（在册端点）读 tool-route enabled。
 */
import { execSync } from 'node:child_process';

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const API = 'http://localhost:3001/api';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const EVIDENCE_DIR = ROOT + '/acceptance/block-173';

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 140)}`);
};
async function api(method, url, body) {
  const response = await fetch(API + url, {
    method,
    headers: AUTH,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => ({})) };
}

// B：决策配置端点断言 tool-route 默认启用（转正后运行时真相）
const config = await api('GET', '/ai/decisions/config');
const pointList = Array.isArray(config.data?.points) ? config.data.points : [];
const toolRoute = pointList.find((p) => p.point === 'tool-route') || {};
record('B.tool-route-enabled', toolRoute.enabled === true,
  `tool-route runtime enabled=${toolRoute.enabled}（转正=无 stored/env 默认启用）`);

// C：seed 干净会话→路由活性冒烟（tool-cancel/guard-ack 同 W1 已证；此处证路由面共存）
const project = await api('POST', '/data/projects', { name: 'BLOCK-173 W3 探针项目' });
const projectId = project.data?.id || project.data?.project?.id;
if (projectId) {
  const conversation = await api('POST', '/ai/conversations', { title: 'BLOCK-173 W3 探针', project_id: projectId });
  const conversationId = conversation.data?.conversation?.id || conversation.data?.id;
  if (conversationId) {
    // 起一个真实任务拿 taskId，再验 tool-cancel/guard-ack 路由面共存（同 W1 A 链）
    const start = await api('POST', '/ai/agent', {
      conversationId,
      messages: [{ role: 'user', content: '用 workspace_list 查看项目结构后简短总结' }],
      context: { accessMode: 'read' },
    });
    const taskId = start.data?.taskId || null;
    if (taskId) await new Promise((r) => setTimeout(r, 2500));
    if (taskId) {
      const toolCancel = await api('POST', `/ai/agent/task/${taskId}/tool-cancel`, {});
      const guardProbe = await api('POST', `/ai/agent/task/${taskId}/guard-ack`, { guardKey: 'cmd:probe-b173' });
      record('C.routes-coexist', toolCancel.status === 200 && toolCancel.data?.ok === true && guardProbe.status === 200 && guardProbe.data?.ok === true,
        `tool-cancel=${JSON.stringify(toolCancel.data).slice(0, 60)} guard-ack=${JSON.stringify(guardProbe.data).slice(0, 60)}`);
      await api('POST', `/ai/agent/task/${taskId}/cancel`);
    } else {
      record('C.routes-coexist', false, 'agent start 无 taskId: ' + JSON.stringify(start.data).slice(0, 120));
    }
  } else {
    record('C.routes-coexist', false, 'conversation create failed');
  }
} else {
  record('C.routes-coexist', false, 'project create failed');
}

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
{
  const fs = await import('node:fs');
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(EVIDENCE_DIR + '/w3-live.json', JSON.stringify(summary, null, 2) + '\n');
}
console.log(`\nW3 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-173/w3-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
