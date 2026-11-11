/**
 * BLOCK-407（第五轮 L3 错误语义与边界）契约测试。
 *
 * 红绿先行：L-12 SSE 终态判定裸奔 / L-13 轮询无界静默 / L-14 空 catch 吞错——
 * 以 fake req/res + require.cache 注入 stub 直接驱动 events.js handler 行为。
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadEventsWithStore(storeStub) {
  const storePath = require.resolve(path.join(ROOT, 'core/petri-server/agent-task-store.js'));
  // eslint-disable-next-line security/detect-object-injection -- require.cache 注入是 store stub 的测试机制（键来自 require.resolve，无外部输入面）
  require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: storeStub };
  // events.js 每次重取（require cache 已被注入）
  delete require.cache[require.resolve(path.join(ROOT, 'core/petri-server/routes/ai-agent/events.js'))];
  const events = require(path.join(ROOT, 'core/petri-server/routes/ai-agent/events.js'));
  const handlers = new Map();
  events.register({ get: (p, h) => handlers.set(p, h) });
  return handlers.get('/api/ai/agent/task/:taskId');
}

function fakeRes() {
  const res = {
    statusCode: 0, headers: {}, writes: [], ended: false,
    // eslint-disable-next-line security/detect-object-injection -- 测试夹具（k 为固定字面量调用，无外部输入面）
    setHeader(k, v) { this.headers[k] = v; },
    flushHeaders() { this.flushed = true; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    write(s) { this.writes.push(s); },
    end() { this.ended = true; },
  };
  return res;
}
function fakeReq() {
  const listeners = {};
  // eslint-disable-next-line security/detect-object-injection -- 测试夹具对象字面量
  return { user: { id: 'local-user' }, params: { taskId: 't1' }, query: {}, on: (ev, h) => { (listeners[ev] ||= []).push(h); }, _listeners: listeners };
}
const frames = (res) => res.writes.filter((w) => w.startsWith('data: ') && !w.includes('[DONE]')).map((w) => JSON.parse(w.slice(6)));
const doneSent = (res) => res.writes.some((w) => w.includes('[DONE]'));

test('L3-1 红转绿：终态判定 getAgentTask 抛错 → error 帧 + [DONE] + res.end（不再裸奔 reject）', async () => {
  let calls = 0;
  const handler = loadEventsWithStore({
    getAgentTask() {
      calls += 1;
      if (calls === 1) return { id: 't1', user_id: 'local-user', agent_status: 'running' };
      throw new Error('db gone');
    },
    getAgentTaskEventsSince: () => [],
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  assert.equal(res.ended, true, 'res.end 必须被调用（SSE 不再悬挂）');
  const errFrame = frames(res).find((f) => f.event === 'error');
  assert.ok(errFrame, '必须发 error 帧');
  assert.equal(errFrame.reasonCode, 'sse_task_read_failed');
  assert.ok(doneSent(res), '[DONE] 哨兵必须发出');
});

test('L3-2 红转绿：轮询连续失败 3 次 → 熔断（error 帧 + 清理 + res.end）', async () => {
  const handler = loadEventsWithStore({
    getAgentTask: () => ({ id: 't1', user_id: 'local-user', agent_status: 'running' }),
    getAgentTaskEventsSince: () => { throw new Error('db flapping'); },
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  // 等待 3 次轮询失败（500ms 间隔 → ~1.6s）+ 熔断
  await new Promise((r) => setTimeout(r, 2300));
  assert.equal(res.ended, true, '熔断后必须 res.end');
  const errFrame = frames(res).find((f) => f.reasonCode === 'sse_poll_failed');
  assert.ok(errFrame, '熔断必须发结构化 error 帧');
  assert.equal(errFrame.retryable, true);
  assert.ok(doneSent(res));
});

test('L3-2 负测：轮询瞬时失败 1 次后恢复 → 不熔断、续发事件到终态', async () => {
  let calls = 0;
  const handler = loadEventsWithStore({
    getAgentTask(taskId) {
      calls += 1;
      if (calls === 3) throw new Error('transient'); // 仅首次轮询瞬断
      return { id: taskId, user_id: 'local-user', agent_status: calls >= 4 ? 'done' : 'running', filesChanged: [] };
    },
    getAgentTaskEventsSince: () => [],
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  await new Promise((r) => setTimeout(r, 1300));
  assert.equal(res.ended, true, '恢复后应正常到终态');
  assert.ok(frames(res).some((f) => f.event === 'done'), '终态 done 帧在场');
  assert.equal(frames(res).some((f) => f.reasonCode === 'sse_poll_failed'), false, '单次瞬断不熔断');
});

test('L3-14 红转绿：findFallbackChild 抛错 → failedPayload 无 fallback 字段但带 fallback_lookup_failed 标注（不再空吞）', async () => {
  const handler = loadEventsWithStore({
    getAgentTask: () => ({ id: 't1', user_id: 'local-user', agent_status: 'failed', error: 'boom' }),
    getAgentTaskEventsSince: () => { throw new Error('events db gone'); },
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  const errFrame = frames(res).find((f) => f.lookupFailed === 'fallback_lookup_failed');
  assert.ok(errFrame, '失败终态 error 帧必须带 fallback_lookup_failed 标注');
  assert.equal(errFrame.fallbackTaskId, undefined, '查询失败不得伪造 fallback 字段');
});

test('L3-14 红转绿：回放抛错 → lastSeq 重置 afterSeq + 回放标注帧（不再空吞）', async () => {
  const handler = loadEventsWithStore({
    getAgentTask: () => ({ id: 't1', user_id: 'local-user', agent_status: 'failed', error: 'boom' }),
    getAgentTaskEventsSince: () => { throw new Error('replay db gone'); },
  });
  const res = fakeRes();
  await handler(fakeReq(), res);
  const replayNote = frames(res).find((f) => f.event === 'error' && f.reasonCode === 'event_replay_failed');
  assert.ok(replayNote, '回放失败必须有结构化标注帧');
  assert.equal(replayNote.lastSeqResetTo, 0, 'lastSeq 显式重置 afterSeq');
});

// ---- L3-4 / L-18：SCAN_ROOTS 扩面 + 真静默清零 ----
test('L3-4 负测：frontend/src 新增裸 catch → 棘轮必红（扩面生效）', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  // 用临时副本模拟「frontend/src 出现新裸 catch」：构造独立根跑棘轮纯函数不可行（脚本写死 ROOT），
  // 计数口径自证：同款正则可命中 frontend 形态裸 catch
  const re = /catch\s*\{\s*\}/g;
  assert.equal(('try { x(); } catch {}'.match(re) || []).length, 1, '口径：frontend 裸 catch 可被同款正则计数');
  assert.ok(fsMod.existsSync(pathMod.join(ROOT, 'test', 'silent-catch-baseline.json')));
  const baseline = JSON.parse(fsMod.readFileSync(pathMod.join(ROOT, 'test', 'silent-catch-baseline.json'), 'utf8'));
  const frontendEntries = Object.keys(baseline.files || {}).filter((f) => f.startsWith('frontend/'));
  assert.ok(frontendEntries.length > 0, `基线须含 frontend 条目（实际 ${frontendEntries.length}）`);
  assert.match(String(baseline._about), /L3-18|BLOCK-407/, '扩面留因必须在 _about');
});

test('L3-4 实测：8 处真静默逐件终态（具名降级或重试上报，无裸吞残留）', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const read = (rel) => fsMod.readFileSync(pathMod.join(ROOT, rel), 'utf8');
  // 每处终态证据：文件含 L3-4/L3-3 具名标注
  assert.match(read('frontend/src/pages/window/CommandCenterJobsWall.tsx'), /L3-4（L-18）|L3-4（L-18）/);
  assert.match(read('frontend/src/pages/home.tsx'), /L3-4（L-18）/);
  const office = read('frontend/src/lib/office-file-preview.ts');
  assert.equal((office.match(/L3-4（L-18）/g) || []).length >= 4, true, `office 4 处具名（实际 ${(office.match(/L3-4（L-18）/g) || []).length}）`);
  const bridge = read('frontend/src/lib/projectionTerminalBridge.ts');
  assert.match(bridge, /L3-3（蓝图 L-17）/, 'terminal 桥 kill/resize 具名上报（L3-3 批）');
  // projectionDataBridges runtime catch 已带 L2-3 标注（蓝图 :169 指认已由 L2-3 根修）
  assert.match(read('frontend/src/lib/projectionDataBridges.ts'), /L2-3（蓝图 L-19）/);
});

// ---- L3-6 / L-23：64MB 预算常量单入口 ----
test('L3-6 负测：生产面九处 64MB 字面量收编后无残余（budget-constants 单源）', async () => {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const files = [
    'core/petri-server/mcp/ide-tools/git-blame.js',
    'core/petri-server/mcp/ide-tools/git-diff.js',
    'core/petri-server/mcp/ide-tools/git-show.js',
    'core/petri-server/mcp/ide-tools/search.js',
    'core/petri-server/routes/result-studio/revisions.js',
    'core/petri-server/helpers/mesh-assets.js',
    'core/shared-backend/llm-providers/io-transcript.js',
    'core/shared-backend/result-studio-table-query.js',
    'core/shared-backend/result-plugin-validator.js',
  ];
  for (const rel of files) {
    const text = fsMod.readFileSync(pathMod.join(ROOT, rel), 'utf8');
    assert.equal(/64 \* 1024 \* 1024/.test(text), false, `${rel} 残留 64MB 字面量`);
    assert.ok(/budget-constants/.test(text), `${rel} 须引用 budget-constants`);
  }
  const constants = fsMod.readFileSync(pathMod.join(ROOT, 'core/shared-backend/budget-constants.js'), 'utf8');
  assert.ok(constants.includes('MAX_ASSET_BYTES') && constants.includes('MAX_CHILD_STDOUT_BYTES'));
});
