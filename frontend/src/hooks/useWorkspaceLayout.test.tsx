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
import { deriveSummaryVisibility, useWorkspaceLayout } from './useWorkspaceLayout';

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
  trigger(): void { this.callback([], this); }
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
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  };
  if (typeof window.matchMedia !== 'function') {
    (window as { matchMedia?: unknown }).matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
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

  // UI-448 加映 v18 — 长会话丢事件自愈：最小化恢复/切回窗口时强制重测。
  // Electron 实测存在会话框宽度冻结在旧值的会话（resize 与 RO 整段错过，
  // 重挂载才自愈）；聚焦/可见性恢复是零成本重测信号。
  it('A6 窗口重新聚焦 / 页面恢复可见时强制重测', () => {
    const view = render(harness([{ id: 'chat', w: 700, h: 600 }]));
    expect(view.getByTestId('w').textContent).toBe('700');

    const node = view.getByTestId('frame-chat');
    node.dataset.w = '1300';
    // 不触发 RO、不触发 React render，仅派发聚焦/可见性事件
    act(() => window.dispatchEvent(new Event('focus')));
    expect(view.getByTestId('w').textContent).toBe('1300');

    node.dataset.w = '400';
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(view.getByTestId('w').textContent).toBe('400');
  });
});

// UI-448 加映 v18 — 宽窄形态派生（含视口钳制兜底）。
// 被测缺陷：Electron 实机 982px 竖窗下会话框测量冻结在旧宽 ≥1120，
// 摘要/侧聊恒卡钉住列区形态不转悬浮（用户实机截图取证）。
describe('deriveSummaryVisibility 宽窄派生（UI-448 加映 v18）', () => {
  it('视口 < 1120 恒悬浮——会话框是视口子集，钉住列区几何上不可能成立', () => {
    expect(deriveSummaryVisibility(1120, 1119)).toBe('float');
    // 冻结病态态：测量值停在旧宽 1518、窗口已收窄 → 兜底强制悬浮
    expect(deriveSummaryVisibility(1518, 982)).toBe('float');
    expect(deriveSummaryVisibility(0, 900)).toBe('float');
  });

  it('视口 ≥ 1120 维持原 UI-351 语义（0=未测量按 expanded、≥1120 钉住、其余悬浮）', () => {
    expect(deriveSummaryVisibility(0, 1920)).toBe('expanded');
    expect(deriveSummaryVisibility(1120, 1920)).toBe('expanded');
    expect(deriveSummaryVisibility(1518, 2530)).toBe('expanded');
    expect(deriveSummaryVisibility(918, 1920)).toBe('float');
  });
});
