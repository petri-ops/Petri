// UI-MODELCFG-1 / UI-696 / UI-COLLAPSE-2 契约：
// ① 模型菜单内可就地用滑条切换上下文窗口与思考强度（减少设置页层级）
// ② 能力位未声明时控件常驻灰显并给出原因，写回结果可见
// ③ 折叠时机从「每条消息 pending 结束即折叠」改为「本轮 run 内统一展开、run 结束统一折叠」
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ModelMenu } from './ModelMenu';
import { contextWindowScale } from '@/lib/context-window-options';
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

describe('UI-696 模型菜单内快捷配置（滑条形态）', () => {
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
    expect(screen.getByTestId('model-menu-context-window').getAttribute('data-value')).toBe('64000');
    expect(screen.getByTestId('model-menu-thinking-level').getAttribute('data-level')).toBe('standard');
    expect(screen.getByText('上下文窗口')).toBeTruthy();
    expect(screen.getByText('思考强度')).toBeTruthy();
  });

  it('拖动刻度条与分段控件触发回调（不再需要进设置页）', () => {
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
    fireEvent.change(screen.getByTestId('model-menu-context-window'), { target: { value: '2' } });
    expect(onCtx).toHaveBeenCalledWith(128000);
    fireEvent.change(screen.getByTestId('model-menu-thinking-level'), { target: { value: '2' } });
    expect(onThink).toHaveBeenCalledWith('high');
  });

  it('点击档位刻度也能切换思考强度', () => {
    const onThink = vi.fn();
    renderMenu({
      thinkingLevel: 'standard',
      thinkingLevelOptions: ['off', 'standard', 'high'],
      onChangeThinkingLevel: onThink,
    });
    fireEvent.click(screen.getByRole('button', { name: '思考强度：高' }));
    expect(onThink).toHaveBeenCalledWith('high');
  });

  it('能力位未声明时控件常驻灰显并给出原因（不再整块消失）', () => {
    renderMenu({
      thinkingLevel: 'standard',
      thinkingLevelOptions: ['off', 'standard', 'high'],
      reasoningSupported: false,
      onChangeThinkingLevel: noop,
    });
    expect(screen.getByTestId('model-menu-thinking-level').hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/未声明思考能力/)).toBeTruthy();
  });

  it('快捷写回结果可见（失败不静默）', () => {
    renderMenu({
      contextWindowOptions: [32000, 64000],
      quickNotice: { text: '保存失败，已回退到服务端值', tone: 'error' },
    });
    expect(screen.getByTestId('model-menu-quick-notice').textContent).toContain('保存失败');
  });

  it('未提供选项时不渲染快捷区（零打扰）', () => {
    renderMenu({ contextWindowOptions: [], thinkingLevelOptions: [] });
    expect(screen.queryByTestId('model-menu-quick')).toBeNull();
  });

  it('历史自定义窗口值不在档位表里时并入刻度轴，不被静默改写', () => {
    expect(contextWindowScale(256000, [32000, 64000, 128000])).toEqual([32000, 64000, 128000, 256000]);
    expect(contextWindowScale(undefined, [32000, 64000])).toEqual([32000, 64000]);
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
