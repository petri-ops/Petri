/**
 * useResponsivePanelCollapse — UI-479 侧栏自适应收起
 *
 * 需求（用户 2026-10-09）：窗口变小或左右侧栏自身宽度低于阈值时自动收起，
 * 且是「自然的过程」。历史语境：UI-341 加映二（2026-09-11）曾移除 compact
 * 自动收起，用户反馈根因是「侧栏自己消失 + 变宽不还原」——本实现对那条
 * 裁决做定向反转，必须带自动还原与迟滞带，且窄窗手动重开不被系统压回。
 *
 * 覆盖：deriveResponsivePanels 纯函数九态 + hook 行为四态（收起/不打架/还原/拖窄）。
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import {
  deriveResponsivePanels,
  useResponsivePanelCollapse,
  type ResponsivePanelFlags,
} from './useResponsivePanelCollapse';

const NO_FLAGS: ResponsivePanelFlags = { left: null, right: null };

function setViewport(px: number) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
  window.dispatchEvent(new Event('resize'));
}

describe('deriveResponsivePanels（纯函数）', () => {
  it('宽裕时零动作', () => {
    const out = deriveResponsivePanels(
      { viewportWidth: 1400, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out).toEqual({ leftOpen: true, rightOpen: true, flags: NO_FLAGS });
  });

  it('侧栏拖窄低于阈值 → 该侧收起（width），对侧不动', () => {
    const out = deriveResponsivePanels(
      { viewportWidth: 1400, leftOpen: true, leftWidth: 120, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out.leftOpen).toBe(false);
    expect(out.flags.left).toBe('width');
    expect(out.rightOpen).toBe(true);
    expect(out.flags.right).toBeNull();
  });

  it('中栏可用宽不足 → 先收右栏（viewport），够用即止', () => {
    // 1000 − 240 − 340 = 420 < 560 → 收右；收后 760 ≥ 560 → 左保留
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.flags.right).toBe('viewport');
    expect(out.leftOpen).toBe(true);
  });

  it('右栏收后仍不足 → 左栏也收', () => {
    // 1000 − 500 − 500 = 0 → 收右后 500 仍 <560 → 左也收
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 500, rightOpen: true, rightWidth: 500 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.leftOpen).toBe(false);
    expect(out.flags).toEqual({ left: 'viewport', right: 'viewport' });
  });

  it('compact（≤960 浮层区）不参与视口判定', () => {
    // 800 属 compact：侧栏是浮层不占中栏，视口触发必须跳过
    const out = deriveResponsivePanels(
      { viewportWidth: 800, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out).toEqual({ leftOpen: true, rightOpen: true, flags: NO_FLAGS });
  });

  it('还原带迟滞：中栏 630（<640）不还原，≥640 才还原', () => {
    const flags: ResponsivePanelFlags = { left: 'viewport', right: null };
    // vw 870：左收起（宽 240），右开（340）→ 中栏 530 <640 不还原
    expect(
      deriveResponsivePanels({ viewportWidth: 870, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags).leftOpen,
    ).toBe(false);
    // vw 900 → 中栏 560；还原左后 −240 = 320 <640 → 仍不还原（还原判据=还原后仍宽裕）
    expect(
      deriveResponsivePanels({ viewportWidth: 900, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags).leftOpen,
    ).toBe(false);
    // vw 1300 → 中栏 960；还原左后 720 ≥640 → 还原并清旗
    const restored = deriveResponsivePanels({ viewportWidth: 1300, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags);
    expect(restored.leftOpen).toBe(true);
    expect(restored.flags.left).toBeNull();
  });

  it('窄窗手动重开（manual-open-narrow）→ 视口触发不再压回', () => {
    // 右栏手动重开且中栏不足：manual 旗在场 → 不再自动收
    const flags: ResponsivePanelFlags = { left: null, right: 'manual-open-narrow' };
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.rightOpen).toBe(true);
    expect(out.flags.right).toBe('manual-open-narrow');
  });

  it('宽裕到两侧都放得下 → manual-open-narrow 旗清理（恢复自动行为）', () => {
    const flags: ResponsivePanelFlags = { left: null, right: 'manual-open-narrow' };
    const out = deriveResponsivePanels(
      { viewportWidth: 1400, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.flags.right).toBeNull();
    expect(out.rightOpen).toBe(true);
  });

  it('迟滞带内（560≤中栏<640）冻结：不新收也不还原', () => {
    const flags: ResponsivePanelFlags = { left: 'viewport', right: null };
    // vw 880：左收、右开 → 中栏 540…取 vw 900：中栏 560 ∈ [560,640) → 冻结
    const out = deriveResponsivePanels({ viewportWidth: 900, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags);
    expect(out.leftOpen).toBe(false);
    expect(out.flags).toEqual(flags);
  });
});

describe('useResponsivePanelCollapse（hook 行为）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  /**
   * 真状态 harness：开合用 useState（setter 触发真实重渲染，中间态成帧——
   * 纯对象 mock 会吞掉 hook 自身 setState 引发的渲染，转换检测失真）；
   * 宽度经外部可变 state + vi.fn 记账（useResizableColumns 的等价投影）。
   */
  function setup(initial: { vw: number; leftWidth: number; rightWidth: number }) {
    const state = { leftWidth: initial.leftWidth, rightWidth: initial.rightWidth };
    const setLeftWidth = vi.fn((n: number) => { state.leftWidth = n; });
    const setRightWidth = vi.fn((n: number) => { state.rightWidth = n; });
    const rigRef: {
      panels: { leftOpen: boolean; rightOpen: boolean };
      setLeftOpen: (v: boolean | ((p: boolean) => boolean)) => void;
      setRightOpen: (v: boolean | ((p: boolean) => boolean)) => void;
    } = { panels: { leftOpen: true, rightOpen: true }, setLeftOpen: () => {}, setRightOpen: () => {} };

    function Harness() {
      const [leftOpen, setLeftOpen] = React.useState(true);
      const [rightOpen, setRightOpen] = React.useState(true);
      rigRef.panels = { leftOpen, rightOpen };
      rigRef.setLeftOpen = setLeftOpen;
      rigRef.setRightOpen = setRightOpen;
      useResponsivePanelCollapse(
        { leftOpen, rightOpen, setLeftOpen, setRightOpen },
        {
          leftWidth: state.leftWidth,
          rightWidth: state.rightWidth,
          setLeftWidth,
          setRightWidth,
        },
      );
      return null;
    }

    setViewport(initial.vw);
    const view = render(<Harness />);
    return {
      /** 每帧换新对象——getter 取当前引用，避免捕获挂载期旧值。 */
      get panels() {
        return rigRef.panels;
      },
      rig: rigRef,
      state,
      setLeftWidth,
      setRightWidth,
      rerenderWith(vw: number) {
        setViewport(vw);
        view.rerender(<Harness />);
      },
    };
  }

  it('窗口缩到中栏不足 → 右栏自动收起；手动重开后不被压回；变宽后自动还原', () => {
    const rig = setup({ vw: 1400, leftWidth: 240, rightWidth: 340 });
    // 缩窗：1400 → 1000（中栏 420 <560）→ 右收
    act(() => rig.rerenderWith(1000));
    expect(rig.panels.rightOpen).toBe(false);
    expect(rig.panels.leftOpen).toBe(true);
    // 用户在窄窗手动重开右栏
    act(() => rig.rig.setRightOpen(true));
    expect(rig.panels.rightOpen).toBe(true);
    // 仍是窄窗，系统不得再次压回
    act(() => rig.rerenderWith(1000));
    expect(rig.panels.rightOpen).toBe(true);
    // 变宽到 1400：manual 旗清理（两侧都放得下），状态保持打开
    act(() => rig.rerenderWith(1400));
    expect(rig.panels.rightOpen).toBe(true);
    expect(rig.panels.leftOpen).toBe(true);
  });

  it('侧栏拖窄低于阈值 → 收起；手动重开时宽度回弹默认值（避免重开即再收）', () => {
    const rig = setup({ vw: 1400, leftWidth: 240, rightWidth: 340 });
    rig.state.leftWidth = 120; // 模拟拖窄（<140）
    act(() => rig.rerenderWith(1400));
    expect(rig.panels.leftOpen).toBe(false);
    // 用户手动重开
    act(() => rig.rig.setLeftOpen(true));
    expect(rig.panels.leftOpen).toBe(true);
    expect(rig.setLeftWidth).toHaveBeenCalledWith(240);
    // 重开后不再被反复收起
    act(() => rig.rerenderWith(1400));
    expect(rig.panels.leftOpen).toBe(true);
  });

  it('视口收起后变宽 → 自动还原', () => {
    const rig = setup({ vw: 1400, leftWidth: 240, rightWidth: 340 });
    act(() => rig.rerenderWith(1000)); // 右收
    expect(rig.panels.rightOpen).toBe(false);
    act(() => rig.rerenderWith(1300)); // 还原右后中栏 720 ≥640
    expect(rig.panels.rightOpen).toBe(true);
    expect(rig.panels.leftOpen).toBe(true);
  });

  it('用户手动收起（非自动）→ 变宽不自动弹回', () => {
    const rig = setup({ vw: 1400, leftWidth: 240, rightWidth: 340 });
    act(() => rig.rig.setLeftOpen(false)); // 用户手动关左栏
    act(() => rig.rerenderWith(1600));
    expect(rig.panels.leftOpen).toBe(false);
  });
});
