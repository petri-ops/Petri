import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { pickTerminalTheme, type TerminalThemeName } from '@/themes/terminal-themes';
import { getBridge } from '@/lib/desktopBridge';
import {
  MAX_TERMINAL_TABS,
  closeTerminalTab,
  createTerminalTab,
  type TerminalTab,
} from './terminalTabs';

export interface UseTerminalTabsOptions {
  /** 底部终端面板是否展开；展开且 tab 激活时才真正启动该 tab 的 pty。 */
  open: boolean;
  /** 新 tab 的默认 cwd（当前项目 workspace）。 */
  workspacePath?: string;
  /** BLOCK-67：SSH 远程项目——pty 直挂 ssh（remotePath 为远端工作目录）。 */
  ssh?: { alias: string; remotePath: string };
  /** 解析后的应用主题；xterm 实例跟随变化（不重建会话）。 */
  theme: TerminalThemeName;
}

export interface UseTerminalTabsResult {
  tabs: TerminalTab[];
  activeId: string | null;
  setActive: (id: string) => void;
  openTab: () => void;
  closeTab: (id: string) => void;
  /** tab 内容容器 callback ref（xterm 首次激活时 open 进该容器）。 */
  registerHost: (id: string) => (el: HTMLDivElement | null) => void;
  /** 上限等操作提示（用户可见，操作后自动消隐）。 */
  limitNotice: string | null;
  dismissLimitNotice: () => void;
  clear: () => void;
  activeRunning: boolean;
  /** sessionId → pty 是否运行中（tab 状态点用）。 */
  runningBy: Record<string, boolean>;
}

interface TabEntry {
  term: XTerm;
  fit: FitAddon;
  started: boolean;
  host: HTMLDivElement;
}

/**
 * BLOCK-54 P2 — 底部终端多 Tab 会话管理（上限 MAX_TERMINAL_TABS=4）。
 *
 * - 每个 tab 独立 xterm 实例 + 独立 node-pty 会话（sessionId 即 tab.id）；
 *   pty 在「面板展开 && tab 首次激活」时才启动（懒启动，不开面板不占资源）。
 * - terminal:data / terminal:exit 事件按 payload.sessionId 路由到对应 tab。
 * - 切换 tab 只做 fit + focus，不重启会话、不丢回显；关闭 tab 即停进程并
 *   dispose 实例；卸载（离开页面）时全量 stop（对齐旧单会话行为）。
 */
export function useTerminalTabs(options: UseTerminalTabsOptions): UseTerminalTabsResult {
  const { open, theme, workspacePath, ssh } = options;
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [limitNotice, setLimitNotice] = useState<string | null>(null);
  const [runningBy, setRunningBy] = useState<Record<string, boolean>>({});

  const entriesRef = useRef<Map<string, TabEntry>>(new Map());
  const hostsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const activeIdRef = useRef<string | null>(null);
  const sshRef = useRef(ssh);
  sshRef.current = ssh;
  const themeRef = useRef(theme);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  activeIdRef.current = activeId;
  themeRef.current = theme;

  const getBridgeTerminal = useCallback(() => getBridge('terminal'), []);

  // Mount-once: backend event routing by sessionId.
  useEffect(() => {
    const offData = getBridgeTerminal()?.onData?.((payload: { sessionId: string; data: string }) => {
      const entry = entriesRef.current.get(payload?.sessionId);
      entry?.term.write(String(payload?.data || ''));
    });
    const offExit = getBridgeTerminal()?.onExit?.((payload: {
      sessionId: string;
      code?: number | null;
      signal?: string | null;
    }) => {
      const sessionId = payload?.sessionId;
      const entry = entriesRef.current.get(sessionId);
      if (entry) {
        entry.started = false;
        entry.term.writeln(
          `\r\n\x1b[90m[进程已退出${payload.code != null ? `，代码 ${payload.code}` : ''}${payload.signal ? `，信号 ${payload.signal}` : ''}]\x1b[0m`
        );
      }
      setRunningBy((prev) => ({ ...prev, [sessionId]: false }));
      setTabs((prev) => prev.map((t) => (t.id === sessionId ? { ...t, exited: true } : t)));
    });
    return () => {
      offData?.();
      offExit?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Theme follows the application palette without recreating sessions.
  useEffect(() => {
    for (const entry of entriesRef.current.values()) {
      try {
        entry.term.options.theme = pickTerminalTheme(theme);
      } catch {
        /* ignore */
      }
    }
  }, [theme]);

  const ensureResizeObserver = useCallback((): ResizeObserver => {
    if (!resizeObserverRef.current) {
      resizeObserverRef.current = new ResizeObserver((observed) => {
        const active = activeIdRef.current;
        for (const item of observed) {
          const id = [...hostsRef.current.entries()].find(([, el]) => el === item.target)?.[0];
          if (!id || id !== active) continue;
          const entry = entriesRef.current.get(id);
          if (!entry) continue;
          try {
            entry.fit.fit();
            getBridgeTerminal()?.resizeSession?.(entry.term.cols, entry.term.rows, id);
          } catch {
            /* ignore */
          }
        }
      });
    }
    return resizeObserverRef.current;
  }, [getBridgeTerminal]);

  const ensureSession = useCallback(
    (tab: TerminalTab) => {
      const host = hostsRef.current.get(tab.id);
      if (!host) return;
      let entry = entriesRef.current.get(tab.id);
      if (!entry) {
        const term = new XTerm({
          cursorBlink: true,
          cursorStyle: 'bar',
          fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          fontSize: 11,
          lineHeight: 1.4,
          scrollback: 5000,
          convertEol: true,
          allowProposedApi: false,
          theme: pickTerminalTheme(themeRef.current),
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(host);
        term.onData((data) => {
          getBridgeTerminal()?.writeSession?.(data, tab.id);
        });
        entry = { term, fit, started: false, host };
        entriesRef.current.set(tab.id, entry);
        ensureResizeObserver().observe(host);
      }
      const ent: TabEntry = entry;
      if (ent.started || tab.exited) return;
      const bridge = getBridgeTerminal();
      if (!bridge?.startSession) return;
      ent.started = true; // 同步置位防并发重复启动；失败时回退
      bridge
        .startSession(tab.cwd, tab.id, sshRef.current || undefined)
        .then((result) => {
          if (!result?.ok) {
            ent.started = false;
            ent.term.writeln(
              `\r\n\x1b[31m[启动失败] ${result?.error || '桌面终端不可用'}\x1b[0m`
            );
            setRunningBy((prev) => ({ ...prev, [tab.id]: false }));
            return;
          }
          setRunningBy((prev) => ({ ...prev, [tab.id]: true }));
          window.requestAnimationFrame(() => {
            try {
              ent.fit.fit();
              bridge.resizeSession?.(ent.term.cols, ent.term.rows, tab.id);
              ent.term.focus();
            } catch {
              /* ignore */
            }
          });
        })
        .catch(() => {
          ent.started = false;
          setRunningBy((prev) => ({ ...prev, [tab.id]: false }));
        });
    },
    [ensureResizeObserver, getBridgeTerminal]
  );

  // Lazy start: panel open + tab active → ensure xterm + pty for the active tab.
  useEffect(() => {
    if (!open || !activeId) return;
    const tab = tabs.find((t) => t.id === activeId);
    if (tab) ensureSession(tab);
     
  }, [open, activeId, tabs, ensureSession]);

  // Switch tab → refit + focus after paint (layout settled).
  useEffect(() => {
    if (!activeId) return;
    const handle = window.requestAnimationFrame(() => {
      const entry = entriesRef.current.get(activeId);
      if (!entry) return;
      try {
        entry.fit.fit();
        getBridgeTerminal()?.resizeSession?.(entry.term.cols, entry.term.rows, activeId);
        entry.term.focus();
      } catch {
        /* ignore */
      }
    });
    return () => window.cancelAnimationFrame(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const openTab = useCallback(() => {
    setLimitNotice(null);
    const res = createTerminalTab(tabs, workspacePath);
    if ('limitReached' in res) {
      setLimitNotice(`最多同时打开 ${MAX_TERMINAL_TABS} 个终端标签，请先关闭不用的标签`);
      return;
    }
    setTabs(res.tabs);
    setActiveId(res.tab.id);
  }, [tabs, workspacePath]);

  const closeTab = useCallback(
    (id: string) => {
      setLimitNotice(null);
      const entry = entriesRef.current.get(id);
      if (entry?.started) getBridgeTerminal()?.stopSession?.(id);
      if (entry) {
        try {
          resizeObserverRef.current?.unobserve(entry.host);
        } catch {
          /* ignore */
        }
        entry.term.dispose();
      }
      entriesRef.current.delete(id);
      hostsRef.current.delete(id);
      setRunningBy((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      const res = closeTerminalTab(tabs, id);
      setTabs(res.tabs);
      setActiveId((cur) => (cur === id ? res.nextActiveId : cur));
    },
    [tabs, getBridgeTerminal]
  );

  const setActive = useCallback((id: string) => {
    setLimitNotice(null);
    setActiveId(id);
  }, []);

  const registerHost = useCallback(
    (id: string) =>
      (el: HTMLDivElement | null): void => {
        if (el) hostsRef.current.set(id, el);
        else hostsRef.current.delete(id);
      },
    []
  );

  const clear = useCallback(() => {
    const entry = activeIdRef.current
      ? entriesRef.current.get(activeIdRef.current)
      : undefined;
    entry?.term.clear();
  }, []);

  // Unmount: stop every started pty + dispose every instance (page leave).
  useEffect(() => {
    const entries = entriesRef;
    const observer = resizeObserverRef;
    return () => {
      const bridge = getBridgeTerminal();
      for (const [id, entry] of entries.current.entries()) {
        if (entry.started) bridge?.stopSession?.(id);
        try {
          observer.current?.unobserve(entry.host);
        } catch {
          /* ignore */
        }
        entry.term.dispose();
      }
      entries.current.clear();
      observer.current?.disconnect();
      observer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    tabs,
    activeId,
    setActive,
    openTab,
    closeTab,
    registerHost,
    limitNotice,
    dismissLimitNotice: () => setLimitNotice(null),
    clear,
    activeRunning: activeId ? runningBy[activeId] === true : false,
    runningBy,
  };
}
