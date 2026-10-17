'use strict';
/**
 * scripts/lib/evals-recording.mjs — BLOCK-193 capture/replay 真实录制态（评测 v2 第五切片）。
 *
 * 设计定案（P0 实码勘察后）：**不新建录制代理、不写第二套 SSE 解析**。模型 I/O 早就有生产级
 * 记录器——core/shared-backend/llm-providers/io-transcript.js（BLOCK-37）由 model-gateway 的
 * chat() 在流式与非流式两条分支之后统一 _emitTranscript，落
 * <PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl。evals 隔离后端把
 * PETRI_LOCAL_DATA_DIR 指到 tmpDir，故真模型跑完时录制台账**已经在 tmpDir 里写好了**，只是随
 * fs.rmSync 一起销毁。本模块就是那段「收割 + 投影 + 入库闸」：
 *   收割=按「文件名→行数」差分定位本任务新增记录（任务串行跑，差分即归属；不靠时钟、
 *         不靠 conversationId 命名）；
 *   投影=response{content|toolCalls,finishReason} → startMockProvider 的回合形状，
 *         request{messages,params} → 与 mock.captured 同形的出站证据（供 BLOCK-189 哨兵）；
 *   闸=①密钥扫描（复用 secret-scan 的同一模式集，命中即拒写且只报模式名）
 *       ②合成任务闸（产物必须源自仓库自写任务 JSON，且转录出站逐字含该 prompt）。
 * 纯函数 + 薄文件 IO：零 provider 调用、零网络、零时钟依赖。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { scanTextForSecrets } from '../secret-scan.mjs';

export const RECORDING_SCHEMA = 'petri-evals-recording/v1';

function sha256(value) {
  return crypto.createHash('sha256').update(String(value ?? '')).digest('hex');
}

// ---------- 收割 ----------
export function transcriptDirOf(tmpDir) {
  return path.join(tmpDir, 'llm-transcripts');
}

function transcriptFiles(tmpDir) {
  try {
    return fs.readdirSync(transcriptDirOf(tmpDir))
      .filter((name) => name.endsWith('.jsonl'))
      .sort();
  } catch {
    return [];
  }
}

function readLines(tmpDir, file) {
  try {
    return fs.readFileSync(path.join(transcriptDirOf(tmpDir), file), 'utf8')
      .split('\n')
      .filter((line) => line.trim());
  } catch {
    return [];
  }
}

/** 收割前快照：文件名 → 已写行数（任务启动前调用）。目录不存在=空快照，诚实非故障。 */
export function snapshotTranscriptCounts(tmpDir) {
  const counts = {};
  for (const file of transcriptFiles(tmpDir)) counts[file] = readLines(tmpDir, file).length;
  return counts;
}

/**
 * 读回本次任务新增的转录记录（任务收口后调用）。
 * 归属=行号差分（同一文件内 before 之后的行）；排序=ts 字典序（同刻并列按文件/行号稳定兜底）。
 * 解析失败的行不静默丢弃：计入 returned.unparsed。
 */
export function readNewTranscriptRecords(tmpDir, before = {}) {
  const rows = [];
  let unparsed = 0;
  for (const file of transcriptFiles(tmpDir)) {
    const lines = readLines(tmpDir, file);
    const from = Number.isFinite(before[file]) ? before[file] : 0;
    lines.slice(from).forEach((line, index) => {
      let record = null;
      try {
        record = JSON.parse(line);
      } catch {
        unparsed += 1;
        return;
      }
      if (!record || typeof record !== 'object') {
        unparsed += 1;
        return;
      }
      rows.push({ ts: typeof record.ts === 'string' ? record.ts : '', file, index, record });
    });
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.file < b.file ? -1 : a.file > b.file ? 1 : a.index - b.index));
  return { records: rows.map((r) => r.record), unparsed };
}

// ---------- 投影 ----------
/** 单条转录 → startMockProvider 回合。既无工具调用又无正文 → 不投影（绝不编造空回合）。 */
export function projectTranscriptToTurn(record) {
  const r = record || {};
  if (r.error) return { turn: null, reason: `转录带 error=${String(r.error).slice(0, 40)}` };
  const resp = r.response;
  if (!resp || typeof resp !== 'object') return { turn: null, reason: '转录无聚合响应（response 缺失）' };
  const toolCalls = Array.isArray(resp.toolCalls) ? resp.toolCalls.filter(Boolean) : [];
  const content = typeof resp.content === 'string' ? resp.content : '';
  if (toolCalls.length) {
    const turn = {
      toolCalls: toolCalls.map((tc) => {
        const fn = (tc && tc.function) || {};
        return {
          name: typeof fn.name === 'string' ? fn.name : '',
          arguments: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
        };
      }),
      finish: 'tool_calls',
    };
    // 真实回合常「正文 + 工具调用」同帧；只投工具会丢正文 → 保留 content 供 mock 先发正文帧。
    if (content) turn.content = content;
    return { turn, reason: null };
  }
  if (!content) return { turn: null, reason: '回合既无工具调用也无正文（不投影）' };
  return { turn: { content, finish: resp.finishReason || 'stop' }, reason: null };
}

/** 单条转录 → 与 mock.captured 同形的出站证据（供 outbound_contains 归一化断言）。 */
export function projectTranscriptToOutbound(record) {
  const r = record || {};
  const req = r.request || {};
  let params = {};
  try {
    params = typeof req.params === 'string' ? JSON.parse(req.params) : (req.params || {});
  } catch {
    params = {};
  }
  const messages = Array.isArray(req.messages) ? req.messages : [];
  return {
    model: r.model ?? params.model ?? null,
    messages,
    tools: Array.isArray(params.tools) ? params.tools : null,
  };
}

/** 转录集 → 录制产物（只存语义回合与骨架，不搬 frames/usage/tools 全量 schema）。 */
export function buildRecording({ task, suite, sourceSuiteFile, records, provider = {} }) {
  const t = task || {};
  const turns = [];
  const droppedReasons = [];
  const outbound = (records || []).map(projectTranscriptToOutbound);
  for (const record of records || []) {
    const { turn, reason } = projectTranscriptToTurn(record);
    if (turn) turns.push(turn);
    else droppedReasons.push(String(reason || '未投影'));
  }
  return {
    schema: RECORDING_SCHEMA,
    id: String(t.id || ''),
    suite: String(suite || ''),
    sourceSuiteFile: String(sourceSuiteFile || ''),
    promptSha256: sha256(t.prompt),
    provider: { name: provider.name || null, model: provider.model || null },
    recordedAt: new Date().toISOString(),
    requestCount: (records || []).length,
    turnCount: turns.length,
    droppedCount: droppedReasons.length,
    droppedReasons,
    // role 骨架（无正文）：人审用得上，又不把对话内容搬进仓。
    outboundRoles: outbound.map((o) => (o.messages || []).map((m) => m && m.role)),
    turns,
  };
}

// ---------- 入库闸 ----------
/**
 * 写盘前的两道闸（用户定案约束①②）。返回 { ok, reasons[] }；reasons 只含模式名与判定名，
 * 绝不含被扫内容——闸本身不得成为密钥外泄通道。
 */
export function gateRecording({ recording, task, records }) {
  const reasons = [];
  const rec = recording || {};
  const t = task || {};
  const secretHits = scanTextForSecrets(JSON.stringify(rec));
  if (secretHits.length) reasons.push(`密钥模式命中：${secretHits.join('/')}`);
  if (rec.schema !== RECORDING_SCHEMA) reasons.push('产物 schema 非 petri-evals-recording/v1');
  const suiteFile = String(rec.sourceSuiteFile || '');
  if (!new RegExp(`^evals/suites/${rec.suite || ''}/[^/]+\\.json$`).test(suiteFile.replace(/\\/g, '/'))) {
    reasons.push('非仓库自写任务（sourceSuiteFile 不在 evals/suites/<suite>/ 下）');
  }
  if (!t.id || rec.id !== t.id) reasons.push('产物 id 与任务不符');
  if (rec.promptSha256 !== sha256(t.prompt)) reasons.push('prompt 与仓库任务不一致（录制不可信）');
  const promptInOutbound = (records || []).some((record) => JSON.stringify((record && record.request && record.request.messages) || []).includes(String(t.prompt ?? '')) && String(t.prompt ?? '').length > 0);
  if (!promptInOutbound) reasons.push('转录出站请求未逐字含仓库 prompt（可能混入非合成输入）');
  if (!Number.isFinite(rec.turnCount) || rec.turnCount <= 0) reasons.push('无有效回合（拒录，防投空白队列）');
  return { ok: reasons.length === 0, reasons };
}

// ---------- 读取与回放校验 ----------
export function recordingPath(root, suite, taskId) {
  return path.join(root, 'evals', 'recordings', String(suite), `${String(taskId)}.json`);
}

export function loadRecording(root, suite, taskId) {
  const file = recordingPath(root, suite, taskId);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 回放前对账：产物必须是同任务同 prompt 的录制（仓库 prompt 漂移即拒放，防「罐头对不上题」）。 */
export function verifyRecordingForReplay(task, recording) {
  const t = task || {};
  const rec = recording || {};
  if (!recording) return { ok: false, reason: `无录制产物：evals/recordings/${t.suite || '?'}/${t.id || '?'}.json（先跑 --record）` };
  if (rec.schema !== RECORDING_SCHEMA) return { ok: false, reason: `产物 schema 非 ${RECORDING_SCHEMA}` };
  if (rec.id !== t.id) return { ok: false, reason: `产物 id「${rec.id}」与任务「${t.id}」不符` };
  if (rec.promptSha256 !== sha256(t.prompt)) return { ok: false, reason: '仓库 prompt 已与录制时不一致（重录后再放）' };
  if (!Array.isArray(rec.turns) || rec.turns.length === 0) return { ok: false, reason: '产物无回合可投' };
  return { ok: true, reason: null };
}

/**
 * 罐头假绿闸（约束③）：replay 态任务的判据里必须至少有一条 `outbound_contains`，
 * 否则「投了罐头回合但请求根本没走过 provider」也能全绿。缺哨兵=直接红，不是警告。
 */
export function assertReplaySentinel(task) {
  const criteria = Array.isArray((task && task.criteria)) ? task.criteria : [];
  const has = criteria.some((c) => c && c.kind === 'outbound_contains');
  return { ok: has, reason: has ? null : 'replay 任务缺 outbound_contains 出站哨兵判据（防罐头响应假绿）' };
}
