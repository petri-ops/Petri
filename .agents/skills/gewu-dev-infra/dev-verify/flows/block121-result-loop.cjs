#!/usr/bin/env node
'use strict';

/**
 * dev-verify flow：block121-result-loop — BLOCK-121 开发态结果闭环垂直切片实机验收
 * （plan docs/block-121-result-loop-vertical-plan.md §8.4，P1=A1-A4+A6，P2 增 A5）。
 *
 * 闭环语义：真实项目 + 真实模型 chat 发起 → run_tool(deseq2) 真实 Rscript 执行 →
 * tool_jobs 落库（artifact-truth）→ Studio 打开且「可信结果」徽标 → （P2）Copilot 跨轮
 * 引用结果真实内容作答。
 *
 * 断言链：
 *   A0 环境前置：后端健康 / R 运行时在位 / 演示数据在位 / 测试实例就绪
 *   A1 catalog_deseq2_loaded         包装载生效（分析目录出现 deseq2）
 *   A2 chat_driven_run_completed     真实 chat 发起（context.projectId + 用户指令），
 *                                    模型自主 run_tool → job completed（真实 R 执行；
 *                                    不走 REST /tools/run 直跑——Studio 打开有
 *                                    conversationId 归属守卫，chat 才是用户真实路径）
 *   A3 artifact_truth_valid          result_json.artifactTruth.status='valid' 且主产物在盘
 *   A4 studio_trusted_badge          CDP 实机：URL 参数自动打开 result 模式，
 *                                    truthBadge=「可信结果」，正文含真实产物元素
 *   A5 copilot_cross_turn_citation   （P2 增）同会话追问解读，回答引用结果真实值
 *   A6 cleanup                       临时项目删除 + 测试实例还原
 *
 * 前置：主 dev 栈 :3001（BIOF3_LOCAL_DATA_DIR=.biof3-dev-user-data/data）+ 测试实例
 * （bash scripts/start-test-instance.sh）+ pack ../gewu-pack-bio（deseq2 激活）+ R 运行时。
 * 证据：acceptance/block-121/block121-result-loop-live.json
 */
const fs = require('node:fs');
const path = require('node:path');
const lib = require('../lib.cjs');

const API = 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };
const APP_ORIGIN = 'http://localhost:3000';
const ROOT = lib.findRepoRoot(__dirname);
const PACK_ROOT = path.resolve(ROOT, '..', 'gewu-pack-bio');
const R_RUNTIME = path.join(ROOT, '.biof3-dev-user-data', 'data', 'runtimes', 'R');
const TASK_TIMEOUT_MS = Number(process.env.BLOCK121_TASK_TIMEOUT_MS || 8 * 60_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rest(method, p, body) {
  const resp = await fetch(API + p, {
    method,
    headers: body ? { ...AUTH, 'content-type': 'application/json' } : AUTH,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

/** 订阅 task SSE 流（终态后回放亦可），收集事件信封。 */
async function collectEvents(taskId, timeoutMs) {
  const url = API + '/ai/agent/task/' + encodeURIComponent(taskId) + '?afterSeq=0';
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const events = [];
  try {
    const resp = await fetch(url, { headers: { Authorization: 'Bearer desktop-local' }, signal: abort.signal });
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep;
      const SEP = String.fromCharCode(10) + String.fromCharCode(10);
      while ((sep = buffer.indexOf(SEP)) !== -1) {
        const line = buffer.slice(0, sep).trim();
        buffer = buffer.slice(sep + 2);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') return events;
        try { events.push(JSON.parse(data)); } catch { /* 非 JSON 行跳过 */ }
      }
    }
  } catch { /* 超时/中断：返回已收集部分 */ } finally { clearTimeout(timer); }
  return events;
}

/** 提交 chat 消息（真实模型）并等 task 终态。 */
async function submitAndWait(message, context, timeoutMs) {
  const sub = await rest('POST', '/ai/agent', { messages: [{ role: 'user', content: message }], context });
  if (!sub.ok || !sub.data || !sub.data.taskId) {
    throw new Error('chat 提交失败: ' + JSON.stringify(sub.data).slice(0, 200));
  }
  const { taskId, conversationId } = sub.data;
  const deadline = Date.now() + timeoutMs;
  let terminal = null;
  while (Date.now() < deadline) {
    await sleep(2000);
    const t = await rest('GET', '/ai/agent/task/' + encodeURIComponent(taskId) + '/meta');
    const meta = t.data || null;
    const status = meta && (meta.agentStatus || meta.agent_status);
    if (status === 'completed' || status === 'done' || status === 'failed' || status === 'cancelled') {
      terminal = status;
      break;
    }
  }
  return { taskId, conversationId, terminal };
}

async function evalRetry(client, expr, tries = 8) {
  let lastErr = null;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await lib.evalJs(client, expr);
    } catch (e) {
      lastErr = e;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

module.exports = {
  id: 'block121-result-loop',
  evidenceDir: path.join(ROOT, 'acceptance', 'block-121'),

  async run({ assert }) {
    // ── A0 环境前置（fail-fast，不在残缺环境跑出假证据）──
    const health = await rest('GET', '/health');
    assert('A0a_backend_health', health.ok && health.data && health.data.status === 'ok', JSON.stringify(health.data).slice(0, 120));
    assert('A0b_r_runtime_present', fs.existsSync(path.join(R_RUNTIME, 'bin', 'Rscript.exe')), R_RUNTIME);
    const demoCounts = path.join(PACK_ROOT, 'demo-data', 'deseq2', 'demo-counts.csv');
    const demoColdata = path.join(PACK_ROOT, 'demo-data', 'deseq2', 'demo-coldata.csv');
    assert('A0c_pack_demo_data_present', fs.existsSync(demoCounts) && fs.existsSync(demoColdata), PACK_ROOT);

    // ── A1 catalog deseq2 已载 ──
    const catalog = await rest('GET', '/tools/catalog');
    const tools = (catalog.data && (catalog.data.tools || catalog.data.catalog)) || [];
    const toolIds = tools.map((t) => t.id);
    assert('A1_catalog_deseq2_loaded', toolIds.includes('deseq2'), 'total=' + tools.length + ' ids=' + toolIds.slice(0, 8).join(','));

    // ── A2 真实 chat 发起 → run_tool(deseq2) → completed ──
    const created = await rest('POST', '/data/projects', { name: 'BLOCK121-验收-' + Date.now(), modality: 'general' });
    const project = created.data && (created.data.project || created.data);
    const projectId = project && project.id;
    assert('A2a_temp_project_created', !!projectId, JSON.stringify(created.data).slice(0, 140));
    if (!projectId) return false;

    // 清理必达：任何后续早退都必须回收临时项目/测试实例现场
    let cdpClient = null;
    let originalUrl = null;
    const cleanupAll = async () => {
      const marks = [];
      if (projectId) {
        const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(projectId));
        marks.push('project=' + d.ok);
      }
      if (cdpClient && originalUrl) {
        try {
          await evalRetry(cdpClient, 'location.href = ' + JSON.stringify(originalUrl) + '; \'restoring\'');
          await sleep(1500);
          marks.push('restored=true');
        } catch { marks.push('restored=eval_failed'); }
      }
      return marks;
    };

    const detail = await rest('GET', '/data/projects/' + encodeURIComponent(projectId));
    const rawProject = (detail.data && detail.data.project) || project || {};
    const workspacePath = rawProject.workspace_path || rawProject.workspacePath || project.workspace_path;
    assert('A2b_workspace_resolved', !!workspacePath && fs.existsSync(workspacePath), String(workspacePath));
    if (!workspacePath) { await cleanupAll(); return false; }

    fs.copyFileSync(demoCounts, path.join(workspacePath, 'counts.csv'));
    fs.copyFileSync(demoColdata, path.join(workspacePath, 'coldata.csv'));
    assert('A2c_demo_files_staged', fs.existsSync(path.join(workspacePath, 'counts.csv')) && fs.existsSync(path.join(workspacePath, 'coldata.csv')), workspacePath);

    const userMessage =
      // 首句对齐 UI 主路径模板（RightPanel.tsx:225 AnalysisLaunchPanel 运行钮→
      // handleAskAgent('请运行「${tool.title}」分析…')）——tool-route 分类器校准
      // 语料见过该形态，保证 run_tool 留在下发 defs 内
      '请运行「DESeq2 差异分析」分析。输入文件已就绪：' +
      'counts="' + path.join(workspacePath, 'counts.csv') + '"，' +
      'coldata="' + path.join(workspacePath, 'coldata.csv') + '"。' +
      '参数：design=condition，对照组（contrast_ref）=Control，处理组（contrast_treat）=Treatment。' +
      '完成后请报告任务 ID 与差异基因数量。';
    const { taskId, conversationId, terminal } = await submitAndWait(
      userMessage,
      // accessMode='full' 显式声明（S-003：执行策略唯一判定源=ctx.accessMode，
      // 缺失按 read 处理注入只读约束——UI 是真相源，flow 与 UI 同协议）
      { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full' },
      TASK_TIMEOUT_MS,
    );
    assert('A2d_chat_task_completed', terminal === 'completed' || terminal === 'done', 'taskId=' + taskId + ' terminal=' + terminal);
    assert('A2e_conversation_bound', !!conversationId, 'conversationId=' + conversationId);

    const events = await collectEvents(taskId, 15_000);
    const payloads = events.map((e) => (e && e.payload) || e);
    const sawRunToolCall = payloads.some((p) => p && p.event === 'tool_call' && p.name === 'run_tool');
    assert('A2f_run_tool_called_in_loop', sawRunToolCall, 'events=' + events.length + ' run_tool tool_call 在场=' + sawRunToolCall);

    // 找 toolJobId：优先 run_tool 的 tool_result 信封，回退任务历史按项目过滤
    let jobId = null;
    for (const p of payloads) {
      if (!p || p.event !== 'tool_result' || p.name !== 'run_tool') continue;
      const text = JSON.stringify(p);
      const explicit = text.match(/"toolJobId"\s*:\s*"(job_[0-9a-f]+)"/i);
      if (explicit) { jobId = explicit[1]; break; }
      const generic = text.match(/job_[0-9a-f]{12,}/i);
      if (generic) { jobId = generic[0]; break; }
    }
    if (!jobId) {
      const hist = await rest('GET', '/tools/history?limit=50');
      const jobs = (hist.data && (hist.data.jobs || hist.data.history || hist.data)) || [];
      const mine = (Array.isArray(jobs) ? jobs : []).find((j) =>
        j && (j.tool_id === 'deseq2' || j.toolId === 'deseq2')
        && (j.project_id === projectId || j.projectId === projectId));
      jobId = mine && (mine.id || mine.jobId);
    }
    assert('A2g_tool_job_found', !!jobId, 'jobId=' + jobId);
    if (!jobId) { await cleanupAll(); return false; }

    let finalStatus = null;
    let lastPoll = null;
    {
      const deadline = Date.now() + 5 * 60_000;
      while (Date.now() < deadline) {
        await sleep(4000);
        const st = await rest('GET', '/tools/status/' + encodeURIComponent(jobId));
        lastPoll = st.data;
        finalStatus = (st.data && (st.data.status || (st.data.job && st.data.job.status))) || null;
        if (finalStatus === 'completed' || finalStatus === 'failed' || finalStatus === 'cancelled') break;
      }
    }
    assert('A2h_real_deseq2_completed', finalStatus === 'completed', 'status=' + finalStatus + ' detail=' + JSON.stringify(lastPoll).slice(0, 220));

    // ── A3 artifact-truth + 主产物在盘 ──
    const st = await rest('GET', '/tools/status/' + encodeURIComponent(jobId));
    const result = st.data && (st.data.result || st.data);
    const truth = result && (result.artifactTruth || (st.data.artifactTruth));
    assert('A3a_artifact_truth_valid', !!truth && truth.status === 'valid', JSON.stringify(truth).slice(0, 160));
    const convOnJob = result && (result.conversationId || (st.data.conversationId));
    assert('A3b_job_has_conversation_owner', !!convOnJob, 'conversationId=' + convOnJob + '（Studio 打开归属守卫前提）');
    const artifacts = (result && result.artifacts) || [];
    const primary = artifacts.find((a) => /deg_table/i.test(a.filename || a.name || '')) || artifacts[0];
    const primaryPath = primary && (primary.canonicalPath || primary.path);
    assert('A3c_primary_artifact_on_disk', !!primaryPath && fs.existsSync(primaryPath), String(primaryPath || JSON.stringify(artifacts).slice(0, 140)));

    // ── A4 Studio 打开 + 「可信结果」徽标（CDP 实机）──
    const targets = await lib.pollTargets({ port: lib.TEST_INSTANCE_PORT, timeoutMs: 30_000 });
    const pages = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
    if (!pages.length) {
      assert('A4a_test_instance_page', false, 'no_app_page_target——请先 bash scripts/start-test-instance.sh');
      await cleanupAll();
      return false;
    }
    const target = await lib.selectPageTarget(pages, {
      probe: async (client) => lib.evalJs(client, '!!document.getElementById(\'root\')').catch(() => false),
    });
    const client = await lib.connectTarget(target);
    cdpClient = client;
    originalUrl = target.url;
    const resultUrl = APP_ORIGIN + '/project/' + encodeURIComponent(projectId) + '?mode=result&job=' + encodeURIComponent(jobId);
    await evalRetry(client, 'location.href = ' + JSON.stringify(resultUrl) + '; \'navigating\'');
    let badgeText = '__no_badge__';
    {
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        await sleep(1500);
        try {
          badgeText = await lib.evalJs(client,
            '(function(){const b=document.querySelector("span[data-tone]");return b?b.textContent:"__no_badge__"})()');
        } catch { /* HMR/context 重建退避重试 */ }
        if (typeof badgeText === 'string' && badgeText.indexOf('可信结果') >= 0) break;
      }
    }
    assert('A4a_studio_trusted_badge', typeof badgeText === 'string' && badgeText.indexOf('可信结果') >= 0, 'badge=' + String(badgeText).slice(0, 120) + ' url=' + resultUrl);
    const bodyProbe = await evalRetry(client,
      '(function(){const t=document.body.innerText;'
      + 'return JSON.stringify({hasArtifactName:/deg_table|volcano|heatmap|pca/i.test(t),'
      + 'hasUnknown: t.indexOf("尚未核验")>=0,'
      + 'hasVisual: !!document.querySelector("img,canvas,table")})})()').catch(() => '{}');
    let probe = {};
    try { probe = JSON.parse(bodyProbe); } catch { /* 保默认 */ }
    assert('A4b_studio_body_real_content', probe.hasArtifactName === true && probe.hasVisual === true,
      'probe=' + bodyProbe.slice(0, 160) + '（正文含真实产物元素，非占位/未核验态）');

    // ── A5（P2/B1）Copilot 跨轮引用：同会话追问解读，回答必须引用结果真实值 ──
    // 接地目标=从盘面主表真值提取（padj 升序 top5 基因）+ manifest.summary 关键数字
    let summary = (result && result.manifest && result.manifest.summary) || {};
    let topGenes = [];
    try {
      const csvLines = fs.readFileSync(primaryPath, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
      const header = csvLines[0].split(',').map((s) => s.replace(/"/g, '').trim());
      const gi = header.indexOf('gene');
      const pi = header.indexOf('padj');
      const dataRows = csvLines.slice(1).map((l) => l.split(',').map((s) => s.replace(/"/g, '').trim()));
      dataRows.sort((a, b) => (parseFloat(a[pi]) || 9e9) - (parseFloat(b[pi]) || 9e9));
      topGenes = dataRows.slice(0, 5).map((r) => r[gi]).filter(Boolean);
    } catch { /* 真值提取失败则 A5b 必红，不掩盖 */ }
    const followUp = await submitAndWait(
      '这个分析结果说明了什么？差异基因主要有哪些？显著的总共多少个、上调下调各多少？请基于真实结果内容回答，不要猜测。',
      { projectId, page: 'workspace', pageTitle: '项目工作区', accessMode: 'full', conversationId },
      TASK_TIMEOUT_MS,
    );
    assert('A5a_followup_completed', followUp.terminal === 'completed' || followUp.terminal === 'done', 'terminal=' + followUp.terminal);
    const msgResp = await rest('GET', '/ai/conversations/' + encodeURIComponent(conversationId) + '/messages?limit=10');
    const msgList = (msgResp.data && msgResp.data.messages) || [];
    let reply = '';
    for (let i = msgList.length - 1; i >= 0; i -= 1) {
      if (msgList[i] && msgList[i].role === 'assistant') { reply = String(msgList[i].content || ''); break; }
    }
    const groundedGene = topGenes.some((g) => reply.includes(g));
    const keyNums = [summary.sig_genes, summary.up, summary.down].filter((n) => Number.isFinite(n));
    const groundedNum = keyNums.some((n) => reply.includes(String(n)));
    assert('A5b_reply_cites_real_content', groundedGene && groundedNum,
      'groundedGene=' + groundedGene + ' groundedNum=' + groundedNum
      + ' topGenes=' + topGenes.slice(0, 3).join(',') + ' sig/up/down=' + summary.sig_genes + '/' + summary.up + '/' + summary.down
      + ' replyLen=' + reply.length);

    // ── A6 清理 + 还原 ──
    const cleanup = await cleanupAll();
    assert('A6_cleanup_done', cleanup.length >= 1 && cleanup.every((s) => s.indexOf('true') >= 0), cleanup.join(' '));

    return true;
  },
};
