'use strict';

/**
 * tool-retry-policy.js — BLOCK-135（G0-PLATFORM PL-3 二刀·分析级重试策略）。
 *
 * 纯函数分类器：tool_job 执行失败后判定是否瞬态（值得重跑）。默认关闭
 * （BIOF3_TOOL_RETRY_MAX 未设或 0），加法式接入，不改既有失败语义。
 *
 * 判瞬态的唯一形态：外部 SIGKILL 且非取消请求（signal==='SIGKILL'，或其
 * 同义退出码 137=128+9）——系统 OOM / 资源挤占等外部环境因素，重跑有独立
 * 成功概率。其余（nonzero_exit / hard_timeout / 取消 / executor setup 失败
 * / SIGTERM 等其他信号）一律确定性失败，不重试。判定优先级：
 * - cancelRequested 优先于 SIGKILL：用户主动取消的终止链也留 SIGKILL 形态
 *   （tools-executor/active-job.js terminateOwnedToolJobProcess）；
 * - timedOut 优先于 SIGKILL：硬超时本方 TERM→KILL 升级同样留 SIGKILL 形态
 *   （process-lifecycle.js enforceHardTimeout），不是外部信号；
 * - recoveryRequested 优先于 SIGKILL：本方失活恢复（process-lifecycle 置
 *   active.recoveryRequested 后 terminateChildProcess，TERM→KILL 升级同样留
 *   SIGKILL 形态）是本方击杀第三形态，不是外部信号；
 * - 字符串 exitCode（child_process 的 'ENOENT' / 'ERR_CHILD_PROCESS_STDIO_
 *   MAXBUFFER' 等错误码）不会与数字 137 混淆，一律落 nonzero_exit。
 */

/**
 * @param {{
 *   exitCode?: number | string | null,
 *   signal?: string | null,
 *   timedOut?: boolean,
 *   setupFailure?: boolean,
 *   cancelRequested?: boolean,
 *   recoveryRequested?: boolean,
 * }} [input]
 * @returns {{ transient: boolean, reason: string }}
 */
function classifyToolJobFailure(input = {}) {
  const {
    exitCode = null,
    signal = null,
    timedOut = false,
    setupFailure = false,
    cancelRequested = false,
    recoveryRequested = false,
  } = input || {};
  if (cancelRequested) return { transient: false, reason: 'cancelled' };
  if (recoveryRequested) return { transient: false, reason: 'recovery_terminated' };
  if (setupFailure) return { transient: false, reason: 'executor_setup_failure' };
  if (timedOut) return { transient: false, reason: 'hard_timeout' };
  if (signal === 'SIGKILL' || exitCode === 137) {
    return { transient: true, reason: 'external_sigkill' };
  }
  if (signal) return { transient: false, reason: 'terminated' };
  return { transient: false, reason: 'nonzero_exit' };
}

/**
 * 重试额度上限；未设 / 非法 / 负数一律 0（=重试关闭）。
 * 每次调用实时读 env（测试需在 import 后设置仍生效）。
 */
function getRetryMax() {
  const raw = process.env.BIOF3_TOOL_RETRY_MAX;
  if (raw === undefined || raw === '') return 0;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function isRetryEnabled() {
  return getRetryMax() > 0;
}

module.exports = {
  classifyToolJobFailure,
  getRetryMax,
  isRetryEnabled,
};
