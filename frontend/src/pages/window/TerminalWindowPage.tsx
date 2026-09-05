// ============================================================
// TerminalWindowPage — BLOCK-59 P2 终端独立窗（/window/terminal/:sessionId）。
//
// 升格语义（plan §7 P2）：把某 Tab 会话升格为窗 = 同一 pty 会话的
// 第二活视图——主窗 tab 的 xterm 保活（session 归主窗 useTerminalTabs
// 所有，零状态丢失），本窗从挂载点起写入新输出；输入/resize 与主窗
// 并发安全（同一 pty）。数据到达依赖 terminal.js 的受管窗口转发
// （terminal:data / terminal:exit → terminal:<sessionId>）。
// 关闭本窗（收回/降格）永不停止 pty 会话。
// ============================================================
import React, { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { WindowShell } from '@/components/window/WindowShell';
import { getBridge } from '@/lib/desktopBridge';
import { pickTerminalTheme } from '@/themes/terminal-themes';
import { useTheme } from '@/themes/ThemeProvider';
import styles from '@/components/window/window-shell.module.css';

export function TerminalWindowPage(): React.ReactElement {
  const params = useParams<{ sessionId?: string }>();
  const sessionId = params.sessionId || 'default';
  const { resolvedTheme } = useTheme();
  const [sessionRunning, setSessionRunning] = useState<boolean | null>(null);
  const [attachNote, setAttachNote] = useState('会话检查中…');
  const [actionError, setActionError] = useState('');
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);

  // 会话状态探测：运行中 → 直接挂载；未运行 → 提供启动（升格即用）。
  useEffect(() => {
    const bridge = getBridge('terminal');
    if (!bridge?.listSessions) {
      setAttachNote('桌面终端桥不可用（仅桌面版支持终端独立窗）。');
      setSessionRunning(false);
      return;
    }
    let cancelled = false;
    bridge
      .listSessions()
      .then((res) => {
        if (cancelled) return;
        const running = (res?.sessions || []).some(
          (s) => s.sessionId === sessionId && s.running,
        );
        setSessionRunning(running);
        setAttachNote(
          running
            ? '已挂载运行中的会话（新输出从此刻起显示；滚动回看在主窗标签）'
            : '会话未运行——可在此启动（关闭本窗不会停止会话）',
        );
      })
      .catch(() => {
        if (!cancelled) {
          setSessionRunning(false);
          setAttachNote('会话状态获取失败，可尝试启动。');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // xterm 挂载 + 事件订阅（仅本会话）；卸载只 dispose 本视图，不停 pty。
  useEffect(() => {
    if (sessionRunning !== true || !hostRef.current) return undefined;
    const bridge = getBridge('terminal');
    if (!bridge) return undefined;
    const term = new XTerm({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 11,
      lineHeight: 1.4,
      scrollback: 5000,
      convertEol: true,
      allowProposedApi: false,
      theme: pickTerminalTheme(resolvedTheme),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    termRef.current = term;
    term.onData((data) => bridge.writeSession?.(data, sessionId));
    term.writeln(`\x1b[90m[终端独立窗 · 会话 ${sessionId}]\x1b[0m`);

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        bridge.resizeSession?.(term.cols, term.rows, sessionId);
      } catch {
        /* ignore */
      }
    });
    observer.observe(hostRef.current);
    window.requestAnimationFrame(() => {
      try {
        fit.fit();
        bridge.resizeSession?.(term.cols, term.rows, sessionId);
        term.focus();
      } catch {
        /* ignore */
      }
    });

    const offData = bridge.onData?.((payload: { sessionId: string; data: string }) => {
      if (payload?.sessionId === sessionId) term.write(String(payload?.data || ''));
    });
    const offExit = bridge.onExit?.((payload: { sessionId: string; code?: number | null }) => {
      if (payload?.sessionId !== sessionId) return;
      setSessionRunning(false);
      term.writeln(
        `\r\n\x1b[90m[进程已退出${payload.code != null ? `，代码 ${payload.code}` : ''}]\x1b[0m`,
      );
    });
    return () => {
      offData?.();
      offExit?.();
      observer.disconnect();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionRunning, sessionId]);

  const handleStart = async () => {
    setActionError('');
    const bridge = getBridge('terminal');
    const res = await bridge?.startSession?.(undefined, sessionId);
    if (res?.ok) {
      setSessionRunning(true);
    } else {
      setActionError(res?.error || '会话启动失败');
    }
  };

  return (
    <WindowShell title={`终端 · ${sessionId}`} badge="独立窗 · 会话视图" subtitle={attachNote}>
      <div style={{ height: 'calc(100vh - 40px)', padding: 8, boxSizing: 'border-box' }}>
        {sessionRunning === false && (
          <div className={styles.resultBody}>
            <span className={styles.statusChip}>{attachNote}</span>
            {actionError && <div className={styles.errorBlock}>{actionError}</div>}
            <div>
              <button type="button" className="gewu-btn gewu-btn--sm" onClick={() => void handleStart()}>
                启动会话
              </button>
            </div>
          </div>
        )}
        <div
          ref={hostRef}
          data-terminal-host={sessionId}
          style={{ width: '100%', height: '100%', visibility: sessionRunning ? 'visible' : 'hidden' }}
        />
      </div>
    </WindowShell>
  );
}
