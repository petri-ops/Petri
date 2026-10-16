/**
 * BLOCK-185 — 冷启动退避重试原语。
 *
 * 冷启动竞态是复发缺陷类（welcome.tsx UI-373/UI-369「窗口先于后端就绪」同族）：
 * 单发请求在 dev 栈重启/整页 reload 时后端尚未监听 → 抛错 → 若直接归零即成
 * 「深链落空 / 选择项目无输入框」死态。本原语把「抛错才退避续跑、成功即停、
 * 取消即停」收敛为可机械测试的单一实现，供 handleOpenResult 等冷启动读路径复用。
 */

export interface BackoffRetryOptions {
  /** 各次尝试前的等待毫秒（首项通常为 0＝立即试）。 */
  delaysMs: readonly number[];
  /** 每次尝试前与等待后校验：返回 false 则中止（如请求序号已被更新的后续请求取代）。 */
  shouldContinue?: () => boolean;
  /** 等待被取消（如组件卸载）时中止。 */
  isCancelled?: () => boolean;
}

/**
 * 按退避序列反复调用 `attempt`，直到：
 *  - `attempt` 返回非 `retry` 的结果 → 返回该结果（成功或「确定性失败，不再试」）；
 *  - `attempt` 抛错 → 视为瞬态（后端未就绪/网络），退避后重试；
 *  - 序列耗尽 → 返回 `exhausted`。
 *
 * `attempt` 用返回 `{ retry: true }` 表达「取回了但判定需再试」，用 `{ retry: false, value }`
 * 表达终态（含「确认不存在」这种不该重试的失败），抛错专留给付诸重试的瞬态异常。
 */
export type RetryOutcome<T> =
  | { status: 'resolved'; value: T }
  | { status: 'not-found' }
  | { status: 'exhausted' };

export async function retryOnThrow<T>(
  attempt: () => Promise<RetryOutcome<T>>,
  { delaysMs, shouldContinue, isCancelled }: BackoffRetryOptions,
): Promise<RetryOutcome<T>> {
  for (let i = 0; i < delaysMs.length; i++) {
    const wait = delaysMs[i];
    if (shouldContinue && !shouldContinue()) return { status: 'exhausted' };
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    if (isCancelled && isCancelled()) return { status: 'exhausted' };
    if (shouldContinue && !shouldContinue()) return { status: 'exhausted' };
    try {
      const outcome = await attempt();
      if (outcome.status !== 'exhausted') return outcome;
      // attempt 主动判定「本轮无结果但可能后端未就绪」→ 继续退避
    } catch {
      /* 后端未就绪/瞬断：退避后重试 */
    }
  }
  return { status: 'exhausted' };
}
