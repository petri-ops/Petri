#!/usr/bin/env node
'use strict';

/**
 * BLOCK-331（C-14 工具输出压缩）— 实测量化腿。
 *
 * 为什么先测：C-14 的**原重开条件是「实测 token 成本成为痛点」**，2026-11-02 用户裁决
 * 「先实测量化再定形，不硬造」。本脚本不给结论，只产出可复核的数字：
 *
 *  ① 单条结果在**真实序列化出口**（`serializeToolResultForModel`）之后有多大（chars / tokens）；
 *  ② 截断是「保留信息」还是「丢弃信息」：每个样本头/尾各埋一个哨兵串，看模型还能不能看到；
 *  ③ 单轮累积：同一条目重复 N 次后的工具结果 token 量与上下文窗口占比；
 *  ④ 既有计量面 `computeContextBreakdown` 的 toolResults 分类，与上面对账（防第二套口径）。
 *
 * 语料说明（诚实标注）：本机没有历史会话库（桌面版 userData 从未落过数据），语料是按真实
 * 工具返回形态**构造的样本**（构建日志 / git diff / 大 JSON / MCP 大载荷 / 搜索命中 / 目录列表），
 * 不是线上真实流量。结论只用于「机制是否丢弃信息」与「量级」，不冒充线上分布。
 *
 * 用法：node scripts/block331-tool-output-measure.mjs
 * 证据：acceptance/block-331/tool-output-measure.json
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// 序列化器所在模块链会 require('./db')（query-tools → db）。为了让测量脚本可以脱离 dev 栈
// 单独跑，这里先给一个**隔离临时库**（绝不碰用户数据）：建库 → 应用 src/migrations → 设 env。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b331-measure-'));
{
  const Database = require(resolve(root, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  const boot = new Database(path.join(TMP_DIR, 'petri.db'));
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(TMP_DIR, 'petri.db');
  process.env.PETRI_LOCAL_DATA_DIR = path.join(TMP_DIR, 'data');
  process.on('exit', () => { try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* 清理失败不掩盖测量结果 */ } });
}

const { serializeToolResultForModel, MODEL_RESULT_LIMIT } = require(resolve(root, 'core/petri-server/agent-tools/tool-execution.js'));
const { countTokens, computeContextBreakdown } = require(resolve(root, 'core/petri-server/helpers/token-estimator.js'));

const HEAD_SENTINEL = 'HEAD_SENTINEL_开头就有用的事实';
const TAIL_SENTINEL = 'TAIL_SENTINEL_最后一行才是报错原因';

function logLines(count, { headLine, tailLine, filler }) {
  const lines = [];
  for (let i = 1; i <= count; i += 1) lines.push(filler ? filler(i) : `[build] step ${i}: ok (1.2s)`);
  if (headLine) lines[0] = headLine;
  if (tailLine) lines[lines.length - 1] = tailLine;
  return lines.join('\n');
}

const SAMPLES = [
  {
    id: 'exec_build_log',
    note: 'workspace_exec：2000 行构建日志，末尾才是失败结论',
    tool: 'workspace_exec',
    data: {
      command: 'npm run build',
      exitCode: 1,
      stdout: logLines(2000, { headLine: `${HEAD_SENTINEL}（命令开头）`, tailLine: TAIL_SENTINEL }),
      stderr: '',
    },
  },
  {
    id: 'exec_git_diff',
    note: 'workspace_exec：3000 行 git diff（头是文件名，尾是最后一处改动）',
    tool: 'workspace_exec',
    data: {
      command: 'git diff',
      exitCode: 0,
      stdout: logLines(3000, {
        headLine: `diff --git a/x.ts b/x.ts ${HEAD_SENTINEL}`,
        tailLine: `+ // ${TAIL_SENTINEL}`,
        filler: (i) => `+ line ${i}: some.changed.expression(arg)`,
      }),
      stderr: '',
    },
  },
  {
    id: 'run_tool_large_result',
    note: 'run_tool：结构化结果约 40k 字符（走 fitValidJson 硬上限）',
    tool: 'run_tool',
    data: Object.fromEntries([
      ['head', HEAD_SENTINEL],
      ...Array.from({ length: 800 }, (_, i) => [`k${i}`, `value-${i}-${'x'.repeat(40)}`]),
      ['tail', TAIL_SENTINEL],
      ['ok', true],
    ]),
  },
  {
    id: 'mcp_large_payload',
    note: 'mcp 工具：大 JSON 载荷（外部连接器常见形态）',
    tool: 'mcp_call',
    data: {
      summary: HEAD_SENTINEL,
      items: Array.from({ length: 500 }, (_, i) => ({ id: i, text: `row ${i} ${'y'.repeat(60)}` })),
      error: TAIL_SENTINEL,
    },
  },
  {
    id: 'workspace_search_many',
    note: 'workspace_search：120 处命中（投影按 12 条，尾部命中按设计丢弃）',
    tool: 'workspace_search',
    data: {
      query: HEAD_SENTINEL,
      matches: Array.from({ length: 120 }, (_, i) => ({
        path: `src/file-${i}.ts`,
        line: i + 1,
        text: i === 119 ? `x ${TAIL_SENTINEL}` : `x match-${i}`,
      })),
      filesScanned: 900,
    },
  },
  {
    id: 'workspace_list_many',
    note: 'workspace_list：300 个条目（投影按 40 条）',
    tool: 'workspace_list',
    data: {
      path: '.',
      entries: Array.from({ length: 300 }, (_, i) => ({ name: `entry-${i}.ts`, path: `entry-${i}.ts`, type: 'file', sizeBytes: 100 + i })),
    },
  },
];

function measure(sample) {
  const envelope = {
    contractVersion: '1.0.0',
    traceId: 'trace_measure',
    callId: 'call_measure',
    tool: sample.tool,
    status: 'success',
    terminationReason: 'success',
    durationMs: 12,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data: sample.data,
  };
  const sourceChars = JSON.stringify(envelope).length;
  const modelText = serializeToolResultForModel(envelope);
  return {
    id: sample.id,
    note: sample.note,
    tool: sample.tool,
    sourceChars,
    modelChars: modelText.length,
    modelTokens: countTokens(modelText),
    keptRatio: Number((modelText.length / sourceChars).toFixed(3)),
    headKept: modelText.includes(HEAD_SENTINEL),
    tailKept: modelText.includes(TAIL_SENTINEL),
    elisionMarker: /省略 \d+ 字符/.test(modelText),
    overHardCap: sourceChars > MODEL_RESULT_LIMIT,
  };
}

function accumulation(rows, repeat) {
  const toolResultTokens = rows.reduce((sum, row) => sum + row.modelTokens * repeat, 0);
  return {
    toolCalls: rows.length * repeat,
    toolResultTokens,
    shareOf64k: Number((toolResultTokens / 65536).toFixed(3)),
    shareOf128k: Number((toolResultTokens / 131072).toFixed(3)),
    shareOf200k: Number((toolResultTokens / 204800).toFixed(3)),
  };
}

const rows = SAMPLES.map(measure);

// 与既有计量面对账：用真实序列化文本喂 computeContextBreakdown，确认分类口径一致
const synthesizedMessages = SAMPLES.map((sample) => ({
  role: 'tool',
  content: serializeToolResultForModel({
    contractVersion: '1.0.0',
    traceId: 'trace_measure',
    callId: 'call_measure',
    tool: sample.tool,
    status: 'success',
    terminationReason: 'success',
    durationMs: 12,
    truncated: false,
    sideEffects: { type: 'none', riskTier: 'R0', resources: [] },
    data: sample.data,
  }),
}));
const breakdown = computeContextBreakdown({ systemPrompt: '', messages: synthesizedMessages, toolDefinitionsTokens: 0, maxTokens: 0 });

const summary = {
  generatedAt: new Date().toISOString(),
  platform: `${process.platform}-${process.arch}`,
  modelResultLimitChars: MODEL_RESULT_LIMIT,
  corpus: '构造样本（本机无历史会话库）：构建日志 / git diff / 大 JSON / MCP 大载荷 / 搜索命中 / 目录列表',
  corpusCaveat: '样本量=6，按工具返回形态构造；只用于机制与量级判断，不作线上分布结论',
  rows,
  accumulation: {
    oneRoundOfEach: accumulation(rows, 1),
    tenRoundsOfEach: accumulation(rows, 10),
  },
  breakdownCrossCheck: {
    toolResultsTokens: breakdown.toolResults,
    sumOfRowsTokens: rows.reduce((sum, row) => sum + row.modelTokens, 0),
    sameOrder: Math.abs(breakdown.toolResults - rows.reduce((sum, row) => sum + row.modelTokens, 0)) <= rows.length * 8,
  },
};

const evidenceDir = path.join(root, 'acceptance', 'block-331');
fs.mkdirSync(evidenceDir, { recursive: true });
const evidenceFile = path.join(evidenceDir, 'tool-output-measure.json');
fs.writeFileSync(evidenceFile, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

const pad = (v, n) => String(v).padEnd(n);
console.log(`设备实测（${summary.platform}）· MODEL_RESULT_LIMIT=${MODEL_RESULT_LIMIT} chars`);
console.log(`${pad('样本', 26)}${pad('源 chars', 12)}${pad('模型 chars', 12)}${pad('tokens', 9)}${pad('头保留', 9)}${pad('尾保留', 9)}省略标记`);
for (const row of rows) {
  console.log(`${pad(row.id, 26)}${pad(row.sourceChars, 12)}${pad(row.modelChars, 12)}${pad(row.modelTokens, 9)}${pad(row.headKept, 9)}${pad(row.tailKept, 9)}${row.elisionMarker}`);
}
console.log('');
console.log(`单轮各来一次：${summary.accumulation.oneRoundOfEach.toolCalls} 次工具调用 ≈ ${summary.accumulation.oneRoundOfEach.toolResultTokens} tokens（64k 窗口的 ${(summary.accumulation.oneRoundOfEach.shareOf64k * 100).toFixed(1)}%）`);
console.log(`各来十次：${summary.accumulation.tenRoundsOfEach.toolCalls} 次 ≈ ${summary.accumulation.tenRoundsOfEach.toolResultTokens} tokens（64k 窗口的 ${(summary.accumulation.tenRoundsOfEach.shareOf64k * 100).toFixed(1)}%，128k 的 ${(summary.accumulation.tenRoundsOfEach.shareOf128k * 100).toFixed(1)}%）`);
console.log(`既有计量面对账：toolResults=${breakdown.toolResults} tokens vs 逐条求和=${summary.breakdownCrossCheck.sumOfRowsTokens}（同量级=${summary.breakdownCrossCheck.sameOrder}）`);
console.log(`证据：${evidenceFile}`);
