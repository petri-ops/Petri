'use strict';

/**
 * helpers/workflow-runner.js — BLOCK-262（Q4b）工作流执行 runner。
 *
 * 定位：把沙箱脚本（workflow-sandbox.js 装载出的 run 函数）驱动成一次可审计的
 * 多代理运行。**agent() 唯一执行路径 = 注入的 deps.launchSubAgent**（生产侧 =
 * spawn-agent-tools.js 导出的 launchSubAgent），绝不旁路新写 agent 循环（红线）。
 *
 * 依赖全部经 deps 注入（launchSubAgent / waitAgentTerminal / requestCancellation），
 * 本模块加载期零 require db/agent-store —— 测试可全 mock 驱动（block262 测试形态）。
 *
 * 确定性：stepKey 由「phase 路径 + 原语调用序/slot」派生（AsyncLocalStorage 传递
 * parallel slot），同脚本同 args 产生同键序列——resume 前缀复用的身份基础。
 */

const { AsyncLocalStorage } = require('node:async_hooks');
const { hashWorkflowSource, hashWorkflowArgs } = require('./workflow-script');
const { loadWorkflowModule } = require('./workflow-sandbox');
const journal = require('./workflow-journal');

const MAX_PROMPT_CHARS = 16 * 1024;
const MAX_LOG_CHARS = 2 * 1024;
const MAX_PHASE_NAME = 80;

function makeSemaphore(limit) {
  let active = 0;
  const queue = [];
  return {
    async acquire() {
      if (active < limit) {
        active += 1;
        return;
      }
      await new Promise((resolve) => queue.push(resolve));
      active += 1;
    },
    release() {
      active -= 1;
      const next = queue.shift();
      if (next) next();
    },
  };
}

function newRunId() {
  // runId 只作目录名/追溯，不进确定性路径（执行序列只由 scriptHash+argsHash+seed 决定）
  return `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 启动一次工作流运行。
 * @param {object} params
 *   source：脚本源码；args：入参（进 argsHash）；userId；deps：{launchSubAgent,
 *   waitAgentTerminal, requestCancellation}；root：workflows 目录；
 *   resumeFromRunId：可选，前缀复用来源。
 * @returns {{ runId, promise: Promise<{status, returned?, error?, runId}>, cancel: () => Promise<void> }}
 */
function startWorkflowRun({ source, args, userId, deps, root, resumeFromRunId = null }) {
  const scriptHash = hashWorkflowSource(source);
  const argsHash = hashWorkflowArgs(args);
  const runId = newRunId();
  const seed = parseInt(argsHash.slice(0, 8), 16) ^ 0x9e3779b9;

  const state = {
    status: 'running',
    cancelled: false,
    startedAgents: 0,
    doneSteps: 0,
    activeAgentIds: new Set(),
    seq: 0,
    phaseCounters: new Map(), // `${phasePath}/${kind}` -> next seq
  };
  const als = new AsyncLocalStorage();
  const semaphore = makeSemaphore(1); // 占位，装载 meta 后按 concurrency 重建
  let concurrencySemaphore = semaphore;

  const cancelledAgentIds = [];
  let timeoutHandle = null;

  const nextSeq = () => {
    state.seq += 1;
    return state.seq;
  };

  function phasePathNow() {
    const store = als.getStore() || {};
    return store.phasePath || '';
  }

  function stepKeyFor(kind) {
    const store = als.getStore() || {};
    const base = store.phasePath || '';
    const slot = store.slots && store.slots[kind] !== undefined ? `@${store.slots[kind]}` : null;
    const counterKey = `${base}/${kind}`;
    let counter;
    if (slot !== null) {
      counter = slot;
    } else {
      counter = (state.phaseCounters.get(counterKey) || 0) + 1;
      state.phaseCounters.set(counterKey, counter);
    }
    return `${base}/${kind}${slot !== null ? '' : ':'}${slot !== null ? '' : counter}`.replace('//', '/');
  }

  function record(kind, fields) {
    const entry = {
      seq: nextSeq(),
      stepKey: fields.stepKey || '',
      kind,
      scriptHash,
      argsHash,
      at: entryNow(),
      ...fields,
    };
    delete entry.at; // at 由 seq 承担（虚拟时序），避免再引时钟
    const res = journal.appendJournalLine(root, runId, entry);
    if (!res.ok) {
      // journal 是 resume 的唯一血缘源：写失败不允许静默继续
      state.cancelled = true;
      state.status = 'failed';
      state.error = 'journal_write_failed';
    }
    return entry;
  }

  // 虚拟时钟（journal 不用；保留给 sandbox determinism 的宿主注入形态一致）
  function entryNow() {
    return 0;
  }

  async function agentImpl(opts = {}) {
    const stepKey = stepKeyFor('agent');
    if (state.cancelled) return { ok: false, error: 'workflow_cancelled' };

    const prompt = String(opts.prompt || '');
    if (prompt.length > MAX_PROMPT_CHARS) {
      record('agent', { stepKey, status: 'rejected', errorHead: 'prompt_too_long' });
      return { ok: false, error: 'prompt_too_long' };
    }

    // resume 前缀命中：复用旧结果，不启动
    if (resumeTable.has(stepKey)) {
      const hit = resumeTable.get(stepKey);
      record('agent', { stepKey, status: hit.status, agentId: hit.agentId, summaryHead: hit.summary, reusedFrom: resumeFromRunId });
      return { ok: hit.status === 'completed', status: hit.status, summary: hit.summary, agentId: hit.agentId };
    }

    if (state.startedAgents >= meta.budget.maxAgents) {
      record('agent', { stepKey, status: 'rejected', errorHead: 'budget_exhausted' });
      return { ok: false, error: 'budget_exhausted' };
    }
    if (state.doneSteps >= meta.budget.maxSteps) {
      record('agent', { stepKey, status: 'rejected', errorHead: 'budget_exhausted' });
      return { ok: false, error: 'budget_exhausted' };
    }

    await concurrencySemaphore.acquire();
    try {
      if (state.cancelled) return { ok: false, error: 'workflow_cancelled' };
      state.startedAgents += 1;
      state.doneSteps += 1;

      const spawn = deps.launchSubAgent({
        userContent: prompt,
        role: opts.role || undefined,
        goals: Array.isArray(opts.goals) ? opts.goals : undefined,
      });
      if (!spawn || spawn.ok === false) {
        record('agent', { stepKey, status: 'failed', errorHead: (spawn && spawn.error) || 'spawn_failed' });
        return { ok: false, error: (spawn && spawn.error) || 'spawn_failed' };
      }
      const agentId = spawn.agentId;
      state.activeAgentIds.add(agentId);

      let terminal;
      try {
        terminal = await deps.waitAgentTerminal(agentId);
      } catch (e) {
        terminal = { status: 'failed', summary: e && e.message ? e.message : String(e) };
      }
      state.activeAgentIds.delete(agentId);
      const status = String((terminal && terminal.status) || 'completed');
      // 每步骤一行（plan §2.4）：settle 时写终态行（running 过程态不落 journal）
      record('agent', {
        stepKey,
        status,
        agentId,
        summaryHead: String((terminal && terminal.summary) || '').slice(0, 400),
      });
      return { ok: status === 'completed', status, summary: (terminal && terminal.summary) || '', agentId };
    } finally {
      concurrencySemaphore.release();
    }
  }

  async function parallelImpl(fns, options = {}) {
    const list = Array.isArray(fns) ? fns : [];
    const slotKind = 'agent';
    return Promise.all(
      list.map((fn, index) =>
        als.run({ ...(als.getStore() || {}), slots: { ...(als.getStore() || {}).slots, [slotKind]: index } }, () =>
          Promise.resolve().then(() => fn())
        )
      )
    );
  }

  async function pipelineImpl(fns) {
    const list = Array.isArray(fns) ? fns : [];
    let value;
    for (const fn of list) {
      value = await Promise.resolve(fn(value));
    }
    return value;
  }

  async function phaseImpl(name, fn) {
    const label = String(name || '').slice(0, MAX_PHASE_NAME);
    const parent = als.getStore() || {};
    const phasePath = parent.phasePath ? `${parent.phasePath}/${label}` : label;
    try {
      const out = await als.run({ ...parent, phasePath, slots: {} }, () => fn());
      // 每步骤一行：phase 完成时写一行（过程态不落 journal）
      record('phase', { stepKey: `${phasePath}`, label, status: 'completed' });
      return out;
    } catch (e) {
      record('phase', { stepKey: `${phasePath}`, label, status: 'failed', errorHead: String(e && e.message ? e.message : e).slice(0, 200) });
      throw e;
    }
  }

  function logImpl(...parts) {
    const text = parts
      .map((p) => {
        if (typeof p === 'string') return p;
        try {
          return JSON.stringify(p);
        } catch {
          return String(p);
        }
      })
      .join(' ')
      .slice(0, MAX_LOG_CHARS);
    record('log', { stepKey: `${phasePathNow()}/log:${nextSeq()}`, text });
  }

  const budgetView = {
    get maxAgents() {
      return meta.budget.maxAgents;
    },
    get startedAgents() {
      return state.startedAgents;
    },
    get maxSteps() {
      return meta.budget.maxSteps;
    },
    get doneSteps() {
      return state.doneSteps;
    },
    get cancelled() {
      return state.cancelled;
    },
  };

  // ── 装载（沙箱）───────────────────────────────────────────
  const host = {
    agent: agentImpl,
    parallel: parallelImpl,
    pipeline: pipelineImpl,
    phase: phaseImpl,
    log: logImpl,
    get budget() {
      return budgetView;
    },
    console: { log: logImpl },
  };

  const loaded = loadWorkflowModule(source, { host, seed });
  let meta;
  if (!loaded.ok) {
    const result = { status: 'failed', error: `${loaded.error}: ${loaded.message || (loaded.diagnostics || []).join('; ')}`, runId };
    return {
      runId,
      promise: Promise.resolve(result),
      cancel: async () => {},
      _loadError: loaded,
    };
  }
  meta = loaded.meta;
  concurrencySemaphore = makeSemaphore(meta.concurrency);

  // ── resume 前缀表 ─────────────────────────────────────────
  let resumeTable = new Map();
  if (resumeFromRunId) {
    resumeTable = journal.buildResumeTable(root, resumeFromRunId, { scriptHash, argsHash });
  }

  // ── run.json 初始落盘 ─────────────────────────────────────
  journal.writeRunMeta(root, runId, {
    runId,
    userId,
    status: 'running',
    meta,
    scriptHash,
    argsHash,
    args: args === undefined ? null : args,
    scriptSource: String(source),
    resumeFromRunId,
    createdAt: new Date().toISOString(),
  });

  // ── 执行 ─────────────────────────────────────────────────
  const promise = (async () => {
    timeoutHandle = setTimeout(() => {
      state.cancelled = true;
      state.status = 'cancelled';
      for (const agentId of state.activeAgentIds) {
        try {
          deps.requestCancellation(agentId);
        } catch {}
      }
    }, meta.budget.timeoutMs);
    if (typeof timeoutHandle.unref === 'function') timeoutHandle.unref();

    let returned;
    try {
      returned = await loaded.run(args === undefined ? {} : args);
    } catch (e) {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const errorText = e && e.message ? e.message : String(e);
      journal.writeRunMeta(root, runId, {
        runId,
        userId,
        status: 'failed',
        meta,
        scriptHash,
        argsHash,
        args: args === undefined ? null : args,
        resumeFromRunId,
        error: errorText,
        finishedAt: new Date().toISOString(),
      });
      return { status: 'failed', error: errorText, runId };
    }
    if (timeoutHandle) clearTimeout(timeoutHandle);

    // 取消在脚本 settle 后仍以 cancelled 终态优先呈现（计划 §2.3）
    const finalStatus = state.cancelled ? 'cancelled' : 'completed';
    journal.writeRunMeta(root, runId, {
      runId,
      userId,
      status: finalStatus,
      meta,
      scriptHash,
      argsHash,
      args: args === undefined ? null : args,
      resumeFromRunId,
      finishedAt: new Date().toISOString(),
    });
    return { status: finalStatus, returned, runId };
  })();

  return {
    runId,
    promise,
    cancel: async () => {
      state.cancelled = true;
      for (const agentId of Array.from(state.activeAgentIds)) {
        try {
          const requested = deps.requestCancellation(agentId);
          if (requested && typeof requested.then === 'function') await requested;
        } catch {}
      }
    },
  };
}

module.exports = {
  startWorkflowRun,
  makeSemaphore,
};
