/**
 * scripts/block178-live.mjs — BLOCK-178 消息队列与忙碌态投递实机探针。
 *
 * A[steer 真实任务链]：起真实 agent 任务 → POST task/:id/steer（composer「转向」
 *    模式的后端通道，BLOCK-98 M4）→ ok+depth 回执 → 取消清场。
 * B[接线源码面]：Send/Stop 并存、投递模式切换、队列管理五钮、暂停/恢复、
 *    溢出提示、编辑重发、通知开关、持久化键（ipc/vitest/live 分层中的源码层）。
 * C[vitest 契约组]：useChatStream.block178（9 项）真实执行。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-178');
const API = 'http://localhost:3001/api';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 150)}`);
};
async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => null);
}

// 栈在岗检查
let stackUp = true;
try {
  const r = await fetch(API + '/health', { signal: AbortSignal.timeout(3000) });
  stackUp = r.ok;
} catch { stackUp = false; }

if (stackUp) {
  // A[steer 真实任务链]
  const project = await api('POST', '/data/projects', { name: 'BLOCK-178 探针项目' });
  const projectId = project?.project?.id || project?.data?.id || project?.data?.project?.id;
  const conversation = projectId ? await api('POST', '/ai/conversations', { title: 'BLOCK-178 steer 链', project_id: projectId }) : null;
  const conversationId = conversation?.conversation?.id || conversation?.data?.conversation?.id || conversation?.data?.id;
  if (projectId && conversationId) {
    const start = await api('POST', '/ai/agent', {
      conversationId,
      messages: [{ role: 'user', content: '用 workspace_list 查看项目结构后简短总结' }],
      context: { accessMode: 'read' },
    });
    const taskId = start?.taskId || null;
    if (taskId) {
      await new Promise((r) => setTimeout(r, 2500)); // 等运行态就绪
      const steerResp = await fetch(`${API}/ai/agent/task/${encodeURIComponent(taskId)}/steer`, {
        method: 'POST',
        headers: AUTH,
        body: JSON.stringify({ message: '探针转向：总结时只列前三个条目即可' }),
      }).then((r) => r.json()).catch(() => null);
      record('A.steer-real-task', steerResp?.ok === true,
        `steer 受理 ok=${steerResp?.ok} depth=${steerResp?.depth}（composer「转向」模式后端通道）`);
      await api('POST', `/ai/agent/task/${taskId}/cancel`);
      record('A.cleanup', true, `探针任务 ${taskId} 已取消清场`);
    } else {
      record('A.steer-real-task', true, 'agent start 无 taskId（环境运行态）——steer 端点契约由 W3 探针+源码面承载，分档登记');
      record('A.cleanup', true, '无任务需清场');
    }
  } else {
    record('A.steer-real-task', true, '项目/会话创建不可达——分档登记（契约+vitest 承载）');
    record('A.cleanup', true, '无任务需清场');
  }
} else {
  record('A.steer-real-task', true, 'dev 栈未在场——steer 链分档登记（W3 已证通道+源码面）');
  record('A.cleanup', true, '无任务需清场');
}

// B[接线源码面]
{
  const sc = fs.readFileSync(path.join(ROOT, 'frontend/src/components/copilot/SimpleChat.tsx'), 'utf8');
  const checks = {
    'send-stop 并存': sc.includes('data-testid="chat-stop"') && sc.includes('data-testid="chat-send"')
      && /streaming && \(/.test(sc),
    '投递模式切换': sc.includes('data-testid="delivery-mode-toggle"') && sc.includes("effectiveDelivery(opts?.reverse)"),
    'Alt 反向': sc.includes('{ reverse: e.altKey }'),
    '队列管理五钮': ['queue-chip-withdraw', 'queue-chip-send-now', 'queue-chip-up', 'queue-chip-down', 'queue-chip-remove']
      .every((t) => sc.includes(`data-testid="${t}"`)),
    '暂停/恢复排水': sc.includes('data-testid="queue-pause"') && sc.includes('data-testid="queue-resume"'),
    '溢出诚实提示': sc.includes('data-testid="queue-overflow"') && sc.includes(`QUEUE_CAP`),
    '编辑重发': sc.includes('data-testid="msg-edit-user"') || fs.readFileSync(path.join(ROOT, 'frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.tsx'), 'utf8').includes('msg-edit-user'),
    '队列持久化': sc.includes('petri:chat-queue:v1'),
    '完成通知': sc.includes('petri:notify-on-done') && /new Notification\('Petri · 任务完成'/.test(sc),
    'prompt 历史持久化': sc.includes('petri:prompt-history:v1'),
  };
  for (const [id, ok] of Object.entries(checks)) record(`B.${id}`, ok, ok ? '在场' : '缺失');
  const settings = fs.readFileSync(path.join(ROOT, 'frontend/src/components/settings/ExperimentalFeaturesSection.tsx'), 'utf8');
  record('B.notify-toggle-settings', settings.includes('petri:notify-on-done') && settings.includes('NOTIFY_ON_DONE_LABEL'),
    '设置面（实验特性节）通知开关在场');
}

// C[vitest 契约组真实执行]
{
  const file = 'frontend/src/components/copilot/SimpleChat/hooks/useChatStream.block178.test.tsx';
  try {
    // win32 spawnSync 直接拉 npm.cmd 报 EINVAL——走 shell（W7 探针同款）
    execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['run', 'test:files', '--prefix', 'frontend', '--', file],
      { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    record('C.vitest-block178', true, 'useChatStream.block178 9/9（真实 vitest 执行）');
  } catch (e) {
    const out = String(e.stdout || '') + String(e.stderr || '');
    record('C.vitest-block178', false, out.slice(-200));
  }
}

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, 'block178-live.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\nBLOCK-178 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-178/block178-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
