/**
 * useResponsivePanelCollapse — UI-479 侧栏自适应收起
 *
 * 需求（用户 2026-10-09）：窗口变小、或左右侧栏自身宽度低于阈值时，
 * 侧栏自动收起——「这应该是个自然的过程」。复用既有收起路径（宽度动画到 0、
 * 列头开关内联、resize 把手隐藏），零新增 CSS。
 *
 * 历史语境（UI-341 加映二 2026-09-11 裁决的定向反转）：当时移除 compact 自动
 * 收起的根因是「侧栏自己消失 + 变宽不还原（状态残留）+ 与用户手动操作打架」。
 * 本实现三道护栏：
 *   1. 自动还原——视口收起（viewport 旗）的侧栏在宽裕回去时自动弹回；
 *   2. 迟滞带——中栏可用宽 <560 收、还原判据 ≥640，边界不抖动；
 *   3. 手动优先——窄窗里用户手动重开的侧栏挂 manual-open-narrow 哨兵，
 *      系统不再压回，直到两侧都放得下才恢复自动行为。
 *
 * 挂载点：WorkspacePanelsProvider（全壳唯一 useWorkspacePanels 实例所在，
 * 外层是 AppRailProvider，可直接读 resizable 列宽单真相）。
 */

import { useEffect, useRef, useState } from 'react';
import { DEFAULT_LEFT_WIDTH, DEFAULT_RIGHT_WIDTH } from './useResizableColumns';

/** 侧栏自身拖窄于此 → 该侧自动收起（拖窄=收起意图；MIN 拖拽钳 96 之上留手感带）。 */
const SIDEBAR_AUTO_COLLAPSE_WIDTH = 140;
/** 中栏可用宽（视口 − 两侧开放栏宽）低于此 → 收侧栏让位（右先左后）。 */
const CENTER_SPACE_COLLAPSE_BELOW = 560;
/** 迟滞带上沿：还原判据 = 还原后中栏可用宽仍 ≥ 此值。 */
const CENTER_SPACE_RESTORE_ABOVE = 640;
/** compact 断点（≤960 侧栏转浮层不占中栏）——该区不参与视口判定。 */
const VIEWPORT_TRIGGER_MAX = 960;

type PanelAutoFlag = 'width' | 'viewport' | 'manual-open-narrow' | null;

export interface ResponsivePanelFlags {
  left: PanelAutoFlag;
  right: PanelAutoFlag;
}

interface PanelSizeInput {
  viewportWidth: number;
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  rightWidth: number;
}

interface ResponsivePanelOutcome {
  leftOpen: boolean;
  rightOpen: boolean;
  flags: ResponsivePanelFlags;
}

/**
 * 纯决策函数：给定视口/开合/列宽与当前旗标，给出目标开合态与新旗标。
 * 规则顺序：① 拖窄触发（width，永不自动还原）→ ② 视口触发（compact 区跳过；
 * 右先左后）→ ③ 宽裕还原（viewport 旗，贪心左先，判据=还原后仍 ≥640）→
 * ④ 全契合清理（manual-open-narrow → null）。560≤中栏<640 为迟滞冻结带。
 */
export function deriveResponsivePanels(
  input: PanelSizeInput,
  flags: ResponsivePanelFlags,
): ResponsivePanelOutcome {
  const { viewportWidth } = input;
  let { leftOpen, rightOpen } = input;
  const next: ResponsivePanelFlags = { left: flags.left, right: flags.right };

  // ① 拖窄触发：侧栏自身宽度低于阈值 → 收起（该侧物理上已不可用）
  if (leftOpen && input.leftWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH) {
    leftOpen = false;
    next.left = 'width';
  }
  if (rightOpen && input.rightWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH) {
    rightOpen = false;
    next.right = 'width';
  }

  if (viewportWidth > VIEWPORT_TRIGGER_MAX) {
    const centerWith = (lo: boolean, ro: boolean) =>
      viewportWidth - (lo ? input.leftWidth : 0) - (ro ? input.rightWidth : 0);

    // ② 视口触发：中栏可用宽不足 → 先收右（对齐「结果列让位主内容」），仍不足再收左
    if (centerWith(leftOpen, rightOpen) < CENTER_SPACE_COLLAPSE_BELOW) {
      if (rightOpen && next.right !== 'manual-open-narrow') {
        rightOpen = false;
        next.right = 'viewport';
      }
      if (
        !rightOpen
        && leftOpen
        && centerWith(leftOpen, false) < CENTER_SPACE_COLLAPSE_BELOW
        && next.left !== 'manual-open-narrow'
      ) {
        leftOpen = false;
        next.left = 'viewport';
      }
    } else {
      // ③④ 宽裕侧：还原 viewport 收起的侧栏（贪心左先）+ 清理 manual 哨兵。
      // 还原判据带迟滞：还原后中栏可用宽仍 ≥640 才动手。
      if (!leftOpen && next.left === 'viewport' && centerWith(true, rightOpen) >= CENTER_SPACE_RESTORE_ABOVE) {
        leftOpen = true;
        next.left = null;
      }
      if (!rightOpen && next.right === 'viewport' && centerWith(leftOpen, true) >= CENTER_SPACE_RESTORE_ABOVE) {
        rightOpen = true;
        next.right = null;
      }
      if (next.left === 'manual-open-narrow' && centerWith(true, true) >= CENTER_SPACE_RESTORE_ABOVE) {
        next.left = null;
      }
      if (next.right === 'manual-open-narrow' && centerWith(true, true) >= CENTER_SPACE_RESTORE_ABOVE) {
        next.right = null;
      }
    }
  }

  return { leftOpen, rightOpen, flags: next };
}

/** 视口宽（resize 监听；jsdom/SSR 容错）。 */
function useViewportWidth(): number {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth));
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

interface ResponsivePanelCollapsePanels {
  leftOpen: boolean;
  rightOpen: boolean;
  setLeftOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
  setRightOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
}

interface ResponsiveColumnSizes {
  leftWidth: number;
  rightWidth: number;
  setLeftWidth: (value: number) => void;
  setRightWidth: (value: number) => void;
}

/**
 * 响应式侧栏收起 hook（单实例，挂 WorkspacePanelsProvider）。
 * 手动/自动开合的区分靠 selfAction 意图标记：hook 自己发起的 setter 调用先
 * 记账，效果重跑时不误判为手动；未记账的开合转换即用户手动操作。
 * enabled=false（无 AppRail 外层的裸 Provider 场景）时完全旁路，行为零变化。
 */
export function useResponsivePanelCollapse(
  panels: ResponsivePanelCollapsePanels,
  sizes: ResponsiveColumnSizes,
  enabled = true,
): void {
  const { leftOpen, rightOpen, setLeftOpen, setRightOpen } = panels;
  const { leftWidth, rightWidth, setLeftWidth, setRightWidth } = sizes;
  const viewportWidth = useViewportWidth();

  const flags = useRef<ResponsivePanelFlags>({ left: null, right: null });
  const prev = useRef<{ leftOpen: boolean; rightOpen: boolean } | null>(null);
  /** hook 自身发起的开合意图（双槽位：同轮两侧都变时互不覆盖）。 */
  const selfAction = useRef<{ left?: boolean; right?: boolean }>({});

  useEffect(() => {
    if (!enabled) {
      prev.current = { leftOpen, rightOpen };
      return;
    }
    const self = selfAction.current;
    selfAction.current = {};
    const prevOpen = prev.current;
    prev.current = { leftOpen, rightOpen };
    // 手动重开 width 收起的侧栏时宽度回弹默认值——回弹发生在 setState，
    // 本轮渲染闭包里的列宽还是旧值，直接参与决策会「重开即再收」；
    // 用生效宽度（回弹值优先）参与本次决策。
    let effectiveLeftWidth = leftWidth;
    let effectiveRightWidth = rightWidth;

    // 手动开合转换（非 hook 自身发起）→ 更新旗标，不与用户打架
    const manualOpened = (side: 'left' | 'right') =>
      prevOpen !== null
      && (side === 'left' ? leftOpen && !prevOpen.leftOpen : rightOpen && !prevOpen.rightOpen)
      && self[side] !== true;

    if (manualOpened('left')) {
      if (flags.current.left === 'viewport' || flags.current.left === 'manual-open-narrow') {
        flags.current.left = 'manual-open-narrow';
      } else {
        // width 收起的手动重开：宽度回弹默认值，避免「重开即再收」死循环
        if (flags.current.left === 'width' && leftWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH) {
          setLeftWidth(DEFAULT_LEFT_WIDTH);
          effectiveLeftWidth = DEFAULT_LEFT_WIDTH;
        }
        flags.current.left = null;
      }
    }
    if (manualOpened('right')) {
      if (flags.current.right === 'viewport' || flags.current.right === 'manual-open-narrow') {
        flags.current.right = 'manual-open-narrow';
      } else {
        if (flags.current.right === 'width' && rightWidth < SIDEBAR_AUTO_COLLAPSE_WIDTH) {
          setRightWidth(DEFAULT_RIGHT_WIDTH);
          effectiveRightWidth = DEFAULT_RIGHT_WIDTH;
        }
        flags.current.right = null;
      }
    }
    const manualClosed = (side: 'left' | 'right') =>
      prevOpen !== null
      && (side === 'left' ? !leftOpen && prevOpen.leftOpen : !rightOpen && prevOpen.rightOpen)
      && self[side] !== false;
    if (manualClosed('left') && flags.current.left !== 'width') flags.current.left = null;
    if (manualClosed('right') && flags.current.right !== 'width') flags.current.right = null;

    // 决策并应用（只改有变化的一侧；旗标-only 变化也回写）
    const outcome = deriveResponsivePanels(
      { viewportWidth, leftOpen, rightOpen, leftWidth: effectiveLeftWidth, rightWidth: effectiveRightWidth },
      flags.current,
    );
    flags.current = outcome.flags;
    if (outcome.leftOpen !== leftOpen) {
      selfAction.current.left = outcome.leftOpen;
      setLeftOpen(outcome.leftOpen);
    }
    if (outcome.rightOpen !== rightOpen) {
      selfAction.current.right = outcome.rightOpen;
      setRightOpen(outcome.rightOpen);
    }
  }, [enabled, viewportWidth, leftOpen, rightOpen, leftWidth, rightWidth, setLeftOpen, setRightOpen, setLeftWidth, setRightWidth]);
}
