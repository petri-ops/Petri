/**
 * BLOCK-57 — 远程作业编排器（设计评审 D1/D4/D5/D7）
 *
 * 职责（P5 拆除后）：agent 部署（ensureAgent，sha256 钉扎幂等重传）+
 * 语言运行时解析（resolveRuntime，节点 probe 事实）。作业机制已由
 * ssh-direct-runner（BLOCK-76 直跑链）取代。
 *
 * 状态真相在节点侧文件；本模块只做观察与转述，绝不因传输失败改写作业终态。
 */

const {
  BIOF3_AGENT_SH,
  AGENT_BIN,
  AGENT_ROOT,
  agentVersionHash,
} = require('./node-agent');
const {
  runSshOp,
} = require('./ssh-transport');

const AGENT_SCRIPT_HASH = agentVersionHash();
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
  // BLOCK-76 P5 — BLOCK-57 作业机制（submit/poll/stream/cancel/manifest/pullOutputs）
  // 已拆除：SSH 直跑链（ssh-direct-runner）取代作业上传/拉回；本文件仅保留
  // agent 部署（ensureAgent）与语言运行时解析（resolveRuntime）。
  return {
    ensureAgent,
    resolveRuntime,
    LANGS,
  };
}

module.exports = { createRemoteJobRunner, AGENT_SCRIPT_HASH };
