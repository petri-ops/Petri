import React from 'react';
import type { CatalogTool } from '@/lib/tool-catalog';
import styles from '@/pages/project-workspace.module.css';

function groupByCategory(tools: CatalogTool[]): Array<{ category: string; items: CatalogTool[] }> {
  const map = new Map<string, CatalogTool[]>();
  for (const tool of tools) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category)!.push(tool);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

export interface AnalysisLaunchPanelProps {
  tools: CatalogTool[];
  onLaunch: (tool: CatalogTool) => void;
  /** 目录尚在拉取中（区别于「已确认无插件」）。 */
  loading?: boolean;
}

/**
 * UI-147 / T84 — 分析入口面板：工作台内统一的分析启动/编排入口。
 * 把分散在 DataIntakeControl「开始分析」与聊天框输入里的分析启动能力，
 * 收敛为一个可发现、按类别分组、可一键启动的分析目录。点击「运行」即把
 * 该分析作为请求发送给 Agent（onLaunch），由 Agent 负责数据就绪检查与执行。
 * 仅依赖 props 与 onLaunch 回调，不持有状态、不反向依赖 RightPanel。
 *
 * BLOCK-83 D4：目录内容投影自已装插件（不再是核心内置清单）——零插件时
 * 渲染诚实空态，不伪造条目。
 */
export function AnalysisLaunchPanel({ tools, onLaunch, loading = false }: AnalysisLaunchPanelProps): React.ReactElement {
  const groups = React.useMemo(() => groupByCategory(tools), [tools]);
  const isEmpty = tools.length === 0;

  return (
    <div className={styles.analysisLaunch}>
      <header className={styles.analysisLaunchHeader}>
        <strong>分析入口</strong>
        <span className={styles.analysisLaunchHint}>选择一项分析，发给 Agent 运行</span>
      </header>
      {isEmpty ? (
        <p className={styles.panelEmpty} data-testid="analysis-launch-empty">
          {loading ? '正在加载分析插件…' : '当前未安装分析插件。安装插件后，其分析项会自动出现在这里。'}
        </p>
      ) : (
        <div className={styles.analysisLaunchList}>
          {groups.map((group) => (
            <section key={group.category} className={styles.analysisLaunchGroup}>
              <h4 className={styles.analysisLaunchGroupTitle}>{group.category}</h4>
              <ul className={styles.analysisLaunchCards}>
                {group.items.map((tool) => (
                  <li key={tool.id}>
                    <div className={styles.analysisLaunchCard}>
                      <div className={styles.analysisLaunchCardMain}>
                        <span className={styles.analysisLaunchCardTitle}>
                          <span
                            className={styles.analysisLaunchDot}
                            style={{ background: tool.color || 'var(--gewu-accent, #3b82f6)' }}
                            aria-hidden
                          />
                          {tool.title}
                        </span>
                        <span className={styles.analysisLaunchCardDesc}>{tool.description}</span>
                        <span className={styles.analysisLaunchCardMeta}>
                          {tool.language ? (
                            <span className={styles.analysisLaunchLang} data-lang={tool.language}>
                              {tool.language.toUpperCase()}
                            </span>
                          ) : null}
                          {tool.estimatedMinutes == null ? null : <span>约 {tool.estimatedMinutes} 分钟</span>}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.analysisLaunchRun}
                        disabled={tool.comingSoon}
                        onClick={() => onLaunch(tool)}
                      >
                        {tool.comingSoon ? '即将推出' : '运行'}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
