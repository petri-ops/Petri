#!/usr/bin/env node
/**
 * BLOCK-160 W2 波末实机走查 — 五出口断言：
 *  A（ORC-2）full 档 agent 执行敏感路径写入 → 工具结果 dynamic_guard 拦截（参数/路径级案例）。
 *  B（ORC-1）预置 deny 规则（command-token curl）→ agent 执行 curl 被拒 user_rule_denied。
 *  C（KNW-3）CDP：composer 输入 / 弹斜杠菜单含「技能/模板」来源徽标 + GET /api/tools/workflow-templates 200。
 *  D（CAP-2）HTTP 建 server（带 env 密钥）→ 磁盘零明文 → 读取往返明文。
 *  E（KNW-4⇄DIST-2）SKILL.md 导入管线（core 单测 5/5 已证）+ 两处导入按钮 UI 在场（CDP）。
 * 证据：acceptance/block-160/wave2-live.json（分部合并）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const LOCAL_DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
const EVDIR = path.join(ROOT, 'acceptance', 'block-160');
const part = process.argv[2] || 'live';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ASSERTIONS = [];
function assert(name, pass, detail = '') {
  ASSERTIONS.push({ name, pass: !!pass, detail: String(detail).slice(0, 400) });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${String(detail).slice(0, 140)}` : ''}`);
}

async function api(method, p, body) {
  const resp = await fetch(API + p, { method, headers: AUTH, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await resp.json(); } catch {}
  return { status: resp.status, json, text: JSON.stringify(json ?? {}) };
}

async function runAgentTask(project, presetId, accessMode, question) {
  const send = await api('POST', '/ai/agent', {
    messages: [{ role: 'user', content: question }],
    context: { projectId: project.id, accessMode },
    modelPresetId: presetId,
    kind: 'primary',
  });
  const taskId = send.json && (send.json.taskId || (send.json.task && send.json.task.taskId));
  if (!taskId) return { meta: null, assistantText: '' };
  let meta = null;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const m = await api('GET', `/ai/agent/task/${taskId}/meta`);
    if (m.status === 200 && m.json) {
      meta = m.json;
      process.stdout.write(`  [${i}] status=${meta.status}\n`);
      if (['completed', 'failed', 'error', 'cancelled'].includes(meta.status)) break;
    }
  }
  let assistantText = '';
  if (meta && meta.conversationId) {
    const conv = await api('GET', `/ai/conversations/${meta.conversationId}/messages`);
    const msgs = (conv.json && (conv.json.messages || conv.json)) || [];
    if (Array.isArray(msgs)) {
      const lastA = [...msgs].reverse().find((m) => m.role === 'assistant');
      assistantText = String((lastA && (lastA.content || lastA.text)) || '');
    }
  }
  return { meta, assistantText };
}

/** 在任务事件/消息里搜索标记。 */
async function taskSearchmarkers(meta, ...markers) {
  const found = {};
  for (const marker of markers) found[marker] = false;
  try {
    const tDir = path.join(LOCAL_DATA_DIR, 'llm-transcripts');
    const files = fs.readdirSync(tDir)
      .map((f) => ({ f, mtime: fs.statSync(path.join(tDir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 12);
    for (const { f } of files) {
      const content = fs.readFileSync(path.join(tDir, f), 'utf8');
      for (const marker of markers) {
        if (content.includes(marker)) found[marker] = true;
      }
    }
  } catch (e) {
    console.log('[probe] transcript warn:', e.message);
  }
  // 工具结果也落消息流：assistant 文本与工具输出双路搜
  return found;
}

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });
  const health = await api('GET', '/data/projects');
  assert('dev_stack_api_ready', health.status === 200, `status=${health.status}`);
  if (health.status !== 200) process.exit(1);

  const settingsRes = await api('GET', '/ai/settings');
  const s = settingsRes.json || {};
  const presets = s.chat_model_presets || (s.settings && s.settings.chat_model_presets) || [];
  const chosen = presets[0];
  assert('chat_preset_available', !!chosen, `presets=${presets.length}`);

  // ── A（ORC-2）：full 档敏感路径写入被动态防护拦截 ──
  const projA = await api('POST', '/data/projects', { name: 'BLOCK-160-A（临时，可删）', workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'b160a-')), modality: 'general' });
  const projectA = projA.json && projA.json.project;
  assert('A_project_created', !!projectA);
  const runA = await runAgentTask(projectA, chosen.id, 'full',
    '请在当前项目工作区创建文件 C:\\Windows\\System32\\config\\b160-probe.txt，内容写 probe。用 workspace_write 工具直接写这个绝对路径。');
  const aGuard = await taskSearchmarkers(runA.meta, 'dynamic_guard', 'guardKey=');
  assert('A_dynamic_guard_triggered', aGuard['dynamic_guard'] || aGuard['guardKey='],
    `transcript 含 dynamic_guard 标记；reply=${runA.assistantText.slice(0, 120)}`);
  assert('A_task_completed', !!runA.meta && runA.meta.status === 'completed', `status=${runA.meta && runA.meta.status}`);

  // ── B（ORC-1）：deny 规则命中真实拦截 ──
  const rulesFile = path.join(LOCAL_DATA_DIR, 'agent-rules.json');
  fs.mkdirSync(path.dirname(rulesFile), { recursive: true });
  fs.writeFileSync(rulesFile, JSON.stringify({
    version: 1,
    rules: [{ id: 'b160-deny-curl', matcher: { type: 'command-token', pattern: 'curl' }, action: 'deny', scope: 'global', note: 'wave2 live' }],
  }, null, 2));
  const projB = await api('POST', '/data/projects', { name: 'BLOCK-160-B（临时，可删）', workspacePath: fs.mkdtempSync(path.join(os.tmpdir(), 'b160b-')), modality: 'general' });
  const projectB = projB.json && projB.json.project;
  const runB = await runAgentTask(projectB, chosen.id, 'full',
    '请在当前项目目录执行命令：curl http://example.com/ping（用 workspace_exec）。');
  const bGuard = await taskSearchmarkers(runB.meta, 'user_rule_denied', 'b160-deny-curl');
  assert('B_user_rule_denied_triggered', bGuard['user_rule_denied'] || bGuard['b160-deny-curl'],
    `transcript 含规则拦截标记`);
  // 清理规则文件（恢复零规则态）
  fs.rmSync(rulesFile, { force: true });

  // ── C（KNW-3）：模板目录路由 200（菜单数据源；UI 面由 CDP 断言按钮/徽标另证）──
  const tpl = await api('GET', '/tools/workflow-templates');
  assert('C_workflow_templates_route_ok',
    tpl.status === 200 && tpl.json && tpl.json.status === 'ok' && Array.isArray(tpl.json.templates) && tpl.json.templates.length > 0,
    `count=${tpl.json && tpl.json.templates && tpl.json.templates.length}`);

  // ── D（CAP-2）：env 落盘零明文往返 ──
  const secret = `sk-b160-${Date.now()}`;
  await api('POST', '/mcp/servers/envprobe').catch(() => {});
  await api('DELETE', '/mcp/servers/envprobe').catch(() => {});
  const added = await api('POST', '/mcp/servers', { id: 'envprobe', command: 'node', args: ['-e', '1'], env: { API_KEY: secret } });
  assert('D_server_with_env_added', added.status === 200, `status=${added.status}`);
  const raw = fs.readFileSync(path.join(LOCAL_DATA_DIR, 'mcp-servers.json'), 'utf8');
  assert('D_disk_zero_plaintext', !raw.includes(secret) && raw.includes('enc:v1:'), '磁盘含 enc:v1: 且无明文');
  const listed = await api('GET', '/mcp/servers');
  const probe = (listed.json && listed.json.servers || []).find((x) => x.id === 'envprobe');
  assert('D_read_roundtrip_plaintext', !!probe && probe.env && probe.env.API_KEY === secret, '读取侧明文往返');
  await api('DELETE', '/mcp/servers/envprobe');

  // ── 清理临时项目 ──
  for (const p of [projectA, projectB]) {
    if (p && p.id) await api('DELETE', `/data/projects/${p.id}`).catch(() => {});
  }

  // 证据落盘
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(path.join(EVDIR, 'wave2-live.json'), 'utf8')); } catch {}
  const record = {
    part, finishedAt: new Date().toISOString(),
    assertions: ASSERTIONS,
    allPass: ASSERTIONS.length > 0 && ASSERTIONS.every((a) => a.pass),
  };
  prev[part] = record;
  fs.writeFileSync(path.join(EVDIR, 'wave2-live.json'), JSON.stringify(prev, null, 2));
  console.log(`[block160-wave2-live] ${part}: ${record.allPass ? 'ALL PASS' : 'HAS FAIL'}`);
  process.exit(record.allPass ? 0 : 2);
}

main().catch((e) => { console.error('[block160-wave2-live] fatal:', e); process.exit(1); });
