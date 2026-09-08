'use strict';

// ============================================================
// BLOCK-48/BLOCK-63 P3 — Computer Use sidecar 托管：spawn / stdio 行式 JSON 协议 /
// 健康管理（死亡即弃，下次请求自动重启一次恢复）/ 超时。
//
// 二进制定位：env BIOF3_COMPUTER_USE_SIDECAR 覆盖 > 按平台选仓库 sidecar 相对路径
// （darwin → sidecars/computer-use；win32 → sidecars/computer-use-windows 单文件发布）。
// 仅 macOS / Windows 支持；未构建诚实报错并附构建指引。单例 getComputerUseHost()
// 供 agent 工具处理器共享（sidecar 自身维护最近快照注册表，必须常驻单实例）。
// ============================================================

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const REQUEST_TIMEOUT_MS = 30000;

class ComputerUseHostError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ComputerUseHostError';
    this.code = code;
  }
}

function defaultSidecarPath() {
  if (process.env.BIOF3_COMPUTER_USE_SIDECAR) return process.env.BIOF3_COMPUTER_USE_SIDECAR;
  if (process.platform === 'win32') {
    // Windows：.NET 8 单文件自包含发布产物（build.ps1 → bin/publish/）
    return path.resolve(
      __dirname, '..', '..', '..',
      'sidecars', 'computer-use-windows', 'bin', 'publish', 'gewu-computer-use-windows.exe',
    );
  }
  return path.resolve(__dirname, '..', '..', '..', 'sidecars', 'computer-use', 'bin', 'gewu-computer-use');
}

class ComputerUseHost {
  constructor({ binaryPath = defaultSidecarPath(), requestTimeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.binaryPath = binaryPath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.proc = null;
    this.nextId = 1;
    // id → { resolve, reject, timer }
    this.pending = new Map();
  }

  isRunning() {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  ensureRunning() {
    if (this.isRunning()) return;
    if (process.platform !== 'darwin' && process.platform !== 'win32') {
      throw new ComputerUseHostError('unsupported_platform', 'Computer Use 仅支持 macOS 与 Windows。');
    }
    if (!fs.existsSync(this.binaryPath)) {
      const hint = process.platform === 'win32'
        ? 'powershell sidecars/computer-use-windows/build.ps1'
        : 'bash scripts/build-computer-use-sidecar.sh';
      throw new ComputerUseHostError('sidecar_not_built', `sidecar 未构建：${hint}`);
    }
    this.proc = spawn(this.binaryPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stderr.on('data', (d) => {
      const text = String(d).trim();
      if (text) console.error(`[computer-use:stderr] ${text}`);
    });
    readline
      .createInterface({ input: this.proc.stdout })
      .on('line', (line) => this.dispatchLine(line));
    this.proc.once('exit', () => {
      const dead = [...this.pending.values()];
      this.pending.clear();
      this.proc = null;
      for (const item of dead) {
        clearTimeout(item.timer);
        item.reject(new ComputerUseHostError('sidecar_died', 'sidecar 进程退出'));
      }
    });
  }

  dispatchLine(line) {
    let msg = null;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // 非 JSON 行不符合协议，忽略
    }
    const item = this.pending.get(msg.id);
    if (!item) return;
    clearTimeout(item.timer);
    this.pending.delete(msg.id);
    if (msg.ok === false) {
      item.reject(
        new ComputerUseHostError(
          (msg.error && msg.error.code) || 'sidecar_error',
          (msg.error && msg.error.message) || 'sidecar 错误',
        ),
      );
      return;
    }
    item.resolve(msg.data ?? {});
  }

  request(verb, params = {}, timeoutMs = this.requestTimeoutMs) {
    this.ensureRunning();
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        // 超时视为 sidecar 失康：终止进程，下次请求走重启恢复
        try {
          if (this.proc) this.proc.kill();
        } catch {}
        reject(new ComputerUseHostError('sidecar_timeout', `sidecar ${verb} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(`${JSON.stringify({ id, verb, params })}\n`);
    });
  }

  /** 死亡/超时自动重启一次再试（同动词）；结构性错误（参数/权限）不重试。 */
  async requestWithRecovery(verb, params = {}, timeoutMs) {
    try {
      return await this.request(verb, params, timeoutMs);
    } catch (e) {
      if (e instanceof ComputerUseHostError && (e.code === 'sidecar_died' || e.code === 'sidecar_timeout')) {
        this.stop();
        return this.request(verb, params, timeoutMs);
      }
      throw e;
    }
  }

  stop() {
    if (this.proc) {
      try {
        this.proc.kill();
      } catch {}
      this.proc = null;
    }
  }
}

let singleton = null;

function getComputerUseHost() {
  if (!singleton) singleton = new ComputerUseHost();
  return singleton;
}

module.exports = { ComputerUseHost, ComputerUseHostError, getComputerUseHost, defaultSidecarPath };
