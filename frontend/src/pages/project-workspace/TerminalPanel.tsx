// ============================================================
// TerminalPanel — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 3019-3122 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import type { BackendStatus } from '@/lib/electron';
import styles from '../project-workspace.module.css';

export function TerminalPanel({
  project,
  backendStatus,
}: {
  /** BLOCK-72：全局 /backend 页无项目上下文——project 仅影响 workspacePath 展示与 openShell cwd */
  project?: Project;
  backendStatus: BackendStatus;
}): React.ReactElement {
  const [snapshot, setSnapshot] = useState<{
    ok: boolean;
    logDir?: string;
    dataDir?: string;
    processes?: Array<{
      id: string;
      label: string;
      command: string;
      status: 'running' | 'stopped';
      pid?: number | null;
      logPath?: string;
      output: string;
    }>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.biof3Desktop?.terminal?.snapshot?.();
      setSnapshot(result || null);
    } catch {
      setSnapshot(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const visibleProcesses = useMemo(() => snapshot?.processes || [], [snapshot]);

  return (
    <div className={styles.terminalPanel}>
      <div className={styles.terminalPanelHead}>
          <div className={styles.terminalPanelTitleWrap}>
            {/* UI-366 — 「后端」词汇退休：本地单进程 + 内嵌运行时架构下，
                面向用户说「本地服务 / 运行时」，不再说后端 */}
            <div className={styles.terminalPanelTitle}>本地服务</div>
          <div className={styles.terminalPanelMeta}>
            {project?.workspacePath || '全局 · 数据根目录'} · R {backendStatus.rRuntime ? '已就绪' : '未安装'} · Python {backendStatus.pyRuntime ? '已就绪' : '未安装'}
          </div>
        </div>
        <div className={styles.terminalPanelActions}>
          <button type="button" className={styles.terminalPanelActionBtn} onClick={refresh}>
            刷新
          </button>
          <button
            type="button"
            className={styles.terminalPanelActionBtn}
            onClick={() => window.biof3Desktop?.terminal?.openLogDir?.()}
          >
            打开日志
          </button>
          <button
            type="button"
            className={styles.terminalPanelActionBtn}
            onClick={() => window.biof3Desktop?.terminal?.openShell?.(project?.workspacePath)}
          >
            系统终端
          </button>
        </div>
      </div>

      {backendStatus.downReason && (
        <div className={styles.terminalPanelHint}>{backendStatus.downReason}</div>
      )}

      <div className={styles.terminalPanelList}>
        {loading && !snapshot && <div className={styles.panelEmpty}>加载后端状态…</div>}
        {visibleProcesses.map((proc) => (
          <details key={proc.id} className={styles.terminalProcessCard} open>
            <summary className={styles.terminalProcessSummary}>
              <span className={styles.terminalProcessName}>
                <span className={styles.terminalProcessDot} data-status={proc.status} />
                {proc.label}
              </span>
              <span className={styles.terminalProcessMeta}>
                {proc.status === 'running' ? '运行中' : '未运行'}
                {proc.pid ? ` · PID ${proc.pid}` : ''}
              </span>
            </summary>
            <div className={styles.terminalProcessCommand}>{proc.command}</div>
            <pre className={styles.terminalProcessOutput}>
              {loading && !snapshot ? '加载后端状态…' : proc.output || '暂无日志输出'}
            </pre>
          </details>
        ))}
        {!loading && snapshot && visibleProcesses.length === 0 && (
          <div className={styles.panelEmpty}>没有可显示的后端状态</div>
        )}
      </div>
    </div>
  );
}
