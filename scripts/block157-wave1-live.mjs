#!/usr/bin/env node
/**
 * BLOCK-157 W1 波末实机走查 — 三出口断言：
 *  A（KNW-1/2）真实模型 read 档自主发现并引用产品 skill（transcript toolCalls 含
 *              skill_discover + skill_get；assistant 引用 coding-playbook）。
 *  B（CAP-1）  workspace-write 档调用 readOnlyHint MCP 工具成功回流（低档可用实机全链；
 *              对照：无注释 execution/R2 工具在该档被 policy 拒——单测已钉，此处不重复）。
 *  C（DIST-1） 探针插件启用=tools/catalog 在场 → installed.json 翻 disabled+重启=消失
 *              （停用即不注册）→ 翻回+重启=复现（启用免重装）。
 * 用法：node scripts/block157-wave1-live.mjs part1|part2|cleanup
 * 证据：acceptance/block-157/wave1-live.json（分部合并）
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local', 'content-type': 'application/json' };
const LOCAL_DATA_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data');
const EVDIR = path.join(ROOT, 'acceptance', 'block-157');
const EVFILE = path.join(EVDIR, 'wave1-live.json');
const PROBE_ID = 'b157-probe-plugin';
const INSTALLED_FILE = path.join(LOCAL_DATA_DIR, 'plugins', 'installed.json');
const part = process.argv[2] || 'part1';
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
  if (!taskId) return { taskId: null, meta: null, assistantText: '', send };
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
  return { taskId, meta, assistantText, send };
}

/** 扫 llm-transcripts 本轮增量帧，断言工具名出现在 response.toolCalls。 */
function transcriptHasToolCall(sinceMs, toolName) {
  const tDir = path.join(LOCAL_DATA_DIR, 'llm-transcripts');
  let hit = false;
  try {
    const files = fs.readdirSync(tDir)
      .map((f) => ({ f, mtime: fs.statSync(path.join(tDir, f)).mtimeMs }))
      .filter((x) => x.mtime >= sinceMs - 60_000)
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, 40);
    outer:
    for (const { f } of files) {
      for (const line of fs.readFileSync(path.join(tDir, f), 'utf8').split('\n')) {
        if (!line.includes(toolName)) continue;
        let entry = null;
        try { entry = JSON.parse(line); } catch { continue; }
        const calls = entry && entry.response && Array.isArray(entry.response.toolCalls) ? entry.response.toolCalls : [];
        if (calls.some((c) => c && c.function && c.function.name === toolName)) { hit = true; break outer; }
      }
    }
  } catch (e) {
    console.log('[block157-live] transcript warn:', e.message);
  }
  return hit;
}

async function tempProject(name) {
  const wsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b157-ws-'));
  const proj = await api('POST', '/data/projects', { name, workspacePath: wsDir, modality: 'general' });
  return proj.json && proj.json.project;
}

function catalogHas(id) {
  return api('GET', '/tools/catalog').then((r) => {
    const entries = (r.json && (Array.isArray(r.json) ? r.json : r.json.tools || r.json.catalog)) || [];
    return { ok: r.status === 200, has: entries.some((e) => e && e.id === id), raw: r.text.slice(0, 200) };
  });
}

async function main() {
  fs.mkdirSync(EVDIR, { recursive: true });
  const startedAt = new Date().toISOString();

  if (part === 'part1') {
    const health = await api('GET', '/data/projects');
    assert('dev_stack_api_ready', health.status === 200, `status=${health.status}`);
    if (health.status !== 200) process.exit(1);

    // ── A（KNW-1/2）：read 档自主发现并引用 skill ──
    const settingsRes = await api('GET', '/ai/settings');
    const s = settingsRes.json || {};
    const presets = s.chat_model_presets || (s.settings && s.settings.chat_model_presets) || [];
    const chosen = presets[0];
    assert('chat_preset_available', !!chosen, `presets=${presets.length}`);
    const projectA = await tempProject('BLOCK-157-W1-A（临时，可删）');
    assert('temp_project_a', !!projectA);
    const t0 = Date.now();
    const runA = await runAgentTask(
      projectA, chosen.id, 'read',
      '请先看看当前系统里有哪些可用的技能（skills），然后读取其中一个 id 叫 coding-playbook 的技能手册，用一两句话告诉我它适合什么任务。'
    );
    assert('A_task_completed', !!runA.meta && runA.meta.status === 'completed', `status=${runA.meta && runA.meta.status}`);
    const aDiscover = transcriptHasToolCall(t0, 'skill_discover');
    const aGet = transcriptHasToolCall(t0, 'skill_get');
    assert('A_agent_called_skill_discover', aDiscover, 'transcript response.toolCalls 含 skill_discover');
    assert('A_agent_called_skill_get', aGet, 'transcript response.toolCalls 含 skill_get');
    assert('A_agent_references_coding_playbook',
      /coding-playbook/i.test(runA.assistantText), `reply=${runA.assistantText.slice(0, 160)}`);

    // ── B（CAP-1）：workspace-write 档调 readOnlyHint MCP 工具 ──
    await api('POST', '/mcp/servers/fixture/disconnect').catch(() => {});
    await api('DELETE', '/mcp/servers/fixture').catch(() => {});
    const add = await api('POST', '/mcp/servers', {
      id: 'fixture', command: process.execPath,
      args: [path.join(ROOT, 'test', 'fixtures', 'mcp-fixture-server.cjs')],
      autoConnect: false,
    });
    assert('B_fixture_added', add.status === 200, `status=${add.status}`);
    const conn = await api('POST', '/mcp/servers/fixture/connect');
    assert('B_fixture_connected_toolcount_2',
      conn.status === 200 && conn.json && conn.json.toolCount === 2,
      `status=${conn.status} body=${JSON.stringify(conn.json).slice(0, 160)}`);
    const projectB = await tempProject('BLOCK-157-W1-B（临时，可删）');
    const secret = `p53${Date.now() % 100000}`;
    const t1 = Date.now();
    const runB = await runAgentTask(
      projectB, chosen.id, 'workspace-write',
      `请调用工具 mcp_fixture_fixture_lookup_readonly，参数 query 设为 "${secret}"，把工具返回的文本原样告诉我。`
    );
    assert('B_task_completed', !!runB.meta && runB.meta.status === 'completed', `status=${runB.meta && runB.meta.status}`);
    assert('B_readonly_tool_low_mode_success',
      runB.assistantText.includes(`lookup: ${secret} (readonly)`),
      `reply=${runB.assistantText.slice(0, 200)}`);
    assert('B_model_called_readonly_by_name', transcriptHasToolCall(t1, 'mcp_fixture_fixture_lookup_readonly'),
      'transcript toolCalls 含 mcp_fixture_fixture_lookup_readonly');

    // ── C1（DIST-1）：探针插件启用=目录在场 ──
    const c1 = await catalogHas(PROBE_ID);
    assert('C1_enabled_plugin_in_catalog', c1.ok && c1.has, `catalog=${c1.raw}`);

    await api('DELETE', '/mcp/servers/fixture').catch(() => {});
  }

  if (part === 'part2') {
    // ── C2（DIST-1）：停用+重启=目录消失（停用即不注册）──
    const c2 = await catalogHas(PROBE_ID);
    assert('C2_disabled_plugin_absent_from_catalog', c2.ok && !c2.has, `catalog=${c2.raw}`);
  }

  if (part === 'recheck') {
    const c3 = await catalogHas(PROBE_ID);
    assert('C3_reenabled_plugin_back_in_catalog', c3.ok && c3.has, `catalog=${c3.raw}`);
  }

  if (part === 'cleanup') {
    // 移除探针插件 + installed.json 复原 + 临时项目由 UI 手动清理（留档可删）
    const inst = JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf8'));
    fs.writeFileSync(INSTALLED_FILE, JSON.stringify(inst.filter((x) => x.id !== PROBE_ID), null, 2));
    fs.rmSync(path.join(LOCAL_DATA_DIR, 'plugins', PROBE_ID), { recursive: true, force: true });
    assert('cleanup_probe_plugin_removed',
      !fs.existsSync(path.join(LOCAL_DATA_DIR, 'plugins', PROBE_ID)));
  }

  // 证据合并落盘
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(EVFILE, 'utf8')); } catch {}
  const record = {
    part,
    startedAt,
    finishedAt: new Date().toISOString(),
    assertions: ASSERTIONS,
    allPass: ASSERTIONS.length > 0 && ASSERTIONS.every((a) => a.pass),
  };
  prev[part] = record;
  fs.writeFileSync(EVFILE, JSON.stringify(prev, null, 2));
  console.log(`[block157-wave1-live] ${part}: ${record.allPass ? 'ALL PASS' : 'HAS FAIL'} → ${EVFILE}`);
  process.exit(record.allPass ? 0 : 2);
}

main().catch((e) => { console.error('[block157-wave1-live] fatal:', e); process.exit(1); });
