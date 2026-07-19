/**
 * helpers/system-prompt.js — buildSystemPrompt + ERROR_I18N + localizeToolResult
 *
 * Extracted from server.js. Pure module: no side effects, no external state.
 *
 * Public API:
 *   buildSystemPrompt(context) → string
 *   localizeToolResult(result) → result (mutated with message field)
 *   ERROR_I18N — exported map of error codes to Chinese strings
 */

// ERROR_I18N_v1 — map agent-tool error codes to Chinese messages
const ERROR_I18N = {
  missing_args: '缺少必要参数',
  missing_code: '缺少代码字段',
  missing_cluster: '请指定 cluster 编号',
  missing_columnFilters: '请提供筛选条件',
  missing_datasetId: '请指定数据集',
  missing_analysisId: '请指定分析',
  missing_projectId: '请指定项目',
  missing_planId: '请指定 plan',
  missing_label_args: '缺少标签 key 或 value',
  missing_figcardId: '缺少 figcode 卡片 id',
  missing_meta: '该数据集还没有 metadata，无法按列筛选。请先做完标准分析生成 metadata。',
  no_meta: '该数据集还没有 metadata，无法按列筛选。请先做完标准分析生成 metadata。',
  no_cell_id_column: 'metadata 中没有 cell_id 列，无法创建子集',
  no_cell_ids_extracted: '从筛选结果中没能提取到 cell_id',
  no_matches: '筛选条件没有匹配到任何细胞',
  too_many_cells: '匹配的细胞数超过 20 万上限，请加更严格的筛选条件',
  fetch_meta_failed: '无法读取 metadata 文件，可能 OSS 暂时不可达',
  meta_empty: 'metadata 文件是空的或格式不对',
  dataset_not_found: '找不到这个数据集（可能不属于你或已删除）',
  analysis_not_found: '找不到这个分析',
  project_not_found: '找不到这个项目',
  plan_not_found: '找不到这个 plan',
  parent_not_found: '父分析不存在',
  parent_not_ready: '父分析还没完成，需要等它跑完',
  parent_failed: '父分析失败了，无法继续基于它做分析',
  task_submit_failed: '提交任务失败，请稍后重试',
  agent_paused: '你已暂停 Agent Mode，自动操作已停。请在用户菜单 → Copilot 记忆 中恢复。',
  rate_limited: '操作太频繁了（1 分钟最多 5 次），请稍候',
  quota_exceeded: '月度分析次数已达上限',
  too_many_inflight: '同一数据集上同类分析并发太多，请等其他完成',
  unknown_act: '不支持的操作类型',
  unknown_op: '不支持的 plan 操作',
  unknown_resource: '不支持的资源类型',
  invalid_tab: '不存在的 tab',
  invalid_status: '不允许的状态',
  invalid_category: '不支持的事实分类',
  exec_failed: '执行失败',
  code_too_long: '代码超过 30K 字符上限',
  nothing_to_update: '没有可更新的字段',
  need_2_datasets: '至少需要 2 个数据集才能合并',
  fact_required: '内容不能为空',
  unauthorized: '未授权访问',
  guest_no_account: '未登录访客没有个人项目/分析数据',
  fetch_failed: '请求失败',
  fetch_timeout: '请求超时',
};

function localizeToolResult(result) {
  if (result == null) {
    return {
      ok: false,
      error: 'not_found',
      message: '没有找到匹配的数据。请使用当前项目上下文继续回答，并明确说明缺少的输入。',
    };
  }
  if (typeof result !== 'object') return result;
  if (result.error && !result.message) {
    const cn = ERROR_I18N[result.error];
    if (cn) result.message = cn;
    else result.message = '操作失败：' + result.error;
  }
  return result;
}

function renderHarnessSummaryForPrompt(title, harness, options = {}) {
  if (!harness || typeof harness !== 'object') return '';
  let block = '\n\n【' + title + '】';
  block += '\n- 文件数：' + (harness.fileCount || 0) + (harness.truncated ? '（已截断）' : '');
  if (harness.byRole && typeof harness.byRole === 'object') {
    block +=
      '\n- 文件角色统计：' +
      Object.entries(harness.byRole)
        .map(([k, v]) => k + '=' + v)
        .join(', ');
  }
  if (harness.byKind && typeof harness.byKind === 'object') {
    block +=
      '\n- 文件类型统计：' +
      Object.entries(harness.byKind)
        .map(([k, v]) => k + '=' + v)
        .join(', ');
  }
  const entries = Array.isArray(harness.entries) ? harness.entries : [];
  const activeName = options.activeArtifactName ? String(options.activeArtifactName) : '';
  const matched = activeName
    ? entries.find((entry) => entry && (entry.relativePath === activeName || String(entry.relativePath || '').endsWith('/' + activeName)))
    : null;
  if (matched) {
    block += '\n- 当前选中文件识别：' + renderHarnessEntryLine(matched);
  }
  if (entries.length > 0) {
    block += '\n- 候选文件：';
    for (const entry of entries.slice(0, options.maxEntries || 20)) {
      if (!entry || typeof entry !== 'object') continue;
      block += '\n  - ' + renderHarnessEntryLine(entry);
    }
  }
  return block;
}

function renderHarnessEntryLine(entry) {
  let line = entry.relativePath + ' [' + entry.role + '/' + entry.kind + ']';
  if (entry.table) {
    const table = entry.table;
    if (table.columnCount != null || table.rowSampleCount != null) {
      line += ' cols=' + (table.columnCount ?? '?') + ', sampleRows=' + (table.rowSampleCount ?? '?');
    }
    if (table.matrixOrientation) line += ', orientation=' + table.matrixOrientation;
    if (Array.isArray(table.headers) && table.headers.length > 0) {
      line += ', headers=' + table.headers.slice(0, 8).join('|');
    }
  }
  return line;
}

function buildSystemPrompt(context, runtimeIdentity = {}) {
  // PAGE_CONTENT_AWARE_v1
  let base = '你是当前桌面工作台中的生物信息学分析助手，帮助用户完成数据分析、解释结果和推进可复现工作流。';
  const runtimeProvider = typeof runtimeIdentity.provider === 'string'
    ? runtimeIdentity.provider.trim()
    : '';
  const runtimeProviderLabel = typeof runtimeIdentity.providerLabel === 'string'
    ? runtimeIdentity.providerLabel.trim()
    : runtimeProvider;
  const runtimeModel = typeof runtimeIdentity.model === 'string'
    ? runtimeIdentity.model.trim()
    : '';
  if (runtimeProvider || runtimeModel) {
    base += '\n\n=== 当前推理身份（必须透明披露） ===';
    if (runtimeProviderLabel) base += `\n- 供应商：${runtimeProviderLabel}`;
    if (runtimeProvider && runtimeProvider !== runtimeProviderLabel) {
      base += `（Provider ID：${runtimeProvider}）`;
    }
    if (runtimeModel) base += `\n- 模型：${runtimeModel}`;
    base += '\n- 你的工作角色是“生物信息学分析助手”，它不替代底层供应商或模型身份。';
    base += '\n- 用户问“你是谁”“什么模型”“哪个供应商”时，必须直接说明当前供应商和当前模型 ID，并可简短说明你的工作角色；不得省略、模糊或声称看不到这里已经提供的信息。';
    base += '\n- 回答身份问题时不得提及任何产品名，也不得使用“Copilot”作为身份。';
    base += '\n- 不要冒充供应商官方助手；应表述为“我是 <供应商> 提供的 <模型> 模型，当前作为你的生物信息学分析助手运行”。';
  }
  base += '\n\n核心原则：';
  base += '\n- 用简洁的中文回答，避免冗余';
  base +=
    '\n- 你不是被动答疑机器人，而是用户的执行代理：能 emit action 就 emit，绝不要说"我无法点击"或"我无法操作"这种话';
  base +=
    '\n- 当你 emit navigate / external_link action 时，前端会自动跳转。所以表述要用"我帮你打开...""已经为你跳转"等主动语气，不要说"点这个按钮""请点击"';
  base +=
    '\n- 站内跳转（教程 / FigCode 卡片 / 单细胞页）一律用 /... 形式的相对路径，不要写 https://biof3.com。例如 /figcode#volcano 不要写 https://biof3.com/figcode#volcano。external_link 只用于真正的外站链接（如 GitHub）。';
  base +=
    '\n- 当用户说"帮我打开/进入/查看 X"时：如果你已经从下方资源列表知道了 X 的 id，立即 emit navigate action；不要再反问 id';
  base += '\n- 优先用下方提供的真实数据回答（用户的项目/数据集/分析），而不是泛泛而谈';
  base += '\n- 不确定时直接说不确定，不要编造 id 或参数';
  base += '\n- 涉及代码时给出完整可运行片段（R/Python/Bash）';
  base +=
    '\n- 当用户问"这一页"/"这段"/"这里说的"等指代当前页面内容时，请基于下方提供的【当前页面内容】回答，不要凭空编造';
  base +=
    '\n- 历史消息开头若带有 [页面·实体] 标签（例如 [docs · PCA降维] 或 [single-cell-result · PBMC]），表示用户当时正在浏览那个页面。利用这些标签理解用户跨页面的思维链：用户可能从教程跳到分析页又跳回博客，但话题往往是延续的';
  base += '\n- 当前消息没有标签，但下方【当前页面】指明了用户此刻的位置';

  base += `\n\n=== Action Cards Protocol (ACTION_PROTOCOL_v1) ===\n\nAction cards are only for navigation and external links. Scientific analysis must use run_tool so every execution creates a tool_job and verified artifacts.\n\nEach action card is a single JSON object in a fenced \u0060\u0060\u0060action block. Supported types:\n\n1) navigate\n   { "type": "navigate", "label": "查看数据集",\n     "target": "dataset|result|project|projects",\n     "id": "<entity id, omit for projects>" }\n\n2) external_link\n   { "type": "external_link", "label": "查看 Seurat 教程", "url": "https://..." }\n\nRules:\n- Never emit start_analysis or recluster action cards; call run_tool instead.\n- Only emit actions using real IDs from the current context.\n- Put actions after the natural-language explanation.\n- Do not emit action blocks for ordinary questions.\n- Never invent IDs.\n`;

  if (!context) return base;

  const {
    page,
    pageTitle,
    pageUrl,
    pageContent,
    pageOutline,
    visibleHeading,
    datasetId,
    datasetName,
    analysisId,
    analysisType,
    analysisName,
    summary,
    clusterIds,
    plotName,
    codeContent,
    currentModule, // W1-6: 'single-cell' | 'spatial' | undefined
  } = context;

  // W1-6 (2026-05-28): currentModule 注入 — 让 AI 识别用户所在的云平台模块
  if (currentModule === 'spatial') {
    base += '\n\n=== 当前云平台模块：空间组学 (/spatial) ===';
    base +=
      '\n- 用户当前在空间转录组模块，分析统一调用 run_tool；当前本地工具为 spatial-standard / spatial-svg / spatial-deconv / spatial-lr';
    base +=
      '\n- 数据格式以 .h5ad（含 obsm["spatial"] 坐标）为主，主要数据来源：10x Visium / Stereo-seq / MERFISH';
    base +=
      '\n- 后端走 py-server（Squidpy / SpatialData / cell2location / LIANA 生态），不是 r-server';
    base +=
      '\n- 不要建议 scrna_standard / cell_annotation 等单细胞类型作为首选——除非用户明确想用 sc reference 做解卷积';
  } else if (currentModule === 'single-cell') {
    base += '\n\n=== 当前云平台模块：单细胞 (/single-cell) ===';
    base +=
      '\n- 用户当前在单细胞模块，分析统一调用 run_tool；先 op=list 确认可用工具，常用本地工具包括 seurat-standard / cellchat / go-kegg';
    base += '\n- 数据格式以 .rds / .h5 / matrix.mtx 为主';
    base += '\n- 后端走 r-server（Seurat v5 + clusterProfiler + Monocle3 + CellChat 生态）';
  }

  if (page === 'single-cell-result') {
    base += '\n\n用户当前在【单细胞分析结果页】';
    if (analysisName) base += '：' + analysisName;
    if (analysisType) base += '（类型：' + analysisType + '）';
    if (analysisId) base += '\nanalysisId=' + analysisId;
    if (datasetName) base += '\n数据集：' + datasetName;
    if (datasetId) base += ' (datasetId=' + datasetId + ')';
    if (summary) {
      base += '\n关键指标：';
      if (summary.nCells) base += '细胞数=' + summary.nCells + ', ';
      if (summary.nGenes) base += '基因数=' + summary.nGenes + ', ';
      if (summary.nClusters) base += 'cluster数=' + summary.nClusters;
    }
    if (Array.isArray(clusterIds) && clusterIds.length > 0) {
      base += '\n可用 cluster: ' + clusterIds.slice(0, 30).join(', ');
    }
  } else if (page === 'spatial-result') {
    // W1-6: 空间分析结果页
    base += '\n\n用户当前在【空间分析结果页】';
    if (analysisName) base += '：' + analysisName;
    if (analysisType) base += '（类型：' + analysisType + '）';
    if (analysisId) base += '\nanalysisId=' + analysisId;
    if (datasetName) base += '\n数据集：' + datasetName;
    if (datasetId) base += ' (datasetId=' + datasetId + ')';
    if (summary) {
      base += '\n关键指标：';
      if (summary.nSpots) base += 'spot数=' + summary.nSpots + ', ';
      if (summary.nGenes) base += '基因数=' + summary.nGenes + ', ';
      if (summary.nClusters) base += '空间cluster=' + summary.nClusters + ', ';
      if (summary.nSVGs) base += '显著SVG=' + summary.nSVGs;
    }
  } else if (page === 'single-cell-dataset') {
    base += '\n\n用户当前在【单细胞数据集页】';
    if (datasetName) base += '：' + datasetName;
    if (datasetId) base += ' (datasetId=' + datasetId + ')';
  } else if (page === 'spatial-dataset') {
    // W1-6
    base += '\n\n用户当前在【空间数据集页】';
    if (datasetName) base += '：' + datasetName;
    if (datasetId) base += ' (datasetId=' + datasetId + ')';
  } else if (page === 'single-cell-projects') {
    base += '\n\n用户当前在单细胞云平台的项目列表页';
  } else if (page === 'spatial-projects') {
    // W1-6
    base += '\n\n用户当前在空间组学云平台的项目列表页';
  } else if (page === 'figcode') {
    base += '\n\n用户当前在 FigCode 图表代码库';
    if (plotName) base += '，正在查看：' + plotName;
  } else if (page === 'docs') {
    base += '\n\n用户当前在【生信教程页面】';
    if (pageTitle) base += '：' + pageTitle;
    if (visibleHeading) base += '\n用户视野中的章节：' + visibleHeading;
  } else if (page === 'blog') {
    base += '\n\n用户当前在【博客文章】';
    if (pageTitle) base += '：' + pageTitle;
    if (visibleHeading) base += '\n用户视野中的章节：' + visibleHeading;
  } else if (page === 'home') {
    base += '\n\n用户当前在站点主页';
  } else if (page === 'desktop-home') {
    base += '\n\n用户当前在桌面端首页（项目仪表盘），可看到所有项目卡片和最近活动';
  } else if (page === 'desktop-project') {
    base += '\n\n用户当前在【桌面端项目工作台】';
    if (pageTitle) base += '：' + pageTitle;
    if (context.projectModality) {
      base += '\n项目类型：' + context.projectModality;
      if (context.projectModality === 'single-cell') {
        base += '（单细胞，r-server / Seurat 生态）';
      } else if (context.projectModality === 'spatial') {
        base += '（空间转录组，py-server / Squidpy 生态）';
      }
    }
    if (Array.isArray(context.projectDatasets) && context.projectDatasets.length > 0) {
      base += '\n\n【项目数据集】';
      for (const ds of context.projectDatasets.slice(0, 10)) {
        base += '\n- ' + ds.name + ' (id=' + ds.id;
        if (ds.rows != null) base += ', 细胞/spot数=' + ds.rows;
        if (ds.type) base += ', type=' + ds.type;
        base += ')';
      }
    } else {
      base += '\n\n【项目数据集】暂无数据集';
    }
    if (Array.isArray(context.projectJobs) && context.projectJobs.length > 0) {
      base += '\n\n【项目分析历史】(最近 ' + context.projectJobs.length + ' 条)';
      for (const job of context.projectJobs.slice(0, 15)) {
        const time = new Date(job.createdAt).toLocaleString('zh-CN', { hour12: false });
        base += '\n- [' + job.status + '] ' + (job.name || job.toolId) + ' (id=' + job.id + ', ' + time + ')';
      }
    }
    base += renderHarnessSummaryForPrompt('Harness 项目文件摘要', context.projectHarnessSummary, {
      maxEntries: 20,
    });
    if (context.activeJobHarnessSummary && typeof context.activeJobHarnessSummary === 'object') {
      base += renderHarnessSummaryForPrompt('Harness 当前结果产物摘要', context.activeJobHarnessSummary, {
        activeArtifactName: context.activeArtifact && context.activeArtifact.name,
        maxEntries: 20,
      });
    }
    if (context.projectHarnessSummary || context.activeJobHarnessSummary) {
      base += '\n提示：运行工具前优先结合该 Harness 摘要和 run_tool(op="list") 的 manifest 判断文件参数；不确定时让参数确认卡和 /api/harness/repair 兜底。';
    }
    if (context.activeJobId) {
      base += '\n\n用户正在查看结果：jobId=' + context.activeJobId;
    }
    base += '\n\n提示：用户在桌面端项目工作台中，可以基于已有数据集启动分析、查看结果、或请求 Agent 协助。数据集 ID 和 job ID 可用于 action card。';
  }

  if (pageUrl) base += '\n页面 URL：' + pageUrl;

  if (Array.isArray(pageOutline) && pageOutline.length > 0) {
    base += '\n\n【当前页面大纲】\n' + pageOutline.slice(0, 25).join('\n');
  }

  if (typeof pageContent === 'string' && pageContent.length > 0) {
    base += '\n\n【当前页面正文】\n' + pageContent;
  }

  if (typeof codeContent === 'string' && codeContent.length > 0) {
    base += '\n\n【当前编辑器中的代码】\n```r\n' + codeContent + '\n```';
  }

  base += renderFileReferenceHints(context);

  return base;
}

/**
 * 给 system prompt 注入内部 URI 协议说明：让模型知道在提到工具产物 / harness
 * 文件时输出可读 Markdown 链接，不要暴露 file:// 或本机绝对路径。
 *
 * Action Card 协议不变；这里只追加一段【文件引用格式】。当 `context` 里没有
 * toolJobId / harness 摘要时，仅保留总体规则；否则补一段示例，让模型能落地。
 */
function renderFileReferenceHints(context) {
  let block = '\n\n=== 文件引用格式 (CHAT_FILE_REF_URI_v1) ===';
  block +=
    '\n- 提到任意工具产物 / toolJobId / harness 列出的文件 / 项目工作区文件时，使用内部 URI 协议，渲染为 Markdown 链接：[label](biof3://…) 形式。';
  block +=
    '\n  - 工具产物（运行某 tool 后产出的文件）：[产物名.csv](biof3://artifact/<toolJobId>/<产物名>)，<toolJobId> 取自 run_tool 返回的 toolJobId 或 tool_job/artifact 摘要；产物名只用 basename，禁止 / 或 file:// 等。';
  block +=
    '\n  - 项目工作区文件（用户上传到项目 workspace 的 csv/rds/h5/...）：[data.csv](biof3://workspace/<projectId>/<relativePath>)，relativePath 是相对 project workspace 根的正向路径，例如 data/sample.csv；不要写真机绝对路径，不要写 file:// 或 /Users/...。';
  block +=
    '\n- 永远不要在 Markdown 链接里直接写 file://、http://localhost、/Users/...、C:\\... 这类本机 / 绝对路径；前端会把它们当 dangerous 链接剥掉。';
  block +=
    '\n- 当用户问到具体某个工具产物或工作区文件但你拿不到准确 id 时，告诉用户"没拿到该文件的内部 id，无法生成直达链接"，不要凭空伪造 path。';
  block +=
    '\n- 这些 URI 只在 Copilot 聊天内渲染，不影响 navigate / external_link Action Card；分析执行仍调用 run_tool。';

  const summary = context && context.activeJobHarnessSummary;
  if (summary && Array.isArray(summary.entries) && summary.entries.length > 0) {
    const examples = summary.entries.slice(0, 3).map((entry) => {
      if (!entry || !entry.relativePath) return null;
      const safePath = String(entry.relativePath).replace(/[<>"'\\\u0000-\u001F\u007F]/g, '');
      if (!safePath) return null;
      const label = safePath.split('/').pop() || safePath;
      const jobId = context && context.activeJobId ? String(context.activeJobId) : '<toolJobId>';
      return `[${label}](biof3://artifact/${encodeURIComponent(jobId)}/${encodeURIComponent(label)})`;
    }).filter(Boolean);
    if (examples.length > 0) {
      block += '\n\n本会话当前 toolJob 的产物 URI 示例：';
      for (const line of examples) {
        block += '\n- ' + line;
      }
    }
  }

  return block;
}

module.exports = {
  buildSystemPrompt,
  localizeToolResult,
  renderFileReferenceHints,
  ERROR_I18N,
};
