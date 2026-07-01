import React, { useMemo, useState, useDeferredValue, useEffect, useCallback } from 'react';
import { skillsData, Skill } from './_data';
import { SkillDetailPanel } from './_SkillDetailPanel';
import styles from './skills.module.css';

// 桌面版无 Docusaurus baseUrl，useBaseUrl 直接返回原路径
function useBaseUrl(path: string): string {
  return path;
}

// ============================================================
// /skills 主入口 — Wave S2 完整版
//
// 功能:全 523 卡 + 63 类目筛选 + 全文搜索 + 站内详情面板(react-markdown 渲染 SKILL.md)+ 中文导读 + 覆盖度徽章 + 站内下载 zip
//
// ⚠️ MIT 合规约束(详见 .kiro/steering/skills-page-dev.md §1):
//   - attribution banner 不可关闭
//   - 卡片正面 sourceBadge 强制
//   - 详情底部 attribution 强制
//   - 不修改 SKILL.md 原文(详情页用 react-markdown 渲染原文,中文导读单独 wrapper)
// ============================================================

const PAGE_SIZE = 60;

function FooterAttribution() {
  const sources = skillsData.sources;
  return (
    <div className={styles.footerAttribution}>
      <div className={styles.footerAttributionTitle}>📚 内容来源声明</div>
      {sources.length === 1 ? (
        <p style={{ margin: 0 }}>
          本页收录{' '}
          <a href={sources[0].url} target="_blank" rel="noopener">
            <strong>{sources[0].name}</strong>
          </a>{' '}
          的 {skillsData.skills.length} 个生信 AI agent skills ({sources[0].license} License,上游
          commit{' '}
          <code style={{ background: '#fff', padding: '1px 5px', borderRadius: 3 }}>
            {sources[0].commit}
          </code>
          )。 BioF3 仅做内容索引、分类、中文导览、镜像下载,不修改原内容,不参与 skill 创作。
          完整体验请使用
          <a href={sources[0].url} target="_blank" rel="noopener">
            官方安装脚本
          </a>
          (Claude Code / Codex / Gemini / OpenCode / OpenClaw)。
        </p>
      ) : (
        <p style={{ margin: 0 }}>
          本页收录 {sources.length} 个开源 skill 库,共 {skillsData.skills.length} 个 skills:
          {sources.map((s, i) => (
            <React.Fragment key={s.id}>
              {i > 0 && '、'}
              <a href={s.url} target="_blank" rel="noopener">
                <strong>{s.name}</strong>
              </a>{' '}
              ({s.license})
            </React.Fragment>
          ))}
          。BioF3 仅做内容索引、分类、中文导览、镜像下载,不修改原内容。
        </p>
      )}
    </div>
  );
}

function StatsRow({
  filterCovered,
  filterZh,
  onToggleCovered,
  onToggleZh,
}: {
  filterCovered: boolean;
  filterZh: boolean;
  onToggleCovered: () => void;
  onToggleZh: () => void;
}) {
  const meta = skillsData.biof3_meta;
  const totalSkills = skillsData.skills.length;
  const sources = skillsData.sources;
  return (
    <div className={styles.statsRow}>
      <span className={styles.statBadge}>
        <strong>{totalSkills}</strong> skills
      </span>
      <span className={styles.statBadge}>
        <strong>{skillsData.categories.length}</strong> categories
      </span>
      <button
        className={`${styles.statBadge} ${styles.statBadgeBtn} ${filterCovered ? styles.statBadgeActive : ''}`}
        onClick={onToggleCovered}
        title={`523 skills 中,BioF3 已用现有工具 / 教程 / figcode 覆盖了 ${meta.coverage_count} 个(${meta.coverage_percent}%)。点击只看已覆盖的,再点取消。`}
      >
        BioF3 已覆盖 <strong>{meta.coverage_count}</strong> ({meta.coverage_percent}%)
        {filterCovered && <span style={{ marginLeft: 4 }}>✓</span>}
      </button>
      <button
        className={`${styles.statBadge} ${styles.statBadgeBtn} ${filterZh ? styles.statBadgeActive : ''}`}
        onClick={onToggleZh}
        title={`已写中文导读的 skill 数量。点击只看有导读的,再点取消。`}
      >
        中文导读 <strong>{meta.zh_notes_count}</strong>
        {filterZh && <span style={{ marginLeft: 4 }}>✓</span>}
      </button>
      {sources.length === 1 ? (
        <span className={styles.statBadge}>
          Source: <strong>{sources[0].name}</strong> ({sources[0].license}) ·{' '}
          <code style={{ fontSize: 11 }}>{sources[0].commit}</code>
        </span>
      ) : (
        <span className={styles.statBadge}>
          <strong>{sources.length} sources</strong>:{' '}
          {sources.map((s) => `${s.name} (${s.license})`).join(' · ')}
        </span>
      )}
    </div>
  );
}

interface CategoryFilterProps {
  selectedCat: string | null;
  onSelect: (cat: string | null) => void;
  filteredCount: number;
}

function CategoryFilter({ selectedCat, onSelect }: CategoryFilterProps) {
  return (
    <aside className={styles.sidebar}>
      <h2 className={styles.sidebarTitle}>Categories ({skillsData.categories.length})</h2>
      <ul className={styles.catList}>
        <li
          className={`${styles.catItem} ${selectedCat === null ? styles.catItemActive : ''}`}
          onClick={() => onSelect(null)}
        >
          <span>全部</span>
          <span className={styles.catCount}>{skillsData.skills.length}</span>
        </li>
        {skillsData.categories.map((cat) => (
          <li
            key={cat.id}
            className={`${styles.catItem} ${selectedCat === cat.id ? styles.catItemActive : ''}`}
            onClick={() => onSelect(cat.id)}
          >
            <span>{cat.name_zh || cat.name_en}</span>
            <span className={styles.catCount}>{cat.skill_count}</span>
          </li>
        ))}
      </ul>
      {selectedCat && (
        <button className={styles.catReset} onClick={() => onSelect(null)}>
          清空筛选
        </button>
      )}
    </aside>
  );
}

interface SkillCardProps {
  skill: Skill;
  onClick: () => void;
}

function SkillCard({ skill, onClick }: SkillCardProps) {
  const zipUrl = useBaseUrl(skill.zip_path);
  const cov = skill.biof3_coverage;
  const zh = skill.biof3_zh;

  let coverageBadge = null;
  if (cov) {
    const cls =
      cov.match_quality === 'high'
        ? styles.coverageBadgeHigh
        : cov.match_quality === 'medium'
          ? styles.coverageBadgeMedium
          : styles.coverageBadgeLow;
    coverageBadge = <span className={`${styles.coverageBadge} ${cls}`}>✅ BioF3</span>;
  }

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
        <span className={styles.categoryBadge}>{skill.category}</span>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {coverageBadge}
          <span className={styles.sourceBadge}>📦 bioSkills</span>
        </div>
      </div>
      <h3 className={styles.cardTitle}>
        {skill.title}
        {zh?.title_zh && (
          <span
            style={{
              fontSize: 12,
              color: '#6b7280',
              display: 'block',
              fontWeight: 400,
              marginTop: 2,
            }}
          >
            {zh.title_zh}
          </span>
        )}
      </h3>
      {zh?.summary_zh ? (
        <div className={styles.zhSummary}>{zh.summary_zh}</div>
      ) : (
        <p className={styles.cardDesc}>{skill.use_when || skill.description}</p>
      )}
      <div className={styles.cardFooter}>
        {skill.primary_tool && <span className={styles.toolChip}>{skill.primary_tool}</span>}
        <a
          href={zipUrl}
          download
          className={styles.downloadBtn}
          onClick={(e) => e.stopPropagation()}
        >
          ⬇ 下载
        </a>
      </div>
    </div>
  );
}

function SkillsPageInner() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
  const [filterCovered, setFilterCovered] = useState(false);
  const [filterZh, setFilterZh] = useState(false);

  const deferredSearch = useDeferredValue(search);

  // 筛选
  const filtered = useMemo(() => {
    let list = skillsData.skills;
    if (selectedCat) {
      list = list.filter((s) => s.category === selectedCat);
    }
    if (filterCovered) {
      list = list.filter((s) => s.biof3_coverage);
    }
    if (filterZh) {
      list = list.filter((s) => s.biof3_zh);
    }
    const q = deferredSearch.trim().toLowerCase();
    if (q) {
      list = list.filter((s) => {
        const blob =
          `${s.title} ${s.description} ${s.primary_tool || ''} ${s.use_when || ''} ${s.biof3_zh?.summary_zh || ''} ${s.biof3_zh?.title_zh || ''}`.toLowerCase();
        return blob.includes(q);
      });
    }
    return list;
  }, [selectedCat, deferredSearch, filterCovered, filterZh]);

  // 分页(增量加载)
  const visible = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page]);
  const hasMore = visible.length < filtered.length;

  // 筛选条件变化时回到第一页
  useEffect(() => {
    setPage(1);
  }, [selectedCat, deferredSearch, filterCovered, filterZh]);

  const handleCardClick = useCallback((skill: Skill) => {
    setActiveSkill(skill);
  }, []);

  const handleClose = useCallback(() => setActiveSkill(null), []);

  return (
    <>
      <header className={styles.header}>
        <h1 className={styles.title}>Skills 库</h1>
        <p className={styles.subtitle}>
          收录给 AI coding agent(Claude Code / Codex / Gemini / OpenCode /
          OpenClaw)的生信任务工作流模板。 策展自上游开源项目,内容已镜像同步到 BioF3
          站内,无网络依赖。点卡片站内阅读详情,可一键下载 zip。
        </p>
        <StatsRow
          filterCovered={filterCovered}
          filterZh={filterZh}
          onToggleCovered={() => setFilterCovered((v) => !v)}
          onToggleZh={() => setFilterZh((v) => !v)}
        />
      </header>

      <main className={styles.main}>
        <CategoryFilter
          selectedCat={selectedCat}
          onSelect={setSelectedCat}
          filteredCount={filtered.length}
        />

        <div>
          <div className={styles.searchRow}>
            <input
              className={styles.searchInput}
              type="search"
              placeholder="搜索 skill(标题 / 描述 / 工具 / 中文导读)..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className={styles.searchStats}>
              <strong>{filtered.length}</strong> / {skillsData.skills.length} skills
              {selectedCat && (
                <span>
                  {' '}
                  · 类目:<strong>{selectedCat}</strong>
                </span>
              )}
              {filterCovered && (
                <span>
                  {' '}
                  · <strong>仅 BioF3 已覆盖</strong>
                </span>
              )}
              {filterZh && (
                <span>
                  {' '}
                  · <strong>仅有中文导读</strong>
                </span>
              )}
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className={styles.emptyState}>没有匹配的 skill。试试清空搜索 / 筛选。</div>
          ) : (
            <>
              <div className={styles.cardsGrid}>
                {visible.map((skill) => (
                  <SkillCard key={skill.id} skill={skill} onClick={() => handleCardClick(skill)} />
                ))}
              </div>

              {hasMore ? (
                <div className={styles.loadMoreRow}>
                  <button className={styles.loadMoreBtn} onClick={() => setPage((p) => p + 1)}>
                    加载更多 (剩余 {filtered.length - visible.length})
                  </button>
                </div>
              ) : (
                <div className={styles.endNote}>— 已显示全部 {filtered.length} 个 skill —</div>
              )}
            </>
          )}
        </div>
      </main>

      {activeSkill && <SkillDetailPanel skill={activeSkill} onClose={handleClose} />}
    </>
  );
}

export default function SkillsPage(): React.ReactElement {
  return (
    <div className={styles.page}>
      <SkillsPageInner />
      {/* attribution 移到页脚:MIT 合规仍 always visible,但不挤占顶部 */}
      <FooterAttribution />
    </div>
  );
}
