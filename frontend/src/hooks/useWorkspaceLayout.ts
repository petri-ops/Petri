/**
 * useWorkspaceLayout — panel visibility, responsive breakpoint, and
 * measured DOM dimensions for the ProjectWorkspace shell.
 *
 * Optionally accepts panel overrides from WorkspacePanelsContext so
 * TitleBar-driven state takes precedence over the layout's own state.
 *
 * State owned here:
 * - leftOpen / rightOpen         — panel collapse toggles
 * - compactLayout                — viewport < 960px breakpoint
 * - bottomTerminalOpen           — terminal drawer
 * - summaryOpen                  — pinned summary card visibility
 * - centerColWidth               — measured from ResizeObserver
 * - sessionFrameWidth/Height     — measured from ResizeObserver
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';

/** UI-351 — 中栏宽裕阈值（≥ 才钉住展开摘要/侧聊列区；会话框一旦被挤即转悬浮）。 */
// UI-448 清偿（AUDIT-LOG 🔴 销号）：仅模块内使用，按 knip 棘轮去导出（行为不变）
const SUMMARY_PIN_MIN_WIDTH = 1120;

/**
 * UI-351 — 摘要/侧聊宽窄形态派生（窄窗悬浮、宽窗钉住列区）。
 * UI-448 加映 v18 — 视口钳制兜底：会话框是视口的子集，视口不足阈值时
 * 「钉住列区」形态在几何上不可能成立，直接判悬浮。防御长会话下测量值
 * 冻结在旧宽的病态态（此时窗口已收窄、派生若只看会话框会恒卡列区）。
 */
export function deriveSummaryVisibility(
  sessionFrameWidth: number,
  viewportWidth: number,
): 'hidden' | 'compact' | 'float' | 'expanded' {
  if (viewportWidth < SUMMARY_PIN_MIN_WIDTH) return 'float';
  if (sessionFrameWidth === 0) return 'expanded';
  if (sessionFrameWidth >= SUMMARY_PIN_MIN_WIDTH) return 'expanded';
  return 'float';
}

export interface UseWorkspaceLayoutResult {
  // Panel toggles
  leftOpen: boolean;
  setLeftOpen: React.Dispatch<React.SetStateAction<boolean>>;
  rightOpen: boolean;
  setRightOpen: React.Dispatch<React.SetStateAction<boolean>>;
  compactLayout: boolean;
  viewportWidth: number;

  // Terminal
  bottomTerminalOpen: boolean;
  setBottomTerminalOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Summary card
  summaryOpen: boolean;
  setSummaryOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** UI-448 加映 v15 — 侧边聊天面板开合（与摘要概览同机制）。 */
  sideChatOpen: boolean;
  setSideChatOpen: React.Dispatch<React.SetStateAction<boolean>>;

  // Measured refs (for passing to children who observe them)
  centerColRef: React.RefObject<HTMLElement | null>;
  /**
   * UI-371 — 会话框测量 ref，**回调式**（可直接传给任意多个元素的 `ref=`）。
   * 每次节点挂载都会重新挂 ResizeObserver 并立刻测量；实例卸载时按连通性自清理。
   */
  sessionFrameRef: React.Ref<HTMLDivElement>;
  centerColWidth: number;
  sessionFrameWidth: number;
  sessionFrameHeight: number;
}

export function useWorkspaceLayout(): UseWorkspaceLayoutResult {
  const ctx = useWorkspacePanelsContext();
  const ctxAvailable = ctx !== null;

  // ── Panel toggles (from context if available, else local) ─────
  const [leftOpenLocal, setLeftOpenLocal] = useState(true);
  const [rightOpenLocal, setRightOpenLocal] = useState(true);
  const [compactLayout, setCompactLayout] = useState(
    () => window.matchMedia('(max-width: 960px)').matches,
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  // ── Terminal ────────────────────────────────────────────────────
  const [bottomTerminalOpenLocal, setBottomTerminalOpenLocal] = useState(false);

  const leftOpen = ctxAvailable ? ctx.leftOpen : leftOpenLocal;
  const setLeftOpen = ctxAvailable ? ctx.setLeftOpen : setLeftOpenLocal;
  const rightOpen = ctxAvailable ? ctx.rightOpen : rightOpenLocal;
  const setRightOpen = ctxAvailable ? ctx.setRightOpen : setRightOpenLocal;
  const bottomTerminalOpen = ctxAvailable ? ctx.bottomTerminalOpen : bottomTerminalOpenLocal;
  const setBottomTerminalOpen = ctxAvailable ? ctx.setBottomTerminalOpen : setBottomTerminalOpenLocal;

  // ── Summary card ────────────────────────────────────────────────
  const [summaryOpenLocal, setSummaryOpenLocal] = useState(false);

  const summaryOpen = ctxAvailable ? ctx.summaryOpen : summaryOpenLocal;
  const setSummaryOpen = ctxAvailable ? ctx.setSummaryOpen : setSummaryOpenLocal;

  // ── Side chat (UI-448 加映 v15 — 壳状态，摘要概览同机制) ────────
  const [sideChatOpenLocal, setSideChatOpenLocal] = useState(false);
  const sideChatOpen = ctxAvailable ? ctx.sideChatOpen : sideChatOpenLocal;
  const setSideChatOpen = ctxAvailable ? ctx.setSideChatOpen : setSideChatOpenLocal;

  // ── Measured DOM dimensions ─────────────────────────────────────
  const [centerColWidth, setCenterColWidth] = useState(0);
  const [sessionFrameWidth, setSessionFrameWidth] = useState(0);
  const [sessionFrameHeight, setSessionFrameHeight] = useState(0);
  const centerColRef = useRef<HTMLElement | null>(null);
  const sessionFrameNodesRef = useRef<Set<HTMLDivElement>>(new Set());
  const sessionFrameObserverRef = useRef<ResizeObserver | null>(null);

  // ── Effects ─────────────────────────────────────────────────────

  // Responsive: 仅记录是否 compact（驱动浮层渲染），不动侧栏开合状态。
  useEffect(() => {
    const media = window.matchMedia('(max-width: 960px)');
    const syncLayout = (compact: boolean) => setCompactLayout(compact);
    syncLayout(media.matches);
    const onChange = (event: MediaQueryListEvent) => syncLayout(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  // compactLayout 只驱动「浮层渲染样式」（≤960px 时侧栏变浮层 + backdrop），
  // **不再自动收起侧栏**（UI-341 加映二 用户裁决 2026-09-11：侧栏常驻打开，
  // 只由用户主动点击关闭）。原实现在进 compact 时 setLeftOpen/setRightOpen(false)，
  // 于是窄窗口下每次进入页面都表现为「左栏自己消失 + 页面像全屏盖住导航」，
  // 且变宽后不还原（状态残留）。

  // Measure center column width.
  useEffect(() => {
    const element = centerColRef.current;
    if (!element) return;
    const updateWidth = () => setCenterColWidth(element.getBoundingClientRect().width || 0);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Measure session frame dimensions.
  // UI-351 抓真修：原实现在挂载时 `sessionFrameRef.current` 为 null 就整段
  // return——此后再无任何测量，sessionFrameWidth 永远停在 0，摘要卡恒按
  // 'expanded' 钉住（宽度恒 300px），「compact/悬浮随宽度自适应」从未生效。
  // 改为 rAF 等待 ref 就绪后再挂 RO + resize 监听（ref 晚于 effect 就绪的
  // 场景：SessionFrameView 在子树条件分支内，挂载顺序晚于本 hook 的 effect）。
  //
  // UI-371 — 上述 rAF 修法仍有两个真实缺陷（实机实证，非推测）：
  //   ① **共用 refObject 被两处挂载**：`SessionFrameView` 在两个互斥分支各渲染一个
  //      实例（chat 那个常驻、scheduled 那个条件挂载），而两者 `ref={ctx.sessionFrameRef}`
  //      共用同一个 refObject。scheduled 实例卸载时 React 对该元素调用 `ref(null)` →
  //      refObject.current 被置空；**常驻的 chat 实例并不会被重新赋值**（它没有重挂）
  //      → `sessionFrameRef.current === null` → 之后每次测量都写 0 →
  //      `summaryVisibility` 恒 'expanded'：摘要卡恒按钉住列渲染并被
  //      `max-width: calc(100% - 24px)` 挤成窄条，float/compact 形态彻底失效。
  //   ② **RO 只 observe 一次**：节点被替换/重挂后观察的是已移除的旧节点，永不触发
  //      → 尺寸冻在旧值，面板开合/分支切换都不再重测（只有 window resize 能救）。
  // 修法：测量 ref 改**回调式** + 活节点集合：
  //   · 每次节点挂载都 observe 并立刻测量（不再依赖 rAF 轮询与「只挂一次」）；
  //   · 回调收到 null（有实例卸载）时按 `isConnected` 自清理，绕开「回调拿不到是哪个
  //     节点卸载」的限制（仍连通的节点留待 RO 触发时再清，无副作用）；
  //   · 宽度取「所有已挂载会话框的最大值」——chat/scheduled 两实例并存时只有一个可见，
  //     隐藏的那个是 display:none（宽度 0），故最大值即当前可见会话框宽度；
  //   · 0 宽不写入状态（切模式瞬间/离开工作区），避免把摘要卡瞬时误判为 'expanded'。
  const measureSessionFrames = useCallback(() => {
    const nodes = sessionFrameNodesRef.current;
    const observer = sessionFrameObserverRef.current;
    let width = 0;
    let height = 0;
    for (const node of Array.from(nodes)) {
      if (!node.isConnected) {
        observer?.unobserve(node);
        nodes.delete(node);
        continue;
      }
      const rect = node.getBoundingClientRect();
      if (rect.width > width) {
        width = rect.width;
        height = rect.height;
      }
    }
    if (width > 0) {
      setSessionFrameWidth(width);
      setSessionFrameHeight(height);
    }
  }, []);

  const sessionFrameRef = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      sessionFrameNodesRef.current.add(node);
      if (typeof ResizeObserver !== 'undefined') {
        if (!sessionFrameObserverRef.current) {
          sessionFrameObserverRef.current = new ResizeObserver(measureSessionFrames);
        }
        sessionFrameObserverRef.current.observe(node);
      }
    }
    measureSessionFrames();
  }, [measureSessionFrames]);

  useEffect(() => {
    const remeasure = () => measureSessionFrames();
    window.addEventListener('resize', remeasure);
    // UI-448 加映 v18 — 长会话丢事件自愈：最小化恢复 / 切回窗口 / 系统级 DPI
    // 变化等场景下 resize 与 RO 都可能整段错过（Electron 实测存在会话框宽度
    // 冻结在旧值、摘要/侧聊恒列区不转悬浮的会话，重挂载才自愈）。
    // 聚焦与可见性恢复是零成本的重测信号：节点仍在则拿实时宽度，节点已换
    // 则由 ref 回调补挂。冻结类缺陷从「重挂载才自愈」收敛为「切回即自愈」。
    document.addEventListener('visibilitychange', remeasure);
    window.addEventListener('focus', remeasure);
    return () => {
      window.removeEventListener('resize', remeasure);
      document.removeEventListener('visibilitychange', remeasure);
      window.removeEventListener('focus', remeasure);
      sessionFrameObserverRef.current?.disconnect();
      sessionFrameObserverRef.current = null;
      sessionFrameNodesRef.current.clear();
    };
  }, [measureSessionFrames]);

  // UI-448 加映 v19 — 布局守望（事件无关自愈）：Electron 实机会话存在
  // resize/RO 全部失效而页面其余功能正常的病态（多次 HMR 撕裂模块图后实测；
  // 长会话丢事件类），此时任何事件驱动的重测都不会发生，派生 useMemo 依赖
  // 永不变化、视口钳制也随之失效。守望器每 300ms 读一次真实 DOM 宽度——
  // 与事件系统零耦合，只要会话框节点在，任何窗口变化最多滞后一拍自愈。
  // 隐藏页跳过读取（Chromium 本身会对后台页节流，无需额外配合）。
  useEffect(() => {
    const watcher = window.setInterval(() => {
      if (document.hidden) return;
      measureSessionFrames();
    }, 300);
    return () => window.clearInterval(watcher);
  }, [measureSessionFrames]);

  return {
    leftOpen,
    setLeftOpen,
    rightOpen,
    setRightOpen,
    compactLayout,
    viewportWidth,
    bottomTerminalOpen,
    setBottomTerminalOpen,
    summaryOpen,
    setSummaryOpen,
    sideChatOpen,
    setSideChatOpen,
    centerColRef,
    sessionFrameRef,
    centerColWidth,
    sessionFrameWidth,
    sessionFrameHeight,
  };
}
