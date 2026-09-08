// ============================================================
// EmptyResult — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 3389-3463 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import styles from '../project-workspace.module.css';

export function EmptyResult({
  project,
  onOpenResults,
  onOpenTerminal,
  onOpenBrowser,
  onOpenFiles,
  onOpenChat,
  onOpenReview,
}: {
  project: Project;
  onOpenResults?: () => void;
  onOpenTerminal?: () => void;
  onOpenBrowser?: () => void;
  onOpenFiles?: () => void;
  onOpenChat?: () => void;
  /** BLOCK-28.2 — 打开右侧审阅停靠面板（CodeReview）。 */
  onOpenReview?: () => void;
}): React.ReactElement {
  return (
    <div className={styles.emptyResult}>
      <div className={styles.emptyResultIcon}>
        <Icon name="zap" size={40} />
      </div>
      <h2 className={styles.emptyResultTitle}>开始工作</h2>
      <p className={styles.emptyResultDesc}>
        打开后端、浏览器、文件或侧边聊天，继续当前项目的分析与协作。
      </p>
      <p className={styles.emptyResultProject}>项目：{project.name}</p>
      <div className={styles.emptyResultLaunchpad}>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenResults} disabled={!onOpenResults}>
          <Icon name="bar-chart" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>结果</span>
            <small>查看当前分析产物</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenTerminal} disabled={!onOpenTerminal}>
          <Icon name="terminal" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>后端</span>
            <small>查看服务状态与日志</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenBrowser} disabled={!onOpenBrowser}>
          <Icon name="globe" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>浏览器</span>
            <small>打开网页或本地站点</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenFiles} disabled={!onOpenFiles}>
          <Icon name="folder" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>文件</span>
            <small>浏览项目目录</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenChat} disabled={!onOpenChat}>
          <Icon name="sidebar" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>侧边聊天</span>
            <small>打开右侧会话面板</small>
          </div>
        </button>
        <button type="button" className={styles.emptyResultLaunchCard} onClick={onOpenReview} disabled={!onOpenReview}>
          <Icon name="git-branch" size={16} />
          <div className={styles.emptyResultLaunchText}>
            <span>审阅</span>
            <small>审阅工作区改动（接受/拒绝/提交）</small>
          </div>
        </button>
      </div>
    </div>
  );
}
