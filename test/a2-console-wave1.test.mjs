/**
 * A2 控制台治理第一波 — HK-01 红绿先行契约（harness 隐形体验优化队列 7）。
 *
 * 红基线（改动前）：下列目标文件仍有 console 调用，且未引入结构化 logger。
 * 绿判据：低风险面 console→logger 定向清零（仅留注释/默认值/子进程源码字符串），
 *   logger 单源路径真实可解析；绝对不动面（agent-runner / error-log / 注释默认值）保持原计数；
 *   console ratchet 无增长。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { checkCounts, scan } from '../scripts/console-ratchet.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');
const consoleCount = (src) => (src.match(/console\./g) || []).length;

// 每个文件改动后允许的 console 残留数（0 = 定向清零；2 = registry.js 内子进程源码字符串，非本进程日志）
const TARGETS = {
  'core/petri-server/mcp/registry/run-plugin-script.js': 0,
  'core/petri-server/mcp/registry.js': 2,
  'core/petri-server/routes/feedback.js': 0,
  'core/petri-server/helpers/conversations.js': 0,
  'core/petri-server/cache-manager.js': 0,
  'core/shared-backend/skill-runtime.js': 0,
  'core/petri-server/routes/ai-agent/events.js': 0,
};

// 绝对不动 / 注释默认值保留面：计数必须原样（防止误伤桥接链或抢走第二波同文件）
const PRESERVED = {
  'core/petri-server/agent-runner.js': 15,          // 第二波聚宝盆拆解同文件，本波零触碰
  'core/shared-backend/error-log.js': 12,           // BLOCK-520 OB-004 console.error→logError 桥接与写盘兜底（12 处调用 = 11 行）
  'core/petri-server/jobs/retention-sweeper.js': 5, // 全是注释与 warn 默认值中的 console 字样
};

test('A2-WAVE1 低风险目标文件 console 定向清零（仅留已登记残留）', () => {
  for (const [rel, allowed] of Object.entries(TARGETS)) {
    const src = read(rel);
    assert.equal(consoleCount(src), allowed, `${rel} console 残留数应为 ${allowed}`);
  }
});

test('A2-WAVE1 每个目标文件引入可解析的结构化 logger 单源并实际使用', () => {
  for (const rel of Object.keys(TARGETS)) {
    const src = read(rel);
    const m = src.match(/require\(['"]([^'"]*logger)['"]\)/);
    assert.ok(m, `${rel} 必须引入 shared-backend/logger 单源`);
    const abs = path.resolve(path.dirname(path.join(ROOT, rel)), m[1]);
    assert.ok(fs.existsSync(`${abs}.js`) || fs.existsSync(abs), `${rel} 的 logger 路径不可解析：${m[1]}`);
    assert.ok(/logger\.(?:info|warn|error|debug)\(/.test(src), `${rel} 必须实际使用 logger`);
  }
});

test('A2-WAVE1 绝对不动面计数原样保留（桥接链 / 第二波同文件 / 注释默认值）', () => {
  for (const [rel, expected] of Object.entries(PRESERVED)) {
    assert.equal(consoleCount(read(rel)), expected, `${rel} 属本波禁改面，计数须保持 ${expected}`);
  }
});

test('A2-WAVE1 console ratchet 只减不增（无新增文件/新增调用）', () => {
  const baseline = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/console-baseline.json'), 'utf-8'));
  const violations = checkCounts(scan(), baseline);
  assert.deepEqual(violations, [], `console 棘轮违规：\n${violations.join('\n')}`);
});
