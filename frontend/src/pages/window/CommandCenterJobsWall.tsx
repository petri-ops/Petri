// ============================================================
// CommandCenterJobsWall — 指挥中心瓦片墙核心（UI-362 从 CommandCenterPage 提取）。
//
// 单一事实源不变（BLOCK-59 plan §10 治理红线）：只读 /api/tools/history
// 既有 REST（tool_jobs 表投影），5s 轮询；**零本地任务状态缓存**。
//
// 两个宿主：
// - 独立窗 CommandCenterPage（projectId=null）：全局俯瞰，瓦片带项目归属标注；
// - 右栏「指挥中心」tab（projectId=当前项目）：项目绑定俯瞰，瓦片不带项目标注。
//
// 行动作用于两宿主一致：活跃（running/pending）置顶；查日志（1s 轮询）+
// 两步确认取消；done/failed 瓦片点击下钻 = L1 结果窗弹出（桌面桥缺失时诚实提示）。
// ============================================================
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { listAllJobs, listProjects } from '@/lib/project-store';
import type { ToolJob } from '@/lib/project-types';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { isActiveJob, orderJobsForWall } from './commandCenterModel';
import styles from './command-center.module.css';

const POLL_MS = 5000;
const LOG_POLL_MS = 1000;
const MAX_TILES = 12;

const STATUS_LABEL: Record<ToolJob['status'], string> = {
  pending: '排队中',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function formatElapsed(fromMs: number, toMs: number): string {
  const sec = Math.max(0, Math.round((toMs - fromMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m${sec % 60}s`;
  return `${Math.floor(min / 60)}h${min % 60}m`;
}

interface LogView {
  text: string;
  source: string | null;
  live: boolean;
  note?: string;
}

export interface CommandCenterJobsWallProps {
  /** 非空 = 只看该项目（右栏 tab 项目绑定俯瞰）；null = 全部项目（独立窗）。 */
  projectId: string | null;
  emptyText: React.ReactNode;
  onStatsChange?: (stats: { active: number; history: number }) => void;
}

export function CommandCenterJobsWall({
  projectId,
  emptyText,
  onStatsChange,
}: CommandCenterJobsWallProps): React.ReactElement {
  const [jobs, setJobs] = useState<ToolJob[]>([]);
  const [loadError, setLoadingError] = useState('');
  const [drillNote, setDrillNote] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [projectNames, setProjectNames] = useState<Record<string, string>>({});
  const [logJobId, setLogJobId] = useState<string | null>(null);
  const [logView, setLogView] = useState<LogView | null>(null);
  const [cancelArmedId, setCancelArmedId] = useState<string | null>(null);
  const jobsRef = useRef<ToolJob[]>([]);
  jobsRef.current = jobs;
  const logJobRef = useRef<string | null>(null);
  logJobRef.current = logJobId;

  const refresh = useCallback(async () => {
    try {
      const data = await listAllJobs();
      const scoped = projectId ? data.filter((job) => job.project_id === projectId) : data;
      // 活跃置顶后截 12：running/pending 不再被连续历史作业挤出墙（§3 #4）
      setJobs(orderJobsForWall(scoped).ordered.slice(0, MAX_TILES));
      setLoadingError('');
    } catch (e) {
      setLoadingError(e instanceof Error ? e.message : '作业状态获取失败');
    }
  }, [projectId]);

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

  // P1-a：项目归属标注（job.project_id → 项目名；失败静默降级为裸 id）。
  // 仅全局俯瞰需要（项目绑定视图单项目，无标注意义）。
  const showProjectTag = projectId === null;
  useEffect(() => {
    if (!showProjectTag) return undefined;
    let alive = true;
    void listProjects()
      .then((projects) => {
        if (!alive) return;
        setProjectNames(Object.fromEntries(projects.map((p) => [p.id, p.name])));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showProjectTag]);

  // P1-b：日志拉取（展开期间 1s 轮询；作业终态后由后端返回静态 run.log，无需特判）
  // BLOCK-105 §7 Batch-7 — tools 日志/状态/取消 REST 信封 wire 形状（JSON 解析出站边界契约文档；
  // 字段 optional＝后端可能发任意 JSON，运行时防御 ?. 保持原样）。
  type ToolsEnvelope = {
    ok?: unknown;
    log?: string;
    source?: string | null;
    live?: boolean;
    note?: string;
    error?: string;
    message?: string;
    result?: { artifacts?: Array<{ name?: string; filename?: string }>; files?: Array<{ name?: string; filename?: string }> } | null;
    files?: Array<{ name?: string; filename?: string }>;
  } | null;

  useEffect(() => {
    if (!logJobId) return;
    let alive = true;
    const fetchOnce = async () => {
      const id = logJobRef.current;
      if (!id) return;
      try {
        const token = getToken();
        const resp = await fetch(`${getApiPrefix('r')}/tools/log/${encodeURIComponent(id)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await resp.json().catch(() => null)) as ToolsEnvelope;
        if (!alive || logJobRef.current !== id) return;
        if (data?.ok) {
          setLogView({ text: data.log || '', source: data.source ?? null, live: data.live === true, note: data.note });
        } else {
          setLogView({ text: '', source: null, live: false, note: data?.error || `日志获取失败（HTTP ${resp.status}）` });
        }
      } catch (e) {
        if (alive && logJobRef.current === id) {
          setLogView({ text: '', source: null, live: false, note: e instanceof Error ? e.message : '日志获取失败' });
        }
      }
    };
    void fetchOnce();
    const timer = window.setInterval(() => void fetchOnce(), LOG_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [logJobId]);

  // 两步取消的武装态 3s 自动解除，避免误留「确认取消？」长期挂起
  useEffect(() => {
    if (!cancelArmedId) return;
    const timer = window.setTimeout(() => setCancelArmedId(null), 3000);
    return () => window.clearTimeout(timer);
  }, [cancelArmedId]);

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
      const data = (await resp.json().catch(() => null)) as ToolsEnvelope;
      const res = (data?.result || data) as { artifacts?: Array<{ name?: string; filename?: string }>; files?: Array<{ name?: string; filename?: string }> };
      const files = res?.artifacts || res?.files || [];
      const artifactName = files[0]?.name || files[0]?.filename || null;
      if (!artifactName) {
        setDrillNote(`作业 ${job.name || job.id} 无产物可下钻`);
        return;
      }
      // UI-385 — 结果独立窗退役：下钻转发主窗右栏打开（跨项目自动导航）
      const pop = await wm.openResultInMainWindow({
        type: 'gewu:project-open-artifact',
        detail: { jobId: job.id, artifactName, projectId: job.project_id || null },
      });
      if (!pop?.ok) setDrillNote(pop?.error || pop?.code || '下钻失败');
    } catch (e) {
      setDrillNote(e instanceof Error ? e.message : '下钻失败');
    }
  }, []);

  const toggleLog = useCallback((jobId: string) => {
    setLogView(null);
    setCancelArmedId(null);
    setLogJobId((prev) => (prev === jobId ? null : jobId));
  }, []);

  const handleCancel = useCallback(
    async (job: ToolJob) => {
      setDrillNote(null);
      try {
        const token = getToken();
        const resp = await fetch(`${getApiPrefix('r')}/tools/cancel/${encodeURIComponent(job.id)}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await resp.json().catch(() => null)) as ToolsEnvelope;
        if (!resp.ok || data?.ok === false) {
          setDrillNote(`取消失败：${data?.error || `HTTP ${resp.status}`}`);
        } else {
          setDrillNote(data?.message === 'already_finished' ? '作业已结束，无需取消' : `已请求取消 ${job.name || job.id}`);
        }
      } catch (e) {
        setDrillNote(e instanceof Error ? e.message : '取消失败');
      }
      setCancelArmedId(null);
      void refresh();
    },
    [refresh],
  );

  const activeCount = jobs.filter(isActiveJob).length;
  const historyCount = jobs.length - activeCount;

  const stats = { active: activeCount, history: historyCount };
  const onStatsChangeRef = useRef(onStatsChange);
  onStatsChangeRef.current = onStatsChange;
  useEffect(() => {
    onStatsChangeRef.current?.(stats);
  }, [stats.active, stats.history]);

  return (
    <div className={styles.gridWrap}>
      {loadError && <div className={styles.loadError} role="alert">{loadError}</div>}
      {drillNote && <div className={styles.drillNote} role="status">{drillNote}</div>}
      {jobs.length === 0 && !loadError && (
        <div className={styles.empty}>{emptyText}</div>
      )}
      <div className={styles.grid}>
        {jobs.map((job) => {
          const active = isActiveJob(job);
          const logOpen = logJobId === job.id;
          const body = (
            <>
              <div className={styles.tileHead}>
                <span className={styles.statusDot} data-status={job.status} />
                <strong className={styles.tileName}>{job.name || job.tool_id}</strong>
              </div>
              <div className={styles.tileMeta}>
                <span>{job.tool_id}</span>
                {showProjectTag && job.project_id && (
                  <span className={styles.projectTag} title={job.project_id}>
                    {projectNames[job.project_id] || job.project_id}
                  </span>
                )}
                {job.execution_target_id && (
                  <span className={styles.remoteBadge} title={`远程执行目标 ${job.execution_target_id}`}>
                    远程
                  </span>
                )}
              </div>
              {job.status === 'failed' && job.error && (
                <div className={styles.tileError} title={job.error}>
                  {job.error}
                </div>
              )}
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
            </>
          );
          if (active) {
            return (
              <div
                key={job.id}
                className={styles.tile}
                data-status={job.status}
                data-job-id={job.id}
                data-testid="cc-tile-active"
              >
                {body}
                <div className={styles.tileActions}>
                  <button
                    type="button"
                    className={logOpen ? styles.actionBtnActive : styles.actionBtn}
                    onClick={() => toggleLog(job.id)}
                  >
                    {logOpen ? '收起日志' : '查日志'}
                  </button>
                  {cancelArmedId === job.id ? (
                    <button
                      type="button"
                      className={styles.cancelArmBtn}
                      onClick={() => void handleCancel(job)}
                      title="再次点击确认取消（3 秒后自动还原）"
                    >
                      确认取消？
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={styles.actionBtn}
                      onClick={() => setCancelArmedId(job.id)}
                    >
                      取消
                    </button>
                  )}
                </div>
                {logOpen && (
                  <pre className={styles.tileLog} data-testid="cc-tile-log">
                    {logView ? logView.note || logView.text || '（空日志）' : '加载中…'}
                  </pre>
                )}
              </div>
            );
          }
          return (
            <button
              key={job.id}
              type="button"
              className={styles.tile}
              data-status={job.status}
              data-job-id={job.id}
              data-testid="cc-tile-history"
              onClick={() => void handleDrill(job)}
              title="点击下钻到结果独立窗"
            >
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}
