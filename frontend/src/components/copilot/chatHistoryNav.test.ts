import { describe, expect, it } from 'vitest'
import {
  INITIAL_NAV_STATE,
  stepHistoryNavigation,
  type HistoryNavState,
} from './chatHistoryNav'

// history 约定：最新在末尾，调用方会反序传入，故此处 index 越大越新。
const history = ['first', 'second', 'third']

describe('stepHistoryNavigation', () => {
  it('history 为空时原样返回输入，不改变导航态', () => {
    const { state, value } = stepHistoryNavigation([], INITIAL_NAV_STATE, 'up', 'draft')
    expect(state).toEqual(INITIAL_NAV_STATE)
    expect(value).toBe('draft')
  })

  it('未导航且输入非空时按 ↑ 不触发（保护草稿）', () => {
    const { state, value } = stepHistoryNavigation(history, INITIAL_NAV_STATE, 'up', 'my draft')
    expect(state).toEqual(INITIAL_NAV_STATE)
    expect(value).toBe('my draft')
  })

  it('空输入按 ↑ 从最新一条已发送消息开始回溯', () => {
    const { state, value } = stepHistoryNavigation(history, INITIAL_NAV_STATE, 'up', '')
    expect(state.index).toBe(2) // 'third'
    expect(value).toBe('third')
  })

  it('重复按 ↑ 向更旧走', () => {
    let state: HistoryNavState = { index: 2, draft: '' }
    let r = stepHistoryNavigation(history, state, 'up', 'third')
    expect(r.state.index).toBe(1)
    expect(r.value).toBe('second')
    r = stepHistoryNavigation(history, r.state, 'up', 'second')
    expect(r.state.index).toBe(0)
    expect(r.value).toBe('first')
  })

  it('已是最旧再按 ↑ 不再前进', () => {
    const state: HistoryNavState = { index: 0, draft: '' }
    const r = stepHistoryNavigation(history, state, 'up', 'first')
    expect(r.state.index).toBe(0)
    expect(r.value).toBe('first')
  })

  it('按 ↓ 向更新走，越过最新项还原草稿并退出导航', () => {
    let state: HistoryNavState = { index: 0, draft: 'my draft' }
    let r = stepHistoryNavigation(history, state, 'down', 'first')
    expect(r.state.index).toBe(1)
    expect(r.value).toBe('second')
    r = stepHistoryNavigation(history, r.state, 'down', 'second')
    expect(r.state.index).toBe(2)
    expect(r.value).toBe('third')
    r = stepHistoryNavigation(history, r.state, 'down', 'third')
    expect(r.state).toEqual(INITIAL_NAV_STATE)
    expect(r.value).toBe('my draft')
  })

  it('未导航时按 ↓ 无操作', () => {
    const { state, value } = stepHistoryNavigation(history, INITIAL_NAV_STATE, 'down', 'draft')
    expect(state).toEqual(INITIAL_NAV_STATE)
    expect(value).toBe('draft')
  })
})
