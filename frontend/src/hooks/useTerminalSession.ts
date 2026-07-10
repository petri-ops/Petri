import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { pickTerminalTheme } from '@/themes/terminal-themes';
import { getBridge } from '@/lib/desktopBridge';

export interface UseTerminalSessionOptions {
  /** Workspace path passed to startSession (typically the active project dir). */
  workspacePath?: string;
  /** Whether the terminal is currently visible. Starts the session when true. */
  open: boolean;
}

export interface UseTerminalSessionResult {
  hostRef: React.MutableRefObject<HTMLDivElement | null>;
  running: boolean;
  clear: () => void;
  focus: () => void;
}

/**
 * Owns an xterm.js instance bound to a desktop node-pty session.
 *
 * - Constructs the terminal on mount with a `data-theme`-aware palette.
 * - Reapplies the palette when `<html data-theme>` mutates.
 * - Proxies input to `window.biof3Desktop.terminal.writeSession` and
 *   surfaces remote output via `onData` / `onExit`.
 * - Starts the session when `open` flips to `true` and stops it on unmount.
 * - Exposes a `clear` / `focus` API for the host component's buttons.
 */
export function useTerminalSession(
  options: UseTerminalSessionOptions,
): UseTerminalSessionResult {
  const { open, workspacePath } = options;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const startedRef = useRef(false);
  const openRef = useRef(open);
  const workspacePathRef = useRef(workspacePath);
  const [running, setRunning] = useState(false);

  // Mount: construct terminal + wire IPC.
  useEffect(() => {
    if (!hostRef.current) return undefined;
    const terminal = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.4,
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: false,
      theme: pickTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(hostRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    terminal.writeln('\x1b[38;5;39mBioF3 Terminal\x1b[0m');

    const inputDisposable = terminal.onData((data) => {
      getBridge('terminal')?.writeSession?.(data);
    });
    const offData = getBridge('terminal')?.onData?.((data: string) => {
      terminal.write(String(data || ''));
    });
    const offExit = getBridge('terminal')?.onExit?.(({ code, signal }) => {
      setRunning(false);
      startedRef.current = false;
      terminal.writeln(
        `\r\n\x1b[90m[进程已退出${code != null ? `，代码 ${code}` : ''}${signal ? `，信号 ${signal}` : ''}]\x1b[0m`
      );
    });

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        getBridge('terminal')?.resizeSession?.(terminal.cols, terminal.rows);
      } catch {
        /* ignore */
      }
    });
    resizeObserver.observe(hostRef.current);

    const applyTheme = () => {
      try {
        terminal.options.theme = pickTerminalTheme();
      } catch {
        /* ignore */
      }
    };
    applyTheme();
    const themeObserver = new MutationObserver(applyTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => {
      themeObserver.disconnect();
      resizeObserver.disconnect();
      inputDisposable.dispose();
      offData?.();
      offExit?.();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      getBridge('terminal')?.stopSession?.();
    };
  }, []);

  // Keep latest values available to the mount effect's "auto-start" sequence
  // without re-binding listeners (the listener setup is mount-once).
  openRef.current = open;
  workspacePathRef.current = workspacePath;

  // Auto-start session when opened (and not already started).
  useEffect(() => {
    if (!open || startedRef.current) return;
    startedRef.current = true;
    getBridge('terminal')?.startSession?.(workspacePath).then((result) => {
      if (!result?.ok) {
        startedRef.current = false;
        terminalRef.current?.writeln(
          `\r\n\x1b[31m[启动失败] ${result?.error || '桌面终端不可用'}\x1b[0m`
        );
        return;
      }
      setRunning(true);
      window.requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit();
          const term = terminalRef.current;
          if (term) {
            getBridge('terminal')?.resizeSession?.(term.cols, term.rows);
            term.focus();
          }
        } catch {
          /* ignore */
        }
      });
    });
  }, [open, workspacePath]);

  return {
    hostRef,
    running,
    clear: () => terminalRef.current?.clear(),
    focus: () => terminalRef.current?.focus(),
  };
}