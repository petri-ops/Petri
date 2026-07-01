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
  const user = getStoredUser();

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

  useEffect(() => {
    fetchRecentJobs();
    const id = setInterval(fetchRecentJobs, 30_000);
    return () => clearInterval(id);
  }, [fetchRecentJobs]);

  const quickToolList = tools.filter((t) => QUICK_TOOLS.includes(t.id));

  return (
    <div className={styles.dashboard}>
      <header className={styles.header}>
        <div className={styles.headerCopy}>
          <h1 className={styles.title}>{user ? `欢迎回来，${user.username}` : '欢迎回来'}</h1>
          <p className={styles.subtitle}>继续上次的分析，或探索新的工具</p>
        </div>
        <div className={styles.headerSearch}>
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
