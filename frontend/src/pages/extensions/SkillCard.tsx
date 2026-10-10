/**
 * SkillCard — 技能卡片组件
 * 显示技能的概要信息，支持查看详情和执行操作
 */

import React, { useCallback } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Skill } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

interface SkillCardProps {
  skill: Skill;
  onViewDetail: (skill: Skill) => void;
  onExecute: (skill: Skill) => void;
  canExecute?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  'built-in': '内置',
  'installed': '已安装',
};

const SOURCE_COLORS: Record<string, string> = {
  'built-in': 'sourceBuiltin',
  'installed': 'sourceInstalled',
};

export function SkillCard({
  skill,
  onViewDetail,
  onExecute,
  canExecute = true,
}: SkillCardProps): React.ReactElement {
  const handleViewDetail = useCallback(() => {
    onViewDetail(skill);
  }, [skill, onViewDetail]);

  const handleExecute = useCallback(() => {
    onExecute(skill);
  }, [skill, onExecute]);

  return (
    <article className={styles.skillCard}>
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h3 className={styles.cardTitle}>{skill.name}</h3>
          <span className={styles.cardVersion}>v{skill.version}</span>
        </div>
        <span className={`${styles.sourceBadge} ${styles[SOURCE_COLORS[skill.source] ?? '']}`}>
          {SOURCE_LABELS[skill.source] ?? skill.source}
        </span>
      </header>

      <p className={styles.cardDescription}>{skill.description}</p>

      <div className={styles.cardTags}>
        {skill.tags.slice(0, 4).map((tag) => (
          <span key={tag} className={styles.tag}>
            {tag}
          </span>
        ))}
        {skill.tags.length > 4 && (
          <span className={styles.tagMore}>+{skill.tags.length - 4}</span>
        )}
      </div>

      <div className={styles.cardMeta}>
        <span className={styles.categoryLabel}>
          <Icon name="folder" size={12} />
          {skill.category}
        </span>
        {skill.plugins.required.length > 0 && (
          <span className={styles.pluginCount}>
            <Icon name="puzzle" size={12} />
            {skill.plugins.required.length} 依赖插件
          </span>
        )}
      </div>

      <footer className={styles.cardActions}>
        <button
          type="button"
          className={styles.detailButton}
          onClick={handleViewDetail}
        >
          <Icon name="info" size={14} />
          查看详情
        </button>
        <button
          type="button"
          className={styles.executeButton}
          onClick={handleExecute}
          disabled={!canExecute}
        >
          <Icon name="play" size={14} />
          执行
        </button>
      </footer>
    </article>
  );
}
