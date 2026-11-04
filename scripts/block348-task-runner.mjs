#!/usr/bin/env node
/**
 * scripts/block348-task-runner.mjs — BLOCK-348 通用 agent 任务基准实测 runner。
 *
 * 复用 BLOCK-181 evals-harness 的隔离后端基建（spawnIsolatedBackend / collectTaskEvents /
 * evaluateCriterion / defaultTmpDir），在其上做能力实测（非回归防退化）：
 *   - 8 个跨域任务（acceptance/block-348/tasks.json，判据表冻结于跑前）
 *   - real provider（本机凭据库回落）；web 访问经预写 web-search.json 开启
 *   - 全程事件轨迹落 acceptance/block-348/traces/<taskId>.jsonl
 *   - 工作区产物收割落 acceptance/block-348/artifacts/<taskId>/workspace/（含 sha256 清单）
 *   - 干预点=dynamic_guard 审批请求，按冻结策略 auto-approve-and-record 逐条记录
 *   - 自定义判据 kinds：tool_output_contains / file_unmodified / min_tool_calls /
 *     file_contains_all / file_min_length（其余走 harness evaluateCriterion）
 *
 * 用法：
 *   node scripts/block348-task-runner.mjs [--tasks=acceptance/block-348/tasks.json]
 *        [--only=t1-code-bugfix,t2-data-cleaning] [--report=acceptance/block-348/results.json]
 *
 * 诚实边界：本 runner 只产出事实（status/criteria/interventions/轨迹），人眼判据
 * （toolSelectJudge / artifactJudge）由操作者按冻结表在报告里填写；环境不可得如实
 * 标记，不伪造成功。退出码：1=基建性失败（后端起不来/凭据缺失/任务未启动），
 * 0=跑完（判据不红门禁——本包是能力测量，不是回归闸）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  spawnIsolatedBackend, collectTaskEvents, evaluateCriterion, defaultTmpDir, AUTH,
} from './lib/evals-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (prefix, fallback) => {
  const hit = args.filter((a) => a.startsWith(`${prefix}=`)).pop();
  return hit ? hit.slice(prefix.length + 1) : fallback;
};
const tasksPath = argValue('--tasks', 'acceptance/block-348/tasks.json');
const reportPath = argValue('--report', 'acceptance/block-348/results.json');
const onlyArg = argValue('--only', '');
const only = onlyArg ? new Set(onlyArg.split(',').map((s) => s.trim()).filter(Boolean)) : null;
// --tag：同任务多次测量的证据隔离后缀（防轨迹/产物互相覆盖——BLOCK-348 实测教训：
// T7 首跑轨迹被重跑覆盖，run-1 证据只剩 results.json 判据明细）
const tag = argValue('--tag', '');

const TASKS_ABS = path.join(ROOT, tasksPath);
const doc = JSON.parse(fs.readFileSync(TASKS_ABS, 'utf8'));
const tasks = doc.tasks || [];
if (!Array.isArray(tasks) || tasks.length === 0) {
  console.error('[block348] tasks.json 无任务');
  process.exit(2);
}
const selected = only ? tasks.filter((t) => only.has(t.id)) : tasks;
if (selected.length === 0) {
  console.error(`[block348] --only 未命中任何任务：${onlyArg}`);
  process.exit(2);
}

// ---------- 小工具（harness 内未导出，按同语义自实现，不自造第二套判据语义） ----------
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function apiCall(api, method, url, body) {
  const r = await fetch(api + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

function findWorkspaceFile(tmpDir, relativePath) {
  const target = relativePath.replaceAll('\\', '/');
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (full.replaceAll('\\', '/').endsWith(`/${target}`)) return full;
    }
  }
  return null;
}

async function resolveProjectWorkspace(api, tmpDir, projectId) {
  const rec = await apiCall(api, 'GET', `/api/data/projects/${encodeURIComponent(projectId)}`);
  const ws = rec.json?.project?.workspace_path || rec.json?.data?.workspace_path || rec.json?.workspace_path;
  if (ws && fs.existsSync(ws)) return ws;
  const stack = [tmpDir];
  while (stack.length) {
    const dir = stack.pop();
    if (dir.includes(projectId)) {
      let stat;
      try { stat = fs.statSync(dir); } catch { continue; }
      if (stat.isDirectory()) return dir;
    }
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (entry.isDirectory()) stack.push(path.join(dir, entry.name));
    }
  }
  return null;
}

async function pollSubagentDone(api, parentTaskId, conversationId, { timeoutMs = 60_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let count = 0;
  while (Date.now() < deadline) {
    const res = await apiCall(api, 'GET', `/api/ai/agent/tasks${conversationId ? `?conversationId=${encodeURIComponent(conversationId)}` : ''}`);
    const list = res.json?.tasks || [];
    count = list.filter((t) => t.parentTaskId === parentTaskId
      && (t.agentStatus === 'done' || t.agentStatus === 'completed' || t.status === 'done' || t.status === 'completed')).length;
    if (count >= 3) return count;
    await new Promise((r) => setTimeout(r, 500));
  }
  return count;
}

// ---------- T7 种子生成器（确定性，判据 FACT-<3n> 与 tasks.json 冻结清单对应） ----------
const LEDGER_STYLES = [
  { tag: '平实记录', mood: '如实记下当日行程与数据，不做修饰。' },
  { tag: '抒情渲染', mood: '笔锋带情绪，把荒原与天空写进感受。' },
  { tag: '冷峻克制', mood: '只留事实与数字，形容词一律砍掉。' },
  { tag: '口语随性', mood: '像跟老友写信，想到哪写到哪。' },
];

function buildLedgerFile(n) {
  const style = LEDGER_STYLES[n % 4];
  const fact = `FACT-${String(n * 3).padStart(3, '0')}`;
  const day = String(n).padStart(2, '0');
  const km = n * 7 + 13;
  const alt = 800 + n * 45;
  const temp = (18 + (n * 3) % 11);
  const lines = [];
  lines.push(`# 远征日志 seq-${day}（第 ${n} 段行程）`);
  lines.push('');
  lines.push(`本段行程从第 ${km - 7} 公里处推进到第 ${km} 公里处，海拔自 ${alt - 45} 米上升至 ${alt} 米。营地设在 ${alt} 米等高线附近的背风坡，实测气温 ${temp} 摄氏度，风速 ${2 + (n % 5)} 级。队伍于清晨六时出发，午后三时扎营，全程未遇地形障碍。`);
  lines.push('');
  lines.push(`${style.mood}${n % 4 === 1 ? '远处的山脊像一条沉睡的鲸背，云从谷底升起来，把整段路途泡在灰蓝色里。' : ''}${n % 4 === 2 ? '物资清点完毕：绳索四捆、干粮按计划消耗、燃料余量百分之六十。' : ''}${n % 4 === 3 ? '说白了今天就是走路、喝水、看表，没什么可吹的。' : ''}${n % 4 === 0 ? '观测窗口准时开启，仪器读数与预估偏差在容差以内。' : ''}本段正式观测记录标记：${fact}（对应第 ${n} 号观测点，采样三次取中值）。`);
  lines.push('');
  lines.push(`沿途观测：上午穿越 ${2 + (n % 4)} 处碎石坡，午后经行一段冰碛垄，${fact} 的采样点选在垄体背阴面，避开了午后直射。向导提示此段在融雪季节容易积水，实测仅一处浅洼，深不过踝。队伍按序通过，无人失足。`);
  lines.push('');
  lines.push(`补给与状态：水耗 ${3 + (n % 3)} 升，食物按计划，鞋与绑腿状态良好。第 ${n % 4 + 1} 号队员右脚踝有轻微摩擦伤，已处理，不影响行程。通讯中继在第 ${km} 公里标桩处信号两格，向大本营发了当日简报。`);
  lines.push('');
  lines.push(`明日计划：若天气维持，按第 ${n + 1} 段行程推进至第 ${km + 7} 公里处；若晨间风速超过五级，则原地休整半日，把 ${fact} 观测点的补采做掉。装备检查完毕，绳结全部复核。`);
  lines.push('');
  lines.push(`备注：本段日志按「${style.tag}」体例书写。所有数字以仪器记录为准，手记若与仪器冲突，以仪器为准。第 ${n} 段行程结束。`);
  lines.push('');
  return lines.join('\n');
}

function generateSeed(task) {
  if (task.seedGenerator === 'ledger20') {
    const files = [];
    for (let n = 1; n <= 20; n += 1) {
      files.push({ path: `ledger/seq-${String(n).padStart(2, '0')}.md`, content: buildLedgerFile(n) });
    }
    return files;
  }
  return [];
}

// ---------- 自定义判据 kinds（tasks.json $meta.customCriteriaKinds 冻结口径） ----------
function evaluateCustomCriterion(c, ctx) {
  const result = (passed, detail) => ({ ...c, passed, detail: String(detail).slice(0, 240) });
  switch (c.kind) {
    case 'tool_output_contains': {
      const hits = ctx.events.filter((e) => e.event === 'tool_result' && e.name === c.tool
        && JSON.stringify(e.toolResult?.data ?? e.toolResult ?? '').includes(c.value));
      return result(hits.length >= 1, `tool ${c.tool} 输出含「${String(c.value).slice(0, 40)}」× ${hits.length}`);
    }
    case 'file_unmodified': {
      const seedHash = ctx.seedHashes[c.path];
      if (!seedHash) return result(false, `种子哈希缺失：${c.path}`);
      const abs = findWorkspaceFile(ctx.tmpDir, c.path);
      if (!abs) return result(false, `文件不存在（被删/改名）：${c.path}`);
      const cur = sha256(fs.readFileSync(abs));
      return result(cur === seedHash, `${c.path} ${cur === seedHash ? '未被改动' : '被改动'}`);
    }
    case 'min_tool_calls': {
      const total = ctx.events.filter((e) => e.event === 'tool_call').length;
      return result(total >= (c.min || 1), `全程 tool_call × ${total}（期望 ≥${c.min}）`);
    }
    case 'file_contains_all': {
      const missing = [];
      for (const v of c.values || []) {
        const abs = findWorkspaceFile(ctx.tmpDir, c.path);
        const content = abs ? fs.readFileSync(abs, 'utf8') : null;
        if (content === null || !content.includes(v)) missing.push(v);
      }
      return result(missing.length === 0, missing.length === 0
        ? `${c.path} 含全部 ${c.values.length} 项标记`
        : `${c.path} 缺 ${missing.length}/${c.values.length} 项（如 ${missing.slice(0, 3).join(',')}）`);
    }
    case 'file_min_length': {
      const abs = findWorkspaceFile(ctx.tmpDir, c.path);
      if (!abs) return result(false, `文件不存在：${c.path}`);
      const len = fs.readFileSync(abs, 'utf8').length;
      return result(len >= (c.min || 1), `${c.path} ${len} 字符（期望 ≥${c.min}）`);
    }
    default:
      return null; // 非自定义 → 交给 harness evaluateCriterion
  }
}

// ---------- 主流程 ----------
const evidenceDir = path.join(ROOT, path.dirname(reportPath));
const tracesDir = path.join(evidenceDir, 'traces');
const artifactsDir = path.join(evidenceDir, 'artifacts');
fs.mkdirSync(tracesDir, { recursive: true });
fs.mkdirSync(artifactsDir, { recursive: true });

const tmpDir = defaultTmpDir('petri-block348-');
// web 访问开闸（冻结口径：t3 需要联网；web_search 后端 provider=none 属预期）
fs.writeFileSync(path.join(tmpDir, 'web-search.json'), JSON.stringify({
  enabled: true, provider: 'none', searxngBaseUrl: '', maxResults: 5,
  timeoutMs: 15000, fetchMaxBytes: 1048576, allowedHosts: '', blockedHosts: '',
}, null, 2));

const backend = await spawnIsolatedBackend({ root: ROOT, tmpDir, mode: 'real' });
const report = {
  package: 'BLOCK-348',
  at: new Date().toISOString(),
  criteriaFrozenAt: doc.$meta?.criteriaFrozenAt || null,
  provider: {
    source: backend.provider.source, model: backend.provider.model, hasKey: backend.provider.hasKey, skipReason: backend.provider.skipReason,
    // 凭据溯源（不落任何密钥明文）：本机预设残留 mock 值时经 env 显式覆盖指向真实端点
    envOverrides: {
      baseUrlFromEnv: Boolean(process.env.PETRI_EVALS_BASE_URL),
      modelFromEnv: process.env.PETRI_EVALS_MODEL || null,
      localDataDir: process.env.PETRI_LOCAL_DATA_DIR || null,
    },
  },
  backendUp: backend.ok,
  tasks: [],
};
let infraFailure = false;

if (!backend.ok) {
  console.error('[block348] 隔离后端未起来——环境不可得，如实登记');
  infraFailure = true;
  for (const t of selected) report.tasks.push({ id: t.id, status: 'not_started', reason: 'backend DOWN', criteriaResults: [] });
}

if (backend.ok && backend.provider.hasKey === false) {
  console.error(`[block348] real 凭据不可得（${backend.provider.skipReason}）——全部任务诚实 skip，不伪造`);
  for (const t of selected) report.tasks.push({ id: t.id, status: 'skipped', reason: `real 凭据不可得：${backend.provider.skipReason}`, criteriaResults: [] });
  backend.ok = false; // 走收尾，不出伪造结果
}

if (backend.ok) {
  const api = backend.api;
  console.log(`[block348] backend @${api} provider=${backend.provider.source} model=${backend.provider.model}`);
  for (const task of selected) {
    console.log(`\n=== ${task.id} · ${task.title} ===`);
    const startedAt = Date.now();
    // T7 窗口覆盖（冻结口径 $meta.environmentNotes[1]）：预设窗口是产品配置轴。
    // 注意：getAiSettings 会把 model_profiles 过 normalizeModelProfile（缺 model 字段
    // 整条丢弃且 supplied 非空即短路 → 预设窗口查找落空回落模型表），故必须带全
    // provider/model 使 profile 存活并命中 profileId='evals-provider'。
    if (task.windowOverride) {
      const settingsPath = path.join(tmpDir, 'ai-settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings.model_profiles = [{
        id: 'evals-provider', provider: 'deepseek', model: 'deepseek-chat',
        contextWindow: task.windowOverride,
      }];
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
      console.log(`[block348] ${task.id} 窗口覆盖 → ${task.windowOverride}（预设配置轴，压缩场景确定性触发）`);
    }

    const project = await apiCall(api, 'POST', '/api/data/projects', { name: `block348-${task.id}` });
    const projectId = project.json?.project?.id || project.json?.data?.id || project.json?.data?.project?.id;
    const wsDir = projectId ? await resolveProjectWorkspace(api, tmpDir, projectId) : null;
    const seedHashes = {};
    if (wsDir) {
      const seedFiles = [
        ...generateSeed(task),
        ...(task.seedWorkspace || []).map((s) => ({ path: s.path, content: String(s.content) })),
      ];
      for (const f of seedFiles) {
        const abs = path.join(wsDir, f.path);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, f.content);
        seedHashes[f.path] = sha256(f.content);
      }
    }
    const conversation = projectId
      ? await apiCall(api, 'POST', '/api/ai/conversations', { title: `block348-${task.id}`, project_id: projectId })
      : null;
    const conversationId = conversation?.json?.conversation?.id || conversation?.json?.data?.conversation?.id || conversation?.json?.data?.id;

    const start = await apiCall(api, 'POST', '/api/ai/agent', {
      conversationId,
      modelPresetId: 'evals-provider',
      messages: [{ role: 'user', content: task.prompt }],
      context: { accessMode: task.accessMode || 'full', projectId },
    });
    const agentTaskId = start.json?.taskId || null;
    if (!agentTaskId) {
      console.error(`  启动失败：${JSON.stringify(start.json || {}).slice(0, 200)}`);
      report.tasks.push({ id: task.id, status: 'not_started', reason: `启动失败：${JSON.stringify(start.json || {}).slice(0, 160)}`, criteriaResults: [] });
      infraFailure = true;
      continue;
    }

    // 干预点（冻结策略 auto-approve-and-record）：每个 dynamic_guard 审批请求=1 个干预点
    const interventions = [];
    let approvalsUsed = 0;
    const maxApprovals = doc.$meta?.interventionPolicy?.maxPerTask ?? 20;
    const onEvent = async (ev) => {
      const data = ev.toolResult && ev.toolResult.data;
      if (!data || data.error !== 'dynamic_guard_triggered' || !data.requestId) return;
      interventions.push({
        at: new Date().toISOString(),
        guardKey: data.guardKey || null,
        requestId: data.requestId,
        decision: approvalsUsed < maxApprovals ? 'approve' : 'exhausted(maxApprovals)',
      });
      if (approvalsUsed >= maxApprovals) return;
      approvalsUsed += 1;
      await apiCall(api, 'POST', `/api/ai/agent/task/${encodeURIComponent(agentTaskId)}/guard-ack`, {
        requestId: data.requestId, decision: 'approve', always: false,
      }).catch(() => { /* 决策失败如实留在 interventions */ });
    };

    const timeoutMs = task.timeoutMs || 300000;
    const events = await collectTaskEvents(api, agentTaskId, { timeoutMs, onEvent });
    // 轨迹落盘（当次证据，逐行 JSON；--tag 隔离多轮测量）
    const tracePath = path.join(tracesDir, `${task.id}${tag}.jsonl`);
    fs.writeFileSync(tracePath, events.map((e) => JSON.stringify(e)).join('\n') + '\n');

    const finalText = events
      .filter((e) => e.choices && e.choices[0] && e.choices[0].delta && typeof e.choices[0].delta.content === 'string')
      .map((e) => e.choices[0].delta.content)
      .join('');
    const completed = events.some((e) => e.event === 'done');
    const failedEvent = events.find((e) => e.event === 'error' || e.event === 'fatal_agent_error');
    const toolCalls = events.filter((e) => e.event === 'tool_call').map((e, i) => ({
      seq: i + 1, name: e.name || null,
      argsPreview: JSON.stringify(e.arguments || e.args || {}).slice(0, 160),
    }));
    const compactionEvents = events.filter((e) => e.event === 'context_compacted');

    const needsSubagents = (task.criteria || []).some((c) => c.kind === 'subagent_completed');
    const subagentDoneCount = needsSubagents ? await pollSubagentDone(api, agentTaskId, conversationId) : 0;

    const fileReader = (relativePath) => {
      const abs = findWorkspaceFile(tmpDir, relativePath);
      return abs ? fs.readFileSync(abs, 'utf8') : null;
    };
    const ctx = { events, finalText, completed, failedEvent: failedEvent ? String(failedEvent.error || failedEvent.event) : null, fileReader, subagentDoneCount, seedHashes, tmpDir };
    const criteriaResults = (task.criteria || []).map((c) => {
      const custom = evaluateCustomCriterion(c, ctx);
      return custom !== null ? custom : evaluateCriterion(c, ctx);
    });

    // 产物收割（除 node_modules/.git 全量拷贝 + sha256 清单；--tag 隔离多轮测量）
    const artifactDir = path.join(artifactsDir, `${task.id}${tag}`, 'workspace');
    const manifest = [];
    if (wsDir) {
      const walk = (dir, rel) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;
          const full = path.join(dir, entry.name);
          const relPath = rel ? `${rel}/${entry.name}` : entry.name;
          if (entry.isDirectory()) walk(full, relPath);
          else {
            try {
              const buf = fs.readFileSync(full);
              const dest = path.join(artifactDir, relPath);
              fs.mkdirSync(path.dirname(dest), { recursive: true });
              fs.writeFileSync(dest, buf);
              manifest.push({ path: relPath, bytes: buf.length, sha256: sha256(buf) });
            } catch { /* 不可读文件如实跳过 */ }
          }
        }
      };
      walk(wsDir, '');
      const taskArtifactDir = path.join(artifactsDir, task.id);
      fs.mkdirSync(taskArtifactDir, { recursive: true });
      fs.writeFileSync(path.join(taskArtifactDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    }

    const status = completed ? 'completed' : (failedEvent ? 'failed' : 'interrupted');
    const result = {
      id: task.id,
      title: task.title,
      status,
      reason: status === 'failed' ? String(failedEvent?.error || '').slice(0, 200) : (status === 'interrupted' ? `超时/事件流收尾（timeoutMs=${timeoutMs}）` : null),
      criteriaResults,
      interventions,
      interventionCount: interventions.length,
      toolCallCount: toolCalls.length,
      compactionCount: compactionEvents.length,
      durationMs: Date.now() - startedAt,
      tracePath: path.relative(ROOT, tracePath),
      artifactDir: wsDir ? path.relative(ROOT, artifactDir) : null,
      artifactCount: manifest.length,
      pendingHumanJudgment: { toolSelectJudge: '按冻结表由操作者填写（见报告）', artifactJudge: '按冻结表由操作者填写（见报告）' },
    };
    report.tasks.push(result);
    for (const c of criteriaResults) console.log(`  ${c.passed ? '✔' : '✖'} ${c.kind}${c.detail ? ` — ${c.detail.slice(0, 90)}` : ''}`);
    console.log(`  status=${status} toolCalls=${toolCalls.length} interventions=${interventions.length} compaction=${compactionEvents.length} artifacts=${manifest.length} (${Math.round(result.durationMs / 1000)}s)`);
  }
}

// 机械度量（人眼项由报告按冻结表填写）
const done = report.tasks.filter((t) => t.status === 'completed' && (t.criteriaResults || []).length > 0 && t.criteriaResults.every((c) => c.passed));
report.metrics = {
  autonomousCompletion: { numerator: done.length, denominator: selected.length, note: '环境不可得任务如实单列（见各任务 reason），仍计入分母' },
  interventionCount: report.tasks.reduce((a, t) => a + (t.interventionCount || 0), 0),
  interrupted: report.tasks.filter((t) => t.status === 'interrupted').length,
  failed: report.tasks.filter((t) => t.status === 'failed').length,
  skipped: report.tasks.filter((t) => t.status === 'skipped').length,
  notStarted: report.tasks.filter((t) => t.status === 'not_started').length,
  // 人眼判据待填清单：已产出 criteriaResults 的任务需要操作者按冻结表填 judge
  humanEyePending: report.tasks
    .filter((t) => (t.criteriaResults || []).length > 0)
    .map((t) => t.id),
};
console.log(`\n=== block348 run: 自主完成 ${done.length}/${selected.length} · 干预 ${report.metrics.interventionCount} · 中断 ${report.metrics.interrupted} · 失败 ${report.metrics.failed} · skip ${report.metrics.skipped} ===`);
report.metrics.humanEyePending = report.tasks
  .filter((t) => t.criteriaResults && t.criteriaResults.length > 0)
  .map((t) => t.id);

fs.mkdirSync(path.dirname(path.join(ROOT, reportPath)), { recursive: true });
const outAbs = path.join(ROOT, reportPath);
fs.writeFileSync(outAbs, JSON.stringify(report, null, 2) + '\n');
const stamped = path.join(path.dirname(outAbs), path.basename(outAbs, '.json') + `-${report.at.replace(/[:.]/g, '-')}.json`);
fs.writeFileSync(stamped, JSON.stringify(report, null, 2) + '\n');
console.log(`[block348] 报告 ${path.relative(ROOT, outAbs)}（+时间戳副本）`);

await backend.cleanup();
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟 */ }
process.exitCode = infraFailure ? 1 : 0;
