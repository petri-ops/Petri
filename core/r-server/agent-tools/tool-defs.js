/**
 * agent-tools/tool-defs.js — OpenAI-compatible tool definitions for DeepSeek
 */
const _fs = require('fs');
const _path = require('path');

// --------------------------------------------------------------
// Tool schemas (OpenAI-compatible function definitions)
// --------------------------------------------------------------
const TOOL_DEFS = [
  {
    type: 'function',
    function: {
      name: 'query',
      description:
        '查询用户在 BioF3 上的任意结构化资源。返回 JSON 数组。' +
        '资源类型：projects | datasets | analyses | facts | memories | docs | figcode | blog. ' +
        '当你需要更详细的资源信息（system prompt 里没有的字段）时调用此工具。',
      parameters: {
        type: 'object',
        properties: {
          resource: {
            type: 'string',
            enum: [
              'projects',
              'datasets',
              'analyses',
              'facts',
              'memories',
              'docs',
              'figcode',
              'blog',
            ],
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
        '读取一篇教程、博客或 FigCode 工具的完整内容。url 必须是站内路径，例如 /docs/single-cell/module05 或 /figcode#volcano。' +
        '也支持读取已安装内容插件的教程片段：url 形如 /plugin/<pluginId>/<slug>（如 /plugin/deseq2-tutorial/quickstart）。' +
        '当分析现场卡住、不确定某工具/流程怎么用时，先调 read_page 查对应插件教程片段再回答用户。',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description:
              '站内路径（不含 https:// 前缀）。教程用 /docs/...，FigCode 用 /figcode#...，内容插件用 /plugin/<id>/<slug>。',
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
        '在 BioF3 全站做语义 + 关键词混合检索。返回最相关的若干条目（混合教程/工具/历史对话/已装内容插件教程片段）。' +
        '当用户的问题需要找站点中匹配某个主题/概念的内容时使用。' +
        '分析卡住、不确定某工具/流程怎么用时也可调用，scope 可选 plugins 只搜内容插件。',
      parameters: {
        type: 'object',
        properties: {
          q: { type: 'string', description: '查询语句' },
          scope: {
            type: 'string',
            enum: ['all', 'docs', 'figcode', 'memories', 'plugins'],
            description: '默认 all。plugins 只搜已装内容插件的教程片段。',
          },
          topK: { type: 'integer', description: '返回多少条，默认 5，最大 15' },
        },
        required: ['q'],
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
        ' start_analysis（在某 dataset 上发起新分析）;' +
        ' recluster（对某结果的某 cluster 子聚类）;' +
        ' rename_project / rename_dataset / rename_analysis（重命名）;' +
        ' update_analysis_params（修改分析参数）。' +
        '不允许：删除、跨用户操作、上传数据。删除请让用户自己在 UI 中操作。',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'start_analysis',
              'recluster',
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
          datasetId: { type: 'string', description: 'start_analysis 用' },
          analysisId: {
            type: 'string',
            description: 'recluster / rename_analysis / update_params 用',
          },
          projectId: { type: 'string', description: 'rename_project 用' },
          analysisType: {
            type: 'string',
            // W1-5 (2026-05-28): 补全长期遗漏的 communication / cell_cycle / doublet_detection +
            // 新增空间组学 spatial_* 5 种类型（与 /spatial 平台对齐）
            enum: [
              // 单细胞（r-server）
              'scrna_standard',
              'recluster',
              'deg',
              'enrichment',
              'cell_annotation',
              'scrna_integration',
              'trajectory',
              'communication',
              'cell_cycle',
              'doublet_detection',
              // 空间组学（py-server）
              'spatial_standard',
              'spatial_recluster',
              'spatial_svg',
              'spatial_deconv',
              'spatial_lr',
            ],
            description: 'start_analysis 时的分析类型',
          },
          parentAnalysisId: {
            type: 'string',
            description: 'start_analysis 时可选的父分析（提供已聚类 RDS）',
          },
          cluster: { type: ['string', 'number'], description: 'recluster 时指定哪个 cluster' },
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
              'PLAN_STEP_LINK_v1_TOOL — update_step 用：把当前 step 关联到某个 analysis id。当你 act(start_analysis) 后立刻在该步骤调用 plan(update_step, analysisId=<新分析 id>) 把它们绑定。这样分析自然 done/failed 时会自动同步 step status。',
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
        '\n用途：run_tool 跑完出图后，如果你需要看图内容才能回答（如"图里上调基因集中在哪？"），调本工具拿图，后端会用 qwen-vl-max 解读。' +
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
  // SUGGEST_NEXT_STEPS_v1
  {
    type: 'function',
    function: {
      name: 'suggest_next_steps',
      description:
        'SUGGEST_NEXT_STEPS_v1 — 基于当前用户已学进度（user_progress 表）和 copilot-index.json 元数据，推荐 3-5 条可执行的"下一步"。' +
        '适用场景：用户首次进站不知道从哪开始；用户问"接下来该学什么"；用户在某领域（如 single-cell）已有进度但卡壳时。' +
        '不要为了写"我可以推荐..."这种过场话调用此工具，调用就要把结果直接给用户。' +
        '可选参数 topic（领域偏好，如 "single-cell" / "bulk-rnaseq" / "basics"）；不传则自动按用户进度推断。',
      parameters: {
        type: 'object',
        properties: {
          topic: { type: 'string', description: '可选：用户偏好的领域（copilot.domain 枚举值）' },
          limit: { type: 'number', description: '返回条数，默认 4，最多 6' },
        },
      },
    },
  },
  // VERIFY_UNDERSTANDING_v1
  {
    type: 'function',
    function: {
      name: 'verify_understanding',
      description:
        'VERIFY_UNDERSTANDING_v1 — 在用户完成一篇 docs 的学习流程之后，调用此工具生成 1-3 道理解题。' +
        '题目基于该篇 docs 的 copilot.learning_outcomes，帮你验证用户是否真的学到了。' +
        '调用时机：学习计划全部完成 / 用户说"我学完了"/"出题考考我" 时。' +
        '不要为了凑话调用，调用就把题目逐道发给用户、收到答案后简短反馈。',
      parameters: {
        type: 'object',
        properties: {
          docUrl: {
            type: 'string',
            description:
              '要出题的 docs URL，例如 "/docs/single-cell/module03"。如果当前页就是该 doc，可直接传 ctx.page 对应的 url。',
          },
          count: {
            type: 'number',
            description: '题目数量，默认 2，最多 3。',
          },
        },
        required: ['docUrl'],
      },
    },
  },
  // SUGGEST_REVIEW_v1
  {
    type: 'function',
    function: {
      name: 'suggest_review',
      description:
        'SUGGEST_REVIEW_v1 — 找出用户 N 天前已完成、现在适合再过一遍的 docs。' +
        '调用时机：用户重新进站、问"接下来学什么"、或你判断当前对话有合适的"复习而非新学"窗口时。' +
        '返回的每条候选都附带它的 learning_outcomes，方便你直接用一两道问题快速测一下。' +
        '不要每次都调用，频率掌握在合理范围（同一会话最多 1-2 次）。',
      parameters: {
        type: 'object',
        properties: {
          days_threshold: {
            type: 'number',
            description: '完成多少天之前的内容才算"该复习"。默认 7。',
          },
          limit: {
            type: 'number',
            description: '最多返回几条候选，默认 3，最多 5。',
          },
        },
      },
    },
  },
  // LEARNING_MEMORY_v1 — record mastery signal
  {
    type: 'function',
    function: {
      name: 'record_learning_signal',
      description:
        'LEARNING_MEMORY_v1 — 记录用户对某个概念的掌握信号。' +
        '使用场景：调用 verify_understanding 让用户回答题之后，根据答得对不对，给每个相关 outcome / concept 打一个 weak / moderate / strong。' +
        '系统会用这些信号优先推荐复习内容。' +
        '不是让你写笔记，而是用 1-2 词的"概念"+ 一个等级。',
      parameters: {
        type: 'object',
        properties: {
          resource: {
            type: 'string',
            description: '该概念所属 doc/figcode 的 url，例如 "/docs/single-cell/module03"。',
          },
          concept: {
            type: 'string',
            description:
              '一两个词的概念关键词，例如 "UMAP" / "线粒体过滤" / "DESeq2 dispersion"。建议从 doc 的 learning_outcomes 里挑词。',
          },
          signal: {
            type: 'string',
            description: '"weak" 答错或答得很差｜"moderate" 答得有点意思但不全｜"strong" 答得到位',
          },
          note: { type: 'string', description: '可选：一句话备注，比如"对降维原理还是模糊"。' },
        },
        required: ['resource', 'concept', 'signal'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'verify_state',
      description:
        'VERIFY_STATE_v1 — 确认某个实体的当前状态符合预期。在执行写操作后调用此工具核实，避免在没有真实反馈时声称"已完成"。' +
        ' 例如：act(start_analysis) 后 verify_state(kind="analysis", id=<id>, expect={status:"running"}); ' +
        'act(rename_project) 后 verify_state(kind="project", id=<id>, expect={name:<新名>}); ' +
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

module.exports = { TOOL_DEFS, getToolDefs };
