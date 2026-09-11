/**
 * KnowledgePage — BLOCK-72 / UI-320 知识空间全局工作台页（/knowledge）
 *
 * 知识空间是设备级全局域（BLOCK-69 D1 单行 default 空间），管理面从项目工作区右栏
 * 迁出至全局能力区（对标 /skills 先例）。面板组件复用 KnowledgeSpacePanel（零项目依赖）。
 * composer 大脑开关保留在会话内（快捷启停是态，本页是管理面）。
 */

import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { KnowledgeSpacePanel } from '@/components/workspace-panels/KnowledgeSpacePanel';
import styles from '../global-page.module.css';

export default function KnowledgePage(): React.ReactElement {
  const navigate = useNavigate();
  const handleReturnBack = useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else navigate('/');
  }, [navigate]);

  return (
    <div className={styles.page} data-testid="knowledge-page">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleReturnBack}
          title="返回"
          aria-label="返回"
        >
          <Icon name="arrow-left" size={16} />
          <span>返回</span>
        </button>
        <div className={styles.pageIcon}>
          <Icon name="brain" size={20} />
        </div>
        <div className={styles.titleWrap}>
          <span className={styles.title}>知识空间</span>
          <span className={styles.subtitle}>全局知识库 · 启用后对话自动检索（非项目/会话关联）</span>
        </div>
      </header>
      <div className={styles.body}>
        <KnowledgeSpacePanel />
      </div>
    </div>
  );
}
