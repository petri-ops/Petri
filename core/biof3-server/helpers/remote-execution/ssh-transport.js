/**
 * BLOCK-57 — SSH 传输层（设计评审 D2）
 *
 * 唯一传输面：系统 ssh（spawn argv 数组，本地零 shell 拼接）+ tar-over-ssh 流。
 * 所有远程命令 = biof3-agent.sh 固定 verbs（node-agent.remoteAgentCommand）或
 * 两段结构性 tar 管道（路径只由受控常量 + 已校验 jobId 组成）。
 * 统一 ssh 参数：BatchMode=yes（交互认证快败）+ ConnectTimeout。
 */

const { spawn } = require('child_process');
const { classifySshFailure } = require('./error-classifier');
const { JOB_ID_RE } = require('./node-agent');

const SSH_CONNECT_TIMEOUT_S = 10;

function assertJobId(jobId) {
  if (typeof jobId !== 'string' || !JOB_ID_RE.test(jobId)) {
    throw new Error(`invalid_job_id: ${String(jobId).slice(0, 40)}`);
  }
  return jobId;
}

function assertAlias(alias) {
  if (typeof alias !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(alias)) {
    throw new Error(`invalid_target_alias: ${String(alias).slice(0, 40)}`);
  }
  return alias;
}

// 返回 ssh 的参数（不含命令名本身——调用方统一 spawn('ssh', args)）。
// BIOF3_SSH_DEBUG=1 时注入 -v（诊断用，不改变连接语义）。
function buildSshArgv(alias, remoteCommand) {
  return [
    ...(process.env.BIOF3_SSH_DEBUG ? ['-v'] : []),
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
function runSshOp({ alias, remoteCommand, timeoutMs = 30000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('ssh', buildSshArgv(alias, remoteCommand), {
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
function streamSshOp({ alias, remoteCommand, onChunk, onExit }) {
  const child = spawn('ssh', buildSshArgv(alias, remoteCommand), {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stopped = false;
  child.stdout.on('data', (chunk) => {
    if (!stopped) onChunk(chunk);
  });
  child.on('close', (code, signal) => {
    if (!stopped) onExit({ code, signal, stderr: '' });
  });
  child.on('error', (error) => {
    if (!stopped) onExit({ code: null, signal: null, stderr: error.message });
  });
  return {
    stop() {
      stopped = true;
      try { child.kill('SIGKILL'); } catch {}
    },
  };
}

/**
 * tar-over-ssh 上传：tar -C jobDir --exclude=./output -cf - . | ssh 'mkdir -p dir && tar -xf - -C dir'
 * 仅覆盖指定子目录，不触碰节点其他路径。
 */
function uploadBundle({ alias, jobDir, remoteJobDir }) {
  return new Promise((resolve) => {
    const tar = spawn('tar', ['-C', jobDir, '--exclude=./output', '-cf', '-', '.'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ssh = spawn(
      'ssh',
      buildSshArgv(
        alias,
        `mkdir -p "${remoteJobDir}" && tar -xf - -C "${remoteJobDir}"`
      ),
      { stdio: ['pipe', 'ignore', 'pipe'] }
    );
    let stderr = '';
    let tarErr = '';
    let timedOut = false;
    let tarCode = null;
    let sshCode = null;
    const timer = setTimeout(() => {
      timedOut = true;
      tar.kill('SIGKILL');
      ssh.kill('SIGKILL');
    }, 120000);
    timer.unref?.();
    ssh.stdin.on('error', () => { /* tar 端先退出时 EPIPE 属预期，最终以双方退出码裁决 */ });
    tar.stdout.pipe(ssh.stdin);
    ssh.stderr.on('data', (c) => { stderr += c; });
    tar.stderr.on('data', (c) => { tarErr += c; });
    let tarDone = false;
    let sshDone = false;
    const maybeFinish = (tarCodeArg, sshCodeArg) => {
      if (!(tarDone && sshDone)) return;
      clearTimeout(timer);
      if (sshCodeArg === 0 && tarCodeArg === 0) {
        resolve({ ok: true, code: 0, stderr: '' });
        return;
      }
      const combined = `${stderr}\n${tarErr}`.trim();
      const sshClassified = classifySshFailure({ exitCode: sshCodeArg, stderr, timedOut });
      resolve({ ok: false, code: sshCodeArg ?? tarCodeArg, stderr: combined, classified: sshClassified });
    };
    tar.on('close', (code) => { tarDone = true; tarCode = code; maybeFinish(code, sshCode); });
    ssh.on('close', (code) => { sshDone = true; sshCode = code; maybeFinish(tarCode, code); });
    ssh.on('error', (error) => { sshDone = true; stderr += `\n${error.message}`; maybeFinish(tarCode, null); });
    tar.on('error', (error) => { tarDone = true; tarErr += `\n${error.message}`; maybeFinish(null, sshCode); });
  });
}

/**
 * tar-over-ssh 拉回：ssh 'tar -C remoteDir -cf - <sub>' | tar -xf - -C localDir
 */
function pullBundle({ alias, remoteDir, subPath, localDir }) {
  return new Promise((resolve) => {
    const ssh = spawn(
      'ssh',
      buildSshArgv(alias, `tar -C "${remoteDir}" -cf - "${subPath}"`),
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const tar = spawn('tar', ['-xf', '-', '-C', localDir], {
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ssh.kill('SIGKILL');
      tar.kill('SIGKILL');
    }, 300000);
    timer.unref?.();
    tar.stdin.on('error', () => {});
    ssh.stdout.pipe(tar.stdin);
    ssh.stderr.on('data', (c) => { stderr += c; });
    let sshDone = false;
    let tarDone = false;
    let sshCode = null;
    let tarCode = null;
    const maybeFinish = () => {
      if (!(sshDone && tarDone)) return;
      clearTimeout(timer);
      if (sshCode === 0 && tarCode === 0) {
        resolve({ ok: true });
        return;
      }
      resolve({ ok: false, stderr: stderr.trim(), classified: classifySshFailure({ exitCode: sshCode, stderr, timedOut }) });
    };
    ssh.on('close', (code) => { sshDone = true; sshCode = code; maybeFinish(); });
    tar.on('close', (code) => { tarDone = true; tarCode = code; maybeFinish(); });
    ssh.on('error', (error) => { sshDone = true; stderr += `\n${error.message}`; maybeFinish(); });
    tar.on('error', (error) => { tarDone = true; stderr += `\n${error.message}`; maybeFinish(); });
  });
}

/** 节点侧固定目录布局（与 node-agent 的 AGENT 常量一一对应）。 */
function remoteJobDirPath(jobId) {
  assertJobId(jobId);
  return `$HOME/.biof3-agent/jobs/${jobId}`;
}

module.exports = {
  buildSshArgv,
  runSshOp,
  streamSshOp,
  uploadBundle,
  pullBundle,
  remoteJobDirPath,
  assertJobId,
  assertAlias,
  SSH_CONNECT_TIMEOUT_S,
};
