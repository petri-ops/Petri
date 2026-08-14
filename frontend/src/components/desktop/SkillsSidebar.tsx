/**
 * SkillsSidebar — 桌面端 Skills 快速访问侧边栏
 *
 * 提供收藏、最近使用和全部分类 Skills 的快速访问入口，
 * 支持搜索过滤和区域折叠。
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
import styles from './SkillsSidebar.module.css';

export interface Skill {
  id: string;
  name: string;
  description?: string;
  category: string;
  icon?: IconName;
  favorite?: boolean;
  lastUsedAt?: number;
}

export interface SkillsSidebarProps {
  expanded: boolean;
  onToggle: () => void;
  onSkillClick: (skillId: string) => void;
  skills?: Skill[];
  favorites?: string[];
  recentIds?: string[];
}

interface SectionProps {
  title: string;
  icon: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Section({ title, icon, count, defaultOpen = true, children }: SectionProps): React.ReactElement {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={styles.section}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
      >
        <span className={styles.sectionIcon}>{icon}</span>
        <span className={styles.sectionTitle}>{title}</span>
        {count !== undefined && count > 0 && (
          <span className={styles.sectionCount}>{count}</span>
        )}
        <Icon
          name="chevron-right"
          size={14}
          className={`${styles.sectionChevron} ${isOpen ? styles.sectionChevronOpen : ''}`}
        />
      </button>
      {isOpen && <div className={styles.sectionContent}>{children}</div>}
    </div>
  );
}

interface SkillItemProps {
  skill: Skill;
  onClick: (id: string) => void;
}

function SkillItem({ skill, onClick }: SkillItemProps): React.ReactElement {
  const [showTooltip, setShowTooltip] = useState(false);

  const handleClick = useCallback(() => {
    onClick(skill.id);
  }, [skill.id, onClick]);

  return (
    <div
      className={styles.skillItemWrapper}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <button
        type="button"
        className={styles.skillItem}
        onClick={handleClick}
        title={skill.description}
      >
        <span className={styles.skillIcon}>
          {skill.icon ? (
            <Icon name={skill.icon} size={14} />
          ) : (
            <Icon name="zap" size={14} />
          )}
        </span>
        <span className={styles.skillName}>{skill.name}</span>
      </button>
      {showTooltip && skill.description && (
        <div className={styles.tooltip}>
          <div className={styles.tooltipTitle}>{skill.name}</div>
          <div className={styles.tooltipDesc}>{skill.description}</div>
        </div>
      )}
    </div>
  );
}

// 演示数据
const DEMO_SKILLS: Skill[] = [
  { id: 'deg-analysis', name: 'DEG分析', category: '生物信息', description: '差异表达基因分析', icon: 'bar-chart' },
  { id: 'go-enrichment', name: 'GO富集', category: '生物信息', description: 'Gene Ontology 富集分析', icon: 'git-branch' },
  { id: 'volcano-plot', name: 'Volcano图', category: '可视化', description: '火山图可视化', icon: 'zap' },
  { id: 'sample-qc', name: '样本质控', category: '数据处理', description: '样本质量控制', icon: 'check' },
  { id: 'kegg-pathway', name: 'KEGG通路', category: '生物信息', description: 'KEGG 通路富集分析', icon: 'zap' },
  { id: 'pca-analysis', name: 'PCA分析', category: '统计学习', description: '主成分分析', icon: 'layout-grid' },
  { id: 'heatmap', name: '热图', category: '可视化', description: '基因表达热图', icon: 'zap' },
  { id: 'tsne', name: 't-SNE降维', category: '统计学习', description: 't-SNE 降维可视化', icon: 'zap' },
];

export function SkillsSidebar({
  expanded,
  onToggle,
  onSkillClick,
  skills = DEMO_SKILLS,
  favorites = ['deg-analysis', 'go-enrichment'],
  recentIds = ['volcano-plot', 'sample-qc'],
}: SkillsSidebarProps): React.ReactElement {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSkills = useMemo(() => {
    if (!searchQuery.trim()) return skills;
    const query = searchQuery.toLowerCase();
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(query) ||
        s.category.toLowerCase().includes(query) ||
        s.description?.toLowerCase().includes(query)
    );
  }, [skills, searchQuery]);

  const favoriteSkills = useMemo(
    () => filteredSkills.filter((s) => favorites.includes(s.id)),
    [filteredSkills, favorites]
  );

  const recentSkills = useMemo(
    () => {
      const order = new Map(recentIds.map((id, idx) => [id, idx]));
      return filteredSkills
        .filter((s) => recentIds.includes(s.id))
        .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    },
    [filteredSkills, recentIds]
  );

  const groupedSkills = useMemo(() => {
    const groups: Record<string, Skill[]> = {};
    const nonDisplayed = new Set([...favorites, ...recentIds]);
    filteredSkills
      .filter((s) => !nonDisplayed.has(s.id))
      .forEach((skill) => {
        if (!groups[skill.category]) groups[skill.category] = [];
        groups[skill.category].push(skill);
      });
    return groups;
  }, [filteredSkills, favorites, recentIds]);

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearchQuery(e.target.value);
    },
    []
  );

  if (!expanded) {
    return (
      <div className={styles.sidebarCollapsed}>
        <button
          type="button"
          className={styles.collapsedToggle}
          onClick={onToggle}
          title="展开 Skills"
          aria-label="展开 Skills"
        >
          <Icon name="sparkles" size={16} />
        </button>
      </div>
    );
  }

  return (
    <aside className={styles.sidebar} aria-label="Skills 侧边栏">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.toggle}
          onClick={onToggle}
          title="收起 Skills"
          aria-label="收起 Skills"
        >
          <Icon name="chevron-right" size={14} />
        </button>
        <span className={styles.headerTitle}>Skills</span>
        <button
          type="button"
          className={styles.menuBtn}
          onClick={() => {}}
          title="更多选项"
          aria-label="更多选项"
        >
          <Icon name="more-horizontal" size={16} />
        </button>
      </header>

      <div className={styles.searchWrapper}>
        <Icon name="search" size={14} className={styles.searchIcon} />
        <input
          type="text"
          className={styles.searchInput}
          placeholder="搜索..."
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="搜索 Skills"
        />
        {searchQuery && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setSearchQuery('')}
            aria-label="清除搜索"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <div className={styles.content}>
        <Section title="收藏" icon="★" count={favoriteSkills.length}>
          {favoriteSkills.length > 0 ? (
            <ul className={styles.skillList}>
              {favoriteSkills.map((skill) => (
                <li key={skill.id}>
                  <SkillItem skill={skill} onClick={onSkillClick} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyHint}>暂无收藏的 Skills</p>
          )}
        </Section>

        <Section title="最近使用" icon="🕐" count={recentSkills.length}>
          {recentSkills.length > 0 ? (
            <ul className={styles.skillList}>
              {recentSkills.map((skill) => (
                <li key={skill.id}>
                  <SkillItem skill={skill} onClick={onSkillClick} />
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.emptyHint}>暂无最近使用的 Skills</p>
          )}
        </Section>

        <Section title="全部 Skills" icon="📦" count={filteredSkills.length} defaultOpen>
          {Object.entries(groupedSkills).map(([category, categorySkills]) => (
            <div key={category} className={styles.categoryGroup}>
              <div className={styles.categoryLabel}>{category}</div>
              <ul className={styles.skillList}>
                {categorySkills.map((skill) => (
                  <li key={skill.id}>
                    <SkillItem skill={skill} onClick={onSkillClick} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {Object.keys(groupedSkills).length === 0 && filteredSkills.length === 0 && (
            <p className={styles.emptyHint}>
              {searchQuery ? '未找到匹配的 Skills' : '暂无 Skills'}
            </p>
          )}
        </Section>
      </div>
    </aside>
  );
}

export default SkillsSidebar;
