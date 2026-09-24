import { getBridge } from '@/lib/desktopBridge';
import type { SkillExecution } from './types';

// BLOCK-92 Wave B-7 — Skill 执行监控机制外迁（原 useSkillStore.ts，纯搬运零行为变化）：
// 2s polling（真值兜底）+ PHASE 1 G0 UI-157 事件驱动 wakeup（≤100ms 感知）+
// BLOCK-4 E2 deep-equal 变更判定。终态时清理订阅避免泄漏。

function _startPolling(
  executionId: string,
  onUpdate: (execution: SkillExecution) => void
): void {
  if (_pollIntervals.has(executionId)) return;

  const interval = setInterval(() => { void (async () => {
    const bridge = getBridge('skills');
    if (!bridge) {
      clearInterval(interval);
      _pollIntervals.delete(executionId);
      return;
    }

    try {
      const result = await bridge.getExecution(executionId);
      if (result.ok && result.execution) {
        const exec: SkillExecution = {
          executionId: result.execution.executionId,
          skillId: result.execution.skillId,
          status: result.execution.status,
          startedAt: result.execution.startedAt
            ? new Date(result.execution.startedAt)
            : undefined,
          completedAt: result.execution.completedAt
            ? new Date(result.execution.completedAt)
            : undefined,
          result: result.execution.result,
          error: result.execution.error,
        };
        onUpdate(exec);

        // Stop polling on terminal state
        if (
          exec.status === 'completed' ||
          exec.status === 'failed'
        ) {
          clearInterval(interval);
          _pollIntervals.delete(executionId);
          // BLOCK-3 P2 A1: 终态同步清 onProgress 订阅，避免多 execution 切换后
          // 残留 wakeup callback 继续接收 progress 事件触发重复 IPC。
          _unsubscribeProgressWakeup(executionId);
        }
      }
    } catch {
      clearInterval(interval);
      _pollIntervals.delete(executionId);
      // BLOCK-3 P2 A1: 异常路径同样清 onProgress 订阅
      _unsubscribeProgressWakeup(executionId);
    }
  })(); }, 2000);

  _pollIntervals.set(executionId, interval);
}

const _pollIntervals: Map<string, ReturnType<typeof setInterval>> = new Map();

function _stopAllPolling(): void {
  _pollIntervals.forEach((interval) => clearInterval(interval));
  _pollIntervals.clear();
}

// PHASE 1 G0 UI-157：event-driven wakeup（取代单纯 2s polling）。
// 订阅主进程 webContents.send('skills:progress') 推送，过滤到当前
// executionId 时立即调一次 bridge.getExecution() 拉完整 snapshot。
// 与 _startPolling 并行运行（polling 2s 是真值兜底，wakeup 把感知延迟从
// ≤2s 降到 ≤100ms；终态时清理订阅避免泄漏）。
const _progressUnsubs: Map<string, () => void> = new Map();

// 自动派生自 d.ts onProgress 回调参数的真实类型（BLOCK-4 D1）
type SkillsBridge = NonNullable<ReturnType<typeof getBridge<'skills'>>>;
type SkillsProgressPayload = Parameters<SkillsBridge['onProgress']>[0] extends (p: infer P) => any ? P : never;

function _subscribeProgressWakeup(
  executionId: string,
  onUpdate: (execution: SkillExecution) => void
): void {
  if (_progressUnsubs.has(executionId)) return;
  const bridge = getBridge('skills');
  if (!bridge || typeof bridge.onProgress !== 'function') return;
  const unsubscribe = bridge.onProgress((payload: SkillsProgressPayload) => {
    // BLOCK-4 B4: payload 缺 executionId 时 console.warn 便于诊断
    if (!payload || typeof payload !== 'object') {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[useSkillStore] skills:progress payload missing or not object:', payload);
      }
      return;
    }
    if (payload.executionId !== executionId) return;
    void (async () => {
      try {
        const result = await bridge.getExecution(executionId);
        if (result.ok && result.execution) {
          onUpdate({
            executionId: result.execution.executionId,
            skillId: result.execution.skillId,
            status: result.execution.status,
            startedAt: result.execution.startedAt
              ? new Date(result.execution.startedAt)
              : undefined,
            completedAt: result.execution.completedAt
              ? new Date(result.execution.completedAt)
              : undefined,
            result: result.execution.result,
            error: result.execution.error,
          });
        }
      } catch {
        /* 静默兜底：polling 仍会按 2s 节奏兜底真值 */
      }
    })();
  });
  _progressUnsubs.set(executionId, unsubscribe);
}

// BLOCK-4 E2: deep-equal 比较，避免无变化 re-render；返回 true 表示有变化
function _executionsChanged(prev: SkillExecution, next: SkillExecution): boolean {
  if (prev === next) return false;
  if (prev.status !== next.status) return true;
  if (prev.completedAt?.getTime() !== next.completedAt?.getTime()) return true;
  if (prev.error !== next.error) return true;
  if (prev.result !== next.result) return true;
  if (prev.startedAt?.getTime() !== next.startedAt?.getTime()) return true;
  return false;
}

function _unsubscribeProgressWakeup(executionId: string): void {
  const unsub = _progressUnsubs.get(executionId);
  if (unsub) {
    unsub();
    _progressUnsubs.delete(executionId);
  }
}

function _stopAllProgressWakeups(): void {
  _progressUnsubs.forEach((unsub) => unsub());
  _progressUnsubs.clear();
}

// Test-only helper 出口：BLOCK-4 PHASE 2 G5 断言 useEffect 清理订阅用
//（内部 Map 保持模块私有，getter 是唯一 test-facing surface）。
export function __getProgressUnsubsSize(): number {
  return _progressUnsubs.size;
}

export {
  _startPolling,
  _stopAllPolling,
  _subscribeProgressWakeup,
  _executionsChanged,
  _unsubscribeProgressWakeup,
  _stopAllProgressWakeups,
};
