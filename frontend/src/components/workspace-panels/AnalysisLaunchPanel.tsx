import React from 'react';
import type { CatalogInputField, CatalogTool } from '@/lib/tool-catalog';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { demoDataTargetDir, loadDemoDataIntoWorkspace } from '@/lib/demo-data';
import styles from '@/pages/project-workspace.module.css';

function groupByCategory(tools: CatalogTool[]): Array<{ category: string; items: CatalogTool[] }> {
  const map = new Map<string, CatalogTool[]>();
  for (const tool of tools) {
    if (!map.has(tool.category)) map.set(tool.category, []);
    map.get(tool.category)!.push(tool);
  }
  return [...map.entries()].map(([category, items]) => ({ category, items }));
}

/** BLOCK-148 #11：tree?recursive=1 响应形状（与后端 files.js 契约同构）。 */
interface WorkspaceTreeResponse {
  entries?: Array<{ name?: string; type?: string; path?: string }>;
  inputExtensions?: unknown[];
  /** BLOCK-148 P2-3：500 条触顶的诚实截断信号——true 时下拉只含前 500 项，须提示。 */
  truncated?: boolean;
}

/** BLOCK-148 #11：按 tree 响应投影的白名单（inputExtensions，与上传面同源）过滤可选文件。
 * 无第二份清单——扩展名列表只来自后端投影，缺省（旧响应/拉取失败）= 无可选项。 */
function filterByInputExtensions(
  files: Array<{ path: string; name: string }>,
  extensions: string[],
): Array<{ path: string; name: string }> {
  if (extensions.length === 0) return [];
  const lowers = extensions.map((ext) => ext.toLowerCase());
  return files.filter((f) => {
    const name = f.name.toLowerCase();
    return lowers.some((ext) => name.endsWith(ext));
  });
}

/**
 * BLOCK-131（BIO-5 P2）：把插件输入契约投影为显式参数表单——文件输入
 * 枚举工作区文件供选择（未选=「<选择文件>」占位，由 Agent 侧数据
 * 就绪检查兜底），文本/数值输入带默认值回填；「按以上参数运行」组装
 * 携带显式参数的启动 prompt（文件名与参数值点名进指令），保留「配置/
 * 收起」与旧「运行」一键路径（无参数直达 Agent）。
 *
 * BLOCK-148 #11：文件选项 value 改用 workspace 相对完整 path（同名不同
 * 目录消歧），显示名即 path（子目录文件带相对目录）。
 * BLOCK-148 #12：demoDataUrl 声明的工具提供「用示例数据试跑」——demo
 * 输入文件一键落工作区 demo-data/<toolId>/，落完即出现在上方下拉。
 */
function ToolLaunchForm({ tool, workspaceFiles, projectId, onLaunchWithPrompt, onWorkspaceFilesRefreshed, treeTruncated }: {
  tool: CatalogTool;
  workspaceFiles: Array<{ path: string; name: string }>;
  projectId?: string | null;
  onLaunchWithPrompt: (tool: CatalogTool, prompt: string) => void;
  onWorkspaceFilesRefreshed?: () => void;
  /** BLOCK-148 P2-3：tree 500 条触顶信号——true 时文件下拉仅含前 500 项，须诚实提示。 */
  treeTruncated?: boolean;
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
  const [demoBusy, setDemoBusy] = React.useState(false);
  const [demoMessage, setDemoMessage] = React.useState<string | null>(null);

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

  const handleLoadDemo = async () => {
    if (demoBusy || !projectId) return;
    setDemoBusy(true);
    setDemoMessage(null);
    try {
      const summary = await loadDemoDataIntoWorkspace(projectId, tool.id);
      if (summary.listed === 0) {
        setDemoMessage('该工具未提供示例数据');
      } else {
        setDemoMessage(`已载入 ${summary.loaded} 个示例文件到 ${demoDataTargetDir(tool.id)}/，可在上方文件下拉中选择${summary.skipped > 0 ? `（${summary.skipped} 个已存在跳过）` : ''}`);
        onWorkspaceFilesRefreshed?.();
      }
    } catch (error) {
      setDemoMessage(`示例数据载入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDemoBusy(false);
    }
  };

  return (
    <div className={styles.analysisLaunchForm} data-tool={tool.id}>
      {fileInputs.length > 0 && (
        <div role="group" aria-label={`${tool.title} 文件输入`}>
          {treeTruncated && (
            <p className={styles.analysisLaunchHint} role="note">
              工作区文件较多，仅列出前 500 项——若找不到目标文件，可先整理工作区或用子目录收纳。
            </p>
          )}
          {fileInputs.map((input: CatalogInputField) => (
            <label key={input.id} className={styles.analysisLaunchField}>
              <span>{input.label || input.id}{input.required !== false ? '（必填）' : ''}</span>
              <select
                aria-label={input.label || input.id}
                value={fileSelection[input.id] || ''}
                onChange={(event) => setFileSelection((prev) => ({ ...prev, [input.id]: event.target.value }))}
              >
                <option value="">&lt;选择文件&gt;</option>
                {workspaceFiles.map((file) => <option key={file.path} value={file.path}>{file.path}</option>)}
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
      {fileInputs.length > 0 && tool.demoDataUrl && projectId && (
        <div>
          <button
            type="button"
            className="gewu-btn gewu-btn--ghost gewu-btn--sm"
            disabled={demoBusy}
            onClick={() => { void handleLoadDemo(); }}
          >
            {demoBusy ? '正在载入示例数据…' : '用示例数据试跑'}
          </button>
          {demoMessage && <span role="status">{demoMessage}</span>}
        </div>
      )}
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
  /** BLOCK-131：工作区文件清单（文件输入显式选择的选项源；显式提供时为调用方策展清单，不再按白名单过滤）。 */
  workspaceFiles?: Array<{ path: string; name: string }>;
  /** BLOCK-131 / BLOCK-148 #11：项目 id——提供时自动拉取工作区树（recursive=1，子目录可达）
   * 作为文件选项，白名单跟随响应 inputExtensions（与上传面同源）。 */
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
  // BLOCK-148 #11：文件选项源 + 下拉白名单（inputExtensions，后端与上传面同源投影）。
  // 显式 props 优先作为文件清单（调用方策展，不再过滤）；tree 拉取改 recursive=1
  // （子目录文件可达，条目 path = workspace 相对路径）。demo 载入后 bump version 重拉。
  const [treeFiles, setTreeFiles] = React.useState<Array<{ path: string; name: string }>>([]);
  const [treeTruncated, setTreeTruncated] = React.useState(false);
  const [inputExtensions, setInputExtensions] = React.useState<string[]>([]);
  const [treeVersion, setTreeVersion] = React.useState(0);
  React.useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/tree?recursive=1`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
      .then(async (resp): Promise<WorkspaceTreeResponse> => (resp.ok ? (await resp.json()) as WorkspaceTreeResponse : { entries: [] }))
      .then((data) => {
        if (cancelled) return;
        const entries = Array.isArray(data.entries) ? data.entries : [];
        const files: Array<{ path: string; name: string }> = [];
        for (const entry of entries) {
          if (!entry || !entry.name) continue;
          if (entry.type && entry.type !== 'file') continue;
          files.push({ path: entry.path || entry.name, name: entry.name });
        }
        setTreeFiles(files);
        setInputExtensions(Array.isArray(data.inputExtensions) ? data.inputExtensions.map((ext) => String(ext)) : []);
        setTreeTruncated(data.truncated === true);
      })
      .catch(() => { /* 文件清单失败=选项为空，不阻断表单 */ });
    return () => { cancelled = true; };
  }, [projectId, treeVersion]);
  const workspaceFiles = workspaceFilesProp || filterByInputExtensions(treeFiles, inputExtensions);
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
                        projectId={projectId}
                        onLaunchWithPrompt={(t, prompt) => {
                          setExpandedTool(null);
                          onLaunch(t, prompt);
                        }}
                        onWorkspaceFilesRefreshed={() => setTreeVersion((v) => v + 1)}
                        treeTruncated={treeTruncated}
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
