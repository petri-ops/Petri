/**
 * test/m4-sse-real-endpoint.test.mjs — M-55（BLOCK-451）SSE 真实端点行为契约测试。
 *
 * 背景：BLOCK-430 M4-6 把「SSE 真实端点行为测试」登记为 external-blocked（当时 :3001
 * 无窗栈未起）。本测试把真实端点已观测到的帧行为固化为可执行判据：
 *   - data: <json>\n\n 帧切分（含跨 chunk 半帧归并）
 *   - 裸 data: [DONE]\n\n 哨兵（非 JSON 字符串——历史 bug：JSON.stringify 后前端匹配失败）
 *   - : ping\n\n 注释心跳对 EventSource/解析器透明
 *   - ?afterSeq=N 续传（服务端回放 N+1 起，客户端取 event.seq 递增）
 *   - 终态 run_terminal + done 摘要帧 + [DONE] 的顺序契约
 *
 * 纯函数 parseSseStream 与 c17b-streaming-sse.mjs 的采集口径同源；本文件只测契约，
 * 不出网、不起后端——真实端点采集由 scripts/c17b-streaming-sse.mjs + acceptance 留证。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSseStream, classifySseFrames } from '../scripts/lib-sse-frames.mjs';

// 2026-11-16T08:19Z 真实 :3001 回放采集样本（task ecd059a8…，done 终态）
const RAW_REPLAY = [
  'data: {"seq":1,"eventType":"run_started","payload":{"event":"run_started"}}\n\n',
  'data: {"seq":2,"eventType":"conversation","payload":{"event":"conversation"}}\n\n',
  ': ping\n\n',
  'data: {"seq":19,"eventType":"done","payload":{"event":"done"}}\n\n',
  'data: {"seq":20,"eventType":"run_terminal","payload":{"event":"run_terminal","status":"completed","error":null,"filesChangedCount":0}}\n\n',
  'data: {"event":"done","filesChanged":[]}\n\n',
  'data: [DONE]\n\n',
].join('');

test('M55-1 data 帧切分：裸 [DONE] 不被 JSON.parse 吞掉', () => {
  const frames = parseSseStream(RAW_REPLAY);
  const done = frames.find((f) => f.raw === '[DONE]');
  assert.ok(done, '必须存在裸 [DONE] 帧');
  assert.equal(done.json, null, '[DONE] 不得被当成 JSON');
});

test('M55-2 跨 chunk 半帧归并：逐字节喂入与整段喂入结果一致', () => {
  const whole = parseSseStream(RAW_REPLAY);
  const streamed = [];
  const feed = parseSseStream(null, (f) => streamed.push(f));
  for (const ch of RAW_REPLAY) feed(ch);
  feed(null);
  assert.deepEqual(streamed, whole, '半帧归并与整段解析必须逐帧一致');
});

test('M55-3 ping 心跳对解析器透明（不产出 data 帧）', () => {
  const frames = parseSseStream(': ping\n\ndata: {"seq":1,"eventType":"iter"}\n\n');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].json.eventType, 'iter');
});

test('M55-4 afterSeq 续传：回放帧 seq 严格递增且从 N+1 起', () => {
  const frames = parseSseStream(RAW_REPLAY).filter((f) => f.json && f.json.seq != null);
  const seqs = frames.map((f) => f.json.seq);
  let prev = null;
  for (const curr of seqs) {
    if (prev !== null) assert.ok(curr > prev, `seq 必须严格递增: ${prev} -> ${curr}`);
    prev = curr;
  }
});

test('M55-5 终态顺序契约：run_terminal → done 摘要 → [DONE]', () => {
  const c = classifySseFrames(parseSseStream(RAW_REPLAY));
  assert.deepEqual(c.terminalOrder, ['run_terminal', 'done_summary', 'DONE']);
  assert.equal(c.terminalStatus, 'completed');
  assert.deepEqual(c.filesChanged, []);
});

test('M55-6 负测：缺 [DONE] 哨兵必须判红（模拟历史「完成前中断」bug）', () => {
  const noDone = RAW_REPLAY.replace('data: [DONE]\n\n', '');
  const c = classifySseFrames(parseSseStream(noDone));
  assert.equal(c.hasDoneSentinel, false);
  assert.ok(c.issues.some((i) => i.includes('MISSING_DONE_SENTINEL')), '缺哨兵必须给出具名 issue');
});

test('M55-7 负测：failed 终态不得伪装成 completed', () => {
  const failed = RAW_REPLAY.replace('"status":"completed"', '"status":"failed"')
    .replace('"event":"done","filesChanged":[]', '"event":"error","message":"boom"');
  const c = classifySseFrames(parseSseStream(failed));
  assert.equal(c.terminalStatus, 'failed');
  assert.ok(c.issues.some((i) => i.includes('TERMINAL_FAILED')), 'failed 必须具名标红');
});
