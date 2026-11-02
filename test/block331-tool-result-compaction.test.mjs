/**
 * BLOCK-331（C-14 工具输出压缩第一刀）— 超限结果「头 + 尾」保留契约。
 *
 * 实测动因（acceptance/block-331/tool-output-measure.json）：模型可见出口对超限结果原本
 * 只保留**头部**（`dataText.slice(0, room)`），尾巴整段丢弃；而工具输出最需要被看见的
 * 恰恰常在尾部（shell 末尾报错、构建收尾统计、JSON 的 error 字段）。测量腿在同一批样本上
 * 给出「头保留 true / 尾保留 false」的组合。
 *
 * 本测钉住三件事：
 * ① 超限结果头尾都在，且省略带**精确字符数**（模型据此判断是否值得重跑一次更窄的调用）；
 * ② 未超限结果**逐字节不变**（不是所有结果都加标记）；
 * ③ exec 投影仍是「尾部优先」的既有形态（**故意的**不对称：shell 的结论在尾部），
 *    不因为本包把通用出口改成头尾双保留就顺手改掉它。
 */
import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrapTestDb } from './helpers/bootstrap-db.mjs';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 序列化器所在模块链会 require('./db')：先给隔离临时库，绝不碰用户数据。
const TEST_DB_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b331-compaction-'));
process.env.PETRI_DB_PATH = path.join(TEST_DB_DIR, 'petri.db');
bootstrapTestDb();
after(() => { try { fs.rmSync(TEST_DB_DIR, { recursive: true, force: true }); } catch { /* Windows 文件句柄 */ } });

const { serializeToolResultForModel, MODEL_RESULT_LIMIT } = require(resolve(root, 'core/petri-server/agent-tools/tool-execution.js'));

const HEAD = 'HEAD_MARK_开头的事实';
const TAIL = 'TAIL_MARK_结尾的报错';

function envelope(tool, data) {
  return {
    contractVersion: '1.0.0',
    traceId: 'trace_fixture',
    callId: 'call_fixture',
    tool,
    status: 'success',
    terminationReason: 'success',
    durationMs: 1,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data,
  };
}

function bigPayload() {
  return Object.fromEntries([
    ['head', HEAD],
    ...Array.from({ length: 600 }, (_, i) => [`k${i}`, `v${i}-${'x'.repeat(40)}`]),
    ['tail', TAIL],
  ]);
}

test('BLOCK-331 — 超限结果头尾都保留，省略带精确字符数，且仍是合法 JSON', () => {
  const text = serializeToolResultForModel(envelope('run_tool', bigPayload()));
  assert.ok(text.length <= MODEL_RESULT_LIMIT, `模型可见长度 ${text.length} 超上限 ${MODEL_RESULT_LIMIT}`);
  const parsed = JSON.parse(text);
  assert.equal(parsed.truncated, true);
  assert.ok(text.includes(HEAD), '头部哨兵必须还在');
  assert.ok(text.includes(TAIL), '尾部哨兵必须还在（本包修的就是「尾巴整段丢」）');
  assert.match(text, /省略 \d+ 字符/, '省略量要写成数字，不能只说「已截断」');
  const omitted = Number(text.match(/省略 (\d+) 字符/)?.[1]);
  assert.ok(omitted > 1000, `省略量应可观（实测样本），实际 ${omitted}`);
  assert.match(parsed.dataSummary, /HEAD_MARK_开头的事实/);
  assert.match(parsed.dataSummary, /TAIL_MARK_结尾的报错/);
});

test('BLOCK-331 — 未超限结果逐字节不变（不是所有结果都加标记）', () => {
  const small = serializeToolResultForModel(envelope('workspace_write', {
    path: 'analysis/counts.csv',
    created: true,
    sizeBytes: 4096,
    sha256: 'a'.repeat(64),
  }));
  assert.ok(small.length <= MODEL_RESULT_LIMIT);
  assert.doesNotMatch(small, /省略 \d+ 字符/, '未超限不该出现省略标记');
  const parsed = JSON.parse(small);
  assert.equal(parsed.data.sizeBytes, 4096);
  assert.equal(parsed.data.path, 'analysis/counts.csv');
  assert.equal(parsed.truncated, false);
});

test('BLOCK-331 — exec 投影保持「尾部优先」的既有形态（故意不对称）', () => {
  const stdout = `${HEAD}\n${Array.from({ length: 2000 }, (_, i) => `line ${i}`).join('\n')}\n${TAIL}`;
  const text = serializeToolResultForModel(envelope('workspace_exec', {
    command: 'npm test',
    exitCode: 1,
    stdout,
    stderr: '',
  }));
  assert.ok(text.length <= MODEL_RESULT_LIMIT);
  const parsed = JSON.parse(text);
  assert.ok(parsed.data.stdoutTail.includes(TAIL), 'shell 结论在尾部，尾部必须保留');
  assert.equal(parsed.data.stdoutTail.includes(HEAD), false, 'exec 仍是尾部优先（头部不进 stdoutTail）');
  assert.equal(parsed.data.truncated, true, '截断事实要显式：模型才知道可以用更窄的命令重跑');
});

test('BLOCK-331 — 预算极小时不产生非法 JSON（退化路径仍有界）', () => {
  const text = serializeToolResultForModel(envelope('run_tool', bigPayload()), 200);
  assert.ok(text.length <= 200, `hard cap 失效：${text.length}`);
  assert.doesNotThrow(() => JSON.parse(text), '退化路径必须仍是合法 JSON');
});

test('BLOCK-331 — 测量腿证据在册（数字可回读，不靠叙述）', () => {
  const file = resolve(root, 'acceptance/block-331/tool-output-measure.json');
  assert.ok(fs.existsSync(file), '缺 acceptance/block-331/tool-output-measure.json');
  const evidence = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(evidence.modelResultLimitChars, MODEL_RESULT_LIMIT);
  const byId = Object.fromEntries((evidence.rows || []).map((row) => [row.id, row]));
  assert.equal(byId.exec_build_log.tailKept, true, 'exec 尾部保留（shell 的结论在尾部）');
  assert.equal(byId.run_tool_large_result.headKept, true);
  assert.equal(byId.run_tool_large_result.tailKept, true, '通用出口头尾双保留');
  assert.ok(evidence.accumulation.tenRoundsOfEach.toolResultTokens > 0, '累积量级必须有数');
});
