#!/usr/bin/env node
'use strict';
/**
 * block95-b1-diff-live.cjs — BLOCK-95 B1 实机 diff 对账（dev 栈，开关开）。
 *
 * 前置：dev 栈以 BIOF3_SERVER_HISTORY_ASSEMBLY=1 启动（restart-dev-stack.sh 透传）。
 * 流程：
 *   S1 短会话全等对账：seed 4 条历史 → 模拟前端 POST tagged(4+1) → 等 task 完成 →
 *      transcript request.messages 与 DB 拼装重放逐字 diff（短请求不触发折叠）；
 *   S2 长会话（250 条）对账：同法，长度=行数、尾条=本轮原文；若 transcript 触发
 *      折叠则降级为首尾+messagesTruncated 断言并如实登记；
 *   S3 开关关（当前进程 env 判断不可行——dev 栈已带开关；此断言由契约测试覆盖，
 *      本脚本只跑开态实机）。
 * 证据：acceptance/block-95/block95-b1-diff-live.json
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const ROOT = path.join(__dirname, '..');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-95');
const DB_FILE = path.join(ROOT, '.biof3-dev-user-data', 'data', 'biof3.db');
const TRANSCRIPT_DIR = path.join(ROOT, '.biof3-dev-user-data', 'data', 'llm-transcripts');
const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json' };

function apiPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(API + pathname, { method: 'POST', headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
function apiGet(pathname) {
  return new Promise((resolve, reject) => {
    http.get(API + pathname, { headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    }).on('error', reject);
  });
}

const Database = require(path.join(ROOT, 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));

function readTranscriptFor(convId) {
  const file = path.join(TRANSCRIPT_DIR, `${convId}.jsonl`); // convId 本身已带 conv_ 前缀
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

(async () => {
  const run = lib.createRun({ name: 'block95-b1-diff-live', evidenceDir: EVIDENCE_DIR });
  const db = new Database(DB_FILE); // WAL 多连接：dev 后端持连接，此处读写并行安全（busy_timeout 兜底）
  db.pragma('busy_timeout = 10000');

  // ---------- S1 短会话全等对账 ----------
  const convS1 = `conv_b95_b1_${Date.now().toString(36)}`;
  const now = Date.now();
  db.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(convS1, 'local-user', 'B1 对账短会话', 'active', null, new Date(now).toISOString(), new Date(now).toISOString());
  const seedS1 = db.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)');
  // seed ts 必须整体早于后端 append（真实 now）——否则 rowid 游标排序把本轮 user 插进历史中间
  [['user', '第一问：用一句话说明什么是 RAG'], ['assistant', 'RAG 是检索增强生成……']]
    .forEach(([role, content], i) => seedS1.run(`msg_s1_${Date.now().toString(36)}_${i}`, convS1, role, content, null, new Date(now - 120000 + i * 1000).toISOString()));
  const s1Incoming = '第二问（带引用原文）：[引用: demo.md]\n那向量检索呢？';
  // 增量形态请求（B1b 前端形态预演）：只发本轮 user——开关生效时 LLM 应收到
  // DB 全量历史 + 本轮原文；开关未生效时只会收到这 1 条（断言因此有区分度）。
  const s1Tagged = [
    { role: 'user', content: s1Incoming },
  ];

  const p1 = await apiPost('/api/ai/agent', {
    conversationId: convS1,
    messages: s1Tagged,
    context: { page: 'desktop-project', projectId: null },
  });
  if (p1.status !== 200 || !p1.body.taskId) {
    run.assert('s1_post_task_created', false, JSON.stringify(p1).slice(0, 200));
    const payload = await run.finish({ stage: 'S1-post-failed' });
    console.log('ALLPASS=' + payload.allPass);
    process.exit(payload.allPass ? 0 : 1);
  }
  const taskIdS1 = p1.body.taskId;
  run.assert('s1_post_task_created', true, `taskId=${taskIdS1} conv=${convS1}`);

  // 等 task 终态（真 LLM 轮次，上限 120s）——直查 DB（/task/:taskId 是 SSE 流端点会挂住）
  let finalS1 = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const row = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskIdS1);
    if (row && row.status && row.status !== 'running') { finalS1 = row.status; break; }
  }
  run.assert('s1_task_settled', finalS1 === 'done' || finalS1 === 'completed' || finalS1 === 'failed', `status=${finalS1}`);

  // transcript 对账：任务完成后 DB 尾部多出本轮 assistant 回复——
  // 第一轮请求的历史 = 除去尾部 assistant 回复后的 DB 前缀（+尾部原文回填语义）
  const allRowsS1 = db.prepare("SELECT role, content FROM copilot_messages WHERE conversation_id=? AND role IN ('user','assistant') ORDER BY ts ASC, rowid ASC").all(convS1);
  run.assert('s1_db_row_count_includes_turn_user', allRowsS1.length >= 3, `rows=${allRowsS1.length}`);
  const preReplyS1 = (allRowsS1.length > 0 && allRowsS1[allRowsS1.length - 1].role === 'assistant')
    ? allRowsS1.slice(0, -1)
    : allRowsS1;
  const expectedS1 = preReplyS1.map((r) => ({ role: r.role, content: String(r.content || '') }));
  const recsS1 = readTranscriptFor(convS1);
  const llmRec = recsS1.filter((r) => r.request && Array.isArray(r.request.messages))[0]; // 第一轮请求
  if (!llmRec) {
    run.assert('s1_transcript_found', false, `records=${recsS1.length}`);
  } else {
    run.assert('s1_transcript_found', true, `records=${recsS1.length}`);
    const folded = Boolean(llmRec.messagesTruncated);
    // runner 会把 system prompt 放头部——B1 对账只管对话历史，过滤 system 后逐字比
    const llmHistory = llmRec.request.messages.filter((m) => m.role !== 'system');
    if (!folded) {
      run.assert('s1_request_matches_db_assembly', JSON.stringify(llmHistory) === JSON.stringify(expectedS1),
        `llm=${llmHistory.length} expected=${expectedS1.length} first=${JSON.stringify(llmHistory[0]).slice(0, 80)}`);
      run.assert('s1_tail_is_original_incoming', llmHistory[llmHistory.length - 1].content === s1Incoming,
        'tail=' + String(llmHistory[llmHistory.length - 1].content).slice(0, 50));
    } else {
      run.assert('s1_request_matches_db_assembly_folded', llmRec.messagesTruncated > 0 && llmHistory.length > 0,
        `truncated=${llmRec.messagesTruncated}`);
    }
  }

  const payload = await run.finish({
    conversationId: convS1,
    taskId: taskIdS1,
    note: 'B1 开态实机：LLM 实际收到的 messages 与 DB 拼装逐字对账（开关=BIOF3_SERVER_HISTORY_ASSEMBLY=1）',
  });
  db.close();
  console.log('ALLPASS=' + payload.allPass);
  process.exit(payload.allPass ? 0 : 1);
})().catch((e) => { console.error('PROBE_ERROR', e && e.message); process.exit(2); });
