/**
 * agent-tools/tool-defs.js — OpenAI-compatible tool definitions for DeepSeek
 */
const _fs = require('fs');
const _path = require('path');

// --------------------------------------------------------------
// Tool schemas (OpenAI-compatible function definitions)
// --------------------------------------------------------------
const WORKSPACE_TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'workspace_list',
      description:
        '列出当前 BioF3 项目工作区中的目录内容。路径必须是相对项目根目录的路径；不会返回符号链接或默认隐藏文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的目录，默认 "."' },
          includeHidden: { type: 'boolean', description: '是否包含普通隐藏文件，默认 false；敏感路径始终不可见' },
          limit: { type: 'integer', description: '最多返回多少项，默认 200，最大 500' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_find',
      description:
        '在当前项目工作区递归查找文件名。适合先定位 CSV、脚本、配置或报告；不会进入 node_modules、.git、target、dist 等生成目录。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'glob 模式，例如 "*.csv"、"scripts/*.R"、"**/report.html"' },
          path: { type: 'string', description: '相对搜索起点，默认 "."' },
          maxDepth: { type: 'integer', description: '递归深度，默认 8，最大 20' },
          limit: { type: 'integer', description: '最多返回多少项，默认 200，最大 500' },
          includeHidden: { type: 'boolean', description: '是否包含普通隐藏文件，默认 false' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_search',
      description:
        '在当前项目工作区的文本文件中搜索内容并返回文件、行号和匹配行。适合定位列名、函数、配置项和错误信息。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜索的文本' },
          path: { type: 'string', description: '相对文件或目录，默认 "."' },
          filePattern: { type: 'string', description: '可选 glob，例如 "*.R"、"**/*.ts"' },
          caseSensitive: { type: 'boolean', description: '是否区分大小写，默认 false' },
          maxDepth: { type: 'integer', description: '递归深度，默认 8，最大 20' },
          limit: { type: 'integer', description: '最多返回匹配行数，默认 80，最大 300' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_read',
      description:
        '分段读取当前项目工作区内的文本文件，返回行号范围、总行数和 sha256。大文件应多次按 startLine/maxLines 分段读取。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
          startLine: { type: 'integer', description: '起始行，从 1 开始，默认 1' },
          maxLines: { type: 'integer', description: '最多读取行数，默认 240，最大 1000' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_write',
      description:
        '在当前项目工作区创建或完整覆写一个文本文件。已存在文件必须传 overwrite=true；建议同时传 workspace_read 返回的 expectedSha256 防止覆盖并发修改。只读模式或只检查请求中禁止调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
          content: { type: 'string', description: '完整文本内容，最大 1 MiB' },
          overwrite: { type: 'boolean', description: '目标存在时必须显式为 true' },
          expectedSha256: { type: 'string', description: '可选：写入前文件 sha256，用于并发冲突检测' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_replace',
      description:
        '在当前项目工作区文本文件中做一次精确替换。oldText 必须唯一匹配；建议传 expectedSha256 防止覆盖并发修改。只读模式或只检查请求中禁止调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
          oldText: { type: 'string', description: '必须在文件中唯一出现的原文本' },
          newText: { type: 'string', description: '替换后的文本' },
          expectedSha256: { type: 'string', description: '可选：修改前文件 sha256' },
        },
        required: ['path', 'oldText', 'newText'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_exec',
      description:
        '在当前项目工作区根目录执行一个短命令，最多 30 秒并截断输出。适合检查、测试、格式化和短脚本；禁止 sudo、文件删除、git push/reset --hard、发布、远程脚本管道等危险操作。开发服务器、watch、训练等长驻进程不支持。只读模式或只检查请求中禁止调用。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '单行短命令' },
          timeoutMs: { type: 'integer', description: '超时毫秒，默认 20000，最大 30000' },
        },
        required: ['command'],
      },
    },
  },
];

const TOOL_DEFS = [
  ...WORKSPACE_TOOL_DEFS,
  {
    type: 'function',
    function: {
      name: 'query',
      description:
        '查询当前项目范围内的结构化资源。返回 JSON 数组。' +
        '资源类型：projects | datasets | analyses | facts | memories. ' +
        '当你需要更详细的资源信息（system prompt 里没有的字段）时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          resource: {
            type: 'string',
            enum: ['projects', 'datasets', 'analyses', 'facts', 'memories'],
            description: '资源类型',
          },
          id: { type: 'string', description: '可选：精确查找某条记录' },
          parentId: {
            type: 'string',
            description: '可选：父级 id（如 projectId 用来列 datasets）',
          },
          limit: { type: 'integer', description: '默认 50，最大 200' },
        },
        required: ['resource'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_page',
      description:
        '读取已安装内容插件的教程片段。url 形如 /plugin/<pluginId>/<slug>（如 /plugin/deseq2-tutorial/quickstart）。' +
        '当分析现场卡住、不确定某工具/流程怎么用时，先调 read_page 查对应插件教程片段再回答用户。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              '已安装内容插件路径，格式为 /plugin/<id>/<slug>。',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search',
      description:
        '在当前项目记忆或已安装内容插件中做语义 + 关键词检索。' +
        '分析卡住、不确定某工具或流程怎么用时，优先用 scope=plugins。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '查询语句' },
          scope: {
            type: 'string',
            enum: ['memories', 'plugins'],
            description: 'memories 搜当前项目记忆；plugins 搜已安装内容插件。',
          },
          topK: { type: 'integer', description: '返回多少条，默认 5，最大 15' },
        },
        required: ['q', 'scope'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'act',
      description:
        'ACT_TOOL_v1 — 在用户的 BioF3 账户上执行写操作。受白名单限制，所有操作都会被审计记录，并支持 5 秒内撤销。' +
        '支持的 type：' +
        ' rename_project / rename_dataset / rename_analysis（重命名）;' +
        ' update_analysis_params（修改分析参数）。' +
        '不允许：删除、跨用户操作、上传数据。删除请让用户自己在 UI 中操作。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'rename_project',
              'rename_dataset',
              'rename_analysis',
              'update_analysis_params',
              'update_figcode_editor',
              'switch_result_tab',
              'focus_cluster',
              'highlight_gene',
              'select_cells',
              'filter_table',
              'label_cells',
              'merge_datasets',
              'open_replot',
              'upload_data_hint',
              'open_figcode_plot',
              'open_tool',
            ],
            description: '操作类型',
          },
          datasetId: { type: 'string', description: 'rename_dataset 等数据集操作使用' },
          analysisId: {
            type: 'string',
            description: 'rename_analysis / update_params 使用',
          },
          projectId: { type: 'string', description: 'rename_project 用' },
          cluster: { type: ['string', 'number'], description: 'focus_cluster 使用的 cluster' },
          name: { type: 'string', description: '可选：分析或资源的新名称' },
          newName: { type: 'string', description: 'rename_* 时的新名字' },
          params: {
            type: 'object',
            description: '具体参数对象，例如 {minCells:3, resolution:0.5}',
          },
          code: {
            type: 'string',
            description: 'update_figcode_editor 用：完整的新 R 代码（要替换编辑器中的内容）',
          },
          autoRun: {
            type: 'boolean',
            description: 'update_figcode_editor 用：是否替换后自动运行（默认 true）',
          },
          tab: {
            type: 'string',
            enum: ['preview', 'plots', 'data', 'params'],
            description: 'switch_result_tab 用：跳转到哪个 tab',
          },
          gene: { type: 'string', description: 'highlight_gene 用：基因符号（如 CD3E、IL7R）' },
          columnFilters: {
            type: 'object',
            description:
              'filter_table / select_cells 用：{列名: 筛选值} 的对象。多列做 AND，单列内用逗号或冒号分隔做 OR 匹配。例如 {"seurat_clusters":"5", "nFeature_RNA":">1000"}',
          },
          subsetName: { type: 'string', description: 'select_cells 用：可选的 subset 名' },
          labelKey: { type: 'string', description: 'label_cells 用：标签的 key（如 "cell_type"）' },
          labelValue: { type: 'string', description: 'label_cells 用：标签的值（如 "NK cell"）' },
          datasetIds: {
            type: 'array',
            description: 'merge_datasets 用：要合并的 dataset id 数组',
            items: { type: 'string' },
          },
          mergeName: { type: 'string', description: 'merge_datasets 用：合并后的新数据集名' },
          figcardId: {
            type: 'string',
            description: 'open_figcode_plot 用：FigCode 卡片 id（如 volcano、heatmap）',
          },
          toolId: {
            type: 'string',
            description: 'open_tool 用：工具 id（如 deseq2、enrichment、km-survival）',
          },
        },
        required: ['type'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'plan',
      description:
        'PLAN_TOOL_v1 — 持久化任务计划。当用户给出一个**多步骤的任务**' +
        '（例如"做完整的 PBMC 分析"或"对比两种方案"）时，应当先创建一个 plan，' +
        '再按步骤执行。Plan 跨会话保存，用户和 AI 都能看到推进进度。\n\n' +
        '操作：' +
        ' create（创建新 plan，需要 title + steps[]）;' +
        ' update_step（更新某 step 的状态/结果）;' +
        ' list（列用户所有 plan）;' +
        ' get（按 id 获取详情）;' +
        ' pause / resume（暂停/恢复整个 plan）;' +
        ' complete / cancel（完成或取消 plan）。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['create', 'update_step', 'list', 'get', 'pause', 'resume', 'complete', 'cancel'],
            description: '操作类型',
          },
          planId: {
            type: 'string',
            description: 'update_step / get / pause / resume / complete / cancel 用',
          },
          title: { type: 'string', description: 'create 用：plan 简短标题（一句话）' },
          goal: { type: 'string', description: 'create 用：plan 的最终目标（详细描述）' },
          steps: {
            type: 'array',
            description: 'create 用：步骤数组，每步 {n, title, hint?}。建议 3-8 步',
            items: {
              type: 'object',
              properties: {
                n: { type: 'integer' },
                title: { type: 'string' },
                hint: { type: 'string', description: '可选：执行此步的提示或参数建议' },
              },
            },
          },
          stepN: { type: 'integer', description: 'update_step 用：步骤序号（从 1 开始）' },
          stepStatus: {
            type: 'string',
            enum: ['pending', 'running', 'done', 'failed', 'skipped'],
            description: 'update_step 用：步骤新状态',
          },
          stepResult: {
            type: 'string',
            description: 'update_step 用：步骤结果摘要（done 时建议填）',
          },
          chatExcerpt: {
            type: 'string',
            description:
              'create 用（可选）：触发该计划的用户原话片段（≤ 200 字），用于以后回顾"当时为什么定这个计划"。',
          },
          analysisId: {
            type: 'string',
            description:
              'PLAN_STEP_LINK_v1_TOOL — update_step 用：把当前 step 关联到已有 analysis id，使其状态变化同步到步骤。',
          },
          toolJobId: {
            type: 'string',
            description:
              'PLAN_TOOL_JOB_LINK_v1 — update_step 用：把当前 step 关联到某个 tool_job id（bulk 工具，方案 C）。当你 run_tool 后立刻在该步骤调用 plan(update_step, toolJobId=<返回的 toolJobId>) 绑定。tool_jobs 状态 completed/failed 会自动同步 step status。',
          },
        },
        required: ['op'],
      },
    },
  },
  // ACT_GENERIC_TOOL_v1
  {
    type: 'function',
    function: {
      name: 'discover_capabilities',
      description:
        '查看当前网站注册的所有可调用的 generic act handler。每次会话开始时**先调用一次**，了解你能干什么。返回 {handler_id: {description, pages, payloadSchema, example}}。注意：这是**当前用户当前会话**的注册表，不同页面/版本可能不同。',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'act_generic',
      description:
        '通用执行通道。前端注册的任何 act handler 都可以通过此工具调用，不需要每次都加新的工具定义。**先调用 discover_capabilities 看可用 handler 列表**，再用此工具执行。如果某个 handler 不存在，会返回 unknown_handler；如果当前页面不允许，会返回 wrong_page。',
      parameters: {
        type: 'object',
        properties: {
          handlerId: {
            type: 'string',
            description: '注册表里的 handler id，例如 "violin_plot_open" 或 "export_dataset_csv"。',
          },
          payload: {
            type: 'object',
            description:
              '该 handler 期望的 payload 对象，参考 discover_capabilities 返回的 payloadSchema 和 example。',
          },
        },
        required: ['handlerId'],
      },
    },
  },
  // RUN_TOOL_v1 — 跑 BioF3 分析工具（deseq2/volcano-plot 等），真实执行出图
  {
    type: 'function',
    function: {
      name: 'run_tool',
      description:
        '执行 BioF3 的分析工具，真实跑 R/Python 脚本出图出表（不是模拟）。' +
        '\n六个操作：' +
        '\n - op=list：列出所有可用工具 + 参数契约（首次调用前先 list 看参数）' +
        '\n - op=plan：按标准模板生成 Agent 主导的多步骤计划，只规划、不自动执行' +
        '\n - op=status：从真实 tool jobs 和 artifact truth 重建计划状态' +
        '\n - op=next：返回当前可执行步骤与恢复建议，不自动执行' +
        '\n - op=bind_artifact：校验上一步 tool_job 的 artifact truth，并把真实产物绑定到下游输入' +
        '\n - op=run：执行指定工具，传 toolId + params' +
        '\n可用工具包括：deseq2（bulk 差异分析）、volcano-plot（火山图）、gene-correlation（基因相关性热图）、pca-explorer（PCA）等。' +
        '\n用户说"帮我跑差异分析"/"画火山图"/"做 DESeq2"/"分析这个 count 矩阵"时使用。' +
        '\n注意：file 类型参数传**本地绝对路径**（如 /Users/.../counts.csv）。执行返回 jobDir + 输出文件路径 + toolJobId，可读取出图/表。' +
        '\nplan 联动：跑完返回 toolJobId，若当前在 plan 推进中，立刻调 plan(op=update_step, toolJobId=<返回的 toolJobId>) 绑定，分析状态（completed/failed）自动同步 step。' +
        '\n重操作确认：deseq2/wgcna/ml-*/rsf-survival/lasso-cox/consensus-cluster/seurat-standard/cellchat/maftools-mutation/mo-* 等重操作，首次 op=run 会返回 {needApproval, ackToken} 而非立即执行。前端确认卡用户点"开始"后，重调 run_tool(op=run, toolId, params, ackToken=<返回的 ackToken>) 才真跑。单图小工具（volcano-plot/gene-correlation/pca-explorer）直接跑，不拦截。',
      parameters: {
        type: 'object',
        properties: {
          op: {
            type: 'string',
            enum: ['list', 'plan', 'status', 'next', 'bind_artifact', 'run'],
            description: 'list 列工具；plan 生成计划；status 重建状态；next 给出下一步；bind_artifact 绑定已验证产物；run 执行工具',
          },
          toolId: {
            type: 'string',
            description: 'op=run 用：工具 id（如 deseq2、volcano-plot）。先 op=list 看 id',
          },
          params: {
            type: 'object',
            description:
              'op=run 用：工具参数对象。file 类型传本地绝对路径。具体参数见 op=list 返回的 inputSchema。',
          },
          templateId: {
            type: 'string',
            description: 'op=plan 用：标准模板 id，可先通过 op=list 查看 workflowTemplates',
          },
          initialInputs: {
            type: 'object',
            description: 'op=plan 用：第一步可直接使用的文件或参数；后续输入由 verified artifact lineage 绑定',
          },
          workflowPlan: {
            type: 'object',
            description: 'status/next/bind_artifact 或 workflow step run 用：op=plan 返回并由 Agent 持续更新的计划对象',
          },
          stepId: {
            type: 'string',
            description: 'workflow step run 用：执行前会从真实 jobs 重新投影，只有 ready 步骤可提交',
          },
          fromToolJobId: {
            type: 'string',
            description: 'bind_artifact 用：产生上游 artifact 的真实 tool_job id',
          },
          fromStepId: { type: 'string', description: 'bind_artifact 用：上游步骤 id' },
          toStepId: { type: 'string', description: 'bind_artifact 用：下游步骤 id' },
          inputId: { type: 'string', description: 'bind_artifact 用：下游参数名' },
          artifactId: {
            type: 'string',
            description: 'bind_artifact 可选：指定 artifact id/name；省略时取首个已验证产物',
          },
          ackToken: {
            type: 'string',
            description:
              '重操作确认用：当首次 op=run 返回 needApproval=true 时，前端用户确认后，重调 run_tool 传这个 ackToken 才会真跑。非重操作不需要。',
          },
        },
        required: ['op'],
      },
    },
  },
  // READ_IMAGE_v1（阶段2 Task4）：agent 看图（多模态）
  {
    type: 'function',
    function: {
      name: 'read_image',
      description:
        '读取某个 tool_job 结果里的图（PNG），交给多模态模型解读图内容。' +
        '\n用途：run_tool 跑完出图后，如果你需要看图内容才能回答（如"图里上调基因集中在哪？"），调本工具拿图，后端会用 vision 角色模型解读。' +
        '\n注意：token 消耗较高，仅在用户明确问图内容时调，不要每次出图都读。',
      parameters: {
        type: 'object',
        properties: {
          toolJobId: {
            type: 'string',
            description: 'tool_job id（run_tool 返回的 toolJobId）',
          },
          fileName: {
            type: 'string',
            description: '可选：指定读哪个图（如 volcano.png）。不传则读第一张 plot',
          },
        },
        required: ['toolJobId'],
      },
    },
  },
  // GENERATE_METHODS_v1
  {
    type: 'function',
    function: {
      name: 'generate_methods',
      description:
        '基于用户在 BioF3 上执行过的分析自动生成论文 Methods 段落（学术风格，引用 Seurat / scanpy / Leiden / Harmony 等关键包及版本，报告 QC 阈值、分辨率等关键参数）。' +
        '\n输入三选一：\n - analysisId：基于该分析及其父分析链生成；\n - planId：基于整个 plan 的所有步骤；\n - datasetId：基于该数据集的所有 done 分析。\n' +
        '可选 language：zh / en / both（默认 zh）。\n用户说"帮我写 Methods" / "导出方法部分" / "整理出方法学描述"时使用。',
      parameters: {
        type: 'object',
        properties: {
          analysisId: { type: 'string', description: '可选：起点 analysis id（会沿父链向上拉取）' },
          planId: { type: 'string', description: '可选：plan id（取所有 step 关联分析）' },
          datasetId: { type: 'string', description: '可选：dataset id（取所有完成的分析）' },
          language: { type: 'string', enum: ['zh', 'en', 'both'], description: '语言，默认 zh' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_state',
      description:
        'VERIFY_STATE_v1 — 确认某个实体的当前状态符合预期。在执行写操作后调用此工具核实，避免在没有真实反馈时声称"已完成"。' +
        ' 例如：act(rename_project) 后 verify_state(kind="project", id=<id>, expect={name:<新名>}); ' +
        'act(switch_result_tab) 后 verify_state(kind="context", expect={page:"single-cell-result"})。',
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['analysis', 'project', 'dataset', 'plan', 'plan_step', 'context'],
            description: '实体类型',
          },
          id: { type: 'string', description: 'kind 为 analysis/project/dataset/plan 时的 id' },
          planId: { type: 'string', description: 'kind=plan_step 时的 plan id' },
          stepN: { type: 'integer', description: 'kind=plan_step 时的步骤序号' },
          expect: {
            type: 'object',
            description: '预期字段值，例如 {status:"running"} 或 {name:"foo"}。',
          },
        },
        required: ['kind'],
      },
    },
  },
];

function getToolDefs() {
  return TOOL_DEFS;
}

module.exports = { TOOL_DEFS, WORKSPACE_TOOL_DEFS, getToolDefs };
