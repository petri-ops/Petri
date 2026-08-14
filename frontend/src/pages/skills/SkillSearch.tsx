/**
 * SkillSearch — 技能搜索与筛选组件
 * 提供关键词搜索、来源筛选、类别筛选功能
 */

import React, { useCallback, useRef } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { SkillSource } from '@/hooks/useSkillStore';
import styles from './styles.module.css';

interface SkillSearchProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  selectedSource: SkillSource | 'all';
  onSourceChange: (source: SkillSource | 'all') => void;
  selectedCategory: string;
  onCategoryChange: (category: string) => void;
  categories: string[];
  stats: {
    total: number;
    bySource?: Record<string, number>;
  };
}

const SOURCE_OPTIONS: Array<{ value: SkillSource | 'all'; label: string }> = [
  { value: 'all', label: '全部来源' },
  { value: 'built-in', label: '内置' },
  { value: 'installed', label: '已安装' },
  { value: 'marketplace', label: '商店' },
];

export function SkillSearch({
  searchQuery,
  onSearchChange,
  selectedSource,
  onSourceChange,
  selectedCategory,
  onCategoryChange,
  categories,
  stats,
}: SkillSearchProps): React.ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onSearchChange('');
    inputRef.current?.focus();
  }, [onSearchChange]);

  return (
    <div className={styles.searchContainer}>
      <div className={styles.searchRow}>
        <div className={styles.searchInputWrapper}>
          <Icon name="search" size={16} className={styles.searchIcon} />
          <input
            ref={inputRef}
            type="text"
            className={styles.searchInput}
            placeholder="搜索 Skills..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="搜索技能"
          />
          {searchQuery && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={handleClear}
              aria-label="清除搜索"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        <div className={styles.sourceFilters}>
          {SOURCE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`${styles.filterChip} ${
                selectedSource === option.value ? styles.filterChipActive : ''
              }`}
              onClick={() => onSourceChange(option.value)}
            >
              {option.label}
              {option.value !== 'all' && stats.bySource?.[option.value] !== undefined && (
                <span className={styles.filterCount}>
                  {stats.bySource[option.value]}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.categoryRow}>
        <div className={styles.categoryScroll}>
          <button
            type="button"
            className={`${styles.categoryChip} ${
              selectedCategory === '' ? styles.categoryChipActive : ''
            }`}
            onClick={() => onCategoryChange('')}
          >
            全部
            <span className={styles.filterCount}>{stats.total}</span>
          </button>
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              className={`${styles.categoryChip} ${
                selectedCategory === category ? styles.categoryChipActive : ''
              }`}
              onClick={() => onCategoryChange(category)}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
