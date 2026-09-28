'use strict';

/**
 * helpers/job-live-log.js — BLOCK-126 P2（运行期日志行缓冲）。
 *
 * 语义：本地作业 spawn 化后 stdout/stderr 逐块喂入按 jobId 的有界行缓冲；
 * 日志端点在 run.log 尚未落盘的运行窗口内读取实时尾部（source: 'live'）。
 * 全量日志的真相仍是 finalize 时统一写入的 output/run.log——本缓冲只是
 * 运行窗口的投影，终态收尾后 clear，不构成第二份日志真相。
 *
 * 有界纪律：尾部 600 行 / 96KB 滚动，丢弃计数如实上报，不截断成
 * 「一半的真相」；StringDecoder 保证多字节内容跨 chunk 安全；
 * 未完成行（无换行结尾）在 endJobLiveLog 前不外泄，防半行乱码。
 */

const { StringDecoder } = require('node:string_decoder');

const MAX_LINES = 600;
const MAX_BYTES = 96 * 1024;

const trackers = new Map();

function trackerFor(jobId) {
  let tracker = trackers.get(jobId);
  if (!tracker) {
    tracker = {
      lines: [],
      bytes: 0,
      dropped: 0,
      pending: { stdout: '', stderr: '' },
      decoders: { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') },
    };
    trackers.set(jobId, tracker);
  }
  return tracker;
}

function pushLine(tracker, stream, line) {
  const entry = (stream === 'stderr' ? '[stderr] ' : '') + line;
  tracker.lines.push(entry);
  tracker.bytes += entry.length + 1;
  while ((tracker.lines.length > MAX_LINES || tracker.bytes > MAX_BYTES) && tracker.lines.length > 1) {
    const dropped = tracker.lines.shift();
    tracker.bytes -= dropped.length + 1;
    tracker.dropped += 1;
  }
}

/** 逐块追加。stream ∈ stdout | stderr；chunk 为 Buffer。 */
function appendJobLiveLog(jobId, stream, chunk) {
  if (!jobId || !chunk || !chunk.length) return;
  const tracker = trackerFor(jobId);
  const key = stream === 'stderr' ? 'stderr' : 'stdout';
  tracker.pending[key] += tracker.decoders[key].write(chunk);
  const parts = tracker.pending[key].split('\n');
  tracker.pending[key] = parts.pop() || '';
  for (const line of parts) pushLine(tracker, key, line);
}

/** 进程退出后冲刷未完成行（decoder 余量 + 无换行尾段）。 */
function endJobLiveLog(jobId) {
  const tracker = trackers.get(jobId);
  if (!tracker) return;
  for (const key of ['stdout', 'stderr']) {
    const rest = tracker.decoders[key].end() + (tracker.pending[key] || '');
    tracker.pending[key] = '';
    if (rest) pushLine(tracker, key, rest);
  }
}

/**
 * 读实时尾部。maxBytes 预算内按行边界取最旧可行段。
 * 返回 { log, truncated, lineCount, droppedLines }；无缓冲返回 null。
 */
function readJobLiveLogTail(jobId, maxBytes = 32 * 1024) {
  const tracker = trackers.get(jobId);
  if (!tracker || tracker.lines.length === 0) return null;
  const out = [];
  let used = 0;
  let truncated = false;
  for (let i = tracker.lines.length - 1; i >= 0; i -= 1) {
    const need = tracker.lines[i].length + 1;
    if (used + need > maxBytes && out.length > 0) { truncated = true; break; }
    out.unshift(tracker.lines[i]);
    used += need;
  }
  return {
    log: out.join('\n'),
    truncated: truncated || tracker.dropped > 0,
    lineCount: out.length,
    droppedLines: tracker.dropped,
  };
}

/** 终态收尾后清缓冲，防 Map 无界增长。 */
function clearJobLiveLog(jobId) {
  trackers.delete(jobId);
}

module.exports = { appendJobLiveLog, endJobLiveLog, readJobLiveLogTail, clearJobLiveLog };
