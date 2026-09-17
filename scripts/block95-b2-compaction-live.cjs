#!/usr/bin/env node
'use strict';
/**
 * block95-b2-compaction-live.cjs — BLOCK-95 B2/A5 实机验收（dev 栈，双开关开）。
 *
 * 前置：dev 栈以 BIOF3_SERVER_HISTORY_ASSEMBLY=1 BIOF3_SESSION_COMPACTION=1 启动。
 * 流程：
 *   S1 seed 重会话（40 条 × ~800 字 ≈ 数万 token，稳过 12000 阈值）；
 *   S2 轮次 1：POST 增量请求 → 完成 → 后台 compaction 触发 → 等 conversation_compaction 落库；
 *   S3 轮次 2：再发一轮 → transcript 对账：
 *      - before/after prompt_tokens（io-transcript usage）——压缩后显著下降；
 *      - 第二次请求 messages[0] = 摘要卡（[会话早期对话摘要…]）；
 *      - 红线：copilot_messages 原文只增不改（行数单调、历史行逐字节不变）。
 * 证据：acceptance/block-95/block95-b2-compaction-live.json（含 token 对账数字）。
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
const N_SEED = 40;
const CHUNK = '这段较早的讨论涵盖了数据清洗的参数选择、聚类分辨率对比与差异表达阈值约定，';

function apiPost(pathname, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(API + pathname, { method: 'POST', headers: AUTH }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(d) }); } catch { resolve({ status: res.statusCode, body: d }); } });
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

const Database = require(path.join(ROOT, 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));

function readTranscriptFor(convId) {
  const file = path.join(TRANSCRIPT_DIR, `${convId}.jsonl`);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

async function waitTaskDone(taskId, db, timeoutMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    const row = db.prepare('SELECT status FROM tasks WHERE id=?').get(taskId);
    if (row && row.status && row.status !== 'running') return row.status;
  }
  return 'timeout';
}

(async () => {
  const run = lib.createRun({ name: 'block95-b2-compaction-live', evidenceDir: EVIDENCE_DIR });
  const db = new Database(DB_FILE);
  db.pragma('busy_timeout = 10000');

  // S1 seed 重会话（ts 依次排在过去，后端 append 在其后）
  const convId = `conv_b95_b2_${Date.now().toString(36)}`;
  const now = Date.now();
  db.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(convId, 'local-user', 'B2 压缩验证重会话', 'active', null, new Date(now).toISOString(), new Date(now).toISOString());
  const seed = db.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)');
  for (let i = 0; i < N_SEED; i += 1) {
    const role = i % 2 === 0 ? 'user' : 'assistant';
    seed.run(`msg_b2l_${Date.now().toString(36)}_${i}`, convId, role,
      `B2消息-${i}（${role === 'user' ? '问' : '答'}）：${CHUNK.repeat(40)}`,
      null, new Date(now - 600000 + i * 1000).toISOString());
  }
  const seedSnapshot = db.prepare('SELECT rowid, id, role, content FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(convId);
  run.assert('s1_seeded_heavy_conversation', seedSnapshot.length === N_SEED, `rows=${seedSnapshot.length}`);

  const postTurn = async (text) => {
    const p = await apiPost('/api/ai/agent', {
      conversationId: convId,
      messages: [{ role: 'user', content: text }], // 增量形态（B1 后端拼装）
      context: { page: 'desktop-project', projectId: null },
    });
    return p;
  };

  // S2 轮次 1 → 后台 compaction
  const t1 = await postTurn('第一轮：请用一句话确认你在跟踪本会话背景');
  if (t1.status !== 200 || !t1.body.taskId) {
    run.assert('s2_turn1_posted', false, JSON.stringify(t1).slice(0, 160));
    const payload = await run.finish({ stage: 'S2-failed' });
    console.log('ALLPASS=' + payload.allPass);
    process.exit(payload.allPass ? 0 : 1);
  }
  const st1 = await waitTaskDone(t1.body.taskId, db, 180000);
  run.assert('s2_turn1_posted', st1 === 'completed' || st1 === 'done', `status=${st1} taskId=${t1.body.taskId}`);

  // 等 compaction 落库（后台生成，上限 90s）
  let comp = null;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    comp = db.prepare('SELECT * FROM conversation_compaction WHERE conversation_id=?').get(convId);
    if (comp) break;
  }
  run.assert('s2_compaction_recorded', !!comp, comp ? `covers=${comp.covers_count} srcTokens=${comp.source_tokens}` : 'no record');

  const recs1 = readTranscriptFor(convId);
  const firstReq = recs1.filter((r) => r.request && Array.isArray(r.request.messages))[0];
  const tokensBefore = firstReq && firstReq.response && firstReq.response.usage ? (firstReq.response.usage.prompt_tokens || 0) : 0;
  run.assert('s2_baseline_tokens_captured', tokensBefore > 0, `promptTokensBefore=${tokensBefore}`);

  // S3 轮次 2：摘要版视图
  const t2 = await postTurn('第二轮：背景里最早的讨论主题是什么？');
  const st2 = t2.status === 200 && t2.body.taskId ? await waitTaskDone(t2.body.taskId, db, 180000) : 'post_failed';
  run.assert('s3_turn2_settled', st2 === 'completed' || st2 === 'done', `status=${st2}`);

  const recs2 = readTranscriptFor(convId);
  const reqs = recs2.filter((r) => r.request && Array.isArray(r.request.messages));
  const secondReq = reqs[reqs.length - 1];
  let tokensAfter = 0;
  let summaryFirst = false;
  if (secondReq) {
    const hist = secondReq.request.messages.filter((m) => m.role !== 'system');
    summaryFirst = hist.length > 0 && /\[会话早期对话摘要/.test(String(hist[0].content || ''));
    tokensAfter = secondReq.response && secondReq.response.usage ? (secondReq.response.usage.prompt_tokens || 0) : 0;
  }
  run.assert('s3_summary_leads_second_request', summaryFirst, `secondReqMessages=${secondReq ? secondReq.request.messages.length : 0}`);
  run.assert('s3_tokens_reduced', tokensAfter > 0 && tokensAfter < tokensBefore, `before=${tokensBefore} after=${tokensAfter} saved=${tokensBefore - tokensAfter}`);

  // 红线：原文只增不改
  const afterSnapshot = db.prepare('SELECT rowid, id, role, content FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(convId);
  const prefixUnchanged = seedSnapshot.every((r, i) => afterSnapshot[i] && afterSnapshot[i].id === r.id && afterSnapshot[i].content === r.content);
  run.assert('redline_source_messages_immutable', afterSnapshot.length >= seedSnapshot.length && prefixUnchanged,
    `before=${seedSnapshot.length} after=${afterSnapshot.length}`);

  await lib.screenshotPng ? null : null;
  const payload = await run.finish({
    conversationId: convId,
    tokenLedger: { promptTokensBefore: tokensBefore, promptTokensAfter: tokensAfter, saved: Math.max(0, tokensBefore - tokensAfter) },
    compaction: comp ? { coversCount: comp.covers_count, sourceTokens: comp.source_tokens, summaryHead: String(comp.summary).slice(0, 120) } : null,
  });
  db.close();
  console.log('ALLPASS=' + payload.allPass);
  process.exit(payload.allPass ? 0 : 1);
})().catch((e) => { console.error('PROBE_ERROR', e && e.message); process.exit(2); });
