/**
 * useStartupTimeline — BLOCK-101 P0 启动 timeline 度量（D1 四段口径，纯观测）
 *
 * 渲染层职责：firstPaint（paintTiming）+ dataReady（左栏 projects 首次到货，
 * 由 AppRailContext 调 markDataReady）+ preloadMs（preload 暴露）汇总后经
 * startup:report 一次性上报主进程存档；flow 经 startup:marks 拉取对账。
 * 主进程侧 mainReady/windowShown/didFinishLoad 由 src/ipc/startup-timeline.js 打点。
 * 桌面外（投影/浏览器）无桥 → 静默跳过（诚实降级，不伪造数字）。
 */

import { useEffect, useRef } from 'react';

export interface StartupReport {
  preloadMs?: number;
  firstPaintMs?: number;
  dataReadyMs?: number;
  reportedAt: number;
}

/** 模块级单例：dataReady 打点先于 hook mount 也可靠 */
let dataReadyMark: number | null = null;
/** 只挡 mount 兜底上报；dataReady 终版始终放行（主进程 last-write-wins） */
let mountReported = false;

/** AppRailContext 在项目列表首次到货时调用；终版带上 dataReady 再报一次 */
export function markDataReady(): void {
  if (dataReadyMark == null) dataReadyMark = Math.round(performance.now());
  sendReport(false);
}

function sendReport(isMountFallback: boolean): void {
  if (typeof window === 'undefined') return;
  if (isMountFallback && mountReported) return;
  const desktop = (window as { gewu?: unknown }).gewu ?? (window as { biof3Desktop?: unknown }).biof3Desktop;
  const bridge = (desktop as { startup?: { report?: (p: StartupReport) => void } } | null)?.startup;
  if (!bridge?.report) return;
  if (isMountFallback) mountReported = true;

  const report: StartupReport = { reportedAt: Date.now() };
  const preloadMs = (desktop as { __startupPreloadMs?: number }).__startupPreloadMs;
  if (typeof preloadMs === 'number' && preloadMs >= 0 && preloadMs < 60000) report.preloadMs = Math.round(preloadMs);
  if (dataReadyMark != null) report.dataReadyMs = dataReadyMark;
  const entries = performance.getEntriesByType('paint');
  const fp = entries.find((e) => e.name === 'first-paint' || e.name === 'first-contentful-paint');
  if (fp) report.firstPaintMs = Math.round(fp.startTime);
  bridge.report(report);
}

export function useStartupTimeline(): void {
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    // mount 即发一版（dataReady 可能未到，字段诚实缺省）；dataReady 到货时
    // markDataReady→sendReport(终版) 再报（主进程 last-write-wins 覆盖）。
    sendReport(true);
    // firstPaint 晚于 mount 的兜底补采一版
    const timer = window.setTimeout(() => sendReport(true), 1500);
    return () => window.clearTimeout(timer);
  }, []);
}
