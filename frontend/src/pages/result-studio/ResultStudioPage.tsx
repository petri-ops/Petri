// ============================================================
// ResultStudio Page
//
// Phase 2: Result Studio UI with project-scoped results
//
// Key architectural principle:
//   - Results are loaded by PROJECT ID, not branch ID
//   - Branch switching does NOT trigger Result Studio reload
//   - This page demonstrates the "conversation isolation, result sharing" model
//
// Layout:
//   ┌──────────────────────────────────────────────────────────────┐
//   │ [📁 项目] [Branch A] [Branch B] [+] [结果 2 ▼]             │
//   ├────────────────┬─────────────────────────────────────────────┤
//   │                │                                             │
//   │  Copilot       │         Result Studio（共享）               │
//   │  ──────────   │         ────────────────────               │
//   │  (按分支隔离)  │         (按项目共享，跨分支不变)             │
//   │                │                                             │
//   └────────────────┴─────────────────────────────────────────────┘
// ============================================================

import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useResultStore } from '@/hooks/useResultStore';
import { useBranchStore } from '@/hooks/useBranchStore';
import { BranchTabsWrapper } from '@/components/branch/BranchTabsWrapper';
import { ResultVersionHistory } from './components/ResultVersionHistory';
import type { Result, ResultVersion } from '@/types/result.types';
import styles from './ResultStudio.module.css';

export function ResultStudioPage(): React.ReactElement {
  const { projectId } = useParams<{ projectId: string }>();

  // Result store - keyed on projectId, NOT branchId
  // This is the key: results persist across branch switches
  const {
    results,
    summaries,
    activeResultId,
    loading,
    error,
    refresh,
    setActiveResult,
    updateResult,
    deleteResult,
  } = useResultStore(projectId);

  // Branch store - also keyed on projectId
  const { branches, activeBranchId } = useBranchStore(projectId);

  // Load results on mount / projectId change
  useEffect(() => {
    if (projectId) {
      void refresh();
    }
  }, [projectId, refresh]);

  const activeResult = results.find((r) => r.id === activeResultId) || null;

  return (
    <div className={styles.resultStudio}>
      {/* Header with project info and branch tabs */}
      <header className={styles.header}>
        <div className={styles.projectInfo}>
          <span className={styles.projectLabel}>项目结果</span>
          {projectId && (
            <span className={styles.resultCount}>
              {results.length} 个结果
            </span>
          )}
        </div>
        <BranchTabsWrapper />
      </header>

      {/* Main content area */}
      <main className={styles.content}>
        {/* Results list sidebar */}
        <aside className={styles.sidebar}>
          <div className={styles.sidebarHeader}>
            <h2>结果列表</h2>
            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void refresh()}
              disabled={loading}
            >
              刷新
            </button>
          </div>

          {loading && <div className={styles.loading}>加载中...</div>}
          {error && <div className={styles.error}>{error}</div>}

          <div className={styles.resultList}>
            {summaries.length === 0 && !loading && (
              <div className={styles.emptyState}>
                <p>暂无结果</p>
                <p className={styles.hint}>
                  在 Copilot 中运行分析后会显示在这里
                </p>
              </div>
            )}

            {summaries.map((result) => (
              <div
                key={result.id}
                className={`${styles.resultItem} ${
                  result.id === activeResultId ? styles.resultItemActive : ''
                }`}
                onClick={() => setActiveResult(result.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    setActiveResult(result.id);
                  }
                }}
              >
                <div className={styles.resultIcon}>
                  <ResultTypeIcon type={result.type} />
                </div>
                <div className={styles.resultInfo}>
                  <span className={styles.resultName}>{result.name}</span>
                  <span className={styles.resultMeta}>
                    {result.type} · {formatDate(result.updatedAt)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </aside>

        {/* Result detail view */}
        <section className={styles.detail}>
          {activeResult ? (
            <ResultDetail
              result={activeResult}
              onUpdate={(updates) => void updateResult(activeResult.id, updates)}
              onDelete={() => {
                void deleteResult(activeResult.id);
                setActiveResult(null);
              }}
            />
          ) : (
            <div className={styles.noSelection}>
              <p>选择一个结果以查看详情</p>
              <p className={styles.hint}>
                结果按项目共享，切换分支不会影响结果列表
              </p>
            </div>
          )}
        </section>
      </main>

      {/* Branch isolation indicator */}
      <footer className={styles.footer}>
        <div className={styles.branchIndicator}>
          <span className={styles.branchLabel}>当前分支:</span>
          <span className={styles.branchName}>
            {branches.find((b) => b.id === activeBranchId)?.name || '无'}
          </span>
          <span className={styles.isolationNote}>
            (对话隔离，结果共享)
          </span>
        </div>
      </footer>
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================

function ResultTypeIcon({ type }: { type: Result['type'] }): React.ReactElement {
  const iconMap: Record<Result['type'], string> = {
    chart: '📊',
    table: '📋',
    code: '💻',
    text: '📝',
    file: '📁',
    conversation_export: '💬', // Phase 4: conversation export icon
  };
  return <span aria-hidden>{iconMap[type] || '📄'}</span>;
}

function ResultDetail({
  result,
  onUpdate,
  onDelete,
}: {
  result: Result;
  onUpdate: (updates: { name?: string; data?: unknown; config?: Record<string, unknown> }) => void;
  onDelete: () => void;
}): React.ReactElement {
  const [currentVersion, setCurrentVersion] = useState<number>(1);

  const handleVersionSelect = (version: ResultVersion) => {
    // Load the old version data and display it
    // The parent component should handle the actual data update
    if (version.data) {
      onUpdate({ data: version.data, config: version.config });
    }
    setCurrentVersion(version.version);
  };

  return (
    <div className={styles.resultDetail}>
      <header className={styles.detailHeader}>
        <div className={styles.detailTitleRow}>
          <h2>{result.name}</h2>
          <ResultVersionHistory
            resultId={result.id}
            currentVersion={currentVersion}
            onVersionSelect={handleVersionSelect}
          />
        </div>
        <div className={styles.detailActions}>
          <button type="button" className={styles.actionButton} onClick={onDelete}>
            删除
          </button>
        </div>
      </header>

      <div className={styles.detailBody}>
        <dl className={styles.detailMeta}>
          <div>
            <dt>类型</dt>
            <dd>{result.type}</dd>
          </div>
          <div>
            <dt>创建时间</dt>
            <dd>{formatDate(result.createdAt)}</dd>
          </div>
          <div>
            <dt>更新时间</dt>
            <dd>{formatDate(result.updatedAt)}</dd>
          </div>
          <div>
            <dt>来源分支</dt>
            <dd>{result.sourceBranchId || '无'}</dd>
          </div>
        </dl>

        <div className={styles.dataPreview}>
          <h3>数据预览</h3>
          <pre className={styles.dataBlock}>
            {JSON.stringify(result.data, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Utilities
// ============================================================

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
