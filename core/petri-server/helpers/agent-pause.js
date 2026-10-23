'use strict';

/**
 * helpers/agent-pause.js — BLOCK-249（Q4a）子代理暂停/恢复登记。
 *
 * 语义边界（写死，避免"暂停"被理解成冻结进程）：
 *  - 暂停只在**迭代边界**生效：当前工具调用跑完、下一轮模型调用之前停下；
 *  - 登记是**进程内内存**（重启即丢，任务会被启动清扫标为中断——不伪造跨重启暂停）；
 *  - 取消优先：暂停等待循环里 `shouldAbort()` 为真即返回，由循环正常收口；
 *  - 谁登记谁清：任务终态由调用方 `clear()`（幂等）。
 */

const pausedTaskIds = new Set();

function normalizeId(taskId) {
  return String(taskId || '').trim();
}

function requestPause(taskId) {
  const id = normalizeId(taskId);
  if (!id) return false;
  pausedTaskIds.add(id);
  return true;
}

function resumeTask(taskId) {
  return pausedTaskIds.delete(normalizeId(taskId));
}

function isPaused(taskId) {
  return pausedTaskIds.has(normalizeId(taskId));
}

function clear(taskId) {
  pausedTaskIds.delete(normalizeId(taskId));
}

/** 迭代边界等待：暂停中轮询；出现取消即返回（不吞取消）。 */
async function waitWhilePaused(taskId, shouldAbort, { pollMs = 250 } = {}) {
  const id = normalizeId(taskId);
  if (!id) return;
  while (pausedTaskIds.has(id)) {
    if (typeof shouldAbort === 'function' && shouldAbort()) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/** 仅供测试：清空登记（避免用例间串味）。 */
function __resetForTests() {
  pausedTaskIds.clear();
}

module.exports = {
  requestPause,
  resumeTask,
  isPaused,
  clear,
  waitWhilePaused,
  __resetForTests,
};
