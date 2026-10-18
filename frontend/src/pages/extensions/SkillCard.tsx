/**
 * SkillCard — 技能卡片组件
 * 显示技能的概要信息，支持查看详情和执行操作
 */

import React, { useCallback } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Skill } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

/** BLOCK-176 W7 CP-21 — 依赖自检三态（/api/skills/preflight 数据面；仅本卡消费不导出）。 */
interface SkillDepsState {
  status: 'available' | 'installable' | 'missing_deps' | 'blocked_platform';
  missingBins: string[];
  /** BLOCK-211（W8 · C-33）：插件硬依赖缺失清单（preflight 已纳入 plugins.required）。 */
  missingPlugins?: string[];
  install?: string | null;
}

interface SkillCardProps {
  skill: Skill;
  onViewDetail: (skill: Skill) => void;
  onExecute: (skill: Skill) => void;
  canExecute?: boolean;
  deps?: SkillDepsState | null;
}

const DEPS_STATUS_LABELS: Record<SkillDepsState['status'], string> = {
  available: '依赖可用',
  installable: '依赖待装',
  missing_deps: '缺依赖',
  blocked_platform: '平台不适用',
};

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
  deps = null,
}: SkillCardProps): React.ReactElement {
  // 声明了 requires.bins 的技能才显示依赖徽章（数据面 preflight 未达时如实不显示状态色）
  const declaredBins = (skill as Skill & { dependencies?: { requiresBins?: string[] } | null }).dependencies?.requiresBins ?? [];
  // 插件硬依赖同样算"声明了依赖"：否则生物信息学两族永远不显示徽章（正是"货架可见不可用"）
  const declaredPlugins = Array.isArray(skill.plugins?.required) ? skill.plugins.required : [];
  const showDeps = (declaredBins.length > 0 || declaredPlugins.length > 0) && !!deps;
  const handleViewDetail = useCallback(() => {
    onViewDetail(skill);
  }, [skill, onViewDetail]);

  const handleExecute = useCallback(() => {
    onExecute(skill);
  }, [skill, onExecute]);

  const isDisabled = skill.disabled === true;

  return (
    <article
      className={styles.skillCard}
      style={isDisabled ? { opacity: 0.55 } : undefined}
      data-disabled={isDisabled || undefined}
    >
      <header className={styles.cardHeader}>
        <div className={styles.cardTitleRow}>
          <h3 className={styles.cardTitle}>{skill.name}</h3>
          <span className={styles.cardVersion}>v{skill.version}</span>
        </div>
        <span className={`${styles.sourceBadge} ${styles[SOURCE_COLORS[skill.source] ?? '']}`}>
          {SOURCE_LABELS[skill.source] ?? skill.source}
        </span>
        {isDisabled && (
          <span className={styles.sourceBadge} data-testid={`skill-disabled-${skill.id}`}>已停用</span>
        )}
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
        {showDeps && deps && (
          <span
            className={styles.pluginCount}
            title={
              deps.status !== 'available' && (deps.missingBins.length > 0 || (deps.missingPlugins?.length ?? 0) > 0)
                ? [
                  deps.missingBins.length > 0 ? `缺二进制：${deps.missingBins.join(', ')}${deps.install ? `（安装：${deps.install}）` : ''}` : '',
                  (deps.missingPlugins?.length ?? 0) > 0 ? `缺插件包：${deps.missingPlugins?.join(', ')}` : '',
                ].filter(Boolean).join('；')
                : undefined
            }
            data-testid={`skill-deps-${skill.id}`}
          >
            <Icon name="puzzle" size={12} />
            {DEPS_STATUS_LABELS[deps.status]}
          </span>
        )}
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
          disabled={!canExecute || isDisabled}
          title={isDisabled ? '技能已停用——在详情中重新启用' : undefined}
        >
          <Icon name="play" size={14} />
          执行
        </button>
      </footer>
    </article>
  );
}
