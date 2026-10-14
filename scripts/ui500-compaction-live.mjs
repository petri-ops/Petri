#!/usr/bin/env node
/**
 * scripts/ui500-compaction-live.mjs — UI-500 自动压缩实机构造探针（批次C）。
 *
 * 构造链：临时调小 dev settings 的 active preset contextWindow（+generation.maxTokens
 * 同步调小防 headroom 占满预算）→ 真界面连发多轮长消息 → 确定性触发 loop 0.85 断路
 * → CP-5 摘要 → context_compacted 事件 → API+UI 双证据落盘 → 恢复设置。
 *
 * 证据：acceptance/ui-500/{events.json, ui500-budget-*.png}
 * - API 侧：task_events 中 token_budget(trimmed=true) + context_compacted(summarized)
 * - UI 侧：petri:token-budget 窗口事件采集（ContextBudgetButton 数据源）+ 截图
 *
 * 纪律：settings 改写全程 backup→finally 恢复→哈希校验（block93 事故教训）；
 * 后端按文件签名缓存 settings，改盘即生效无需重启。
 */
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const { pollTargets, filterPageTargets, evalJs, connectTarget, screenshotPng } = await import(
  pathToFileURL(libPath).href
).then((m) => m.default ?? m);

const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const API = 'http://127.0.0.1:3001/api';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-500');
const DATA_DIR = path.join(ROOT, '.petri-dev-user-data', 'data');
const SETTINGS = path.join(DATA_DIR, 'ai-settings.json');
const DB_PATH = path.join(DATA_DIR, 'petri.db');

const args = process.argv.slice(2);
const num = (name, dflt) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? Number(hit.split('=')[1]) : dflt;
};
const CTX = num('ctx', 16000);
const MAX_TOKENS = num('max-tokens', 8192); // deepseek-flash 系推理模型：预算过低会被 reasoning 吃满致正文空（实测抓真）
const MAX_ROUNDS = num('max-rounds', 8);
const MSG_CHARS = num('msg-chars', 1200);
const ACTIVE_PRESET = num('preset-id', 0); // 0=按 active_chat_model_id 定位

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 200)}`);
}

async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

// ---------- settings 改写（backup→apply / restore→verify） ----------
const bakPath = SETTINGS + '.ui500-bak';
function applySettings() {
  const raw = fs.readFileSync(SETTINGS, 'utf8');
  fs.writeFileSync(bakPath, raw);
  const settings = JSON.parse(raw);
  const activeId = ACTIVE_PRESET || settings.active_chat_model_id;
  // 预算面读数=agent-runner 查 model_profiles（authoritative）；展示面/会话配置读
  // chat_model_presets——两集合同 id 条目都要改，单改一处不生效（实测抓真）。
  const preset = (settings.chat_model_presets || []).find((p) => p.id === activeId);
  const profile = (settings.model_profiles || []).find((p) => p.id === activeId);
  if (!profile && !preset) throw new Error(`active preset/profile 不存在：${activeId}`);
  if (preset) preset.contextWindow = CTX;
  if (profile) profile.contextWindow = CTX;
  settings.generation = { ...(settings.generation || {}), maxTokens: MAX_TOKENS };
  fs.writeFileSync(SETTINGS, JSON.stringify(settings, null, 2));
  console.log(`[ui500] settings applied: preset=${activeId} contextWindow=${CTX}（presets+profiles 双改） generation.maxTokens=${MAX_TOKENS}`);
  return { activeId };
}
function restoreSettings() {
  const raw = fs.readFileSync(bakPath, 'utf8');
  fs.writeFileSync(SETTINGS, raw);
  const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const ok = sha(SETTINGS) === sha(bakPath);
  fs.rmSync(bakPath, { force: true });
  console.log(`[ui500] settings restored: hash-match=${ok}`);
  return ok;
}

// ---------- 压缩证据查询（readonly 打开 dev DB，WAL 并发安全） ----------
function findTaskIds(conversationId) {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    return db.prepare(
      `SELECT id FROM tasks
       WHERE json_valid(params) = 1 AND json_extract(params, '$.conversationId') = ?
         AND (json_extract(params, '$.kind') IS NULL OR json_extract(params, '$.kind') != 'subagent')
       ORDER BY created_at ASC`
    ).all(conversationId).map((r) => r.id);
  } finally { db.close(); }
}

// 无 per-task events REST 端点（SSE 即流即逝）——事件证据直读 task_events 表。
function readTaskEventsFromDb(taskIds) {
  if (taskIds.length === 0) return { budgetTrimmed: [], compacted: [] };
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  try {
    const placeholders = taskIds.map(() => '?').join(',');
    const rows = db.prepare(
      `SELECT task_id, payload FROM task_events
       WHERE task_id IN (${placeholders}) AND event_type IN ('token_budget', 'context_compacted')
       ORDER BY rowid ASC`
    ).all(...taskIds);
    const budgetTrimmed = [];
    const compacted = [];
    for (const row of rows) {
      let pl = row.payload;
      if (typeof pl === 'string') { try { pl = JSON.parse(pl); } catch { continue; } }
      if (!pl) continue;
      if (pl.event === 'token_budget' && pl.trimmed === true) {
        budgetTrimmed.push({ taskId: row.task_id, pct: pl.pct, messagesDropped: pl.messagesDropped, messagesTokensUsed: pl.messagesTokensUsed, contextWindow: pl.contextWindow });
      }
      if (pl.event === 'context_compacted') {
        compacted.push({ taskId: row.task_id, dropped: pl.dropped, summarized: pl.summarized, summaryHead: pl.summaryHead ? String(pl.summaryHead).slice(0, 120) : null });
      }
    }
    return { budgetTrimmed, compacted };
  } finally { db.close(); }
}

async function collectCompactionEvidence(conversationId, seenTaskIds) {
  const ids = findTaskIds(conversationId).filter((id) => !seenTaskIds.has(id));
  const result = readTaskEventsFromDb([...seenTaskIds, ...ids]);
  for (const id of ids) seenTaskIds.add(id);
  return result;
}

async function withMainWindow(fn) {
  const targets = await pollTargets({ timeoutMs: 15000 });
  const pages = filterPageTargets(targets).filter((t) => t.webSocketDebuggerUrl);
  const target = pages.find((t) => /petri|格物/i.test(t.title || '')) || pages[0];
  if (!target) throw new Error('无可用页面 target');
  const client = await connectTarget(target);
  try { return await fn(client); } finally { try { client.close(); } catch { /* */ } }
}

const LONG_TOPICS = [
  '请详细分析单细胞 RNA 测序中质量控制的关键指标，包括 nFeature_RNA、nCount_RNA、线粒体基因比例的阈值设定依据，以及不同组织样本的差异。',
  '请系统比较 DESeq2、edgeR、limma-voom 三种差异表达方法的统计模型假设、适用场景与优缺点，并给出选择建议。',
  '请解释细胞通讯分析中配体受体对推断的原理，比较 CellChat、NicheNet、CellPhoneDB 三种方法的数据库来源与打分机制。',
  '请详细介绍轨迹分析拟时序推断的数学原理，包括 Monocle3 与 SCORPIUS 的图构建方式差异与伪时间拟合方法。',
  '请论述空间转录组学中 spot 去卷积的挑战与主流方法（RCTD、cell2location、Tangram）的建模思路对比。',
  '请分析批次效应的来源与校正策略，比较 Harmony、Seurat integration、scVI 三种方法的理论基础与适用边界。',
  '请详细介绍富集分析方法演进，从 ORA 到 GSEA 再到 GSVA 的统计检验差异与多重校正策略。',
  '请系统说明免疫组库分析中 TCR/BCR 克隆型多样性指标的计算方式与生物学含义。',
];

const PAD_SENTENCES = [
  '在展开论述时请先给出整体框架，再逐层深入到每个子环节的技术细节与常见陷阱，最后给出一份可执行的检查清单，方便实验人员在样本处理阶段直接对照使用。',
  '每个关键结论请附上该方法首次提出的大致时间线与代表性工作背景，并说明在测序通量与参考基因组质量不同的条件下结论是否需要修正。',
  '请特别注意中文文献与英文文献在术语翻译上的常见分歧，在关键术语后括注英文原词，避免歧义传播。',
  '论述过程中请穿插说明哪些步骤对下游分析有不可逆影响，哪些步骤可以在后续分析中补救，并解释判断依据。',
];

function buildRoundMessage(round) {
  const topic = LONG_TOPICS[(round - 1) % LONG_TOPICS.length];
  let msg = `${topic}（第 ${round} 轮，请展开充分论述，至少 600 字。）`;
  let padIdx = 0;
  while (msg.length < MSG_CHARS) {
    msg += PAD_SENTENCES[padIdx % PAD_SENTENCES.length];
    padIdx += 1;
  }
  return msg.slice(0, Math.max(MSG_CHARS, 200));
}

async function sendRound(client, text) {
  const filled = await evalJs(client, `(() => {
    const ta = document.querySelector('textarea');
    if (!ta) return 'no-textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(text)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
  if (filled !== 'filled') return filled;
  await new Promise((r) => setTimeout(r, 300));
  return evalJs(client, `(() => {
    const btn = document.querySelector('[data-testid="chat-send"]');
    if (btn && !btn.disabled) { btn.click(); return 'sent'; }
    return 'no-send';
  })()`);
}

async function waitIdle(conversationId, { timeoutMs = 150_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await api('GET', `/ai/agent/tasks/inflight?conversationId=${encodeURIComponent(conversationId)}`);
    const tasks = res.json?.tasks || [];
    if (tasks.length === 0) {
      await new Promise((r) => setTimeout(r, 1500));
      return true;
    }
  }
  return false;
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const { activeId } = applySettings();
  const seenTaskIds = new Set();
  let conversationId = null;
  const uiBudget = [];
  try {
    const project = await api('POST', '/data/projects', { name: 'UI-500 压缩构造' });
    const projectId = project.json?.project?.id || project.json?.data?.id;
    const conv = await api('POST', '/ai/conversations', { title: 'UI-500 压缩构造', project_id: projectId });
    conversationId = conv.json?.conversation?.id || conv.json?.data?.conversation?.id || conv.json?.data?.id;
    record('setup.conversation', Boolean(conversationId && projectId), `project=${projectId} conv=${conversationId}`);

    await withMainWindow(async (client) => {
      await evalJs(client, `location.href = ${JSON.stringify(`http://localhost:3000/project/${projectId}?conversationId=${conversationId}`)}; true;`);
      await new Promise((r) => setTimeout(r, 3500));
      // UI 侧采集器：petri:token-budget（ContextBudgetButton 数据源）
      await evalJs(client, `(() => {
        window.__ui500Budget = [];
        window.addEventListener('petri:token-budget', (e) => window.__ui500Budget.push(e.detail));
        return 'collector-installed';
      })()`);

      let compactedSeen = null;
      for (let round = 1; round <= MAX_ROUNDS && !compactedSeen; round += 1) {
        const text = buildRoundMessage(round);
        const sent = await sendRound(client, text);
        if (sent !== 'sent') { record(`round${round}.send`, false, sent); break; }
        const idle = await waitIdle(conversationId);
        const ev = await collectCompactionEvidence(conversationId, seenTaskIds);
        record(`round${round}.evidence`, true,
          `idle=${idle} trimmed=${ev.budgetTrimmed.length} compacted=${ev.compacted.length}${ev.compacted.length ? ` dropped=${ev.compacted[0].dropped} summarized=${ev.compacted[0].summarized}` : ''}`);
        if (ev.compacted.length > 0) {
          compactedSeen = ev;
          await screenshotPng(client, EVIDENCE, `ui500-budget-after-compact.png`);
        }
      }
      const uiEvents = JSON.parse(await evalJs(client, `JSON.stringify(window.__ui500Budget || [])`));
      uiBudget.push(...uiEvents);
      if (!uiBudget.some((b) => b.trimmed)) {
        await screenshotPng(client, EVIDENCE, 'ui500-budget-no-trim.png');
      }
      record('ui.token-budget-events', uiBudget.length > 0, `帧数=${uiBudget.length} trimmed帧=${uiBudget.filter((b) => b.trimmed).length} 最大pct=${Math.max(0, ...uiBudget.map((b) => b.pct || 0))}`);
    });

    const ev = await collectCompactionEvidence(conversationId, seenTaskIds);
    const ok = ev.compacted.length > 0 && ev.budgetTrimmed.length > 0;
    record('api.compaction-events', ev.compacted.length > 0, `context_compacted=${ev.compacted.length} 首条=${JSON.stringify(ev.compacted[0] || null).slice(0, 160)}`);
    record('api.trimmed-budget-events', ev.budgetTrimmed.length > 0, `token_budget(trimmed)=${ev.budgetTrimmed.length} 首条=${JSON.stringify(ev.budgetTrimmed[0] || null).slice(0, 160)}`);
    record('ui.trimmed-budget-events', uiBudget.some((b) => b.trimmed), `UI 侧 trimmed 帧=${uiBudget.filter((b) => b.trimmed).length}`);
    fs.writeFileSync(path.join(EVIDENCE, 'events.json'), JSON.stringify({
      at: new Date().toISOString(), conversationId, activePreset: activeId,
      contextWindow: CTX, maxTokens: MAX_TOKENS,
      compacted: ev.compacted, budgetTrimmed: ev.budgetTrimmed,
      uiBudgetEvents: uiBudget, results,
    }, null, 2));
    console.log(`\n[ui500] 总体：${ok ? 'PASS' : 'FAIL'}（证据 acceptance/ui-500/）`);
    process.exitCode = ok ? 0 : 1;
  } finally {
    const restored = restoreSettings();
    record('settings.restored', restored, 'backup 哈希校验');
  }
}

main().catch((e) => { console.error('[ui500] fatal:', e); restoreSettings(); process.exit(2); });
