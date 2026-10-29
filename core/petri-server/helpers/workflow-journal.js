'use strict';

/**
 * helpers/workflow-journal.js — BLOCK-262（Q4b）工作流 journal 与 run 状态文件。
 *
 * 形态对齐 helpers/agent-journal.js（BLOCK-249 先例）：一行一事件、单行有界、
 * 文件轮转、读取有界、追加 best-effort 不阻塞执行；区别是本文件承载**工作流
 * 步骤血缘**（stepKey/scriptHash/argsHash/reusedFrom），是 resume 前缀复用的
 * 唯一读取源——因此 journal 写失败时 runner 必须把该步骤判失败（fail-closed，
 * 见 workflow-runner.js），不能静默丢血缘。
 *
 * 落点：<root>/<runId>/journal.jsonl + run.json（root 由调用方注入，生产侧
 * = dataPaths.dataFile('workflows')）。
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_LINE_BYTES = 4096;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 200;
const MAX_READ_BYTES = 64 * 1024;
const MAX_JOURNAL_TAIL = 100;

function safeRunId(value) {
  return String(value || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
}

function runDir(root, runId) {
  return path.join(root, safeRunId(runId));
}

function journalPath(root, runId) {
  return path.join(runDir(root, runId), 'journal.jsonl');
}

function runMetaPath(root, runId) {
  return path.join(runDir(root, runId), 'run.json');
}

/** 追加一行 journal（best-effort 落盘；超长行截断 summary 后仍超则截行）。 */
function appendJournalLine(root, runId, entry) {
  const file = journalPath(root, runId);
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
      line = JSON.stringify({
        ...entry,
        summaryHead: String(entry.summaryHead || '').slice(0, 256),
        errorHead: String(entry.errorHead || '').slice(0, 256),
        truncated: true,
      });
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        line = JSON.stringify({ ...entry, summaryHead: '', errorHead: '', truncated: true });
      }
    }
    fs.appendFileSync(file, `${line}\n`, 'utf8');
    return { ok: true };
  } catch (e) {
    // resume 依赖 journal 完整性；写失败必须让调用方知情（fail-closed）
    return { ok: false, error: 'journal_write_failed', message: e && e.message ? e.message : String(e) };
  }
}

/** 原子写 run.json（状态面：status/meta/args/hash/resume 引用）。 */
function writeRunMeta(root, runId, meta) {
  const file = runMetaPath(root, runId);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(meta), 'utf8');
    fs.renameSync(tmp, file);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'run_meta_write_failed', message: e && e.message ? e.message : String(e) };
  }
}

function readRunMeta(root, runId) {
  try {
    return { ok: true, meta: JSON.parse(fs.readFileSync(runMetaPath(root, runId), 'utf8')) };
  } catch {
    return { ok: false, error: 'run_meta_read_failed' };
  }
}

/** 有界读取 journal 行（旧→新；默认最近 MAX_READ_LINES 行）。 */
function readJournalLines(root, runId, { limit = MAX_READ_LINES } = {}) {
  const file = journalPath(root, runId);
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_READ_BYTES) {
    text = text.slice(-MAX_READ_BYTES);
  }
  const lines = text.trimEnd().split('\n').filter(Boolean);
  const out = [];
  for (const line of lines.slice(-Math.max(1, Math.min(limit, MAX_READ_LINES)))) {
    try {
      out.push(JSON.parse(line));
    } catch {
      /* 脏行跳过，不毁整页 */
    }
  }
  return out;
}

/** 列出全部 runId（目录名，有界）。 */
function listRunIds(root, { limit = 50 } = {}) {
  try {
    return fs
      .readdirSync(root)
      .filter((name) => {
        try {
          return fs.statSync(path.join(root, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort()
      .reverse()
      .slice(0, Math.max(1, Math.min(limit, 50)));
  } catch {
    return [];
  }
}

/**
 * resume 前缀表：从旧 journal 抽出可复用的 terminal agent 结果。
 * 命中条件（plan §2.4）：scriptHash+argsHash 一致 + kind=agent + status terminal。
 * 返回 Map<stepKey, {status, summary, agentId}>。
 */
function buildResumeTable(root, runId, { scriptHash, argsHash }) {
  const table = new Map();
  for (const line of readJournalLines(root, runId, { limit: MAX_READ_LINES })) {
    if (!line || !['agent', 'phase'].includes(line.kind)) continue;
    if (line.scriptHash !== scriptHash || line.argsHash !== argsHash) continue;
    if (!['completed', 'failed', 'cancelled'].includes(line.status)) continue;
    if (!line.stepKey) continue;
    if (line.reusedFrom) {
      // 复用行本身也代表该步骤已 settle；沿用其原值
    }
    if (line.kind === 'phase') {
      if (line.status === 'completed' && line.result !== undefined) {
        table.set(line.stepKey, { status: line.status, result: line.result });
      }
      continue;
    }
    table.set(line.stepKey, {
      status: line.status,
      summary: line.summaryHead || '',
      agentId: line.agentId || null,
    });
  }
  return table;
}

module.exports = {
  MAX_JOURNAL_TAIL,
  safeRunId,
  runDir,
  journalPath,
  runMetaPath,
  appendJournalLine,
  writeRunMeta,
  readRunMeta,
  readJournalLines,
  listRunIds,
  buildResumeTable,
};
