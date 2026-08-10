// 聊天输入框的键盘历史回溯（纯逻辑，便于单测）。
//
// 行为约定（参考终端 / 常见聊天框的 ↑/↓ 历史）：
// - 历史源是「已发送的用户消息」，由调用方从会话消息里过滤 role==='user' 后反序传入
//   （最新在前）。本模块不持有历史，只负责在给定 history 数组上做索引导航。
// - 空输入或未处于导航态时按 ↑：从该会话最新一条已发送消息开始回溯（先保存当前草稿）。
// - 非空且未导航时按 ↑：不打断正在编辑的多行草稿，放行光标（默认行为）。
// - 导航态下 ↑ 向更旧走，↓ 向更新走；↓ 越过最新项时还原进入导航前保存的草稿。
// - 到达最旧项再按 ↑ 不再前进；未导航态按 ↓ 无操作。

export interface HistoryNavState {
  /** null = 未进入导航（输入框即实时草稿）；否则为 history 数组下标 */
  index: number | null
  /** 进入导航时捕获的实时草稿，离开历史（↓ 越界）时还原 */
  draft: string
}

export const INITIAL_NAV_STATE: HistoryNavState = { index: null, draft: '' }

export function stepHistoryNavigation(
  history: string[],
  state: HistoryNavState,
  direction: 'up' | 'down',
  currentInput: string,
): { state: HistoryNavState; value: string } {
  const len = history.length
  if (len === 0) return { state, value: currentInput }

  if (direction === 'up') {
    // 未在导航态：仅当输入为空才进入导航，保护正在编辑的草稿不被 ↑ 覆盖。
    if (state.index === null) {
      if (currentInput.trim() !== '') return { state, value: currentInput }
      const idx = len - 1
      return { state: { index: idx, draft: currentInput }, value: history[idx] }
    }
    if (state.index <= 0) return { state, value: currentInput } // 已是最旧
    const idx = state.index - 1
    return { state: { index: idx, draft: state.draft }, value: history[idx] }
  }

  // direction === 'down'
  if (state.index === null) return { state, value: currentInput } // 未导航，无操作
  const idx = state.index + 1
  if (idx >= len) {
    // 越过最新项 → 还原进入导航前保存的草稿，退出导航态。
    return { state: INITIAL_NAV_STATE, value: state.draft }
  }
  return { state: { index: idx, draft: state.draft }, value: history[idx] }
}
