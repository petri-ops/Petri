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
import { useEffect, useRef, useState } from 'react';
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
  sessionFrameRef: React.RefObject<HTMLDivElement | null>;
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
  const sessionFrameRef = useRef<HTMLDivElement | null>(null);

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
  useEffect(() => {
    let observer: ResizeObserver | null = null;
    let raf = 0;
    let cancelled = false;
    const updateSize = () => {
      const rect = sessionFrameRef.current?.getBoundingClientRect();
      setSessionFrameWidth(rect?.width || 0);
      setSessionFrameHeight(rect?.height || 0);
    };
    const attach = () => {
      if (cancelled) return;
      const element = sessionFrameRef.current;
      if (!element) {
        raf = requestAnimationFrame(attach);
        return;
      }
      updateSize();
      observer =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateSize);
      observer?.observe(element);
      window.addEventListener('resize', updateSize);
    };
    attach();
    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener('resize', updateSize);
    };
  }, []);

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
