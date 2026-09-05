// ============================================================
// CommandCenterPage — BLOCK-59 P3 指挥中心墙（/window/command-center）。
//
// 单例无状态窗（随开随关，plan §4.1）：网格瓦片聚合最近作业的实时
// 状态。**零第二真相**（plan §10 治理红线）：瓦片只读 /api/tools/history
// 既有 REST（tool_jobs 表投影），5s 轮询；点击瓦片下钻 = L1 结果窗
// 弹出（同内容禁双开契约复用）。不做任何本地任务状态缓存。
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WindowShell } from '@/components/window/WindowShell';
import { getBridge } from '@/lib/desktopBridge';
import { listAllJobs } from '@/lib/project-store';
import type { ToolJob } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import styles from './command-center.module.css';

const POLL_MS = 5000;
const MAX_TILES = 12;

const STATUS_LABEL: Record<ToolJob['status'], string> = {
  pending: '排队中',
  running: '运行中',
  done: '已完成',
  failed: '失败',
};

function formatElapsed(fromMs: number, toMs: number): string {
  const sec = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

export function CommandCenterPage(): React.ReactElement {
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [loadError, setLoadingError] = useState('');
  const [drillNote, setDrillNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const jobsRef = useRef<ToolJob[]>([]);
  jobsRef.current = jobs;

  const refresh = useCallback(async () => {
    try {
      const data = await listAllJobs();
      setJobs(data.slice(0, MAX_TILES));
      setLoadingError('');
    } catch (e) {
      setLoadingError(e instanceof Error ? e.message : '作业状态获取失败');
    }
  }, []);

  // 只读真相轮询：5s 粒度（瓦片实时进度的诚实形态 = 状态 + 已耗时，
  // tool_jobs 无百分比概念，不虚构进度条）
  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const handleDrill = useCallback(async (job: ToolJob) => {
    setDrillNote(null);
    const wm = getBridge('windowManager');
    if (!wm) {
      setDrillNote('桌面桥不可用，无法下钻');
      return;
    }
    try {
      const token = getToken();
      const resp = await fetch(`${getApiPrefix('r')}/tools/status/${encodeURIComponent(job.id)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = await resp.json().catch(() => null);
      const res = data?.result || data;
      const files = res?.artifacts || res?.files || [];
      const artifactName = files[0]?.name || files[0]?.filename || null;
      if (!artifactName) {
        setDrillNote(`作业 ${job.name || job.id} 无产物可下钻`);
        return;
      }
      const pop = await wm.popOut('result', `${job.id}:${artifactName}`);
      if (!pop?.ok) setDrillNote(pop?.error || '下钻失败');
    } catch (e) {
      setDrillNote(e instanceof Error ? e.message : '下钻失败');
    }
  }, []);

  return (
    <WindowShell
      title="指挥中心"
      badge="多任务俯瞰 · 只读投影"
      closeBehavior="close"
      subtitle={`最近 ${Math.min(jobs.length, MAX_TILES)} 个作业 · 5s 刷新`}
    >
      <div className={styles.gridWrap}>
        {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}
        {drillNote && <div className={styles.drillNote} role="status">{drillNote}</div>}
        {jobs.length === 0 && !loadError && (
          <div className={styles.empty}>暂无作业记录——运行一个分析后，瓦片会出现在这里。</div>
        )}
        <div className={styles.grid}>
          {jobs.map((job) => (
            <button
              key={job.id}
              type="button"
              className={styles.tile}
              data-status={job.status}
              onClick={() => void handleDrill(job)}
              title="点击下钻到结果独立窗"
            >
              <div className={styles.tileHead}>
                <span className={styles.statusDot} data-status={job.status} />
                <strong className={styles.tileName}>{job.name || job.tool_id}</strong>
              </div>
              <div className={styles.tileMeta}>
                <span>{job.tool_id}</span>
                {job.execution_target_id && (
                  <span className={styles.remoteBadge}>远程 · {job.execution_target_id}</span>
                )}
              </div>
              <div className={styles.tileStatus}>
                <span data-status={job.status}>{STATUS_LABEL[job.status] || job.status}</span>
                <span>
                  {job.status === 'running' || job.status === 'pending'
                    ? `已 ${formatElapsed(job.created_at, now)}`
                    : job.completed_at
                      ? `耗时 ${formatElapsed(job.created_at, job.completed_at)}`
                      : ''}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </WindowShell>
  );
}
