/**
 * Petri shared backend — IPC Trace (BLOCK-520 P1 / OB-002)
 *
 * 单条 IPC 全链 rid 关联。纯内存 ring（有界），不依赖 Electron——主进程负责
 * 生成/记录 rid，renderer 侧经 preload 自包含字面量生成同名格式 rid 并透传。
 * 诊断包可按 rid 重建时间轴。rid 为可选参数：老 handler 签名不认它也不受影响。
 */

const RING_PER_RID = 64;
const timelines = new Map(); // rid -> [{phase, channel, at, ...}]

let seq = 0;
function newRid() {
  seq += 1;
  return `rid-${process.pid}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

function traceIpc({ rid, channel, phase, ok, durationMs, ...rest } = {}) {
  if (!rid) return;
  let events = timelines.get(rid);
  if (!events) {
    events = [];
    timelines.set(rid, events);
  }
  events.push({
    phase: String(phase || 'event'),
    channel: channel == null ? null : String(channel),
    at: new Date().toISOString(),
    ...(ok === undefined ? {} : { ok: Boolean(ok) }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...rest,
  });
  if (events.length > RING_PER_RID) events.shift();
}

function getTraceTimeline(rid) {
  return [...(timelines.get(rid) || [])];
}

function clearTraces() {
  timelines.clear();
}

module.exports = { newRid, traceIpc, getTraceTimeline, clearTraces };
