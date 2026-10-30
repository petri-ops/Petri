/**
 * useResponsivePanelCollapse — UI-479 侧栏自适应收起 + UI-629 中栏优先宽度模型
 *
 * UI-479（2026-10-09）：窗口变小/侧栏拖窄自动收起，带自动还原、迟滞带、
 * 手动优先（manual-open-narrow 哨兵）。
 *
 * UI-629（BLOCK-321c，2026-10-29 用户裁决「固定中间栏宽度，除非手动调整」）：
 *   ① 中栏保底 560→760→420（2026-10-30 修订；迟滞还原 640→840→500）；
 *   ② gap 计入计算（.workspaceSessionLayout 两侧 gap 共 40px，原计算漏掉）；
 *   ③ 让位规则：一侧挂手动哨兵、另一侧可让 → 收**非哨兵侧**（右先 tie-break），
 *      不再因哨兵放任中栏被挤穿；两侧都哨兵 → 尊重用户显式选择。
 *   ④ 拖宽把手钳制（调用点）：侧栏不得拖过「剩余空间−中栏保底」。
 *
 * 覆盖：deriveResponsivePanels 纯函数 + hook 行为。
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
  it('宽裕时零动作（1400 双栏默认：中栏 780 ≥420）', () => {
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

  it('UI-630 折叠阈值上调 240：右栏拖到 200（旧阈值 140 不触发）→ 快速折叠', () => {
    const out = deriveResponsivePanels(
      { viewportWidth: 1400, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 200 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.flags.right).toBe('width');
    expect(out.leftOpen).toBe(true);
  });

  it('中栏可用宽不足 → 先收右栏（viewport），够用即止（1000−580−40=380<420）', () => {
    // 1000 − 240 − 340 − 40(gap) = 380 < 420 → 收右；收后 720 ≥420 → 左保留
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.flags.right).toBe('viewport');
    expect(out.leftOpen).toBe(true);
  });

  it('UI-629 gap 计入：不计 gap 450 ≥420 不收，计 gap 410 <420 收右（1030）', () => {
    const out = deriveResponsivePanels(
      { viewportWidth: 1030, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.flags.right).toBe('viewport');
  });

  it('右栏收后仍不足 → 左栏也收', () => {
    // 1000 − 560 − 500 − 40 = −100 → 收右后 400 仍 <420 → 左也收
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 560, rightOpen: true, rightWidth: 500 },
      NO_FLAGS,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.leftOpen).toBe(false);
    expect(out.flags).toEqual({ left: 'viewport', right: 'viewport' });
  });

  it('compact（≤960 浮层区）不参与视口判定', () => {
    const out = deriveResponsivePanels(
      { viewportWidth: 800, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      NO_FLAGS,
    );
    expect(out).toEqual({ leftOpen: true, rightOpen: true, flags: NO_FLAGS });
  });

  it('UI-629 让位规则：右栏手动哨兵 + 中栏不足 → 收左（非哨兵侧）让位，右保留', () => {
    const flags: ResponsivePanelFlags = { left: null, right: 'manual-open-narrow' };
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.rightOpen).toBe(true);
    expect(out.flags.right).toBe('manual-open-narrow');
    expect(out.leftOpen).toBe(false);
    expect(out.flags.left).toBe('viewport');
  });

  it('UI-629 两侧都哨兵 → 尊重用户显式选择（不收任何一侧）', () => {
    const flags: ResponsivePanelFlags = { left: 'manual-open-narrow', right: 'manual-open-narrow' };
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.leftOpen).toBe(true);
    expect(out.rightOpen).toBe(true);
    expect(out.flags).toEqual(flags);
  });

  it('UI-629 哨兵在非哨兵侧时不豁免：左哨兵 + 中栏不足 → 右收（右本就可收，tie-break 右先）', () => {
    const flags: ResponsivePanelFlags = { left: 'manual-open-narrow', right: null };
    const out = deriveResponsivePanels(
      { viewportWidth: 1000, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.rightOpen).toBe(false);
    expect(out.flags.right).toBe('viewport');
    expect(out.leftOpen).toBe(true);
  });

  it('宽裕到两侧都放得下 → manual-open-narrow 旗清理（≥500；1500 双栏 880）', () => {
    const flags: ResponsivePanelFlags = { left: null, right: 'manual-open-narrow' };
    const out = deriveResponsivePanels(
      { viewportWidth: 1500, leftOpen: true, leftWidth: 240, rightOpen: true, rightWidth: 340 },
      flags,
    );
    expect(out.flags.right).toBeNull();
    expect(out.rightOpen).toBe(true);
  });

  it('迟滞带内（420≤中栏<500）冻结：不新收也不还原', () => {
    const flags: ResponsivePanelFlags = { left: 'viewport', right: null };
    // 左收、右开 500：中栏 = vw−500−40；vw 1000 → 460 ∈ [420,500) → 冻结
    const out = deriveResponsivePanels({ viewportWidth: 1000, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 500 }, flags);
    expect(out.leftOpen).toBe(false);
    expect(out.flags).toEqual(flags);
  });

  it('还原带迟滞：还原后 <500 不还原，≥500 才还原', () => {
    const flags: ResponsivePanelFlags = { left: 'viewport', right: null };
    // vw 1100：当前中栏 720 ≥420 不收；还原左后 480 <500 → 不还原
    expect(
      deriveResponsivePanels({ viewportWidth: 1100, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags).leftOpen,
    ).toBe(false);
    // vw 1140 → 还原左后 520 ≥500 → 还原并清旗
    const restored = deriveResponsivePanels({ viewportWidth: 1140, leftOpen: false, leftWidth: 240, rightOpen: true, rightWidth: 340 }, flags);
    expect(restored.leftOpen).toBe(true);
    expect(restored.flags.left).toBeNull();
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
    const setRightWidth = vi.fn((n: number) => { state.rightWidth = initial.rightWidth; state.rightWidth = n; });
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

  it('窗口缩到中栏不足 → 右栏自动收起；手动重开后右保留、左栏让位收起；宽到双栏放得下后全部还原', () => {
    const rig = setup({ vw: 1500, leftWidth: 240, rightWidth: 340 });
    // 缩窗：1500 → 1000（中栏 380 <420）→ 右收（收后 720 ≥420，左保留）
    act(() => rig.rerenderWith(1000));
    expect(rig.panels.rightOpen).toBe(false);
    expect(rig.panels.leftOpen).toBe(true);
    // 用户在窄窗手动重开右栏（挂 manual 哨兵）
    act(() => rig.rig.setRightOpen(true));
    expect(rig.panels.rightOpen).toBe(true);
    // 仍是窄窗：右哨兵不压回；中栏不足 → 左栏让位收起（UI-629）
    act(() => rig.rerenderWith(1000));
    expect(rig.panels.rightOpen).toBe(true);
    expect(rig.panels.leftOpen).toBe(false);
    // 变宽：迟滞带上沿 500 后先还原左；两侧都放得下 → 右哨兵清理保持打开
    act(() => rig.rerenderWith(1500));
    expect(rig.panels.rightOpen).toBe(true);
    expect(rig.panels.leftOpen).toBe(true);
  });

  it('侧栏拖窄低于阈值 → 收起；手动重开时宽度回弹默认值（避免重开即再收）', () => {
    const rig = setup({ vw: 1400, leftWidth: 240, rightWidth: 340 });
    rig.state.leftWidth = 120; // 模拟拖窄（<240）
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
    act(() => rig.rerenderWith(1000)); // 右收（中栏 380<420）
    expect(rig.panels.rightOpen).toBe(false);
    act(() => rig.rerenderWith(1500)); // 还原右后中栏 880 ≥500
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
