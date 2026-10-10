'use strict';

/**
 * BLOCK-48 P3 — computer_* 工具面单测：托管协议 / 授权门 / 政策矩阵 /
 * 真实 handler（对真实 sidecar 二进制）。
 *
 * 前置：bash scripts/build-computer-use-sidecar.sh；macOS。TCC 授权态相关
 * 断言一律双态兼容（诚实：两种环境都验证对应契约路径）。
 */

import assert from 'node:assert/strict';
import { test, describe, before } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'petri-server');

// 全量套件防挂 watchdog：sidecar stdio 在受限环境下可能挂起，
// 3 分钟强制退出（诚实 fail 而非拖死整个套件）
setTimeout(() => {
  console.error('WATCHDOG: block48-computer-tools 3min 超时，强制退出');
  process.exit(1);
}, 180000).unref();
const require = createRequire(import.meta.url);

// 临时 DB 自举（存量基建同款：PETRI_DB_PATH 须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-computer-tools-db-'));
  const boot = new Database(path.join(tempDbDir, 'petri.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const { ComputerUseHost, ComputerUseHostError, defaultSidecarPath } = require(
  path.join(R_SERVER, 'helpers', 'computer-use-host.js'),
);
const { decideAgentToolCall } = require(path.join(R_SERVER, 'agent-tools', 'agent-tool-policy.js'));
const { getToolContract, getToolRegistry } = require(path.join(R_SERVER, 'agent-tools', 'registry.js'));
const computerTools = require(path.join(R_SERVER, 'agent-tools', 'computer-use-tools.js'));

describe('托管：sidecar 协议与健康', { skip: process.platform !== 'darwin' && 'macOS sidecar 专属（Windows 侧见 block63-computer-host）' }, () => {
  test('二进制定位存在', () => {
    assert.ok(fs.existsSync(defaultSidecarPath()), 'sidecar 未构建');
  });

  test('request probe：真实 spawn → trusted 布尔（+ screenTrusted 字段）', async () => {
    const host = new ComputerUseHost();
    try {
      const res = await host.request('probe');
      assert.equal(typeof res.trusted, 'boolean');
      if (res.trusted === true) {
        assert.equal(typeof res.screenTrusted, 'boolean', 'P2 probe 应带屏幕录制诚实探测');
      }
      assert.ok(host.isRunning());
    } finally {
      host.stop();
    }
  });

  test('死亡恢复：进程被杀后下一次请求自动重启成功', async () => {
    const host = new ComputerUseHost();
    try {
      await host.request('probe');
      assert.ok(host.isRunning());
      host.proc.kill(); // 模拟崩溃
      await new Promise((r) => setTimeout(r, 300));
      const res = await host.request('probe');
      assert.equal(typeof res.trusted, 'boolean', '重启后请求应成功');
      assert.ok(host.isRunning());
    } finally {
      host.stop();
    }
  });

  test('未知动词：结构化 unknown_verb 错误（HostError.code）', async () => {
    const host = new ComputerUseHost();
    try {
      await assert.rejects(
        host.request('bogus'),
        (e) => e instanceof ComputerUseHostError && e.code === 'unknown_verb',
      );
    } finally {
      host.stop();
    }
  });
});

describe('注册表：8 工具契约与 schema', () => {
  const expectations = {
    computer_snapshot: { category: 'verification', sideEffect: 'none', riskTier: 'R0' },
    computer_authorize: { category: 'verification', sideEffect: 'none', riskTier: 'R0' },
    computer_wait: { category: 'verification', sideEffect: 'none', riskTier: 'R1' },
    computer_click: { category: 'action', sideEffect: 'execution', riskTier: 'R2' },
    computer_type: { category: 'action', sideEffect: 'execution', riskTier: 'R2' },
    computer_press: { category: 'action', sideEffect: 'execution', riskTier: 'R2' },
    computer_scroll: { category: 'action', sideEffect: 'execution', riskTier: 'R2' },
    computer_screenshot: { category: 'vision', sideEffect: 'workspace-write', riskTier: 'R1' },
  };

  test('契约与注册（8/8，含 schema 与 handler）', () => {
    const registry = getToolRegistry(); // 冻结数组：{ definition, handler, contract }
    for (const [name, want] of Object.entries(expectations)) {
      const entry = registry.find((item) => item.definition?.function?.name === name);
      assert.ok(entry, `${name} 未注册`);
      assert.equal(typeof entry.handler, 'function', `${name} handler 缺失`);
      assert.ok(entry.definition.function.parameters, `${name} schema 缺失`);
      assert.equal(entry.contract.category, want.category, `${name} category`);
      assert.equal(entry.contract.sideEffect, want.sideEffect, `${name} sideEffect`);
      assert.equal(entry.contract.riskTier, want.riskTier, `${name} riskTier`);
    }
  });
});

describe('政策矩阵：控制类仅完全访问档', () => {
  const contracts = Object.fromEntries(
    [
      'computer_click', 'computer_type', 'computer_press', 'computer_scroll',
      'computer_snapshot', 'computer_wait', 'computer_authorize', 'computer_screenshot',
    ].map((n) => [n, getToolContract(n)]),
  );
  const allowed = (name, ctx) =>
    decideAgentToolCall({ name, args: {}, ctx, contract: contracts[name] }).decision === 'allow';

  test('computer_click：read / planMode / workspace-write 全拒，full 放行', () => {
    assert.equal(allowed('computer_click', { accessMode: 'read' }), false);
    assert.equal(allowed('computer_click', { accessMode: 'full', planMode: true }), false, '计划模式拒');
    assert.equal(
      allowed('computer_click', { accessMode: 'workspace-write' }),
      false,
      '项目写档拒（execution 面专属 full）',
    );
    assert.equal(allowed('computer_click', { accessMode: 'full' }), true);
  });

  test('computer_snapshot / authorize / wait：只读面全档位放行（planMode 亦放行）', () => {
    for (const name of ['computer_snapshot', 'computer_authorize', 'computer_wait']) {
      for (const mode of ['read', 'workspace-write', 'full']) {
        assert.equal(allowed(name, { accessMode: mode }), true, `${name}@${mode}`);
      }
      assert.equal(allowed(name, { accessMode: 'full', planMode: true }), true, `${name}@planMode`);
    }
  });

  test('computer_screenshot：workspace-write 档放行（项目内产物），read 拒', () => {
    assert.equal(allowed('computer_screenshot', { accessMode: 'workspace-write' }), true);
    assert.equal(allowed('computer_screenshot', { accessMode: 'read' }), false);
    assert.equal(allowed('computer_screenshot', { accessMode: 'full' }), true);
  });
});

describe('工具 handler：确认门 + 真实 sidecar', { skip: process.platform !== 'darwin' && 'macOS sidecar 专属（Windows 侧见 block63-computer-host）' }, () => {
  let trusted = false;

  before(async () => {
    const host = new ComputerUseHost();
    try {
      // TCC 首查询存在偶发 false 竞态：连续 3 次取稳定值
      for (let i = 0; i < 3; i++) {
        const probe = await host.request('probe');
        trusted = probe?.trusted === true;
        if (trusted) break;
        await new Promise((r) => setTimeout(r, 400));
      }
    } finally {
      host.stop();
    }
  });

  test('computer_authorize：真实权限探测（形状契约，双态兼容）', async () => {
    const res = await computerTools.tool_computer_authorize({}, {});
    assert.equal(res.ok, true);
    assert.equal(typeof res.trusted, 'boolean');
    if (res.trusted === true) {
      assert.equal(typeof res.screenTrusted, 'boolean', 'P2 probe 应带屏幕录制诚实探测');
    } else {
      assert.ok(res.guidance && res.guidance.includes('辅助功能'));
    }
  });

  test('确认门：click 首调 → needApproval + ackToken（建可审计 job）', async () => {
    const res = await computerTools.tool_computer_click(
      { ref: 'e1' },
      { userId: 'u_test', conversationId: null },
    );
    assert.equal(res.ok, true);
    assert.equal(res.needApproval, true);
    assert.match(res.ackToken, /^ack_/);
    assert.ok(res.message.includes('confirm'));
  });

  test('确认门：伪造/未批准 token 重调被拒（fail-closed）', async () => {
    const denied = await computerTools.tool_computer_click(
      { ref: 'e1', confirm: true, ackToken: 'ack_fake' },
      { userId: 'u_test' },
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'approval_invalid');
  });

  test('确认门完整链：批准后重调 → 执行落到 sidecar（no_target_snapshot 证明过门）', async () => {
    const first = await computerTools.tool_computer_type(
      { text: 'x' },
      { userId: 'u_test' },
    );
    assert.equal(first.needApproval, true);
    // 模拟前端确认卡批准（与 ai-legacy approve REST 同款 db 调用）
    const db = require(path.join(R_SERVER, 'db'));
    const job = db.getToolJobByAckToken(first.ackToken);
    assert.ok(job, 'token 可回查');
    const ackRes = db.ackToolJob(first.ackToken, true, { userId: 'u_test' });
    assert.equal(ackRes?.ack_status, 'approved');
    const res = await computerTools.tool_computer_type(
      { text: 'x', confirm: true, ackToken: first.ackToken },
      { userId: 'u_test' },
    );
    // 过门后打到真实 sidecar：无快照目标 → no_target_snapshot（而非确认类错误）
    assert.equal(res.ok, false);
    assert.equal(res.error, 'no_target_snapshot');
  });

  test('screenshot：无项目 ctx → project_required（路径白名单门）', async () => {
    const res = await computerTools.tool_computer_screenshot({}, {});
    assert.equal(res.ok, false);
    assert.equal(res.error, 'project_required');
  });

  test('screenshot：伪项目 → project_not_found', async () => {
    const res = await computerTools.tool_computer_screenshot({}, { projectId: 'p_nonexistent' });
    assert.equal(res.ok, false);
    assert.equal(res.error, 'project_not_found');
  });

  test('computer_wait 负路：双态兼容（未授权 not_trusted / 已授权 found:false）', async () => {
    const res = await computerTools.tool_computer_wait({
      role: 'datepicker', timeoutMs: 900,
    });
    if (res.ok === false && res.error === 'not_trusted') {
      assert.ok(res.message.includes('辅助功能'));
      return;
    }
    assert.equal(res.ok, true);
    assert.equal(res.found, false);
  });
});
