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
    window.addEventListener('resize', measureSessionFrames);
    return () => {
      window.removeEventListener('resize', measureSessionFrames);
      sessionFrameObserverRef.current?.disconnect();
      sessionFrameObserverRef.current = null;
      sessionFrameNodesRef.current.clear();
    };
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
    centerColRef,
    sessionFrameRef,
    centerColWidth,
    sessionFrameWidth,
    sessionFrameHeight,
  };
}
