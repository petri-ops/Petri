'use strict';

/**
 * BLOCK-63 P3 — Windows 侧 computer_* 编排注册测试：host 平台门与二进制定位 /
 * 注册表契约 / 政策矩阵 / Windows sidecar 真实 handler 链（确认门两段式）。
 *
 * 前置：powershell sidecars/computer-use-windows/build.ps1（bin/publish 就位）。
 * Windows 本机实跑；平台门测试以 process.platform 模拟覆盖。
 */

import assert from 'node:assert/strict';
import { test, describe, after } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'petri-server');

// 全量套件防挂 watchdog（对标 block48：sidecar stdio 受限环境可能挂起）
setTimeout(() => {
  console.error('WATCHDOG: block63-computer-host 3min 超时，强制退出');
  process.exit(1);
}, 180000).unref();
const require = createRequire(import.meta.url);

// 临时 DB 自举（存量基建同款：PETRI_DB_PATH 须在 require db.js 前生效）
{
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-block63-host-db-'));
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

const { ComputerUseHost, ComputerUseHostError, defaultSidecarPath, getComputerUseHost } = require(
  path.join(R_SERVER, 'helpers', 'computer-use-host.js'),
);
const { decideAgentToolCall } = require(path.join(R_SERVER, 'agent-tools', 'agent-tool-policy.js'));
const { getToolContract, getToolRegistry } = require(path.join(R_SERVER, 'agent-tools', 'registry.js'));
const computerTools = require(path.join(R_SERVER, 'agent-tools', 'computer-use-tools.js'));

const FIXTURE_EXE = path.resolve(
  __dirname, '..', 'sidecars', 'computer-use-windows', 'axfixture', 'bin', 'publish', 'axfixture-windows.exe',
);

describe('托管：平台门与二进制定位（BLOCK-63）', () => {
  test('win32 默认定位指向 computer-use-windows 单文件发布且存在', () => {
    const p = defaultSidecarPath();
    if (process.platform === 'win32') {
      assert.ok(p.endsWith('petri-computer-use-windows.exe'), 'win32 应指向 .exe：' + p);
      assert.ok(fs.existsSync(p), 'sidecar 未构建：powershell sidecars/computer-use-windows/build.ps1');
    }
  });

  test('env PETRI_COMPUTER_USE_SIDECAR 覆盖优先', () => {
    const fake = path.join(os.tmpdir(), 'fake-sidecar.exe');
    process.env.PETRI_COMPUTER_USE_SIDECAR = fake;
    try {
      assert.equal(defaultSidecarPath(), fake);
    } finally {
      delete process.env.PETRI_COMPUTER_USE_SIDECAR;
    }
  });

  test('不支持平台（linux 模拟）→ unsupported_platform（双平台文案）', () => {
    const host = new ComputerUseHost({ binaryPath: 'X:/nonexistent/sidecar.exe' });
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    try {
      assert.throws(
        () => host.ensureRunning(),
        (e) => e instanceof ComputerUseHostError
          && e.code === 'unsupported_platform'
          && e.message.includes('macOS')
          && e.message.includes('Windows'),
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform });
    }
  });

  test('win32 + 二进制缺失 → sidecar_not_built（build.ps1 指引）', () => {
    if (process.platform !== 'win32') return; // 平台门文案按本机平台断言
    const host = new ComputerUseHost({ binaryPath: 'X:/nonexistent/sidecar.exe' });
    assert.throws(
      () => host.ensureRunning(),
      (e) => e instanceof ComputerUseHostError
        && e.code === 'sidecar_not_built'
        && e.message.includes('build.ps1'),
    );
  });

  test('request probe：真实 spawn → platform=windows / trusted / hostElevated', async () => {
    if (process.platform !== 'win32') return;
    const host = new ComputerUseHost();
    try {
      const res = await host.request('probe');
      assert.equal(res.platform, 'windows');
      assert.equal(res.trusted, true, 'Windows 无 TCC 授权门，probe 恒 trusted');
      assert.equal(typeof res.hostElevated, 'boolean');
      assert.ok(Array.isArray(res.verbs) && res.verbs.includes('close'), 'P2 verbs 应含 close');
      assert.ok(host.isRunning());
    } finally {
      host.stop();
    }
  });

  test('死亡恢复：进程被杀后下一次请求自动重启成功', async () => {
    if (process.platform !== 'win32') return;
    const host = new ComputerUseHost();
    try {
      await host.request('probe');
      host.proc.kill();
      await new Promise((r) => setTimeout(r, 300));
      const res = await host.request('probe');
      assert.equal(res.platform, 'windows');
      assert.ok(host.isRunning());
    } finally {
      host.stop();
    }
  });
});

describe('注册表与政策矩阵（8 工具，平台无关契约）', () => {
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

  test('8 工具注册：契约 + schema + handler 全在位', () => {
    const registry = getToolRegistry();
    for (const [name, want] of Object.entries(expectations)) {
      const entry = registry.find((item) => item.definition?.function?.name === name);
      assert.ok(entry, `${name} 未注册`);
      assert.equal(typeof entry.handler, 'function', `${name} handler 缺失`);
      assert.ok(entry.definition.function.parameters, `${name} schema 缺失`);
      assert.equal(entry.contract.category, want.category, `${name} category`);
      assert.equal(entry.contract.sideEffect, want.sideEffect, `${name} sideEffect`);
      assert.equal(entry.contract.riskTier, want.riskTier, `${name} riskTier`);
      assert.ok(
        entry.definition.function.description.includes('macOS/Windows'),
        `${name} 描述应双平台化`,
      );
    }
  });

  test('政策矩阵：控制类仅 full 放行 / 只读面全放行 / screenshot 项目写档放行', () => {
    const allowed = (name, ctx) =>
      decideAgentToolCall({ name, args: {}, ctx, contract: getToolContract(name) }).decision === 'allow';
    assert.equal(allowed('computer_click', { accessMode: 'read' }), false);
    assert.equal(allowed('computer_click', { accessMode: 'workspace-write' }), false);
    assert.equal(allowed('computer_click', { accessMode: 'full', planMode: true }), false);
    assert.equal(allowed('computer_click', { accessMode: 'full' }), true);
    for (const name of ['computer_snapshot', 'computer_authorize', 'computer_wait']) {
      assert.equal(allowed(name, { accessMode: 'read' }), true, `${name}@read`);
    }
    assert.equal(allowed('computer_screenshot', { accessMode: 'workspace-write' }), true);
  });
});

describe('工具 handler：确认门两段式 + Windows sidecar 真链（axfixture 靶）', () => {
  let fixture = null;

  const spawnFixture = () => {
    if (process.platform !== 'win32') return null;
    const p = spawn(FIXTURE_EXE, [], { stdio: 'ignore' });
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(p), 2000);
      p.once('spawn', () => { clearTimeout(timer); resolve(p); });
      p.once('error', () => { clearTimeout(timer); resolve(null); });
    });
  };

  after(() => {
    // 单例 host 的 sidecar 常驻 stdin，不收则事件循环不退（watchdog 误杀）
    try { getComputerUseHost().stop(); } catch {}
    if (fixture && fixture.exitCode === null) {
      try { fixture.kill(); } catch {}
    }
  });

  test('computer_authorize：Windows probe 形状（platform/trusted/hostElevated）', async () => {
    if (process.platform !== 'win32') return;
    const res = await computerTools.tool_computer_authorize({}, {});
    assert.equal(res.ok, true);
    assert.equal(res.platform, 'windows');
    assert.equal(res.trusted, true);
  });

  test('确认门：click 首调 needApproval + ackToken；伪造 token fail-closed', async () => {
    if (process.platform !== 'win32') return;
    const first = await computerTools.tool_computer_click({ ref: 'e0', app: 'axfixture-windows' }, { userId: 'u_t63' });
    assert.equal(first.ok, true);
    assert.equal(first.needApproval, true);
    assert.match(first.ackToken, /^ack_/);
    const denied = await computerTools.tool_computer_click(
      { ref: 'e0', app: 'axfixture-windows', confirm: true, ackToken: 'ack_fake' },
      { userId: 'u_t63' },
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.error, 'approval_invalid');
  });

  test('批准链 → snapshot→type 全链真跑：ValuePattern 回写后语义树实证', async (t) => {
    if (process.platform !== 'win32') return;
    fixture = await spawnFixture();
    assert.ok(fixture, 'fixture 启动失败');
    await new Promise((r) => setTimeout(r, 1200));

    // snapshot 拿 Edit ref（app 传进程名 → buildTarget bundleId 路径）
    const snap = await computerTools.tool_computer_snapshot({ app: 'axfixture-windows' }, {});
    if (snap.ok !== true && snap.error === 'target_not_found') {
      t.skip('非交互桌面：fixture 窗口对 UIA 不可见（环境限制，非产品失败）');
      return;
    }
    assert.equal(snap.ok, true, JSON.stringify(snap).slice(0, 200));
    const edit = (snap.elements || []).find((e) => e.role === 'Edit');
    assert.ok(edit, 'fixture 无文本框');

    // type 确认门完整链：needApproval → db 批准 → 重调执行
    const first = await computerTools.tool_computer_type(
      { text: 'hello 格物 123', ref: edit.ref, app: 'axfixture-windows' },
      { userId: 'u_t63' },
    );
    assert.equal(first.needApproval, true);
    const db = require(path.join(R_SERVER, 'db'));
    const job = db.getToolJobByAckToken(first.ackToken);
    assert.ok(job, 'token 可回查');
    assert.equal(db.ackToolJob(first.ackToken, true, { userId: 'u_t63' })?.ack_status, 'approved');
    const typed = await computerTools.tool_computer_type(
      { text: 'hello 格物 123', ref: edit.ref, app: 'axfixture-windows', confirm: true, ackToken: first.ackToken },
      { userId: 'u_t63' },
    );
    assert.equal(typed.ok, true, JSON.stringify(typed).slice(0, 200));
    assert.equal(typed.typed, 'hello 格物 123'.length);

    // 复照语义树：value 实证（ValuePattern 后台回写）
    const snap2 = await computerTools.tool_computer_snapshot({ app: 'axfixture-windows' }, {});
    const edit2 = (snap2.elements || []).find((e) => e.role === 'Edit');
    assert.ok((edit2?.value || '').includes('hello 格物 123'), 'value 未实证：' + edit2?.value);
  });

  test('screenshot：路径白名单门（project_required / project_not_found）', async () => {
    const noProject = await computerTools.tool_computer_screenshot({}, {});
    assert.equal(noProject.ok, false);
    assert.equal(noProject.error, 'project_required');
    const bad = await computerTools.tool_computer_screenshot({}, { projectId: 'p_nonexistent' });
    assert.equal(bad.ok, false);
    assert.equal(bad.error, 'project_not_found');
  });
});
