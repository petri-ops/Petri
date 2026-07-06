import React, { useMemo, useState, useDeferredValue } from 'react';
import {
  ALGORITHMS,
  ALGORITHM_CATEGORIES,
  type AlgorithmCard,
  type AlgorithmCategory,
} from './_data';
import { AlgorithmDetailPanel } from './_AlgorithmDetailPanel';
import styles from './algorithms.module.css';

function AlgorithmCardView({ card, onClick }: { card: AlgorithmCard; onClick: () => void }) {
  const cat = ALGORITHM_CATEGORIES.find((c) => c.id === card.category);
  const diffClass =
    card.difficulty === 'beginner'
      ? styles.difficultyBeginner
      : card.difficulty === 'intermediate'
        ? styles.difficultyIntermediate
        : styles.difficultyAdvanced;

  return (
    <div
      className={styles.card}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onClick();
      }}
    >
      <div className={styles.cardHeader}>
        <span className={styles.categoryBadge}>{cat?.name_zh || card.category}</span>
        <span className={`${styles.difficultyBadge} ${diffClass}`}>
          {card.difficulty === 'beginner'
            ? '入门'
            : card.difficulty === 'intermediate'
              ? '进阶'
              : '高级'}
        </span>
      </div>
      <h3 className={styles.cardTitle}>
        {card.name}
        <span className={styles.cardNameZh}>{card.name_zh}</span>
      </h3>
      <p className={styles.oneLiner}>{card.one_liner}</p>
      <div className={styles.cardFooter}>
        <span className={styles.flowPreview}>{card.flow.join(' → ')}</span>
      </div>
    </div>
  );
}

function AlgorithmsPageInner() {
  const [selectedCat, setSelectedCat] = useState<AlgorithmCategory | null>(null);
  const [search, setSearch] = useState('');
  const [activeCard, setActiveCard] = useState<AlgorithmCard | null>(null);
  const deferredSearch = useDeferredValue(search);

  const filtered = useMemo(() => {
    let list = ALGORITHMS;
    if (selectedCat) list = list.filter((a) => a.category === selectedCat);
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((a) =>
        `${a.name} ${a.name_zh} ${a.one_liner} ${a.flow.join(' ')} ${a.suitable.join(' ')} ${a.not_suitable.join(' ')}`
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [selectedCat, deferredSearch]);

  const catCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const a of ALGORITHMS) counts[a.category] = (counts[a.category] || 0) + 1;
    return counts;
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>算法卡片</h1>
        <p className={styles.subtitle}>
          每张卡片解释一个生信工具背后的核心算法——公式、计算流程、关键参数、适合和不适合的场景。
          不只是&ldquo;怎么用&rdquo;，更是&ldquo;为什么这样算&rdquo;。
        </p>
        <div className={styles.statsRow}>
          <span className={styles.statBadge}>
            <strong>{ALGORITHMS.length}</strong> 算法卡片
          </span>
          <span className={styles.statBadge}>
            <strong>{ALGORITHM_CATEGORIES.length}</strong> 分类
          </span>
        </div>
      </header>

      <main className={styles.main}>
        {/* 分类侧栏 */}
        <aside className={styles.sidebar}>
          <h2 className={styles.sidebarTitle}>分类</h2>
          <ul className={styles.catList}>
            <li
              className={`${styles.catItem} ${selectedCat === null ? styles.catItemActive : ''}`}
              onClick={() => setSelectedCat(null)}
            >
              <span>全部</span>
              <span className={styles.catCount}>{ALGORITHMS.length}</span>
            </li>
            {ALGORITHM_CATEGORIES.map((cat) => (
              <li
                key={cat.id}
                className={`${styles.catItem} ${selectedCat === cat.id ? styles.catItemActive : ''}`}
                onClick={() => setSelectedCat(cat.id)}
              >
                <span>{cat.name_zh}</span>
                <span className={styles.catCount}>{catCounts[cat.id] || 0}</span>
              </li>
            ))}
          </ul>
          {selectedCat && (
            <button className={styles.catReset} onClick={() => setSelectedCat(null)}>
              清空筛选
            </button>
          )}
        </aside>

        <div>
          {/* 搜索 */}
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="搜索算法（名称 / 描述 / 流程 / 适用场景）..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className={styles.searchStats}>
              <strong>{filtered.length}</strong> / {ALGORITHMS.length}
            </span>
          </div>

          {/* 卡片网格 */}
          <div className={styles.cardsGrid}>
            {filtered.map((card) => (
              <AlgorithmCardView key={card.id} card={card} onClick={() => setActiveCard(card)} />
            ))}
          </div>

          {filtered.length === 0 && (
            <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>
              没有匹配的算法卡片
            </p>
          )}
        </div>
      </main>

      {activeCard && <AlgorithmDetailPanel card={activeCard} onClose={() => setActiveCard(null)} />}
    </div>
  );
}

export default function AlgorithmsPage() {
  return <AlgorithmsPageInner />;
}
