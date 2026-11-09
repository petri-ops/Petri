#!/usr/bin/env node
/**
 * scripts/post-s7-seed-conversations.cjs — post-S7 H8 实机腿专用种子（隔离库）
 *
 * 只写 PETRI_DB_PATH 指向的隔离副本（默认 /tmp/petri-h8-isolated/data/petri.db），
 * 绝不写用户主库 .petri-dev-user-data/data/petri.db。主库由本脚本以 readonly 打开
 * 做一致性快照（VACUUM INTO），种子全部落在快照上。
 *
 * 造两类负载：
 *  ① conversations=N 条会话行（左栏 DOM 预算）；
 *  ② 指定会话内 M 条 copilot_messages（.sc-messages 消息行 DOM 预算）。
 * 幂等：以 title 前缀 `H8-SEED-` 识别，重复运行先删本脚本造的行再插。
 *
 * 用法：node scripts/post-s7-seed-conversations.cjs --convs 400 --msgs 0
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Database = require(path.join(__dirname, '..', 'core/petri-server/node_modules/better-sqlite3'));

const ROOT = path.join(__dirname, '..');
const MAIN_DB = path.join(ROOT, '.petri-dev-user-data/data/petri.db');
const ISO_DB = process.env.PETRI_DB_PATH || '/tmp/petri-h8-isolated/data/petri.db';

function argNum(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
}

function snapshot() {
  fs.mkdirSync(path.dirname(ISO_DB), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(ISO_DB + suffix, { force: true }); } catch { /* best effort */ }
  }
  const src = new Database(MAIN_DB, { readonly: true });
  src.exec(`VACUUM INTO '${ISO_DB.replace(/'/g, "''")}'`);
  src.close();
}

function seed({ convs, msgs }) {
  const db = new Database(ISO_DB);
  const project = db.prepare("SELECT id FROM projects WHERE status='active' ORDER BY updated_at DESC LIMIT 1").get();
  if (!project) throw new Error('isolated db has no active project');
  const delMessages = db.prepare("DELETE FROM copilot_messages WHERE conversation_id IN (SELECT id FROM copilot_conversations WHERE title LIKE 'H8-SEED-%')");
  const delConvs = db.prepare("DELETE FROM copilot_conversations WHERE title LIKE 'H8-SEED-%'");
  const insConv = db.prepare(`INSERT INTO copilot_conversations
    (id,user_id,title,status,last_page,project_id,message_count,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)`);
  const insMsg = db.prepare(`INSERT INTO copilot_messages
    (id,conversation_id,role,content,meta_json,ts,task_id)
    VALUES (?,?,?,?,?,?,NULL)`);
  db.transaction(() => {
    delMessages.run();
    delConvs.run();
    const base = Date.now();
    for (let i = 0; i < convs; i += 1) {
      const id = `conv_h8seed_${String(i).padStart(4, '0')}`;
      const ts = new Date(base - i * 60000).toISOString();
      insConv.run(id, 'local-user', `H8-SEED-${String(i + 1).padStart(4, '0')} DOM 预算负载会话`, 'active', 'desktop-project', project.id, msgs && i === 0 ? msgs : 0, ts, ts);
      if (msgs && i === 0) {
        const meta = JSON.stringify({ page: 'desktop-project', projectId: project.id });
        for (let m = 0; m < msgs; m += 1) {
          insMsg.run(`msg_h8seed_${String(m).padStart(5, '0')}`, id, m % 2 === 0 ? 'user' : 'assistant',
            `H8 种子消息 ${m + 1}：用于量测消息列表的节点数与滚动帧率，不是真实任务产物。`, meta,
            new Date(base + m * 1000).toISOString());
        }
      }
    }
  })();
  const total = db.prepare('SELECT count(*) n FROM copilot_conversations').get().n;
  const msgTotal = db.prepare("SELECT count(*) n FROM copilot_messages WHERE id LIKE 'msg_h8seed_%'").get().n;
  db.close();
  return { projectId: project.id, seededConvs: convs, seededMsgs: msgs, totalConvs: total, totalSeedMsgs: msgTotal };
}

if (require.main === module) {
  const convs = argNum('--convs', 400);
  const msgs = argNum('--msgs', 0);
  if (process.argv.includes('--snapshot-only')) {
    snapshot();
    console.log('[h8-seed] snapshot ->', ISO_DB);
  } else {
    const before = fs.existsSync(ISO_DB);
    if (!before) snapshot();
    const result = seed({ convs, msgs });
    console.log('[h8-seed]', JSON.stringify(result), 'db =', ISO_DB);
  }
}

module.exports = { seed, snapshot, MAIN_DB, ISO_DB };
