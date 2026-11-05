// UI-MODELCFG-1 / UI-COLLAPSE-2 契约：
// ① 模型菜单内可就地切换上下文窗口与思考强度（减少设置页层级）
// ② 折叠时机从「每条消息 pending 结束即折叠」改为「本轮 run 内统一展开、run 结束统一折叠」
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ModelMenu } from './ModelMenu';
import { isMessageInActiveRun, resolveActiveRunStartIndex } from './activeRunWindow';

afterEach(cleanup);

const noop = () => {};

function renderMenu(overrides: Partial<React.ComponentProps<typeof ModelMenu>> = {}) {
  return render(
    <ModelMenu
      mode="all"
      groups={[]}
      selectedGroup={undefined}
      activeModelId="preset_a"
      summary={{ level: 'ok', text: '' } as unknown as React.ComponentProps<typeof ModelMenu>['summary']}
      onClose={noop}
      onPickSupplier={noop}
      onPickModel={noop}
      {...overrides}
    />,
  );
}

describe('UI-MODELCFG-1 模型菜单内快捷配置', () => {
  it('渲染上下文窗口与思考强度两项，默认值来自当前模型/会话', () => {
    renderMenu({
      contextWindow: 64000,
      contextWindowOptions: [32000, 64000, 128000],
      onChangeContextWindow: noop,
      thinkingLevel: 'standard',
      thinkingLevelOptions: ['off', 'standard', 'high'],
      onChangeThinkingLevel: noop,
    });
    expect(screen.getByTestId('model-menu-quick')).toBeTruthy();
    expect((screen.getByTestId('model-menu-context-window') as HTMLSelectElement).value).toBe('64000');
    expect((screen.getByTestId('model-menu-thinking-level') as HTMLSelectElement).value).toBe('standard');
  });

  it('切换上下文窗口与思考强度触发回调（不再需要进设置页）', () => {
    const onCtx = vi.fn();
    const onThink = vi.fn();
    renderMenu({
      contextWindow: 64000,
      contextWindowOptions: [32000, 64000, 128000],
      onChangeContextWindow: onCtx,
      thinkingLevel: 'standard',
      thinkingLevelOptions: ['off', 'standard', 'high'],
      onChangeThinkingLevel: onThink,
    });
    fireEvent.change(screen.getByTestId('model-menu-context-window'), { target: { value: '128000' } });
    expect(onCtx).toHaveBeenCalledWith(128000);
    fireEvent.change(screen.getByTestId('model-menu-thinking-level'), { target: { value: 'high' } });
    expect(onThink).toHaveBeenCalledWith('high');
  });

  it('未提供选项时不渲染快捷区（模型不支持思考档时零打扰）', () => {
    renderMenu({ contextWindowOptions: [], thinkingLevelOptions: [] });
    expect(screen.queryByTestId('model-menu-quick')).toBeNull();
  });
});

describe('UI-COLLAPSE-2 折叠时机', () => {
  const messages = [
    { role: 'user' },
    { role: 'assistant' },
    { role: 'assistant' },
    { role: 'user' },
    { role: 'assistant' },
  ];

  it('run 进行中：本轮 user 之后的消息都属于 active run（统一展开）', () => {
    const start = resolveActiveRunStartIndex(messages, true);
    expect(start).toBe(3);
    expect(isMessageInActiveRun(messages, true, 4)).toBe(true);
    expect(isMessageInActiveRun(messages, true, 1)).toBe(false);
  });

  it('run 结束：不再有 active run，全部按 settled 折叠（统一折叠）', () => {
    expect(resolveActiveRunStartIndex(messages, false)).toBe(-1);
    for (let i = 0; i < messages.length; i += 1) {
      expect(isMessageInActiveRun(messages, false, i)).toBe(false);
    }
  });

  it('负测：历史轮次不因本轮 run 而炸开（只展开本轮窗口）', () => {
    // index 2 属上一轮（最后一个 user 之前）→ 保持折叠；
    // 本轮若有多条 assistant（如 index 4/5 连续输出）→ 全部保持展开。
    const longRun = [...messages, { role: 'assistant' }];
    expect(isMessageInActiveRun(longRun, true, 2)).toBe(false);
    expect(isMessageInActiveRun(longRun, true, 4)).toBe(true);
    expect(isMessageInActiveRun(longRun, true, 5)).toBe(true);
  });
});
