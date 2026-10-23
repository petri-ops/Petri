'use strict';

/**
 * helpers/agent-journal.js — BLOCK-249（Q4a）运行级 journal。
 *
 * 定位：**诊断摘要**，不是第二事件源。`task_events` 仍是唯一事件真相；journal 只回答
 * "这次多代理运行里，每个成员最终交了什么、什么时候结束、血缘是谁"——一行一个成员。
 *
 * 落点：`<dataDir>/agent-journal/<leaderTaskId>/journal.jsonl`（每次多代理运行一个目录）。
 * 边界：单行 ≤4KB、单文件 1MB 轮转 `.1`、读取有界（默认 50 行 / 64KB）；任何失败 best-effort
 * 不阻塞子代理收口。
 */

const fs = require('node:fs');
const path = require('node:path');
const dataPaths = require('../../shared-backend/data-paths');

const MAX_LINE_BYTES = 4096;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 200;
const MAX_READ_BYTES = 64 * 1024;

function safeId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

function journalRoot() {
  return dataPaths.dataFile('agent-journal');
}

function journalPath(leaderTaskId) {
  return path.join(journalRoot(), safeId(leaderTaskId), 'journal.jsonl');
}

function hasJournal(leaderTaskId) {
  try {
    return fs.existsSync(journalPath(leaderTaskId));
  } catch {
    return false;
  }
}

/** 追加一行（best-effort）：返回落盘状态，不抛异常。 */
function appendJournalEntry(entry) {
  const leaderTaskId = entry && entry.leaderTaskId;
  if (!leaderTaskId) return { ok: false, error: 'leader_required' };
  const file = journalPath(leaderTaskId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const stat = fs.statSync(file);
      if (stat.size > MAX_FILE_BYTES) fs.renameSync(file, `${file}.1`);
    } catch {
      /* 首次写入 */
    }
    let line = JSON.stringify(entry);
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
      line = JSON.stringify({ ...entry, resultHead: String(entry.resultHead || '').slice(0, 800), truncated: true });
    }
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

/** 有界读取（尾部 limit 行 + 字节上限）；损坏行如实标记，不静默丢。 */
function readJournal(leaderTaskId, { limit = 50, maxBytes = MAX_READ_BYTES } = {}) {
  const file = journalPath(leaderTaskId);
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ok: true, entries: [], truncated: false, corrupt: 0, path: file, exists: false };
  }
  const byteCap = Math.max(1024, Math.min(MAX_READ_BYTES, Number(maxBytes) || MAX_READ_BYTES));
  const lineCap = Math.max(1, Math.min(MAX_READ_LINES, Number(limit) || 50));
  let text = raw;
  if (Buffer.byteLength(text, 'utf8') > byteCap) {
    text = text.slice(-byteCap);
    const firstNewline = text.indexOf('\n');
    if (firstNewline >= 0) text = text.slice(firstNewline + 1);
  }
  const lines = text.split('\n').filter(Boolean);
  const tail = lines.slice(-lineCap);
  const entries = [];
  let corrupt = 0;
  for (const line of tail) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      corrupt += 1;
    }
  }
  return {
    ok: true,
    entries,
    truncated: lines.length > tail.length || text.length < raw.length,
    corrupt,
    path: file,
    exists: true,
  };
}

module.exports = {
  journalRoot,
  journalPath,
  hasJournal,
  appendJournalEntry,
  readJournal,
  MAX_READ_LINES,
  MAX_READ_BYTES,
};
