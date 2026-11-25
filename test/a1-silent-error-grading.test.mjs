/**
 * A1 静默吞错分级治理 — HK-01 红绿先行契约。
 *
 * 红基线（实现前）：首批四文件仍有裸 catch {} / .catch(() => {})，
 *   用户可见失败（工具结果解析、运行日志写盘、事件回调、审计写盘、审批确认提交）
 *   被静默吞掉且无 reasonCode 留痕。
 * 绿目标：fail-soft 全部写明理由（注释即离开债务口径）；真正吞掉用户可见失败的
 *   路径改走既有 error-log（logError + reasonCode）；前端复用既有 renderer console
 *   链带 reasonCode；零新依赖、行为不改。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { countBareCatches } from '../scripts/silent-catch-ratchet.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const TARGETS = [
  'frontend/src/components/copilot/copilotClient/agentTaskApi.ts',
  'core/petri-server/helpers/tools-executor.js',
  'core/petri-server/agent-runner.js',
  'core/petri-server/conversation-adapter.js',
];

const EMPTY_PROMISE_CATCH = /\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g;

test('A1 HK-01：首批四文件零裸 catch / 零空 .catch(() => {})', () => {
  for (const rel of TARGETS) {
    const src = read(rel);
    assert.equal(countBareCatches(src), 0, `${rel} 仍有裸 catch {}`);
    assert.equal((src.match(EMPTY_PROMISE_CATCH) || []).length, 0, `${rel} 仍有 .catch(() => {})`);
  }
});

test('A1 HK-01：fail-soft 保留且注释清晰（吞错理由可追）', () => {
  // 每处 catch 体内必须有注释或语句——裸 catch 清零即机械证明「每处都写了理由」。
  // 抽样核对代表性 fail-soft 段：清理/通知降级/后台任务/事件回调兜底。
  assert.match(read('core/petri-server/helpers/tools-executor.js'), /A1 A 类[\s\S]{0,120}rmSync\(tmp/);
  assert.match(read('core/petri-server/agent-runner.js'), /coalesceTaskDeltas[\s\S]{0,120}A1 A 类/);
  assert.match(read('core/petri-server/conversation-adapter.js'), /saveMemoryVector[\s\S]{0,400}A1 A 类/);
  assert.match(read('frontend/src/components/copilot/copilotClient/agentTaskApi.ts'), /A1 A 类/);
});

test('A1 HK-01：用户可见失败路径走既有 error-log + reasonCode', () => {
  const te = read('core/petri-server/helpers/tools-executor.js');
  assert.match(te, /require\(['"][^'"]*error-log['"]\)/);
  assert.match(te, /logError\([^;]*reasonCode:\s*'A1_TOOL_RESULT_MANIFEST_PARSE_FAILED'/s);
  assert.match(te, /logError\([^;]*reasonCode:\s*'A1_TOOL_RUN_LOG_WRITE_FAILED'/s);

  const ar = read('core/petri-server/agent-runner.js');
  assert.match(ar, /require\(['"][^'"]*error-log['"]\)/);
  assert.match(ar, /logError\([^;]*reasonCode:\s*'A1_AGENT_EVENT_EMIT_FAILED'/s);

  const ca = read('core/petri-server/conversation-adapter.js');
  assert.match(ca, /require\(['"][^'"]*error-log['"]\)/);
  assert.match(ca, /logError\([^;]*reasonCode:\s*'A1_CHAT_AUDIT_WRITE_FAILED'/s);

  // 前端无 error-log 模块：复用既有 renderer console 链，reasonCode 可 grep 可追。
  const api = read('frontend/src/components/copilot/copilotClient/agentTaskApi.ts');
  assert.match(api, /reasonCode=A1_ACK_SUBMIT_FAILED/);
});

test('A1 HK-01：零新依赖——error-log 为既有单源', () => {
  const el = read('core/shared-backend/error-log.js');
  assert.match(el, /function logError\(/);
  assert.match(el, /function getLastWriteError\(/);
  for (const rel of ['core/shared-backend/error-log.js', ...TARGETS]) {
    assert.doesNotMatch(read(rel), /require\(['"](winston|pino|bunyan|loglevel)['"]\)/);
  }
});

test('A1 HK-01：reasonCode + 上下文真实落 error-log JSONL（复用 OB-004 写盘链）', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'a1-errorlog-'));
  const logFile = path.join(tmp, 'petri-errors.log');
  const script = `
    const { logError, readRecentErrors } = require(${JSON.stringify(path.join(ROOT, 'core/shared-backend/error-log.js'))});
    logError('a1.hk01.probe', new Error('probe'), { reasonCode: 'A1_HK01_PROBE', jobId: 'j_probe' });
    setTimeout(async () => {
      const rows = await readRecentErrors(10);
      process.stdout.write(JSON.stringify(rows.find((r) => r.reasonCode === 'A1_HK01_PROBE') || null));
    }, 100);
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, PETRI_ERROR_LOG_FILE: logFile },
    encoding: 'utf8',
  });
  const row = JSON.parse(out || 'null');
  assert.ok(row, 'reasonCode 必须落盘可查');
  assert.equal(row.source, 'a1.hk01.probe');
  assert.equal(row.reasonCode, 'A1_HK01_PROBE');
  assert.equal(row.jobId, 'j_probe');
  fs.rmSync(tmp, { recursive: true, force: true });
});
