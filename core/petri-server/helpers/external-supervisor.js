'use strict';

/**
 * external-supervisor.js — A5 外部监督器「C 先行」（只观测不动作）。
 *
 * 定性：把「会话心跳超时 / 进程异常退出」从不可见变可见的观测汇（sink），
 * 接现成模块——incident-log（写 incidents 表）+ metrics（计数）+ error-log
 * （告警留痕）+ health（细节可见）+ incident-fingerprint（脱敏聚类）。
 *
 * 绝对红线：本模块只观测，不恢复、不接管、不干预被观测路径。没有常驻守护
 * 进程、没有定时巡检、没有进程信号发送、没有 DB 状态改写。检测由既有设施
 * 完成：进程异常由 error-log 的进程级钩子同刻感知；心跳超时由既有 60s
 * stale-running 对账器在真收口时以只读回调通知。回调默认 no-op、抛错必吞。
 *
 * 脱敏零外发：reasonCode 取固定窄词表；会话键经 sha256 截断成不可回溯的
 * opaque key；送出的 message 仅由 reasonCode + signal 拼成，不含用户消息、
 * 文件正文、绝对路径、凭据或 endpoint。fingerprint 由共享纯函数计算。
 */

const { createHash } = require('node:crypto');
const { normalizeIncidentFingerprint } = require('../../shared-backend/incident-fingerprint');

/** 固定窄词表——观测原因码，零用户数据。 */
const REASON_CODES = Object.freeze({
  HEARTBEAT_TIMEOUT: 'session_heartbeat_timeout',
  ABNORMAL_EXIT: 'session_abnormal_exit',
});

/** 固定窄词表——感知来源信号。 */
const SIGNALS = Object.freeze({
  RECONCILER: 'stale_running_reconciler',
  UNCAUGHT: 'uncaughtException',
  REJECTION: 'unhandledRejection',
});

function opaqueKey(sessionKey) {
  if (sessionKey == null || sessionKey === '') return 'anonymous';
  return createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 12);
}

function defaultDeps() {
  return {
    incidentLog: require('./incident-log'),
    metrics: require('../../shared-backend/metrics'),
    errorLog: require('../../shared-backend/error-log'),
    health: require('../../shared-backend/health'),
    processEmitter: process,
  };
}

/**
 * 构造一个观测汇。deps 可注入（测试用）；生产走 defaultDeps。
 * 每次观测同步写四个出口，各出口独立 try/catch——任一失败不阻断其余，
 * 更不阻断被观测的 loop / 对账主链（fail-soft）。
 */
function createExternalSupervisor(deps = defaultDeps()) {
  const stats = {
    observations: 0,
    byReason: Object.create(null),
    lastReasonCode: null,
    lastFingerprint: null,
    lastHealthShape: null,
  };
  let disposeProcessHooks = null;

  function emit({ kind, reasonCode, source, signal, sessionKey }) {
    const code = reasonCode || (kind === 'abnormal_exit'
      ? REASON_CODES.ABNORMAL_EXIT
      : REASON_CODES.HEARTBEAT_TIMEOUT);
    const tag = signal || kind;
    const key = opaqueKey(sessionKey);
    // 仅有窄词表字段：reasonCode + signal。不含任何调用方自由文本。
    const message = `${code}:${tag}`;
    const { fingerprint, normalized } = normalizeIncidentFingerprint({
      source,
      errorCode: code,
      tool: 'external-supervisor',
      message,
    });

    stats.observations += 1;
    const prevReason = Number(Object.entries(stats.byReason).find(([k]) => k === code)?.[1]) || 0;
    Object.assign(stats.byReason, { [code]: prevReason + 1 });
    stats.lastReasonCode = code;
    stats.lastFingerprint = fingerprint;

    const sinks = [
      () => deps.incidentLog.recordIncident({
        source,
        errorCode: code,
        tool: 'external-supervisor',
        phase: 'observation',
        message,
      }),
      () => deps.metrics.recordSupervisorObservation({ reasonCode: code, kind, session: key }),
      () => deps.errorLog.logError('external_supervisor', `${code} fingerprint=${fingerprint}`, {
        reasonCode: code,
        fingerprint,
        kind,
        session: key,
      }),
      () => {
        stats.lastHealthShape = deps.health.buildHealthShape({
          service: 'external-supervisor',
          readiness: true,
          details: {
            observations: stats.observations,
            lastReasonCode: code,
            lastFingerprint: fingerprint,
          },
        });
      },
    ];
    for (const sink of sinks) {
      try { sink(); } catch { /* 观测失败永不阻断被观测路径 */ }
    }

    return Object.freeze({
      kind,
      reasonCode: code,
      source,
      signal: tag,
      session: key,
      fingerprint,
      normalized,
      at: new Date().toISOString(),
    });
  }

  function observeHeartbeatTimeout({ sessionKey, signal = SIGNALS.RECONCILER } = {}) {
    return emit({
      kind: 'heartbeat_timeout',
      reasonCode: REASON_CODES.HEARTBEAT_TIMEOUT,
      source: 'stall',
      signal,
      sessionKey,
    });
  }

  function observeAbnormalExit({ sessionKey, signal = SIGNALS.UNCAUGHT } = {}) {
    return emit({
      kind: 'abnormal_exit',
      reasonCode: REASON_CODES.ABNORMAL_EXIT,
      source: 'fatal',
      signal,
      sessionKey,
    });
  }

  /**
   * 注册进程级异常感知（只留痕、不改退出语义、不额外接管）。
   * 幂等，返回 dispose。注意 error-log 的进程钩子保有 exit(1) 语义，
   * 调用方须在本钩子之后再装 error-log 钩子，确保留痕先于退出。
   */
  function installProcessHooks() {
    if (disposeProcessHooks) return disposeProcessHooks;
    const onRejection = () => observeAbnormalExit({ signal: SIGNALS.REJECTION });
    const onException = () => observeAbnormalExit({ signal: SIGNALS.UNCAUGHT });
    deps.processEmitter.on('unhandledRejection', onRejection);
    deps.processEmitter.on('uncaughtException', onException);
    disposeProcessHooks = () => {
      deps.processEmitter.off('unhandledRejection', onRejection);
      deps.processEmitter.off('uncaughtException', onException);
      disposeProcessHooks = null;
    };
    return disposeProcessHooks;
  }

  function getSnapshot() {
    return {
      observations: stats.observations,
      byReason: { ...stats.byReason },
      lastReasonCode: stats.lastReasonCode,
      lastFingerprint: stats.lastFingerprint,
    };
  }

  function healthShape() {
    return deps.health.buildHealthShape({
      service: 'external-supervisor',
      readiness: true,
      details: getSnapshot(),
    });
  }

  function resetStats() {
    stats.observations = 0;
    stats.byReason = Object.create(null);
    stats.lastReasonCode = null;
    stats.lastFingerprint = null;
    stats.lastHealthShape = null;
  }

  return {
    observeHeartbeatTimeout,
    observeAbnormalExit,
    installProcessHooks,
    getSnapshot,
    healthShape,
    resetStats,
  };
}

const singleton = createExternalSupervisor();

module.exports = {
  REASON_CODES,
  SIGNALS,
  createExternalSupervisor,
  observeHeartbeatTimeout: singleton.observeHeartbeatTimeout,
  observeAbnormalExit: singleton.observeAbnormalExit,
  installSupervisorProcessHooks: singleton.installProcessHooks,
  getSupervisorSnapshot: singleton.getSnapshot,
  supervisorHealthShape: singleton.healthShape,
  _resetSupervisorStats: singleton.resetStats,
};
