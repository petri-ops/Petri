/**
 * BackendPage — BLOCK-72 / UI-320 后端全局工作台页（/backend）
 *
 * biof3-server 是全局单进程，进程观测面从项目工作区右栏「后端」tab 迁出至全局能力区。
 * 复用 TerminalPanel（project 放宽可选：仅影响 workspacePath 展示与 openShell cwd，
 * 全局态回退数据根目录）；backendStatus 经 App 根 BackendStatusProvider 获取。
 * 边界：底部终端（BLOCK-54 用户侧多 tab 终端）不在此页范围。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { TerminalPanel } from '@/pages/project-workspace';
import styles from '../global-page.module.css';

export default function BackendPage(): React.ReactElement {
  const navigate = useNavigate();
  const backendStatus = useBackendStatus();

  const handleReturnBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  }, [navigate]);

  return (
    <div className={styles.page} data-testid="backend-page">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleReturnBack}
          title="返回"
          aria-label="返回"
        >
          <Icon name="arrow-left" size={16} />
        </button>
        <div className={styles.pageIcon}>
          <Icon name="cpu" size={20} />
        </div>
        <div className={styles.titleWrap}>
          <span className={styles.title}>后端</span>
          <span className={styles.subtitle}>全局后端进程 · 状态 / 日志 / 打开 Shell（非项目关联）</span>
        </div>
      </header>
      <div className={styles.body}>
        <TerminalPanel backendStatus={backendStatus} />
      </div>
    </div>
  );
}
