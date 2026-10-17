/**
 * BLOCK-193 — capture/replay 真实录制态契约测（离线零 provider、零人眼、零网络上游）。
 *
 * 覆盖三件事：
 *  ①收割=差分归属 + 投影两态 + 缺响应不编造回合；
 *  ②入库双闸（用户定案约束①②）=密钥扫描拒写且闸自身不外泄内容、合成任务闸拒录非仓库 prompt；
 *  ③罐头假绿闸（约束③）=replay 必须有 outbound_contains 哨兵，且**哨兵真能判红**：
 *    投了罐头回合但出站为空 → 判据必须红（这一条是本包存在的理由，红绿都测）。
 * 另含投递通道保真（toolCalls+content 同帧）与「设计不漂移」源码守卫（不得出现第二套录制实现）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  snapshotTranscriptCounts, readNewTranscriptRecords, projectTranscriptToTurn, projectTranscriptToOutbound,
  buildRecording, gateRecording, verifyRecordingForReplay, assertReplaySentinel, recordingPath, loadRecording,
  RECORDING_SCHEMA,
} from '../scripts/lib/evals-recording.mjs';
import { evaluateCriterion, startMockProvider } from '../scripts/lib/evals-harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpSuite(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `b193-${name}-`));
  fs.mkdirSync(path.join(dir, 'llm-transcripts'), { recursive: true });
  return dir;
}

function appendRecords(dir, file, records) {
  const p = path.join(dir, 'llm-transcripts', file);
  fs.appendFileSync(p, `${records.map((r) => JSON.stringify(r)).join('\n')}\n`);
}

function toolRecord(over = {}) {
  return {
    ts: '2026-10-16T00:00:01.000Z',
    conversationId: 'conv_test',
    model: 'deepseek-chat',
    request: { messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: '请在 derived/a.md 写入一行「ok」' }], params: JSON.stringify({ model: 'deepseek-chat', tools: [{ type: 'function', function: { name: 'workspace_write' } }] }) },
    response: { content: '我来写文件', reasoningContent: '', toolCalls: [{ id: 'call_1', type: 'function', function: { name: 'workspace_write', arguments: '{"path":"derived/a.md","content":"ok"}' } }], finishReason: 'tool_calls' },
    error: null,
    ...over,
  };
}

test('收割：按行数差分定位本任务新增记录，排序稳定且如实计坏行', () => {
  const dir = tmpSuite('harvest');
  appendRecords(dir, 'conv_a.jsonl', [toolRecord({ ts: '2026-10-16T00:00:01.000Z', id: 'old' })]);
  const before = snapshotTranscriptCounts(dir);
  assert.equal(before['conv_a.jsonl'], 1, '快照须记录既有行数');
  appendRecords(dir, 'conv_a.jsonl', [toolRecord({ ts: '2026-10-16T00:00:03.000Z', id: 'n1' }), toolRecord({ ts: '2026-10-16T00:00:02.000Z', id: 'n2' })]);
  appendRecords(dir, 'conv_b.jsonl', [toolRecord({ ts: '2026-10-16T00:00:04.000Z', id: 'n3' })]);
  fs.appendFileSync(path.join(dir, 'llm-transcripts', 'conv_a.jsonl'), 'NOT-JSON\n');
  const { records, unparsed } = readNewTranscriptRecords(dir, before);
  assert.deepEqual(records.map((r) => r.id), ['n2', 'n1', 'n3'], '新增记录按 ts 升序归属（跨文件同则）');
  assert.equal(unparsed, 1, '解析失败行如实计数，不静默丢');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('投影：工具回合与正文回合两态，且工具帧保留正文', () => {
  const tool = projectTranscriptToTurn(toolRecord());
  assert.equal(tool.turn.toolCalls[0].name, 'workspace_write');
  assert.equal(JSON.parse(tool.turn.toolCalls[0].arguments).path, 'derived/a.md');
  assert.equal(tool.turn.finish, 'tool_calls');
  assert.equal(tool.turn.content, '我来写文件', '正文+工具同帧不得丢正文（否则回放丢 finalText 假红）');
  const text = projectTranscriptToTurn({ ...toolRecord(), response: { content: '完成', finishReason: 'stop' } });
  assert.deepEqual(text.turn, { content: '完成', finish: 'stop' });
});

test('诚实边界：error 与无聚合响应的记录不投影（绝不编造回合）', () => {
  assert.equal(projectTranscriptToTurn({ ...toolRecord(), error: 'api_timeout' }).turn, null);
  assert.equal(projectTranscriptToTurn({ ...toolRecord(), response: null }).turn, null);
  assert.equal(projectTranscriptToTurn({ ...toolRecord(), response: { content: '', finishReason: 'stop' } }).turn, null);
});

test('出站投影与 mock.captured 同形，可直接喂 BLOCK-189 哨兵判据', () => {
  const outbound = projectTranscriptToOutbound(toolRecord());
  assert.equal(outbound.model, 'deepseek-chat');
  assert.equal(outbound.messages.length, 2);
  assert.equal(outbound.tools[0].function.name, 'workspace_write');
  const green = evaluateCriterion({ kind: 'outbound_contains', value: 'derived/a.md' }, { outbound: [outbound], tmpRoot: null });
  assert.equal(green.passed, true, '转录出站须能支撑哨兵（real 层自此可出站自证）');
});

test('录制产物只存语义回合与骨架，不外带 frames/tools 全量与对话正文', () => {
  const task = { id: 'real-x', prompt: '请在 derived/a.md 写入一行「ok」', criteria: [{ kind: 'outbound_contains', value: 'derived/a.md' }] };
  const rec = buildRecording({ task, suite: 'real', sourceSuiteFile: 'evals/suites/real/x.json', records: [toolRecord()] });
  assert.equal(rec.schema, RECORDING_SCHEMA);
  assert.equal(rec.turnCount, 1);
  assert.equal(rec.requestCount, 1);
  const blob = JSON.stringify(rec);
  assert.equal(blob.includes('"frames"'), false, 'delta 帧不入库（体积与噪声）');
  assert.equal(blob.includes('"tools"'), false, '工具全量 schema 不入库（属 BLOCK-188 快照面，非录制面）');
  assert.equal(blob.includes('请在 derived'), false, '请求对话正文不入库（只存 role 骨架）');
});

test('入库闸①：命中密钥模式即拒录，且拒绝原因不外泄命中内容', () => {
  const task = { id: 'real-x', prompt: 'P', criteria: [{ kind: 'outbound_contains', value: 'P' }] };
  const leaky = toolRecord({ response: { content: `key sk-${'A'.repeat(24)} leaked`, finishReason: 'stop' } });
  const rec = buildRecording({ task, suite: 'real', sourceSuiteFile: 'evals/suites/real/x.json', records: [leaky] });
  const gate = gateRecording({ recording: rec, task, records: [leaky] });
  assert.equal(gate.ok, false);
  assert.match(gate.reasons.join('|'), /密钥模式命中/);
  assert.equal(gate.reasons.join('|').includes('sk-'), false, '闸的输出绝不含密钥本体（扫描器不得成为泄漏通道）');
});

test('入库闸②：只录合成任务——prompt 漂移或出站未含仓库 prompt 一律拒录', () => {
  const base = { id: 'real-x', prompt: '请在 derived/a.md 写入一行「ok」', criteria: [{ kind: 'outbound_contains', value: 'ok' }] };
  const rec = buildRecording({ task: base, suite: 'real', sourceSuiteFile: 'evals/suites/real/x.json', records: [toolRecord()] });
  assert.equal(gateRecording({ recording: rec, task: base, records: [toolRecord()] }).ok, true, '健康合成任务应过闸');
  const drifted = gateRecording({ recording: rec, task: { ...base, prompt: '被改过的仓库 prompt' }, records: [toolRecord()] });
  assert.equal(drifted.ok, false);
  assert.match(drifted.reasons.join('|'), /prompt/);
  const notSynthetic = gateRecording({ recording: rec, task: base, records: [{ ...toolRecord(), request: { messages: [{ role: 'user', content: '用户的真实对话内容' }], params: '{}' } }] });
  assert.equal(notSynthetic.ok, false, '转录里没有仓库 prompt=可能混入用户数据，拒录');
  const outsideRepo = gateRecording({ recording: { ...rec, sourceSuiteFile: '/tmp/nonsense.json' }, task: base, records: [toolRecord()] });
  assert.equal(outsideRepo.ok, false);
  assert.match(outsideRepo.reasons.join('|'), /非仓库自写任务/);
});

test('回放对账：缺产物/无回合/prompt 漂移各自给因，健康产物过闸', () => {
  const task = { id: 'real-x', suite: 'real', prompt: 'P', criteria: [{ kind: 'outbound_contains', value: 'P' }] };
  const built = buildRecording({
    task,
    suite: 'real',
    sourceSuiteFile: 'evals/suites/real/x.json',
    records: [toolRecord({ request: { messages: [{ role: 'user', content: 'P' }], params: '{}' } })],
  });
  assert.equal(verifyRecordingForReplay(task, null).ok, false);
  assert.match(verifyRecordingForReplay(task, null).reason, /--record/);
  assert.equal(verifyRecordingForReplay(task, built).ok, true);
  assert.equal(verifyRecordingForReplay({ ...task, prompt: 'P2' }, built).ok, false, '仓库 prompt 变了还拿旧罐头放=拒');
  assert.equal(verifyRecordingForReplay(task, { ...built, turns: [] }).ok, false);
  assert.equal(verifyRecordingForReplay({ ...task, id: 'other' }, built).ok, false);
});

test('罐头假绿闸（约束③）：replay 任务缺 outbound_contains 哨兵=判红，非警告', () => {
  assert.equal(assertReplaySentinel({ criteria: [{ kind: 'task_completed' }, { kind: 'outbound_contains', value: 'x' }] }).ok, true);
  const noSentinel = assertReplaySentinel({ criteria: [{ kind: 'task_completed' }] });
  assert.equal(noSentinel.ok, false);
  assert.match(noSentinel.reason, /outbound_contains/);
  assert.equal(assertReplaySentinel({}).ok, false, '无判据也算缺哨兵（fail-closed）');
});

test('反证：罐头回合已投但请求没走过 provider → 哨兵必须判红', () => {
  // 这就是「罐头假绿」的形状：投了录制回合、事件流看着正常，但出站为零。
  const canned = evaluateCriterion({ kind: 'outbound_contains', value: 'ok' }, { outbound: [], tmpRoot: null });
  assert.equal(canned.passed, false, '空出站=红（防作弊腿不因回放而失效）');
  const missing = evaluateCriterion({ kind: 'outbound_contains', value: 'ok' }, { tmpRoot: null });
  assert.equal(missing.passed, false, '无 outbound 上下文=fail-closed 红');
  const real = evaluateCriterion({ kind: 'outbound_contains', value: '写入一行' }, { outbound: [projectTranscriptToOutbound(toolRecord())], tmpRoot: null });
  assert.equal(real.passed, true, '哨兵在场时正常绿（红不是常量）');
});

test('投递保真：toolCalls 同帧带正文时，回放 SSE 先出 content 帧再出 tool_calls 帧', async () => {
  const mock = startMockProvider();
  const port = await mock.ready;
  mock.push({ toolCalls: [{ name: 'workspace_write', arguments: '{"path":"a"}' }], content: '我来写文件', finish: 'tool_calls' });
  const res = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'go' }], stream: true }),
  });
  const text = await res.text();
  assert.match(text, /"content":"我来写文件"/, '正文帧必须在场');
  assert.match(text, /workspace_write/, '工具帧必须在场');
  assert.equal(mock.captured.length, 1, '出站记录同步在场（哨兵可读）');
  await mock.close();
});

test('录制读写：recordingPath/loadRecording 往返一致，缺文件诚实返回 null', () => {
  const dir = tmpSuite('roundtrip');
  const file = recordingPath(dir, 'real', 'real-x');
  assert.equal(loadRecording(dir, 'real', 'real-x'), null);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: RECORDING_SCHEMA, id: 'real-x', turns: [{ content: 'ok', finish: 'stop' }] }));
  assert.equal(loadRecording(dir, 'real', 'real-x').turns.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('归一化吞文缺陷守卫（本包踩出的 BLOCK-189 既有缺陷，红绿各一）：ENV 行不得吃掉后续正文', () => {
  // <ENV> 规则语义是「折到该行行尾」；出站 blob 是 JSON.stringify 的单行文本（换行以 \n 两字符存在），
  // 直接归一化会让 [^\n]* 吞掉整条 blob → 真模型三例 outbound_contains 全 ×0 的假红根因。
  const req = {
    model: 'm',
    messages: [
      { role: 'system', content: '你是助手。\n当前执行环境：win32 10.0 x64\n工作区：D:\\ws\\projects\\p_abc123_def' },
      { role: 'user', content: 'src/calc.js 的 sumLast 对某些输入会抛错' },
    ],
    tools: null,
  };
  const green = evaluateCriterion({ kind: 'outbound_contains', value: 'sumLast' }, { outbound: [req], tmpRoot: null });
  assert.equal(green.passed, true, `ENV 行之后的正文必须仍可被哨兵命中（detail=${green.detail}）`);
  const stillVolatile = evaluateCriterion({ kind: 'outbound_contains', value: 'p_abc123_def' }, { outbound: [req], tmpRoot: null });
  assert.equal(stillVolatile.passed, false, '易变 token 归一化仍是红（修缺陷不得放松归一化本身）');
});

test('设计不漂移守卫：录制面不得长成第二套录制实现（本包定的骨架）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'lib', 'evals-recording.mjs'), 'utf8');
  assert.equal(/createServer|http\.request|fetch\(/.test(src), false, '录制器不得自建 HTTP 采集面——采集是生产 io-transcript 的职责');
  assert.equal(/sk-\[a-zA-Z0-9\]/.test(src), false, '密钥模式集必须复用 secret-scan 单源，禁止复制');
  assert.match(src, /from '\.\.\/secret-scan\.mjs'/);
  const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'evals-run.mjs'), 'utf8');
  assert.match(runner, /measures:[^}]*recorded-replay/, '回放态必须诚实标注 measures，不冒充 model 质量');
});

test('套件在册：real 三用例全部带出站哨兵（回放前提），产物命名含 replay namespace', () => {
  const suiteDir = path.join(ROOT, 'evals', 'suites', 'real');
  const files = fs.readdirSync(suiteDir).filter((f) => f.endsWith('.json'));
  assert.equal(files.length, 3);
  for (const f of files) {
    const task = JSON.parse(fs.readFileSync(path.join(suiteDir, f), 'utf8'));
    assert.equal(assertReplaySentinel(task).ok, true, `${f} 缺 outbound_contains 哨兵`);
  }
  const gate = fs.readFileSync(path.join(ROOT, 'scripts', 'evals-gate.mjs'), 'utf8');
  assert.match(gate, /replay/ , '棘轮门须按 provider 分产物名，防回放覆盖真模型基线');
});
