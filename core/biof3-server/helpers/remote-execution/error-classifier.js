/**
 * BLOCK-57 — SSH 传输错误分类器（纯函数）
 *
 * 设计评审 D8：所有 ssh 通道失败必须经此单一出口分类，杜绝
 * 「网络抖动把 30 分钟作业标废」——transport 类错误永不改写作业终态。
 *
 * 输入：ssh 进程退出码 + stderr 文本；输出：结构化错误类。
 */

const SSH_EXIT_CODE = 255;

const NETWORK_PATTERNS = [
  /could not resolve hostname/i,
  /connection timed out/i,
  /connection refused/i,
  /network is unreachable/i,
  /no route to host/i,
  /connection reset by peer/i,
  /broken pipe/i,
  /connection closed by/i,
];

const AUTH_PATTERNS = [
  /permission denied/i,
  /publickey\s*,?/i,
  /authentication failed/i,
  /no supported authentication methods/i,
  /keyboard-interactive/i,
  /password authentication/i,
  /hostbased/i,
];

/**
 * @param {{exitCode?: number|null, signal?: string|null, stderr?: string, timedOut?: boolean}} input
 * @returns {{kind: string, retryable: boolean, detail: string}}
 *   kind ∈ transport.network | transport.auth | transport.host_key | transport.timeout
 *        | transport.unknown | ok
 */
function classifySshFailure({ exitCode = null, signal = null, stderr = '', timedOut = false } = {}) {
  const text = String(stderr || '');
  const detail = text.trim().split('\n').filter(Boolean).pop() || `exit=${exitCode ?? 'null'} signal=${signal ?? 'null'}`;
  if (timedOut) {
    return { kind: 'transport.timeout', retryable: true, detail };
  }
  if (exitCode === 0 && !signal) {
    return { kind: 'ok', retryable: false, detail };
  }
  if (exitCode === SSH_EXIT_CODE || text) {
    if (NETWORK_PATTERNS.some((p) => p.test(text))) {
      return { kind: 'transport.network', retryable: true, detail };
    }
    if (/host key verification failed/i.test(text)) {
      // 严格主机指纹策略（D6）：fail-fast，指引用户手动完成首次信任。
      return { kind: 'transport.host_key', retryable: false, detail };
    }
    if (AUTH_PATTERNS.some((p) => p.test(text))) {
      return { kind: 'transport.auth', retryable: false, detail };
    }
    if (exitCode === SSH_EXIT_CODE) {
      return { kind: 'transport.unknown', retryable: true, detail };
    }
  }
  // 非 255 的非零退出码是远端命令自己的失败，不是传输层问题。
  return { kind: 'remote.command_failed', retryable: false, detail };
}

module.exports = { classifySshFailure, SSH_EXIT_CODE };
