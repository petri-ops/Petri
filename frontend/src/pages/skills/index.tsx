/**
 * Skills 页面入口
 * 技能管理主页面，提供技能浏览、搜索、筛选和执行功能
 */

import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { SkillCard } from './SkillCard';
import { SkillDetail } from './SkillDetail';
import { SkillSearch } from './SkillSearch';
import { useSkillStore, type Skill } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

function computeStats(skills: Skill[]): {
  total: number;
  bySource: Record<string, number>;
} {
  const bySource: Record<string, number> = {
    'built-in': 0,
    'installed': 0,
    'marketplace': 0,
  };

  for (const skill of skills) {
    bySource[skill.source] = (bySource[skill.source] || 0) + 1;
  }

  return { total: skills.length, bySource };
}

export default function SkillsPage(): React.ReactElement {
  const {
    skills,
    filteredSkills,
    loading,
    error,
    searchQuery,
    setSearchQuery,
    sourceFilter,
    setSourceFilter,
    categoryFilter,
    setCategoryFilter,
    categories,
    executions,
    execute,
  } = useSkillStore({ autoLoad: true });

  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [executingSkillId, setExecutingSkillId] = useState<string | null>(null);

  const stats = computeStats(skills);

  const navigate = useNavigate();
  const handleReturnHome = useCallback(() => {
    // Use history.back() to return to the previous page (e.g. project Copilot),
    // rather than navigating to "/" which may redirect to a recent result view.
    if (window.history.length > 1) {
      window.history.back();
    } else {
      void navigate('/');
    }
  }, [navigate]);

  const handleViewDetail = useCallback((skill: Skill) => {
    setSelectedSkill(skill);
  }, []);

  const handleCloseDetail = useCallback(() => {
    setSelectedSkill(null);
  }, []);

  const handleExecute = useCallback(
    async (skill: Skill, params: Record<string, unknown>) => {
      console.log('[SkillsPage] Execute skill:', skill.id, 'with params:', params);
      setExecutingSkillId(skill.id);
      try {
        const result = await execute(skill.id, params);
        if (result.ok) {
          console.log('[SkillsPage] Skill execution started:', result.executionId);
          // Close modal after short delay to show success feedback
          setTimeout(() => {
            setExecutingSkillId(null);
            setSelectedSkill(null);
          }, 800);
        } else {
          console.error('[SkillsPage] Skill execution failed:', result.error);
          setExecutingSkillId(null);
        }
      } catch (err) {
        console.error('[SkillsPage] Execute error:', err);
        setExecutingSkillId(null);
      }
    },
    [execute]
  );

  if (loading) {
    return (
      <div className={styles.skillsPage}>
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner} />
          <span className={styles.loadingText}>加载 Skills...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.skillsPage}>
        <div className={styles.loadingState}>
          <Icon name="alert-circle" size={24} />
          <span className={styles.loadingText}>{error}</span>
          <button
            type="button"
            className={styles.retryBtn}
            onClick={handleReturnHome}
            title="返回"
          >
            <Icon name="arrow-left" size={14} />
            <span>返回</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.skillsPage}>
      <header className={styles.pageHeader}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleReturnHome}
          title="返回"
          aria-label="返回"
        >
          <Icon name="arrow-left" size={16} />
          <span>返回</span>
        </button>
        <div className={styles.pageIcon}>
          <Icon name="command" size={22} />
        </div>
        <h1 className={styles.pageTitle}>Skills</h1>
        <div className={styles.pageStats}>
          <span className={styles.statsBadge}>
            <Icon name="layers" size={12} />
            {stats.total} Skills
          </span>
        </div>
      </header>

      <SkillSearch
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedSource={sourceFilter ?? 'all'}
        onSourceChange={(src) => setSourceFilter(src === 'all' ? null : src)}
        selectedCategory={categoryFilter ?? ''}
        onCategoryChange={(cat) => setCategoryFilter(cat || null)}
        categories={categories}
        stats={stats}
      />

      <div className={styles.skillsGrid}>
        {filteredSkills.length === 0 ? (
          <div className={styles.skillsEmpty}>
            <div className={styles.emptyIcon}>
              <Icon name="search" size={24} />
            </div>
            <h3 className={styles.emptyTitle}>没有找到匹配的 Skills</h3>
            <p className={styles.emptyText}>尝试调整搜索条件或筛选器</p>
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onViewDetail={handleViewDetail}
              onExecute={(s) => handleViewDetail(s)}
              canExecute={executingSkillId === null}
            />
          ))
        )}
      </div>

      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          onClose={handleCloseDetail}
          onExecute={handleExecute}
          canExecute={executingSkillId === null}
          isExecuting={executingSkillId === selectedSkill.id}
        />
      )}
    </div>
  );
}
