/**
 * Extensions 页 — BLOCK-156 扩展中心（四货架单入口）。
 *
 * D1 裁决：/extensions 单页四货签（领域插件 / 领域技能 / 通用技能 / MCP 服务），
 * 旧 /plugins、/skills 路由 fail-closed 重定向到对应货签（App.tsx 层 Navigate）。
 * D2 裁决：领域/通用界定 = category 前缀规则（extensionShelves 单源，零 manifest 迁移）。
 * 红线：货架合并是入口层合并——插件与技能的运行时（plugin-loader / skill-registry）不动。
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { useSkillStore, type Skill } from '@/hooks/useSkillStore';
import { getBridge } from '@/lib/desktopBridge';
import {
  EXTENSION_SHELVES,
  classifySkillShelf,
  isExtensionShelfId,
  type ExtensionShelfId,
} from '@/lib/extensionShelves';
import { SkillCard } from './SkillCard';
import { SkillDetail } from './SkillDetail';
import { McpShelfPane } from './McpShelfPane';
import globalStyles from '../global-page.module.css';
import styles from './extensions.module.css';
import skillStyles from './styles.module.css';

export default function ExtensionsPage(): React.ReactElement {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') ?? '';
  const activeShelf: ExtensionShelfId = isExtensionShelfId(tabParam)
    ? tabParam
    : 'domain-plugins';

  const navigate = useNavigate();
  const handleReturn = useCallback(() => {
    // 与既有独立页同语义：回上一页，无历史则回欢迎页
    if (window.history.length > 1) {
      window.history.back();
    } else {
      void navigate('/');
    }
  }, [navigate]);

  const handleSelectShelf = useCallback(
    (id: ExtensionShelfId) => {
      setSearchParams(id === 'domain-plugins' ? {} : { tab: id }, { replace: true });
    },
    [setSearchParams]
  );

  return (
    <div className={globalStyles.page} data-testid="extensions-page">
      <header className={globalStyles.header}>
        <button
          type="button"
          className={globalStyles.backBtn}
          onClick={handleReturn}
          title="返回"
          aria-label="返回"
        >
          <Icon name="arrow-left" size={16} />
          <span>返回</span>
        </button>
        <div className={globalStyles.pageIcon}>
          <Icon name="puzzle" size={22} />
        </div>
        <div className={globalStyles.titleWrap}>
          <span className={globalStyles.title}>扩展中心</span>
          <span className={globalStyles.subtitle}>领域扩展 · 通用技能 · MCP 服务</span>
        </div>
      </header>

      <nav className={styles.shelfBar} role="tablist" aria-label="扩展货架">
        {EXTENSION_SHELVES.map((shelf) => (
          <button
            key={shelf.id}
            type="button"
            role="tab"
            aria-selected={shelf.id === activeShelf}
            className={`${styles.shelfTab} ${shelf.id === activeShelf ? styles.shelfTabActive : ''}`}
            onClick={() => handleSelectShelf(shelf.id)}
            title={shelf.description}
            data-testid={`extensions-tab-${shelf.id}`}
          >
            {shelf.label}
          </button>
        ))}
      </nav>

      <div className={globalStyles.body}>
        {activeShelf === 'domain-plugins' && (
          <PluginStorePanel embedded onClose={handleReturn} backLabel="返回" />
        )}
        {activeShelf === 'domain-skills' && <SkillShelfPane shelfId="domain-skills" />}
        {activeShelf === 'general-skills' && <SkillShelfPane shelfId="general-skills" />}
        {activeShelf === 'mcp' && <McpShelfPane />}
      </div>
    </div>
  );
}

/** 技能货架：按 D2 分类学过滤 + 搜索 + 卡片网格 + 执行详情弹层。 */
function SkillShelfPane({ shelfId }: { shelfId: 'domain-skills' | 'general-skills' }): React.ReactElement {
  const { skills, loading, error, execute, discover } = useSkillStore({ autoLoad: true });
  const [query, setQuery] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [executingSkillId, setExecutingSkillId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);

  // BLOCK-156 D7 — 本地技能目录导入（主进程对话框一条龙；成功后重发现）
  const handleImport = useCallback(async () => {
    setImporting(true);
    setImportNotice(null);
    try {
      const skillsBridge = getBridge('skills');
      if (!skillsBridge) {
        setImportNotice('导入失败：桌面桥不可用');
        return;
      }
      const result = await skillsBridge.importDirectory();
      if (result.ok) {
        setImportNotice(`已导入技能 ${result.skillId ?? ''}`);
        await discover();
      } else if (!result.canceled) {
        setImportNotice(`导入失败：${result.message ?? result.error ?? '未知错误'}`);
      }
    } catch (e) {
      setImportNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  }, [discover]);

  const shelfSkills = useMemo(
    () => skills.filter((s) => classifySkillShelf(s.category) === shelfId),
    [skills, shelfId]
  );

  const visibleSkills = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shelfSkills;
    return shelfSkills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.id.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
    );
  }, [shelfSkills, query]);

  const handleExecute = useCallback(
    async (skill: Skill, params: Record<string, unknown>) => {
      setExecutingSkillId(skill.id);
      try {
        const result = await execute(skill.id, params);
        if (result.ok) {
          // 与原 Skills 页同节奏：短暂成功反馈后收起详情弹层
          setTimeout(() => {
            setExecutingSkillId(null);
            setSelectedSkill(null);
          }, 800);
        } else {
          setExecutingSkillId(null);
        }
      } catch {
        setExecutingSkillId(null);
      }
    },
    [execute]
  );

  const shelfLabel =
    shelfId === 'domain-skills' ? '领域技能' : '通用技能';

  return (
    <div className={styles.shelfPane} data-testid={`skill-shelf-${shelfId}`}>
      {shelfId === 'general-skills' && (
        <div className={styles.mcpHeaderRow}>
          <span className={styles.mcpIntro}>
            <Icon name="download" size={14} />
            <span>{importNotice ?? '通用技能不绑领域；从本地目录导入含 skill.json 的技能'}</span>
          </span>
          <button
            type="button"
            className={styles.mcpAddBtn}
            disabled={importing}
            onClick={() => void handleImport()}
            data-testid="skill-import-directory"
          >
            <Icon name="plus" size={14} />
            <span>{importing ? '导入中…' : '导入本地技能目录'}</span>
          </button>
        </div>
      )}
      <div className={skillStyles.searchRow}>
        <div className={skillStyles.searchInputWrapper}>
          <Icon name="search" size={16} className={skillStyles.searchIcon} />
          <input
            type="text"
            className={skillStyles.searchInput}
            placeholder={`搜索${shelfLabel}…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={`搜索${shelfLabel}`}
          />
        </div>
        <span className={styles.shelfCount}>{shelfSkills.length} 项</span>
      </div>

      {loading ? (
        <div className={skillStyles.skillsEmpty}>
          <h3 className={skillStyles.emptyTitle}>加载中…</h3>
        </div>
      ) : error ? (
        <div className={skillStyles.skillsEmpty}>
          <h3 className={skillStyles.emptyTitle}>{error}</h3>
        </div>
      ) : visibleSkills.length === 0 ? (
        <div className={skillStyles.skillsEmpty}>
          <div className={skillStyles.emptyIcon}>
            <Icon name="search" size={24} />
          </div>
          <h3 className={skillStyles.emptyTitle}>暂无匹配的{shelfLabel}</h3>
          <p className={skillStyles.emptyText}>
            {shelfId === 'general-skills'
              ? '还没有通用技能——点上方「导入本地技能目录」接入第一个（含 skill.json 的目录）'
              : '尝试调整搜索条件，或从领域包安装分析能力'}
          </p>
        </div>
      ) : (
        <div className={skillStyles.skillsGrid}>
          {visibleSkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              onViewDetail={setSelectedSkill}
              onExecute={(s) => setSelectedSkill(s)}
              canExecute={executingSkillId === null}
            />
          ))}
        </div>
      )}

      {selectedSkill && (
        <SkillDetail
          skill={selectedSkill}
          onClose={() => setSelectedSkill(null)}
          onExecute={(skill, params) => void handleExecute(skill, params)}
          canExecute={executingSkillId === null}
          isExecuting={executingSkillId === selectedSkill.id}
        />
      )}
    </div>
  );
}

