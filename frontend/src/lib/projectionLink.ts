/**
 * BLOCK-159 P1-8/P1-9 — 投影链路状态与 resync 总线（仅投影环境有消费方）。
 *
 * 「易断」观感的前端半边：数据桥失败此前静默返空（手机端表现=数据变空/停在
 * 旧值，用户感知为卡死）；终端 EventSource 断线盲重试；手机锁屏回来各轮询器
 * 无齐发 resync。本模块提供两条总线：
 *  1. link 状态（online/offline）：数据桥 getJson 失败/成功上报，状态转移时
 *     通知订阅方（断连横幅 UI-482）。
 *  2. resync：visibilitychange 回前台派发 + 手动派发；终端桥订阅后重挂
 *     EventSource（服务端环形缓冲天然重放）。
 * 桌面（非投影）环境零行为：只有投影桥会调 mark*，监听器无人注册。
 */

export type ProjectionLinkStatus = 'online' | 'offline';

let status: ProjectionLinkStatus = 'online';
let installed = false;
const linkListeners = new Set<(status: ProjectionLinkStatus) => void>();
const resyncListeners = new Set<() => void>();

export function getProjectionLinkStatus(): ProjectionLinkStatus {
  return status;
}

export function onProjectionLinkChange(cb: (status: ProjectionLinkStatus) => void): () => void {
  linkListeners.add(cb);
  return () => linkListeners.delete(cb);
}

export function onProjectionResync(cb: () => void): () => void {
  resyncListeners.add(cb);
  return () => resyncListeners.delete(cb);
}

export function markProjectionBridgeFailure(_reason?: string): void {
  setStatus('offline');
}

export function markProjectionBridgeSuccess(): void {
  setStatus('online');
}

export function requestProjectionResync(): void {
  for (const cb of resyncListeners) {
    try { cb(); } catch { /* 单个订阅方异常不阻断其余 */ }
  }
}

function setStatus(next: ProjectionLinkStatus): void {
  if (status === next) return;
  status = next;
  for (const cb of linkListeners) {
    try { cb(next); } catch { /* 单个订阅方异常不阻断其余 */ }
  }
}

/** projection 环境注册回前台 resync（幂等；桌面环境不注册）。 */
export function installProjectionResyncListener(): void {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestProjectionResync();
  });
}
