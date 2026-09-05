import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Tool } from '@/pages/_data';
import styles from '@/pages/project-workspace.module.css';

function groupByCategory(tools: Tool[]): Array<{ category: string; items: Tool[] }> {
  const map = new Map<string, Tool[]>();
  for (const tool of tools) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category)!.push(tool);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

export interface AnalysisLaunchPanelProps {
  tools: Tool[];
  onLaunch: (tool: Tool) => void;
}

/**
 * UI-147 / T84 — 分析入口面板：工作台内统一的分析启动/编排入口。
 * 把分散在 DataIntakeControl「开始分析」与聊天框输入里的分析启动能力，
 * 收敛为一个可发现、按类别分组、可一键启动的分析目录。点击「运行」即把
 * 该分析作为请求发送给 Agent（onLaunch），由 Agent 负责数据就绪检查与执行。
 * 仅依赖 props 与 onLaunch 回调，不持有状态、不反向依赖 RightPanel。
 */
export function AnalysisLaunchPanel({ tools, onLaunch }: AnalysisLaunchPanelProps): React.ReactElement {
  const groups = React.useMemo(() => groupByCategory(tools), [tools]);

  return (
    <div className={styles.analysisLaunch}>
      <header className={styles.analysisLaunchHeader}>
        <strong>分析入口</strong>
        <span className={styles.analysisLaunchHint}>选择一项分析，发给 Agent 运行</span>
      </header>
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
                        <span className={styles.analysisLaunchLang} data-lang={tool.language}>
                          {tool.language.toUpperCase()}
                        </span>
                        <span>约 {tool.estimatedMinutes} 分钟</span>
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
    </div>
  );
}
