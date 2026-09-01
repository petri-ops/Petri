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
        '在当前项目工作区创建或完整覆写一个文本文件。已存在文件必须同时传 overwrite=true 和 workspace_read 返回的 expectedSha256；创建新文件不需要 expectedSha256。dryRun=true 时只校验并返回变更摘要，不写盘；真实写入在只读模式或只检查请求中禁止调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
          content: { type: 'string', description: '完整文本内容，最大 1 MiB' },
          overwrite: { type: 'boolean', description: '目标存在时必须显式为 true' },
          expectedSha256: { type: 'string', description: '覆写已有文件时必填：写入前文件 sha256' },
          dryRun: { type: 'boolean', description: '为 true 时只校验并返回变更摘要，不修改文件' },
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
        '在当前项目工作区文本文件中做一次精确替换。oldText 必须唯一匹配，并且必须传 workspace_read 返回的 expectedSha256 防止覆盖并发修改。dryRun=true 时只校验并返回变更摘要，不写盘；真实替换在只读模式或只检查请求中禁止调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '相对项目根目录的文件路径' },
          oldText: { type: 'string', description: '必须在文件中唯一出现的原文本' },
          newText: { type: 'string', description: '替换后的文本' },
          expectedSha256: { type: 'string', description: '必填：修改前文件 sha256' },
          dryRun: { type: 'boolean', description: '为 true 时只校验并返回变更摘要，不修改文件' },
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
        '在当前项目工作区打开通用命令行。完全访问模式允许使用 shell 执行用户机器上可用的命令、脚本、管道和重定向；交互式提权、不可恢复删除、静默远端推送和远程脚本管道仍由安全边界拒绝。只读模式或用户明确要求仅检查/规划时禁止调用。科学分析正式结果仍应通过 run_tool 进入 tool_job 与 artifact truth。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要在项目工作目录中执行的 shell 命令，例如 "head -5 counts.csv"、"cat metadata.csv" 或 "Rscript scripts/qc.R"' },
          cwd: { type: 'string', description: '相对项目根目录的工作子目录（必须已存在）；每条命令都是独立 shell，cd 不跨调用持久，需要子目录时优先用本参数' },
          shell: { type: 'string', enum: ['auto', 'posix', 'powershell', 'cmd'], description: 'shell 选择：auto=平台默认（Windows=cmd，其他=$SHELL）；Windows 建议显式用 powershell 获得现代语法' },
          timeoutMs: { type: 'integer', description: '超时毫秒，默认 120000，最大 1800000' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'workspace_exec_background',
      description:
        '在项目工作区以后台进程启动长时间运行的命令（如本地 HTTP 服务、长训练脚本），立即返回进程 ID（processId）、系统 pid 与日志相对路径。stdout 与 stderr 合并写入工作区 .biof3-agent-tmp/ 下的日志文件，可用 workspace_read 查看日志、process_status 查询存活与日志尾部、process_stop 停止。安全边界与 workspace_exec 相同（黑名单先行、需完全访问模式）。科学分析正式结果仍应通过 run_tool。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要在项目工作目录中后台执行的 shell 命令，例如 "python -m http.server 8642"' },
          cwd: { type: 'string', description: '相对项目根目录的工作子目录（必须已存在）' },
          shell: { type: 'string', enum: ['auto', 'posix', 'powershell', 'cmd'], description: 'shell 选择：auto=平台默认（Windows=cmd，其他=$SHELL）' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_status',
      description:
        '查询本会话通过 workspace_exec_background 启动的后台进程状态：存活/退出/停止、退出码、运行时长与日志尾部。不带 processId 时返回本会话全部后台进程；进程表为内存态，应用重启后失效（日志文件仍在，可手工查看）。',
      parameters: {
        type: 'object',
        properties: {
          processId: { type: 'string', description: '可选；workspace_exec_background 返回的进程 ID。省略时列出本会话全部后台进程' },
          logTailBytes: { type: 'integer', description: '日志尾部读取字节数，默认 4096，最大 65536' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'process_stop',
      description:
        '停止本会话启动的后台进程：先 SIGTERM，宽限 3 秒后仍存活则 SIGKILL（Windows 使用 taskkill /T /F）。只能停止本工具启动的进程，不能按系统 pid 任意杀进程。',
      parameters: {
        type: 'object',
        properties: {
          processId: { type: 'string', description: 'workspace_exec_background 返回的进程 ID' },
        },
        required: ['processId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'system_info',
      description:
        '获取当前系统与命令执行环境信息：操作系统与架构、shell 解释器、路径分隔符、Node/npm/Python/Git 版本等。只读、零副作用。在编写或执行任何平台相关命令（workspace_exec）之前先调用，避免跨平台命令语法错误；探测命令不存在时对应版本返回 null。',
      parameters: {
        type: 'object',
        properties: {},
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
  // RUN_TOOL_v1 — 跑 BioF3 分析工具（deseq2/volcano-plot 等），真实执行出图
  {
    type: 'function',
    function: {
      name: 'run_tool',
      description:
        '执行 BioF3 的分析工具，真实跑 R/Python 脚本出图出表（不是模拟）。' +
        '\n六个操作：' +
        '\n - op=list：不带 toolId 时列紧凑工具目录；带 toolId 时返回该工具完整参数契约。先列目录再精确查询，禁止猜测工具 ID' +
        '\n - op=plan：按标准模板生成 Agent 主导的多步骤计划，只规划、不自动执行' +
        '\n - op=status：从真实 tool jobs 和 artifact truth 重建计划状态' +
        '\n - op=next：返回当前可执行步骤与恢复建议，不自动执行' +
        '\n - op=bind_artifact：校验上一步 tool_job 的 artifact truth，并把真实产物绑定到下游输入' +
        '\n - op=run：执行指定工具，传 toolId + params' +
        '\n可用工具包括：deseq2（bulk 差异分析）、volcano-plot（火山图）、gene-correlation（基因相关性热图）、pca-explorer（PCA）等。' +
        '\n用户说"帮我跑差异分析"/"画火山图"/"做 DESeq2"/"分析这个 count 矩阵"时使用。' +
        '\n注意：file 类型参数传**本地绝对路径**（如 /Users/.../counts.csv）。执行返回 jobDir + 输出文件路径 + toolJobId，可读取出图/表。' +
        '\nplan 联动：跑完返回 toolJobId，若当前在 plan 推进中，立刻调 plan(op=update_step, toolJobId=<返回的 toolJobId>) 绑定，分析状态（completed/failed）自动同步 step。' +
        '\n自动化边界：完全访问模式下，deseq2/wgcna 等项目内可复现分析直接执行，由 Agent 检查结果并在安全范围内诊断重试，不弹二次确认。旧调用或非完全访问边界仍可能返回 {needApproval, ackToken}，此时必须遵守确认协议。',
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
            description: 'op=run 用于执行；op=list 时用于读取单个工具完整契约。先用不带 toolId 的 list 获取真实 id',
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
              '兼容确认用：仅当 run_tool 返回 needApproval=true 时原样传回；完全访问模式的项目内分析通常不需要。',
          },
          scientificTaskRef: {
            type: 'object',
            description: 'HRT-3 科学任务执行引用。存在时必须指向已确认且尚未绑定 Job 的 TaskSpec 版本。',
            properties: {
              taskId: { type: 'string' },
              version: { type: 'integer', minimum: 1 },
            },
            required: ['taskId'],
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
      name: 'result_edit_plan',
      description:
        'RESULT_EDIT_INTENT_v1 — 对已有科学结果的修改请求做只读规划：精确定位来源 Job/Artifact/脚本/输入，区分查看、重绘、转换、重算或工作流重规划，并计算受影响 DAG。此工具不修改文件、不创建 Job 或 ChangeSet；缺少真实来源或 DAG 时会明确阻断。',
      parameters: {
        type: 'object',
        properties: {
          toolJobId: { type: 'string', description: '产生当前结果的真实 tool_job id' },
          artifactId: { type: 'string', description: 'Artifact 的稳定 id；不能用文件名代替' },
          revisionId: { type: 'string', description: '当前持久化 ArtifactRevision id' },
          requestedOutcome: { type: 'string', description: '用户希望得到的结果变化' },
          requestedEditClass: {
            type: 'string',
            enum: ['view_only', 'presentation_rerender', 'data_transform', 'scientific_recompute', 'workflow_replan'],
            description: '可选的用户意图类别；参数影响规则可以保守升级它，不能被它降级',
          },
          proposedParameterPatch: { type: 'object', description: '拟议参数 Patch；未知参数自动按科学重算处理' },
          selectionId: { type: 'string', description: '可选 SelectionContext id' },
          sourceNodeId: { type: 'string', description: '可选来源节点 id；不传时由 toolJobId 唯一匹配' },
          userMessageId: { type: 'string', description: '可选来源用户消息 id' },
        },
        required: ['toolJobId', 'artifactId', 'revisionId', 'requestedOutcome'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_create',
      description:
        'RESULT_CHANGESET_v1 — 根据 result_edit_plan 返回的完整 ResultEditIntent 创建隔离候选版本。它会派生独立脚本与参数、创建真实 Git candidate commit，并通过现有 run_tool→tool_job→artifact truth 执行和验证；不会采用候选或覆盖当前结果。科学重算必须 scientificConfirmed=true。',
      parameters: {
        type: 'object',
        properties: {
          intent: { type: 'object', description: 'result_edit_plan 返回且状态为 ready/confirmation_required 的完整 intent 对象' },
          scriptPatch: {
            type: 'array',
            description: '可选的精确脚本替换；每段 oldText 必须唯一匹配',
            items: {
              type: 'object',
              properties: {
                oldText: { type: 'string' },
                newText: { type: 'string' },
              },
              required: ['oldText', 'newText'],
            },
          },
          scientificConfirmed: { type: 'boolean', description: '科学参数/方法变化已完成确认时为 true' },
        },
        required: ['intent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_status',
      description: '读取当前项目中一个 Result Studio ChangeSet、候选 Revision 和恢复状态；只读，不采用、不撤销。',
      parameters: {
        type: 'object',
        properties: {
          changeSetId: { type: 'string', description: 'ChangeSet id' },
        },
        required: ['changeSetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_compare',
      description: '读取一个 Result Studio ChangeSet 的紧凑摘要、Git 文本 diff、JSON 字段 diff、表格语义比较、视觉版本引用和历史；只读且结果有界。',
      parameters: {
        type: 'object',
        properties: { changeSetId: { type: 'string' } },
        required: ['changeSetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_adopt',
      description: '采用已验证且仍基于当前父版本的 preview_ready ChangeSet。会以 Git CAS 与 SQLite 事务原子切换 current；仅在用户明确要求采用当前候选时调用。',
      parameters: {
        type: 'object',
        properties: { changeSetId: { type: 'string' } },
        required: ['changeSetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_revert',
      description: '撤销未采用候选，或在其仍为 current 时撤销已采用 ChangeSet；不会删除历史。较旧版本已被新版本覆盖时应使用 artifact_revision_restore。',
      parameters: {
        type: 'object',
        properties: {
          changeSetId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['changeSetId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'artifact_revision_list',
      description: '列出当前项目一个 Artifact family 的版本历史和唯一 current Revision；只读。',
      parameters: {
        type: 'object',
        properties: { artifactFamilyId: { type: 'string' } },
        required: ['artifactFamilyId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'artifact_revision_restore',
      description: '将历史 ArtifactRevision 恢复为一个新的 commit、ChangeSet 和 Revision 后采用；不改写或删除旧历史。仅在用户明确要求恢复该版本时调用。',
      parameters: {
        type: 'object',
        properties: { revisionId: { type: 'string' } },
        required: ['revisionId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_selection_run',
      description: 'RESULT_SELECTION_ACTION_v1 — 将当前兼容 SelectionContext 解析为稳定科学实体，生成独立物化脚本/参数/基因表，并通过既有 run_tool→tool_job→artifact truth 执行正式 GO/KEGG。选择过期、来源哈希漂移、插件未声明动作或无法权威重建时会阻断。',
      parameters: {
        type: 'object',
        properties: {
          selectionId: { type: 'string', description: '当前主画布持久化 SelectionContext id' },
          action: { type: 'string', enum: ['go_kegg'], description: '当前支持的插件声明下游动作' },
          species: { type: 'string', enum: ['human', 'mouse'] },
          geneIdType: { type: 'string', enum: ['auto', 'SYMBOL', 'ENSEMBL', 'ENTREZID'] },
          analysisType: { type: 'string', enum: ['all', 'GO', 'GO-BP', 'GO-MF', 'GO-CC', 'KEGG'] },
        },
        required: ['selectionId', 'action'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_studio_context',
      description:
        'RESULT_STUDIO_CONTEXT_v1 — 读取用户当前打开结果的完整工程坐标（结果名/工具/版本序号/验证与复现状态/可编辑参数/插件动作/当前选择）。优先调用它，然后使用返回的 contextToken 调用 *_in_context 工具；不要向用户索要或自行猜测 job、artifact、revision、changeset、selection 等内部 id。返回值有界，不含完整实体 ID 列表、路径或结果值。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_edit_plan_in_context',
      description:
        'RESULT_EDIT_INTENT_v1（context-bound）— 只读规划当前打开结果的修改：来源 Job/Artifact/Revision/脚本坐标由后端上下文自动补齐，用户和模型都不需要提供内部 id。区分查看、重绘、转换、重算与工作流重规划，未知参数保守按科学重算；不修改文件、不创建 Job 或 ChangeSet。归因只能到 Job、选择已过期或缺 DAG 时明确阻断并给出修复路径。',
      parameters: {
        type: 'object',
        properties: {
          requestedOutcome: { type: 'string', description: '用户希望得到的结果变化（自然语言）' },
          requestedEditClass: {
            type: 'string',
            enum: ['view_only', 'presentation_rerender', 'data_transform', 'scientific_recompute', 'workflow_replan'],
            description: '可选意图类别；插件影响规则可保守升级它，不能被它降级',
          },
          proposedParameterPatch: {
            type: 'object',
            description: '拟议参数 Patch。只能使用 result_studio_context 的 editControls 声明过的参数名；未声明参数会被拒绝，未知影响按科学重算处理',
          },
          useCurrentSelectionForLabels: {
            type: 'boolean',
            description: '仅火山图：将当前完整、兼容的稳定 gene 选择绑定为额外标签。不能与 label_genes 同时传入，模型不提供基因 ID。',
          },
          editOrigin: {
            type: 'string',
            enum: ['manual', 'agent'],
            description: '参数来源，仅用于审计与解释文案；不影响校验强度或影响分级',
          },
          userMessageId: { type: 'string', description: '可选来源用户消息 id' },
          contextToken: { type: 'string', description: '可选：result_studio_context 返回的 token' },
        },
        required: ['requestedOutcome'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_create_in_context',
      description:
        'RESULT_CHANGESET_v1（context-bound）— 用 result_edit_plan_in_context 返回的 intent 在当前打开结果上创建隔离候选版本，经既有 run_tool→tool_job→artifact truth 执行与验证，不采用候选也不覆盖当前结果。必须携带 contextToken：结果、版本或选择在规划后发生变化时拒绝执行。科学重算需 scientificConfirmed=true。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string', description: 'result_studio_context 返回的 token' },
          intent: {
            type: 'object',
            description: 'result_edit_plan_in_context 返回的 intent 引用；只需原样携带 intentId，执行字段由服务器 sealed plan 解析',
            properties: { intentId: { type: 'string' } },
            required: ['intentId'],
          },
          scientificConfirmed: { type: 'boolean', description: '科学参数或方法变化已完成确认时为 true' },
        },
        required: ['contextToken', 'intent'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_enrichment_from_context',
      description:
        'RESULT_ENRICHMENT_FROM_CONTEXT_v1 — 从当前打开的正式 DEG 表版本继续 GO/KEGG。Revision、输入文件、来源 hash、下游工具与持久 DAG 边均由后端绑定；模型不能提交路径、toolId 或 lineage。仅当前 DEG Revision 且插件声明稳定 gene_id/derive_enrichment_input 时执行。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string', description: 'result_studio_context 返回的 token' },
          species: { type: 'string', enum: ['human', 'mouse'] },
          geneIdType: { type: 'string', enum: ['auto', 'SYMBOL', 'ENSEMBL', 'ENTREZID'] },
          analysisType: { type: 'string', enum: ['all', 'GO', 'GO-BP', 'GO-MF', 'GO-CC', 'KEGG'] },
          padjCutoff: { type: 'number', minimum: 0, maximum: 1 },
          lfcCutoff: { type: 'number', minimum: 0 },
        },
        required: ['contextToken'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_status_in_context',
      description: '读取当前打开结果上进行中修改的阶段结论、候选版本与恢复状态；ChangeSet 由上下文自动绑定，只读。存在多个进行中修改时要求先确认，不自行猜测。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string' },
          changeSetId: { type: 'string', description: '可选：显式指定要查看的修改' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_compare_in_context',
      description: '比较当前打开结果的候选版本与当前版本：视觉/表格语义/JSON 字段/文本差异与版本历史；ChangeSet 由上下文自动绑定，只读且结果有界。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string' },
          changeSetId: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_adopt_in_context',
      description: '采用当前打开结果上已验证的候选版本，以 Git CAS + SQLite 事务原子切换 current；仅在用户明确要求采用时调用。必须携带 contextToken，父版本已变化时拒绝。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string' },
          changeSetId: { type: 'string' },
        },
        required: ['contextToken'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'result_changeset_revert_in_context',
      description: '撤销当前打开结果上的候选修改，或在其仍为 current 时撤销已采用修改；不删除任何历史。必须携带 contextToken。较旧版本已被覆盖时应使用 artifact_revision_restore。',
      parameters: {
        type: 'object',
        properties: {
          contextToken: { type: 'string' },
          changeSetId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['contextToken'],
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
  // Lazy require avoids a module-initialization cycle: registry consumes these
  // schema constants, while callers receive only fresh Provider-safe projections.
  return require('./registry').getProviderToolDefs();
}

module.exports = { TOOL_DEFS, WORKSPACE_TOOL_DEFS, getToolDefs };
