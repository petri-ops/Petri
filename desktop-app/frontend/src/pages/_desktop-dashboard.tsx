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
            {hasUpdate && (
              <Link
                to="/admin"
                title={`有新版本 ${updateVersion}，点击查看`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '12px',
                  color: '#dc2626',
                  fontWeight: 600,
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
              </Link>
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
    </div>
  );
}

export default DesktopDashboard;
