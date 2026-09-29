import React from 'react';
import type { CatalogInputField, CatalogTool } from '@/lib/tool-catalog';
import { getApiPrefix, getToken } from '@/lib/authClient';
import styles from '@/pages/project-workspace.module.css';

function groupByCategory(tools: CatalogTool[]): Array<{ category: string; items: CatalogTool[] }> {
  const map = new Map<string, CatalogTool[]>();
  for (const tool of tools) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category)!.push(tool);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

/**
 * BLOCK-131（BIO-5 P2）：把插件输入契约投影为显式参数表单——文件输入
 * 枚举工作区 CSV/TSV 供选择（未选=「<选择文件>」占位，由 Agent 侧数据
 * 就绪检查兜底），文本/数值输入带默认值回填；「按以上参数运行」组装
 * 携带显式参数的启动 prompt（文件名与参数值点名进指令），保留「配置/
 * 收起」与旧「运行」一键路径（无参数直达 Agent）。
 */
function ToolLaunchForm({ tool, workspaceFiles, onLaunchWithPrompt }: {
  tool: CatalogTool;
  workspaceFiles: Array<{ path: string; name: string }>;
  onLaunchWithPrompt: (tool: CatalogTool, prompt: string) => void;
}): React.ReactElement {
  const fileInputs = tool.inputs.filter((input) => input.type === 'file');
  const paramInputs = tool.inputs.filter((input) => input.type !== 'file');
  const [fileSelection, setFileSelection] = React.useState<Record<string, string>>({});
  const [paramValues, setParamValues] = React.useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const input of paramInputs) {
      if (input.default !== undefined && input.default !== null) initial[input.id] = String(input.default);
    }
    return initial;
  });

  const csvFiles = workspaceFiles.filter((f) => /\.(csv|tsv)$/i.test(f.name));

  const composePrompt = () => {
    const parts: string[] = [];
    for (const input of fileInputs) {
      parts.push(`${input.id}=${fileSelection[input.id] || '<选择文件>'}`);
    }
    for (const input of paramInputs) {
      const value = paramValues[input.id];
      if (value !== undefined && value !== '') parts.push(`${input.id}=${value}`);
    }
    return `请运行「${tool.title}」分析。输入与参数：${parts.join('，')}。输入文件请从项目工作区解析；完成后报告任务 ID。`;
  };

  return (
    <div className={styles.analysisLaunchForm} data-tool={tool.id}>
      {fileInputs.length > 0 && (
        <div role="group" aria-label={`${tool.title} 文件输入`}>
          {fileInputs.map((input: CatalogInputField) => (
            <label key={input.id} className={styles.analysisLaunchField}>
              <span>{input.label || input.id}{input.required !== false ? '（必填）' : ''}</span>
              <select
                aria-label={input.label || input.id}
                value={fileSelection[input.id] || ''}
                onChange={(event) => setFileSelection((prev) => ({ ...prev, [input.id]: event.target.value }))}
              >
                <option value="">&lt;选择文件&gt;</option>
                {csvFiles.map((file) => <option key={file.path} value={file.name}>{file.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      )}
      {paramInputs.map((input: CatalogInputField) => (
        <label key={input.id} className={styles.analysisLaunchField}>
          <span>{input.label || input.id}</span>
          <input
            type={input.type === 'number' ? 'number' : 'text'}
            aria-label={input.label || input.id}
            value={paramValues[input.id] ?? ''}
            onChange={(event) => setParamValues((prev) => ({ ...prev, [input.id]: event.target.value }))}
          />
        </label>
      ))}
      <button
        type="button"
        className={styles.analysisLaunchRun}
        onClick={() => onLaunchWithPrompt(tool, composePrompt())}
      >
        按以上参数运行
      </button>
    </div>
  );
}

export interface AnalysisLaunchPanelProps {
  tools: CatalogTool[];
  onLaunch: (tool: CatalogTool, launchPrompt?: string) => void;
  /** 目录尚在拉取中（区别于「已确认无插件」）。 */
  loading?: boolean;
  /** BLOCK-131：工作区文件清单（文件输入显式选择的选项源）。 */
  workspaceFiles?: Array<{ path: string; name: string }>;
  /** BLOCK-131：项目 id——提供时自动拉取工作区顶层 CSV/TSV 作为文件选项。 */
  projectId?: string | null;
}

/**
 * UI-147 / T84 — 分析入口面板：工作台内统一的分析启动/编排入口。
 * 把分散在聊天框输入里的分析启动能力，
 * 收敛为一个可发现、按类别分组、可一键启动的分析目录。点击「运行」即把
 * 该分析作为请求发送给 Agent（onLaunch），由 Agent 负责数据就绪检查与执行。
 * 仅依赖 props 与 onLaunch 回调，不持有状态、不反向依赖 RightPanel。
 *
 * BLOCK-83 D4：目录内容投影自已装插件（不再是核心内置清单）——零插件时
 * 渲染诚实空态，不伪造条目。
 * BLOCK-131（BIO-5 P2）：「配置」展开输入契约投影表单——文件选择+参数
 * 回填+显式参数运行 prompt（不再只有一句话发 Agent 的隐式路径）。
 */
export function AnalysisLaunchPanel({ tools, onLaunch, loading = false, workspaceFiles: workspaceFilesProp, projectId = null }: AnalysisLaunchPanelProps): React.ReactElement {
  const groups = React.useMemo(() => groupByCategory(tools), [tools]);
  // BLOCK-131：文件选项源——显式 props 优先；否则按项目拉顶层 CSV/TSV。
  const [treeFiles, setTreeFiles] = React.useState<Array<{ path: string; name: string }>>([]);
  React.useEffect(() => {
    if (workspaceFilesProp || !projectId) return;
    let cancelled = false;
    fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/tree?limit=200`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
      .then((resp) => (resp.ok ? resp.json() : { entries: [] }))
      .then((data) => {
        if (cancelled) return;
        const entries = Array.isArray(data.entries) ? data.entries : [];
        setTreeFiles(entries
          .filter((entry: { name?: string; type?: string }) => entry && entry.name && (!entry.type || entry.type === 'file'))
          .map((entry: { path?: string; name: string }) => ({ path: entry.path || entry.name, name: entry.name })));
      })
      .catch(() => { /* 文件清单失败=选项为空，不阻断表单 */ });
    return () => { cancelled = true; };
  }, [projectId, workspaceFilesProp]);
  const workspaceFiles = workspaceFilesProp || treeFiles;
  const isEmpty = tools.length === 0;
  const [expandedTool, setExpandedTool] = React.useState<string | null>(null);

  return (
    <div className={styles.analysisLaunch}>
      <header className={styles.analysisLaunchHeader}>
        <strong>分析入口</strong>
        <span className={styles.analysisLaunchHint}>选择一项分析，发给 Agent 运行；「配置」可显式指定输入与参数</span>
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
                      <div className={styles.analysisLaunchCardActions}>
                        {!tool.comingSoon && tool.inputs.length > 0 && (
                          <button
                            type="button"
                            className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                            aria-expanded={expandedTool === tool.id}
                            onClick={() => setExpandedTool((current) => (current === tool.id ? null : tool.id))}
                          >
                            {expandedTool === tool.id ? '收起' : '配置'}
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.analysisLaunchRun}
                          disabled={tool.comingSoon}
                          onClick={() => onLaunch(tool)}
                        >
                          {tool.comingSoon ? '即将推出' : '运行'}
                        </button>
                      </div>
                    </div>
                    {expandedTool === tool.id && !tool.comingSoon && (
                      <ToolLaunchForm
                        tool={tool}
                        workspaceFiles={workspaceFiles}
                        onLaunchWithPrompt={(t, prompt) => {
                          setExpandedTool(null);
                          onLaunch(t, prompt);
                        }}
                      />
                    )}
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
