/**
 * useWorkspaceLayout — UI-371 会话框测量回归门。
 *
 * 被测缺陷（实机实证，非推测）：`SessionFrameView` 在 chat（常驻）/ scheduled（条件挂载）
 * 两个互斥分支各渲染一个实例，二者**共用同一个测量 ref**。原实现用普通 refObject +
 * 一次性 effect（deps: []）挂 RO，于是：
 *   ① scheduled 实例卸载时 React 对该元素调用 `ref(null)` → refObject.current 被置空，
 *      而常驻的 chat 实例不会被重新赋值 → 此后测量恒 0 → `summaryVisibility` 恒
 *      'expanded'（摘要卡恒钉住并被 `max-width` 挤成窄条）；
 *   ② RO 只在挂载时 observe 一次 → 节点被替换后观察的是已移除的旧节点，永不触发，
 *      尺寸冻在旧值（只有 window resize 能救）。
 *
 * 本门用可记录的 ResizeObserver 桩 + 按 data-w/data-h 返回尺寸的
 * `getBoundingClientRect` 桩，把五条不变量锁死：
 *   A1 多实例并存取可见（最大宽度）实例；A2 条件实例卸载后宽度不回零；
 *   A3 全部卸载保持上一个已知值；A4 新节点被立刻测量且被 RO 观察（旧节点被清理）；
 *   A5 RO 回调触发即重测（覆盖「无 render 的尺寸变化」，如面板开合）。
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { WorkspacePanelsProvider } from '@/components/desktop/WorkspacePanelsContext';
import { useWorkspaceLayout } from './useWorkspaceLayout';

type FrameSpec = { id: string; w: number; h: number };

/** 可记录/可手动触发的 ResizeObserver 桩（happy-dom 自带的 RO 不可控）。 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  observed = new Set<Element>();
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    FakeResizeObserver.instances.push(this);
  }
  observe(target: Element): void { this.observed.add(target); }
  unobserve(target: Element): void { this.observed.delete(target); }
  disconnect(): void { this.observed.clear(); }
  trigger(): void { this.callback([], this as unknown as ResizeObserver); }
}

function Harness({ frames }: { frames: FrameSpec[] }): React.ReactElement {
  const layout = useWorkspaceLayout();
  return (
    <div>
      <output data-testid="w">{layout.sessionFrameWidth}</output>
      <output data-testid="h">{layout.sessionFrameHeight}</output>
      {frames.map((frame) => (
        <div
          key={frame.id}
          data-testid={`frame-${frame.id}`}
          data-w={frame.w}
          data-h={frame.h}
          ref={layout.sessionFrameRef}
        />
      ))}
    </div>
  );
}

/** useWorkspaceLayout 依赖 WorkspacePanelsProvider（上下文访问器无 provider 即抛错）。 */
const harness = (frames: FrameSpec[]) => (
  <WorkspacePanelsProvider>
    <Harness frames={frames} />
  </WorkspacePanelsProvider>
);

let originalRect: typeof Element.prototype.getBoundingClientRect;
let originalResizeObserver: unknown;

beforeEach(() => {
  FakeResizeObserver.instances = [];
  originalResizeObserver = (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FakeResizeObserver;
  originalRect = Element.prototype.getBoundingClientRect;
  // happy-dom 的布局全为 0：按 data-w/data-h 返回尺寸，让「测量」可断言。
  Element.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    const width = Number(this.dataset?.w ?? 0);
    const height = Number(this.dataset?.h ?? 0);
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  if (typeof window.matchMedia !== 'function') {
    (window as { matchMedia?: unknown }).matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = originalRect;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = originalResizeObserver;
  cleanup();
});

describe('useWorkspaceLayout 会话框测量（UI-371）', () => {
  it('A1 多实例并存时取可见（最大宽度）实例的尺寸', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }, { id: 'sched', w: 0, h: 0 }]));
    expect(view.getByTestId('w').textContent).toBe('700');
    expect(view.getByTestId('h').textContent).toBe('600');
  });

  it('A2 条件实例卸载（ref 回调收到 null）后宽度不回零 —— 缺陷①回归', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }, { id: 'sched', w: 0, h: 0 }]));
    expect(view.getByTestId('w').textContent).toBe('700');

    // scheduled 实例卸载：旧实现下 React 会把共用 refObject 置 null → 测量写 0
    view.rerender(harness([{ id: 'chat', w: 700, h: 600 }]));
    expect(view.getByTestId('w').textContent).toBe('700');
  });

  it('A3 全部实例卸载时保持上一个已知宽度（不把「暂无节点」写成 0）', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }]));
    expect(view.getByTestId('w').textContent).toBe('700');

    view.rerender(harness([]));
    expect(view.getByTestId('w').textContent).toBe('700');
  });

  it('A4 替换后的新节点立刻被测量且被 RO 观察，旧节点被清理 —— 缺陷②回归', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }]));
    const first = view.getByTestId('frame-chat');
    const observer = FakeResizeObserver.instances[0];
    expect(observer?.observed.has(first)).toBe(true);

    view.rerender(harness([{ id: 'next', w: 420, h: 500 }]));
    const next = view.getByTestId('frame-next');

    expect(view.getByTestId('w').textContent).toBe('420');
    expect(observer?.observed.has(next)).toBe(true);   // 旧实现永不 observe 新节点
    expect(observer?.observed.has(first)).toBe(false); // 已移除节点被 unobserve
  });

  it('A5 RO 回调触发即重测（覆盖面板开合等无 render 的尺寸变化）', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }]));
    const observer = FakeResizeObserver.instances[0];
    const node = view.getByTestId('frame-chat');

    node.dataset.w = '900';
    act(() => observer.trigger());

    expect(view.getByTestId('w').textContent).toBe('900');
  });
});
