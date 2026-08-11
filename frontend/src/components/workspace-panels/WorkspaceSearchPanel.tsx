import React, { useMemo } from 'react';
import { Icon } from '@/components/icons/Icon';
import { tools as staticTools } from '@/pages/_data';
import type { Project, ToolJob, Dataset } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import styles from '@/pages/project-workspace.module.css';

// Center column search surface for `search` workspace mode.
// Extracted from project-workspace.tsx (T85 增量3, UI-145) to slim the
// 5000-line God component and cut the CenterPanel -> project-workspace
// circular import for this panel. Pure presentational: it owns no state and
// only reports navigation intents back through the `onOpen*` callbacks.
//
// `formatSize` is duplicated here (instead of importing the one in
// project-workspace.tsx) because that original is also used by the file-tree
// view and must stay put; keeping a private copy avoids re-introducing a
// reverse dependency on the God component.
function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

export function WorkspaceSearchPanel({
  query,
  onQueryChange,
  projects,
  currentProjectId,
  conversations,
  jobs,
  datasets,
  onOpenProject,
  onOpenConversation,
  onOpenScheduled,
  onOpenPlugins,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  projects: Project[];
  currentProjectId: string;
  conversations: ConversationSummary[];
  jobs: ToolJob[];
  datasets: Dataset[];
  onOpenProject: (id: string) => void;
  onOpenConversation: (projectId: string | null | undefined, convId: string) => void;
  onOpenScheduled: (jobId: string) => void;
  onOpenPlugins: () => void;
}): React.ReactElement {
  const normalizedQuery = query.trim().toLowerCase();

  const projectMatches = useMemo(
    () =>
      projects.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.name.toLowerCase().includes(normalizedQuery) ||
          (item.description || '').toLowerCase().includes(normalizedQuery) ||
          (item.modality || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, projects]
  );

  const uniqueConversations = useMemo(() => {
    const deduped = new Map<string, ConversationSummary>();
    conversations.forEach((item) => {
      if (!deduped.has(item.id)) deduped.set(item.id, item);
    });
    return Array.from(deduped.values());
  }, [conversations]);

  const conversationMatches = useMemo(
    () =>
      uniqueConversations.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.title.toLowerCase().includes(normalizedQuery) ||
          (item.last_topic_shift_reason || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [normalizedQuery, uniqueConversations]
  );

  const datasetMatches = useMemo(
    () =>
      datasets.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          item.name.toLowerCase().includes(normalizedQuery) ||
          (item.description || '').toLowerCase().includes(normalizedQuery)
        );
      }),
    [datasets, normalizedQuery]
  );

  const jobMatches = useMemo(
    () =>
      jobs.filter((item) => {
        if (!normalizedQuery) return true;
        return (
          (item.name || '').toLowerCase().includes(normalizedQuery) ||
          item.tool_id.toLowerCase().includes(normalizedQuery) ||
          item.status.toLowerCase().includes(normalizedQuery)
        );
      }),
    [jobs, normalizedQuery]
  );

  const hasQuery = normalizedQuery.length > 0;

  return (
    <div className={styles.workspaceSearch}>
      <div className={styles.workspaceSearchHeader}>
        <div>
          <h2 className={styles.workspaceSearchTitle}>搜索</h2>
          <p className={styles.workspaceSearchDesc}>在项目、对话、结果和当前工作记录里快速跳转。</p>
        </div>
        <div className={styles.workspaceSearchActions}>
          <button className={styles.workspaceSearchAction} onClick={onOpenPlugins}>
            <Icon name="puzzle" size={14} />
            <span>插件</span>
          </button>
        </div>
      </div>

      <div className={styles.workspaceSearchBar}>
        <Icon name="search" size={16} />
        <input
          className={styles.workspaceSearchInput}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索项目、对话、结果、任务…"
          autoFocus
        />
      </div>

      <div className={styles.workspaceSearchBody}>
        {!hasQuery && (
          <div className={styles.workspaceSearchHint}>
            <div className={styles.workspaceSearchHintCard}>
              <span>项目</span>
              <strong>{projects.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>对话</span>
              <strong>{uniqueConversations.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>任务</span>
              <strong>{jobs.length}</strong>
            </div>
            <div className={styles.workspaceSearchHintCard}>
              <span>分析项</span>
              <strong>{staticTools.length}</strong>
            </div>
          </div>
        )}

        <SearchResultSection title="项目" count={projectMatches.length}>
          {projectMatches.slice(0, 8).map((item) => (
            <button key={item.id} className={styles.searchResultItem} onClick={() => onOpenProject(item.id)}>
              <Icon name="folder" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name}</span>
                <span className={styles.searchResultSub}>
                  {item.id === currentProjectId ? '当前项目' : item.modality || item.description || '项目'}
                </span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="对话" count={conversationMatches.length}>
          {conversationMatches.slice(0, 8).map((item) => (
            <button
              key={item.id}
              className={styles.searchResultItem}
              onClick={() => onOpenConversation(item.project_id, item.id)}
            >
              <Icon name="message-circle" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.title}</span>
                <span className={styles.searchResultSub}>
                  {item.project_id === currentProjectId ? '当前项目' : item.project_id || '未绑定项目'}
                </span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="任务与结果" count={jobMatches.length}>
          {jobMatches.slice(0, 6).map((item) => (
            <button key={item.id} className={styles.searchResultItem} onClick={() => onOpenScheduled(item.id)}>
              <Icon name="clock" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name || item.tool_id}</span>
                <span className={styles.searchResultSub}>{item.status}</span>
              </div>
            </button>
          ))}
        </SearchResultSection>

        <SearchResultSection title="数据集" count={datasetMatches.length}>
          {datasetMatches.slice(0, 6).map((item) => (
            <div key={item.id} className={styles.searchResultStatic}>
              <Icon name="database" size={14} />
              <div className={styles.searchResultMeta}>
                <span className={styles.searchResultTitle}>{item.name}</span>
                <span className={styles.searchResultSub}>{formatSize(item.size)}</span>
              </div>
            </div>
          ))}
        </SearchResultSection>
      </div>
    </div>
  );
}

function SearchResultSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}): React.ReactElement | null {
  if (count === 0) return null;
  return (
    <section className={styles.searchResultSection}>
      <div className={styles.searchResultHeader}>
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      <div className={styles.searchResultList}>{children}</div>
    </section>
  );
}
