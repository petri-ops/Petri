/**
 * EVO-1 HK-01 — Observe 接线写入咽喉与 5 类 catch 点旁路的可执行合同。
 * 红（当前）：incident-log.js 模块缺席 → require 失败；5 类接线缺席 → 源级断言失败。
 * 绿（实现后）：5 类 source 逐类可查 + 脱敏零残留 + fail-soft 不阻断 + 写入失败计数 + 5 处接线在场。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const req = createRequire(import.meta.url);

const {
  INCIDENT_SOURCES, recordIncident, incidentWriteStats,
  _setIncidentDb, _resetIncidentStats
} = req(path.resolve(ROOT, 'core/petri-server/helpers/incident-log.js'));

function makeFakeDb({ throwOnRun = false } = {}) {
  const rows = [];
  return {
    rows,
    prepare() {
      return {
        run(...args) {
          if (throwOnRun) throw new Error('simulated db down');
          rows.push(args);
          return { changes: 1 };
        }
      };
    }
  };
}

// INSERT 列顺序：fingerprint, source, error_code, tool, phase, normalized, conversation_id, created_at
const I = { FP: 0, SOURCE: 1, CODE: 2, TOOL: 3, PHASE: 4, NORMALIZED: 5, CONV: 6, AT: 7 };

describe('EVO-1 · incident-log 写入咽喉', () => {
  it('① 5 类 source 逐类落库可查', () => {
    const db = makeFakeDb();
    _setIncidentDb(db);
    _resetIncidentStats();
    for (const source of INCIDENT_SOURCES) recordIncident({ source, errorCode: 'X', message: 'boom' });
    assert.equal(db.rows.length, 5);
    assert.deepEqual(db.rows.map((r) => r[I.SOURCE]), [...INCIDENT_SOURCES]);
    assert.match(db.rows[0][I.FP], /^[0-9a-f]{64}$/);
  });

  it('② 非白名单 source 静默跳过', () => {
    const db = makeFakeDb();
    _setIncidentDb(db);
    recordIncident({ source: 'not_a_real_source', message: 'x' });
    assert.equal(db.rows.length, 0);
  });

  it('③ raw message 脱敏零残留（密钥/会话 id 不落库）', () => {
    const db = makeFakeDb();
    _setIncidentDb(db);
    recordIncident({ source: 'fatal', message: 'key=sk-abcdef123456 user conv_abc123 failed' });
    const normalized = db.rows[0][I.NORMALIZED];
    assert.ok(!normalized.includes('sk-abcdef123456'), '密钥残留');
    assert.ok(!normalized.includes('conv_abc123'), '会话 id 残留');
  });

  it('④ fail-soft：DB 写入抛错时不 throw，失败计数 +1', () => {
    _setIncidentDb(makeFakeDb({ throwOnRun: true }));
    _resetIncidentStats();
    assert.doesNotThrow(() => recordIncident({ source: 'fatal', message: 'x' }));
    assert.equal(incidentWriteStats().failures, 1);
  });

  it('⑤ 写入失败计数可观测（多次累加）', () => {
    _setIncidentDb(makeFakeDb({ throwOnRun: true }));
    _resetIncidentStats();
    recordIncident({ source: 'fatal', message: 'a' });
    recordIncident({ source: 'tool_failure', message: 'b' });
    assert.equal(incidentWriteStats().failures, 2);
  });

  it('⑥ context.conversationId 落到 conversation_id 列', () => {
    const db = makeFakeDb();
    _setIncidentDb(db);
    recordIncident({ source: 'reject', message: 'rejected', context: { conversationId: 'conv_test123' } });
    assert.equal(db.rows[0][I.CONV], 'conv_test123');
  });

  it('⑦ 空 source / 无参调用不抛不写', () => {
    const db = makeFakeDb();
    _setIncidentDb(db);
    assert.doesNotThrow(() => recordIncident());
    assert.doesNotThrow(() => recordIncident({ message: 'x' }));
    assert.equal(db.rows.length, 0);
  });
});

describe('EVO-1 · 5 类 catch 点旁路接线（源级断言）', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

  it('8 fatal：loop-orchestrator 在 catch 后接线，覆盖两条赋值路径且排除取消', () => {
    const s = read('core/petri-server/loop-orchestrator.js');
    assert.match(s, /source:\s*'fatal',[\s\S]{0,500}context:\s*\{[^}]*cancellationObserved/);
    assert.match(s, /providerFailureReason \? 'provider_failure' : 'harness_catch'/);
  });

  it('9 tool_failure：tool-execution.js appendTrace 内接线', () => {
    const s = read('core/petri-server/agent-tools/tool-execution.js');
    assert.match(s, /function appendTrace[\s\S]{0,700}recordIncident\(\{[\s\S]{0,120}source:\s*'tool_failure'/);
  });

  it('10 sse_reason：events.js sseSend 内 reasonCode 窄守卫', () => {
    const s = read('core/petri-server/routes/ai-agent/events.js');
    // sseSend 定义后用 reasonCode 守卫，守卫体内记 sse_reason（三段各自就近匹配，避免跨文件头跨度）
    assert.match(s, /const sseSend = \(obj\) => \{[\s\S]{0,600}obj\.reasonCode/);
    assert.match(s, /source:\s*'sse_reason',[\s\S]{0,300}context:\s*\{ taskId \}/);
  });

  it('11 stall：loop-orchestrator _emit 旁路捕获三类 stall 事件', () => {
    const s = read('core/petri-server/loop-orchestrator.js');
    assert.match(s, /source:\s*'stall'/);
    assert.match(s, /provider_retry[\s\S]{0,400}stream_stall[\s\S]{0,400}stall_resume_exhausted/);
  });

  it('12 reject：system-prompt loadRejectEntries 接线（R5 避 src/ipc）', () => {
    const s = read('core/petri-server/helpers/system-prompt.js');
    assert.match(s, /source:\s*'reject',[\s\S]{0,400}working_tree_review/);
    assert.match(s, /_EVO_SEEN_REJECTS\.has\(rejectKey\)/);
    assert.match(s, /require\('\.\/incident-log'\)\.recordIncident/);
  });

  it('13 红线不被触碰：src/ipc 未新增 incident require（R5）', () => {
    const files = fs.readdirSync(path.join(ROOT, 'src/ipc'));
    for (const f of files) {
      if (!f.endsWith('.js')) continue;
      const s = fs.readFileSync(path.join(ROOT, 'src/ipc', f), 'utf8');
      assert.ok(!s.includes("incident-log") && !s.includes("incident-fingerprint"), `R5 违规：src/ipc/${f}`);
    }
  });
});
