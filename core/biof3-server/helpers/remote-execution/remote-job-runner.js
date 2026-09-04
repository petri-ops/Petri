/**
 * BLOCK-57 — 远程作业编排器（设计评审 D1/D4/D5/D7）
 *
 * 职责：agent 部署（sha256 钉扎）→ bundle 上传 → detached start →
 * 日志流（偏移续传）→ status 轮询（心跳事实源）→ cancel →
 * transfer-manifest 拉回 + 本地重算 sha256 对账（fail-closed）。
 *
 * 状态真相在节点侧文件；本模块只做观察与转述，绝不因传输失败改写作业终态。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const {
  BIOF3_AGENT_SH,
  AGENT_BIN,
  AGENT_ROOT,
  agentVersionHash,
  remoteAgentCommand,
} = require('./node-agent');
const {
  runSshOp,
  streamSshOp,
  uploadBundle,
  pullBundle,
  remoteJobDirPath,
  assertJobId,
} = require('./ssh-transport');

const AGENT_SCRIPT_HASH = agentVersionHash();
const START_ACK_TIMEOUT_MS = 15000;
const LANGS = ['r', 'python'];
const TRANSPORT_RETRY_ATTEMPTS = 3;
const TRANSPORT_RETRY_DELAY_MS = 1200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 可重试传输错误（transport.network / transport.timeout / transport.unknown）
 * 的小步退避重试——本地代理/网络瞬态不应放大成操作失败；非重试类原样抛回。
 */
async function runSshOpRetry(params) {
  let last = null;
  for (let attempt = 1; attempt <= TRANSPORT_RETRY_ATTEMPTS; attempt += 1) {
    last = await runSshOp(params);
    if (last.classified.kind === 'ok' || last.classified.retryable !== true) return last;
    if (attempt < TRANSPORT_RETRY_ATTEMPTS) await sleep(TRANSPORT_RETRY_DELAY_MS * attempt);
  }
  return last;
}

function hashLocalFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

function parseSha256SumManifest(text) {
  const entries = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (!m) continue;
    const relPath = m[2].trim();
    if (relPath.includes('..') || path.isAbsolute(relPath)) continue;
    entries.push({ sha256: m[1], path: relPath });
  }
  return entries;
}

function createRemoteJobRunner() {
  /** agent 脚本部署：hash 不一致即重传（幂等）。 */
  async function ensureAgent({ alias }) {
    const remoteHashCmd = `sha256sum "${AGENT_BIN}" 2>/dev/null | cut -d' ' -f1`;
    const current = await runSshOpRetry({ alias, remoteCommand: remoteHashCmd, timeoutMs: 20000 });
    if (current.classified.kind !== 'ok') {
      return { ok: false, error: current.classified };
    }
    if (current.stdout.trim().startsWith(AGENT_SCRIPT_HASH)) {
      return { ok: true, deployed: false };
    }
    const remoteCmd = `mkdir -p "${AGENT_ROOT}/bin" && cat > "${AGENT_BIN}.tmp" && mv "${AGENT_BIN}.tmp" "${AGENT_BIN}" && chmod +x "${AGENT_BIN}"`;
    const child = require('child_process').spawn(
      'ssh',
      [
        '-o', 'BatchMode=yes',
        '-o', 'ConnectTimeout=10',
        '--', alias, remoteCmd,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    );
    const result = await new Promise((resolve) => {
      let stderr = '';
      child.stderr.on('data', (c) => { stderr += c; });
      const timer = setTimeout(() => child.kill('SIGKILL'), 30000);
      timer.unref?.();
      child.stdin.on('error', () => {});
      child.stdin.end(BIOF3_AGENT_SH);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve({ ok: true, deployed: true });
        resolve({ ok: false, error: { kind: 'transport.deploy_failed', retryable: true, detail: stderr.trim().split('\n').pop() || `exit=${code}` } });
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        resolve({ ok: false, error: { kind: 'transport.network', retryable: true, detail: error.message } });
      });
    });
    return result;
  }

  /**
   * 从 probe 信息解析语言运行时；缺失即返回 ready:false（诚实失败，不猜测）。
   */
  function resolveRuntime(probeInfo, lang) {
    const key = lang === 'r' ? 'r' : 'python';
    const bin = probeInfo && probeInfo[key];
    const versionKey = lang === 'r' ? 'rversion' : 'pythonversion';
    const version = probeInfo && probeInfo[versionKey] || null;
    if (!bin || bin === 'missing' || /[\s\r\n]/.test(bin)) {
      return { ready: false, runtimeBin: null, version: null, reason: `节点缺少 ${lang === 'r' ? 'R (Rscript)' : 'Python3'} 运行时` };
    }
    return { ready: true, runtimeBin: bin, version, reason: null };
  }

  /**
   * 提交：上传 bundle → agent start → 轮询到 active 确认。
   * bundle = 本地 jobDir 全量（排除 output/）——脚本/params/共享 helper/上传输入。
   */
  async function submit({ target, jobId, jobDir, lang, argmode, runtimeBin }) {
    assertJobId(jobId);
    const alias = target.alias;
    const deployed = await ensureAgent({ alias });
    if (!deployed.ok) return { ok: false, stage: 'deploy', error: deployed.error };

    const remoteDir = remoteJobDirPath(jobId);
    const upload = await uploadBundle({ alias, jobDir, remoteJobDir: remoteDir });
    if (!upload.ok) {
      return { ok: false, stage: 'upload', error: upload.classified || { kind: 'transport.unknown', retryable: true, detail: upload.stderr } };
    }

    const startOp = await runSshOpRetry({
      alias,
      remoteCommand: remoteAgentCommand(['start', jobId, runtimeBin, argmode]),
      timeoutMs: 20000,
    });
    if (startOp.classified.kind !== 'ok') {
      return { ok: false, stage: 'start', error: startOp.classified, stderr: startOp.stdout + startOp.stderr };
    }
    if (/agent_error:/.test(startOp.stderr || '')) {
      const detail = (startOp.stderr.match(/agent_error:(.+)/) || [])[1] || 'unknown';
      const kind = detail.includes('runtime_missing') ? 'node.runtime_missing' : 'node.start_failed';
      return { ok: false, stage: 'start', error: { kind, retryable: false, detail: detail.trim() } };
    }

    // start 确认：轮询 status 直到 active（detached supervisor 写 state.json 有亚秒延迟）
    const deadline = Date.now() + START_ACK_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await pollStatus({ alias, jobId });
      if (status.ok && status.kind === 'active') {
        return { ok: true, remoteDir };
      }
      if (status.ok && status.kind === 'terminal') {
        return { ok: false, stage: 'start', error: { kind: 'node.terminated_immediately', retryable: false, detail: JSON.stringify(status.info || {}) } };
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    return { ok: false, stage: 'start', error: { kind: 'node.start_ack_timeout', retryable: true, detail: 'start 未在窗口内确认 active' } };
  }

  /** status：terminal|active|unknown（节点文件真相）。 */
  async function pollStatus({ alias, jobId }) {
    assertJobId(jobId);
    const op = await runSshOpRetry({ alias, remoteCommand: remoteAgentCommand(['status', jobId]), timeoutMs: 20000 });
    if (op.classified.kind !== 'ok') {
      return { ok: false, classified: op.classified };
    }
    const firstLine = op.stdout.split('\n')[0].trim();
    const jsonLine = op.stdout.split('\n').slice(1).join('\n').trim();
    let info = null;
    try { info = jsonLine ? JSON.parse(jsonLine) : null; } catch { info = null; }
    if (firstLine === 'terminal' || firstLine === 'active') {
      return { ok: true, kind: firstLine, info };
    }
    return { ok: true, kind: 'unknown', info: null };
  }

  /** 日志流句柄：断开由调用方处理（重连按偏移续传）。 */
  function streamLog({ alias, jobId, offset, onChunk, onExit }) {
    return streamSshOp({
      alias,
      remoteCommand: remoteAgentCommand(['log', jobId, String(Math.max(0, Math.floor(offset)))]),
      onChunk,
      onExit,
    });
  }

  async function cancel({ alias, jobId }) {
    const op = await runSshOp({ alias, remoteCommand: remoteAgentCommand(['cancel', jobId]), timeoutMs: 20000 });
    return {
      ok: op.classified.kind === 'ok',
      response: op.stdout.trim(),
      classified: op.classified,
    };
  }

  async function fetchTransferManifest({ alias, jobId }) {
    const op = await runSshOpRetry({ alias, remoteCommand: remoteAgentCommand(['manifest', jobId]), timeoutMs: 20000 });
    if (op.classified.kind !== 'ok') return { ok: false, classified: op.classified };
    return { ok: true, entries: parseSha256SumManifest(op.stdout) };
  }

  async function fetchExitInfo({ alias, jobId }) {
    const op = await runSshOpRetry({ alias, remoteCommand: remoteAgentCommand(['exitinfo', jobId]), timeoutMs: 20000 });
    if (op.classified.kind !== 'ok') return { ok: false, classified: op.classified };
    try {
      return { ok: true, info: JSON.parse(op.stdout.trim() || '{}') };
    } catch {
      return { ok: true, info: null };
    }
  }

  /**
   * 拉回 output/ 并按 transfer-manifest 逐文件重算 sha256；不符重拉一次，
   * 仍不符 → ok:false（fail-closed，交由上层 artifact_validation 收敛）。
   */
  async function pullOutputs({ target, jobId, localJobDir }) {
    assertJobId(jobId);
    const alias = target.alias;
    const remoteDir = remoteJobDirPath(jobId);
    fs.mkdirSync(localJobDir, { recursive: true });

    const manifestFetch = await fetchTransferManifest({ alias, jobId });
    if (!manifestFetch.ok) {
      return { ok: false, stage: 'manifest', error: manifestFetch.classified };
    }
    const entries = manifestFetch.entries;

    const attempt = async () => pullBundle({
      alias,
      remoteDir,
      subPath: 'output',
      localDir: localJobDir,
    });

    const verify = () => {
      for (const entry of entries) {
        const localPath = path.join(localJobDir, entry.path);
        try {
          if (hashLocalFile(localPath) !== entry.sha256) return false;
        } catch {
          return false;
        }
      }
      return true;
    };

    let pull = await attempt();
    if (!pull.ok) {
      return { ok: false, stage: 'pull', error: pull.classified || { kind: 'transport.unknown', retryable: true, detail: pull.stderr } };
    }
    if (!verify()) {
      pull = await attempt();
      if (!pull.ok) {
        return { ok: false, stage: 'pull', error: pull.classified || { kind: 'transport.unknown', retryable: true, detail: pull.stderr } };
      }
      if (!verify()) {
        return {
          ok: false,
          stage: 'verify',
          error: { kind: 'transfer.hash_mismatch', retryable: false, detail: `产物 sha256 对账失败（${entries.length} 个文件，重拉一次仍不符）` },
        };
      }
    }
    return { ok: true, entries, verifiedCount: entries.length };
  }

  return {
    ensureAgent,
    resolveRuntime,
    submit,
    pollStatus,
    streamLog,
    cancel,
    fetchTransferManifest,
    fetchExitInfo,
    pullOutputs,
    LANGS,
  };
}

module.exports = { createRemoteJobRunner, parseSha256SumManifest, AGENT_SCRIPT_HASH };
