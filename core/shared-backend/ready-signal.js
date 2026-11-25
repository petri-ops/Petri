/**
 * Petri shared backend — Ready Signal (BLOCK-520 P2 / OB-009)
 *
 * 显式 ready 事件：后端/测试实例就绪时 signalReady，等待方经 onReady 立即被唤醒，
 * 不必靠 1s 轮询。纯内存、零新依赖、零副作用；轮询 fallback 由调用方保留，
 * 故本模块缺席/漏信号也不会让等待方悬挂（fail-open 语义）。
 */

const ready = new Map(); // key -> { at, info }
const listeners = new Map(); // key -> Set<fn>

function onReady(key, fn) {
  if (typeof fn !== 'function') return () => {};
  const k = String(key);
  let set = listeners.get(k);
  if (!set) {
    set = new Set();
    listeners.set(k, set);
  }
  set.add(fn);
  return function off() {
    set.delete(fn);
  };
}

function signalReady(key, info = {}) {
  const k = String(key);
  ready.set(k, { at: new Date().toISOString(), ...info });
  const set = listeners.get(k);
  if (!set) return;
  for (const fn of [...set]) {
    try {
      fn(info);
    } catch {
      // 监听器故障不影响其它等待方（观测面 fail-open）
    }
  }
}

function isReady(key) {
  return ready.has(String(key));
}

function getReadyInfo(key) {
  const entry = ready.get(String(key));
  return entry ? { ...entry } : null;
}

function resetReadySignals() {
  ready.clear();
  listeners.clear();
}

module.exports = { onReady, signalReady, isReady, getReadyInfo, resetReadySignals };
