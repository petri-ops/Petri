/**
 * BLOCK-57 — SSH 传输层（设计评审 D2）
 *
 * 唯一传输面：系统 ssh（spawn argv 数组，本地零 shell 拼接）+ tar-over-ssh 流。
 * 所有远程命令 = petri-agent.sh 固定 verbs（node-agent.remoteAgentCommand）或
 * 统一 ssh 参数：BatchMode=yes（交互认证快败）+ ConnectTimeout。
 */

const { spawn } = require('child_process');
const { classifySshFailure } = require('./error-classifier');

const SSH_CONNECT_TIMEOUT_S = 10;


function assertAlias(alias) {
  if (typeof alias !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(alias)) {
    throw new Error(`invalid_target_alias: ${String(alias).slice(0, 40)}`);
  }
  return alias;
}

// BLOCK-96 F1 — 目标级地址族参数化（P0 裁决）：仅显式 inet/inet6 时注入
// `-o AddressFamily=...`；缺省不注入（不全局干预，IPv6-only 远端不受影响，
// 地址族序仍由用户 ~/.ssh/config 与系统默认决定）。
function addressFamilyOptions(addressFamily) {
  if (addressFamily !== 'inet' && addressFamily !== 'inet6') return [];
  return ['-o', `AddressFamily=${addressFamily}`];
}

// 返回 ssh 的参数（不含命令名本身——调用方统一 spawn('ssh', args)）。
// PETRI_SSH_DEBUG=1 时注入 -v（诊断用，不改变连接语义）。
function buildSshArgv(alias, remoteCommand, { addressFamily } = {}) {
  return [
    ...(process.env.PETRI_SSH_DEBUG ? ['-v'] : []),
    ...addressFamilyOptions(addressFamily),
    '-o', 'BatchMode=yes',
    '-o', `ConnectTimeout=${SSH_CONNECT_TIMEOUT_S}`,
    '--',
    assertAlias(alias),
    remoteCommand,
  ];
}

/**
 * 一次性 ssh 操作。远端命令自身的非零退出（如 runtime_missing）不是传输错误，
 * 分类器据此分叉（remote.command_failed vs transport.*）。
 */
function runSshOp({ alias, remoteCommand, timeoutMs = 30000, addressFamily } = {}) {
  return new Promise((resolve) => {
    const child = spawn('ssh', buildSshArgv(alias, remoteCommand, { addressFamily }), {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const finish = (code, signal) => {
      clearTimeout(timer);
      const classified = classifySshFailure({ exitCode: code, signal, stderr, timedOut });
      resolve({ code, signal: signal || null, stdout, stderr, timedOut, classified });
    };
    child.on('close', (code, signal) => finish(code, signal));
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        code: null,
        signal: null,
        stdout,
        stderr: `${stderr}\n${error.message}`,
        timedOut,
        classified: { kind: 'transport.network', retryable: true, detail: error.message },
      });
    });
  });
}

/** 长连接日志流（观察通道；断开 ≠ 作业失败）。返回 {stop()}。 */
module.exports = {
  buildSshArgv,
  runSshOp,
  assertAlias,
  SSH_CONNECT_TIMEOUT_S,
};
