'use strict';

/**
 * routes/ai-agent/llm-transcripts.js — BLOCK-37 P2
 *
 * 模型 I/O 信息流只读查询端点。数据源是 io-transcript.js 落盘的
 * <PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl（含轮转留存文件）：
 *   GET /api/ai/agent/llm-transcripts?conversationId=X
 *     → 索引（不含正文）：ts / model / kind / role / attemptIndex / durationMs /
 *       finishReason / usage / messagesCount / framesCount / 截断标记 / error 摘要 / sizeBytes
 *   GET /api/ai/agent/llm-transcripts/record?conversationId=X&id=rt_...（或 traceId=）
 *     → 单条完整记录（request.messages 全量 + response 聚合 + delta 帧样本）
 *
 * 纪律：严格只读（无重放/编辑/删除）；conversationId 白名单校验拒路径穿越；
 * 文件不存在返回诚实空态；0 新依赖。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

// 与 io-transcript.safeIdPart 的「保持不变」域一致：这些 id 写读同源
const CONVERSATION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function resolveDataDir() {
  return process.env.PETRI_LOCAL_DATA_DIR
    || path.join(os.homedir(), 'Documents', 'Petri-Local');
}

/** 会话对应全部 JSONL 文件：活跃文件 + 已轮转留存文件（<id>.jsonl / <id>.<ts>.jsonl）。 */
function transcriptFiles(dir, conversationId) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const re = new RegExp(`^${conversationId}(?:\\.\\d+)?\\.jsonl$`);
  return names
    .filter((name) => re.test(name))
    .map((name) => path.join(dir, name));
}

/** 读取并解析一个 JSONL 文件：[{ record, sizeBytes }]，坏行诚实跳过。 */
function parseJsonlFile(file) {
  let raw = '';
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed);
      if (record && typeof record === 'object') {
        out.push({ record, sizeBytes: Buffer.byteLength(trimmed, 'utf8') });
      }
    } catch {
      // 坏行（半截写入等）：跳过不抛
    }
  }
  return out;
}

/** 索引投影：不含请求/响应正文与帧样本。 */
function toIndexEntry({ record, sizeBytes }) {
  const response = record.response && typeof record.response === 'object' ? record.response : null;
  return {
    id: record.id,
    ts: record.ts,
    conversationId: record.conversationId || null,
    kind: record.kind,
    role: record.role,
    traceId: record.traceId,
    provider: record.provider,
    profileId: record.profileId,
    model: record.model,
    attemptIndex: record.attemptIndex,
    durationMs: record.durationMs,
    finishReason: response ? response.finishReason : undefined,
    usage: response ? response.usage : undefined,
    messagesCount: record.request && Array.isArray(record.request.messages)
      ? record.request.messages.length
      : 0,
    framesCount: Number.isFinite(record.framesCount) ? record.framesCount : 0,
    framesTruncated: record.framesTruncated === true,
    truncated: record.truncated === true,
    messagesTruncated: record.messagesTruncated || 0,
    error: record.error || null,
    sizeBytes,
  };
}

/**
 * 列出会话全部模型调用索引（按 ts 升序）。
 * @returns {{ ok: true, count: number, records: Array }}
 */
function listTranscripts(dataDir, conversationId) {
  const id = String(conversationId || '').trim();
  if (!CONVERSATION_ID_RE.test(id)) {
    return { ok: false, error: 'conversationId 非法' };
  }
  const dir = path.join(dataDir, 'llm-transcripts');
  const entries = [];
  for (const file of transcriptFiles(dir, id)) {
    entries.push(...parseJsonlFile(file));
  }
  entries.sort((a, b) => String(a.record.ts).localeCompare(String(b.record.ts)));
  return { ok: true, count: entries.length, records: entries.map(toIndexEntry) };
}

/**
 * 读取单条完整记录（按 id 或 traceId 命中，取 ts 最新一条）。
 * @returns {{ ok: true, record: object, sizeBytes: number } | { ok: false, error: string }}
 */
function readTranscriptRecord(dataDir, conversationId, { id, traceId } = {}) {
  const convId = String(conversationId || '').trim();
  if (!CONVERSATION_ID_RE.test(convId)) {
    return { ok: false, error: 'conversationId 非法' };
  }
  const recordId = String(id || '').trim();
  const recordTraceId = String(traceId || '').trim();
  if (!recordId && !recordTraceId) {
    return { ok: false, error: 'id 或 traceId 必填其一' };
  }
  const dir = path.join(dataDir, 'llm-transcripts');
  let found = null;
  for (const file of transcriptFiles(dir, convId)) {
    for (const entry of parseJsonlFile(file)) {
      const hit = recordId
        ? entry.record.id === recordId
        : entry.record.traceId === recordTraceId;
      if (hit && (!found || String(entry.record.ts) >= String(found.record.ts))) {
        found = entry;
      }
    }
  }
  if (!found) return { ok: false, error: 'not_found' };
  return { ok: true, record: found.record, sizeBytes: found.sizeBytes };
}

module.exports = {
  register(app) {
    app.get('/api/ai/agent/llm-transcripts', (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const conversationId = String((req.query && req.query.conversationId) || '').trim();
      if (!conversationId) {
        return res.status(400).json({ status: 'error', error: 'conversationId 不能为空' });
      }
      try {
        const result = listTranscripts(resolveDataDir(), conversationId);
        if (!result.ok) {
          return res.status(400).json({ status: 'error', error: result.error });
        }
        return res.json({ status: 'ok', conversationId, count: result.count, records: result.records });
      } catch (error) {
        return res.status(500).json({ status: 'error', error: (error && error.message) || '查询失败' });
      }
    });

    app.get('/api/ai/agent/llm-transcripts/record', (req, res) => {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }
      const conversationId = String((req.query && req.query.conversationId) || '').trim();
      if (!conversationId) {
        return res.status(400).json({ status: 'error', error: 'conversationId 不能为空' });
      }
      try {
        const result = readTranscriptRecord(resolveDataDir(), conversationId, {
          id: (req.query && req.query.id) || '',
          traceId: (req.query && req.query.traceId) || '',
        });
        if (!result.ok) {
          const notFound = result.error === 'not_found';
          return res.status(notFound ? 404 : 400).json({ status: 'error', error: result.error });
        }
        return res.json({ status: 'ok', conversationId, record: result.record, sizeBytes: result.sizeBytes });
      } catch (error) {
        return res.status(500).json({ status: 'error', error: (error && error.message) || '查询失败' });
      }
    });
  },

  listTranscripts,
  readTranscriptRecord,
};
