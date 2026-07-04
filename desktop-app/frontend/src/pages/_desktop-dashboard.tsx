/**
 * DesktopDashboard — 桌面版首页工作台
 *
 * 取代 Web 版的营销首页，提供软件化的启动体验：
 * - 最近运行任务（从 /tools/history API 拉取）
 * - 快捷工具入口（常用工具一键启动）
 * - 推荐教程 / 学习进度
 * - 全局搜索快捷方式
 */

import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { getToken, getApiPrefix, getStoredUser, isLoggedIn } from '@/lib/authClient';
import { Icon } from '@/components/icons/Icon';
import { tools, toolCategories } from '@/pages/_data';
import type { Tool } from '@/pages/_data';
import { TOOL_IMAGES } from '@/pages/_tool-images';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import styles from './_desktop-dashboard.module.css';

interface Job {
  id: string;
  tool_id: string;
  status: string;
  created_at: number;
  completed_at?: number;
  error?: string;
  name?: string;
}

const QUICK_TOOLS: string[] = [
  'deseq2',
  'go-kegg',
  'gsea',
  'km-survival',
  'seurat-standard',
  'spatial-standard',
];

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    completed: '已完成',
    failed: '失败',
    running: '运行中',
    pending: '排队中',
    uploading: '提交中',
  };
  return map[s] || s;
}

function statusClass(s: string): string {
  if (s === 'completed') return styles.statusCompleted;
  if (s === 'failed') return styles.statusFailed;
  if (s === 'running' || s === 'pending' || s === 'uploading') return styles.statusRunning;
  return '';
}

export function DesktopDashboard(): React.ReactElement {
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [dataDir, setDataDir] = useState<string>('');
  const [hasUpdate, setHasUpdate] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  // M2-6 / E4：更新触发闭环状态
  const [updOpen, setUpdOpen] = useState(false);
  const [updDownloading, setUpdDownloading] = useState(false);
  const [updProgress, setUpdProgress] = useState(0); // 0..1
  const [updDownloaded, setUpdDownloaded] = useState(false);
  const [updError, setUpdError] = useState('');
  const [updInstalling, setUpdInstalling] = useState(false);
  // M2-8：备份/导出闭环
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [backupPromptDismissed, setBackupPromptDismissed] = useState(false);
  const user = getStoredUser();
  const backendStatus = useBackendStatus();

  const fetchRecentJobs = useCallback(async () => {
    if (!isLoggedIn()) {
      setLoadingJobs(false);
      return;
    }
    try {
      const token = getToken();
      const resp = await fetch(getApiPrefix() + '/tools/history', {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await resp.json();
      if (data.ok) {
        // 只取最近 6 条
        setRecentJobs((data.jobs || []).slice(0, 6));
      }
    } catch {
      // ignore
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  // M2-1：拉数据目录信息
  useEffect(() => {
    (async () => {
      try {
        const info = await window.biof3Desktop?.data?.info();
        if (info?.ok && info.dataDir) setDataDir(info.dataDir);
      } catch {
        // ignore
      }
    })();
  }, []);

  // M2-8：首次提示"建议定期备份"
  useEffect(() => {
    try {
      if (!localStorage.getItem('biof3-backup-prompted')) {
        // 首次进入，标记已提示；横幅可通过关闭按钮临时隐藏
        localStorage.setItem('biof3-backup-prompted', '1');
      } else {
        setBackupPromptDismissed(true);
      }
    } catch {
      // ignore
    }
  }, []);

  // M2-8：导出我的数据（zip 打包整个数据目录 + 日志）
  const handleExportData = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportMsg('');
    try {
      const r = await window.biof3Desktop?.diagnostic?.export();
      if (r?.ok) {
        setExportMsg(`已导出到：${r.path}`);
      } else {
        setExportMsg(r?.error === 'cancelled' ? '已取消' : `导出失败：${r?.error || '未知错误'}`);
      }
    } catch (e: unknown) {
      setExportMsg(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
      // 3 秒后清空消息
      setTimeout(() => setExportMsg(''), 3000);
    }
  }, [exporting]);

  // M2-1：启动时检查更新
  useEffect(() => {
    (async () => {
      try {
        const r = await window.biof3Desktop?.updater?.check();
        if (r?.ok && r.hasUpdate) {
          setHasUpdate(true);
          setUpdateVersion(r.info?.version || r.version || '');
        }
      } catch {
        // ignore
      }
    })();
  }, []);

  // M2-6 / E4：监听更新下载进度 / 完成 / 错误
  useEffect(() => {
    const u = window.biof3Desktop?.updater;
    if (!u) return;
    const offProgress = u.onDownloadProgress?.((p) => {
      setUpdProgress(p?.ratio ?? 0);
    });
    const offDone = u.onUpdateDownloaded?.(() => {
      setUpdDownloading(false);
      setUpdProgress(1);
      setUpdDownloaded(true);
    });
    const offErr = u.onError?.((msg: string) => {
      setUpdDownloading(false);
      setUpdInstalling(false);
      setUpdError(msg || '更新失败');
    });
    return () => {
      offProgress?.();
      offDone?.();
      offErr?.();
    };
  }, []);

  // M2-6 / E4：点击"下载并重启"
  const handleDownload = useCallback(async () => {
    setUpdError('');
    setUpdDownloading(true);
    setUpdProgress(0);
    setUpdDownloaded(false);
    try {
      const r = await window.biof3Desktop?.updater?.download();
      if (r && !r.ok) {
        setUpdDownloading(false);
        setUpdError(r.error || '下载失败');
      }
    } catch (e) {
      setUpdDownloading(false);
      setUpdError(String(e) || '下载失败');
    }
  }, []);

  // M2-6 / E4：下载完成 → 安装并重启
  const handleInstall = useCallback(async () => {
    setUpdError('');
    setUpdInstalling(true);
    try {
      await window.biof3Desktop?.updater?.install();
      // install() 会触发 quitAndInstall，应用会重启
    } catch (e) {
      setUpdInstalling(false);
      setUpdError(String(e) || '重启失败');
    }
  }, []);

  useEffect(() => {
    fetchRecentJobs();
    const id = setInterval(fetchRecentJobs, 30_000);
    return () => clearInterval(id);
  }, [fetchRecentJobs]);

  const quickToolList = tools.filter((t) => QUICK_TOOLS.includes(t.id));

  // M2-1：就绪灯颜色
  const readyColor = backendStatus.isReady
    ? '#16a34a'
    : backendStatus.downReason
      ? '#dc2626'
      : '#f59e0b';
  const readyLabel = backendStatus.isReady ? '后端就绪' : backendStatus.downReason || '检测中…';

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{user ? `欢迎回来，${user.username}` : '欢迎回来'}</h1>
          <p className={styles.subtitle}>继续上次的分析，或探索新的工具</p>
        </div>
        <div className={styles.headerSearch}>
          {/* M2-1：顶栏状态条——就绪灯 / 数据目录 / 更新红点 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginRight: '12px' }}>
            <span
              title={readyLabel}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '12px',
                color: 'var(--biof3-text-muted, #5c6b64)',
              }}
            >
              <span
                style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: readyColor,
                  display: 'inline-block',
                  boxShadow: `0 0 6px ${readyColor}`,
                }}
              />
              {readyLabel}
            </span>
            {dataDir && (
              <button
                type="button"
                onClick={() => window.biof3Desktop?.data?.openDir()}
                title={dataDir}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  color: 'var(--biof3-text-muted, #5c6b64)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                  maxWidth: '160px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                📁 {dataDir.split('/').pop()}
              </button>
            )}
            {/* M2-8：导出我的数据 */}
            <button
              type="button"
              onClick={handleExportData}
              disabled={exporting}
              title="将数据目录（数据库 + 结果 + 上传文件）打包成 zip 导出"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                fontSize: '12px',
                color: 'var(--biof3-text-muted, #5c6b64)',
                background: 'none',
                border: '1px solid var(--biof3-border, #e2e8f0)',
                borderRadius: '6px',
                cursor: exporting ? 'wait' : 'pointer',
                padding: '3px 8px',
                opacity: exporting ? 0.6 : 1,
              }}
            >
              {exporting ? '⏳ 导出中…' : '📤 导出我的数据'}
            </button>
            {exportMsg && (
              <span
                style={{
                  fontSize: '11px',
                  color: 'var(--biof3-text-muted, #5c6b64)',
                  maxWidth: '200px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={exportMsg}
              >
                {exportMsg}
              </span>
            )}
            {hasUpdate && (
              <button
                type="button"
                onClick={() => setUpdOpen(true)}
                title={`有新版本 ${updateVersion}，点击下载并重启`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  color: '#dc2626',
                  fontWeight: 600,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span
                  style={{
                    width: '8px',
                    height: '8px',
                    borderRadius: '50%',
                    background: '#dc2626',
                    display: 'inline-block',
                  }}
                />
                有更新
              </button>
            )}
          </div>
          <button
            className={styles.searchBtn}
            onClick={() => window.dispatchEvent(new CustomEvent('biof3:open-search'))}
          >
            <Icon name="search" size={18} />
            <span>搜索教程、工具、结果…</span>
            <kbd className={styles.kbd}>⌘K</kbd>
          </button>
        </div>
      </header>

      {/* M2-8：首次提示"建议定期备份" */}
      {!backupPromptDismissed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '12px 16px',
            marginBottom: '16px',
            background: 'var(--biof3-surface-warn, #fef3c7)',
            borderRadius: '10px',
            border: '1px solid #f59e0b',
          }}
        >
          <span style={{ fontSize: '18px' }}>💡</span>
          <div style={{ flex: 1, fontSize: '13px' }}>
            <strong>建议定期备份你的数据</strong>
            <span style={{ marginLeft: '8px', color: 'var(--biof3-text-muted, #5c6b64)' }}>
              点击"导出我的数据"将数据库、分析结果与上传文件打包成 zip，保存到安全位置。
            </span>
          </div>
          <button
            type="button"
            onClick={() => setBackupPromptDismissed(true)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '16px',
              color: 'var(--biof3-text-muted, #5c6b64)',
              padding: 0,
            }}
            title="关闭提示"
          >
            ×
          </button>
        </div>
      )}

      {/* 快捷工具 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="zap" size={18} />
          快速开始
        </h2>
        <div className={styles.toolGrid}>
          {quickToolList.map((t) => (
            <Link key={t.id} className={styles.toolCard} to={`/tools#${t.id}`} title={t.title}>
              {TOOL_IMAGES[t.id] ? (
                <img
                  src={TOOL_IMAGES[t.id]}
                  alt={t.title}
                  className={styles.toolCover}
                  loading="lazy"
                />
              ) : (
                <div className={styles.toolIconCircle} style={{ background: t.color }}>
                  {t.title[0]}
                </div>
              )}
              <div className={styles.toolMeta}>
                <span className={styles.toolName}>{t.title}</span>
                <span className={styles.toolCat}>{t.category}</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* 最近任务 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="clock" size={18} />
          最近运行
          <Link className={styles.sectionLink} to="/tools">
            查看全部 →
          </Link>
        </h2>
        {loadingJobs ? (
          <div className={styles.emptyState}>
            <div className={styles.spinner} />
            加载中…
          </div>
        ) : recentJobs.length === 0 ? (
          <div className={styles.emptyState}>
            <p>暂无运行记录</p>
            <Link className={styles.emptyCta} to="/tools">
              去工具页开始第一次分析 →
            </Link>
          </div>
        ) : (
          <div className={styles.jobList}>
            {recentJobs.map((job) => {
              const tool = tools.find((t) => t.id === job.tool_id);
              return (
                <Link key={job.id} className={styles.jobItem} to={`/tools#${job.tool_id}`}>
                  <span
                    className={`${styles.jobDot} ${statusClass(job.status)}`}
                    title={statusLabel(job.status)}
                  />
                  <div className={styles.jobInfo}>
                    <span className={styles.jobName}>{job.name || tool?.title || job.tool_id}</span>
                    <span className={styles.jobTime}>{formatTime(job.created_at)}</span>
                  </div>
                  <span className={`${styles.jobStatusBadge} ${statusClass(job.status)}`}>
                    {statusLabel(job.status)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* M2-1：未装运行时引导 */}
      {!backendStatus.rRuntime && (
        <section className={styles.section}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '16px',
              background: 'var(--biof3-surface-warn, #fef3c7)',
              borderRadius: '10px',
              border: '1px solid #f59e0b',
            }}
          >
            <span style={{ fontSize: '20px' }}>⚠️</span>
            <div style={{ flex: 1 }}>
              <strong style={{ display: 'block', marginBottom: '4px' }}>R 运行时未安装</strong>
              <span style={{ fontSize: '13px', color: 'var(--biof3-text-muted, #5c6b64)' }}>
                分析工具需要 R 运行时，去插件商店安装后即可开始
              </span>
            </div>
            <Link className={styles.emptyCta} to="/admin" style={{ flexShrink: 0 }}>
              去插件商店 →
            </Link>
          </div>
        </section>
      )}

      {/* 推荐教程 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="book" size={18} />
          推荐教程
        </h2>
        <div className={styles.tutorialGrid}>
          {[
            { title: '单细胞标准分析流程', href: '/docs/single-cell/module01', tag: '单细胞' },
            { title: 'DESeq2 差异表达分析', href: '/docs/bulk-rnaseq/module01', tag: 'bulk' },
            { title: '空间转录组入门', href: '/docs/single-cell/module10', tag: '空间组学' },
            { title: '机器学习生存预测', href: '/docs/machine-learning/module01', tag: 'ML' },
          ].map((item) => (
            <Link key={item.href} className={styles.tutorialCard} to={item.href}>
              <span className={styles.tutorialTag}>{item.tag}</span>
              <span className={styles.tutorialTitle}>{item.title}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* M2-6 / E4：下载并重启对话框 */}
      {updOpen && (
        <div
          className={styles.updOverlay}
          onClick={() => !updDownloading && !updInstalling && setUpdOpen(false)}
        >
          <div className={styles.updModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.updTitle}>
              发现新版本{updateVersion ? ` ${updateVersion}` : ''}
            </h3>
            <p className={styles.updBody}>
              {updDownloaded
                ? '更新已下载完成，点击下方按钮安装并重启应用。'
                : updDownloading
                  ? '正在下载更新，请勿关闭应用…'
                  : '下载最新版本并安装，安装过程中应用将自动重启。'}
            </p>

            {(updDownloading || updDownloaded) && (
              <div>
                <div className={styles.updBar}>
                  <div
                    className={styles.updBarFill}
                    style={{ width: `${Math.round(updProgress * 100)}%` }}
                  />
                </div>
                <div className={styles.updPct}>{Math.round(updProgress * 100)}%</div>
              </div>
            )}

            {updError && <div className={styles.updErr}>{updError}</div>}

            <div className={styles.updActions}>
              <button
                type="button"
                className={styles.updBtn}
                onClick={() => !updDownloading && !updInstalling && setUpdOpen(false)}
                disabled={updDownloading || updInstalling}
              >
                取消
              </button>
              {updDownloaded ? (
                <button
                  type="button"
                  className={`${styles.updBtn} ${styles.updBtnPrimary}`}
                  onClick={handleInstall}
                  disabled={updInstalling}
                >
                  {updInstalling ? '重启中…' : '下载并重启'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.updBtn} ${styles.updBtnPrimary}`}
                  onClick={handleDownload}
                  disabled={updDownloading}
                >
                  {updDownloading ? '下载中…' : '下载并重启'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DesktopDashboard;
