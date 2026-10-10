# Petri Desktop Skills 层架构设计

> 本文档定义 Petri Desktop 的 Skills 层架构，作为四层抽象体系的顶层。
>
> 状态：Draft → Active
> 版本：1.0.0
> 最后更新：2026-08-14

---

## 1. 架构概览

### 1.1 四层架构

Petri Desktop 采用分层架构，每层有明确的职责边界：

```
┌──────────────────────────────────────────────────────────────────┐
│                      Skills 层（L4）                              │
│  "如何做"：最佳实践、Prompt 模板、恢复策略、用户交互模式           │
├──────────────────────────────────────────────────────────────────┤
│                    Workflows 层（L3）                             │
│  "做什么"：分析流程编排、工具串联、条件分支                        │
├──────────────────────────────────────────────────────────────────┤
│                      Plugins 层（L2）                             │
│  "能做"：具体分析工具（DESeq2、GO/KEGG、WGCNA）                 │
├──────────────────────────────────────────────────────────────────┤
│                    Capabilities 层（L1）                          │
│  "需要什么"：R/Python 运行时、Bundle、环境                       │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 层职责边界

| 层 | 职责 | 回答问题 | 示例 |
|---|---|---|---|
| **L4 Skills** | 领域知识与最佳实践 | "这个分析应该怎么做？" | DEG 分析的系统提示词、恢复策略 |
| **L3 Workflows** | 流程编排与串联 | "这个工作流需要哪些步骤？" | DEG → QC → Volcano → GO |
| **L2 Plugins** | 原子工具执行 | "这个工具怎么调用？" | deseq2.run(), volcano-plot.run() |
| **L1 Capabilities** | 环境依赖保障 | "这个工具需要什么环境？" | R 4.4+, clusterProfiler 包 |

### 1.3 层间通信协议

```
Agent <-- MCP 协议 --> Skills SDK
                         |
                         v
                  Workflow Engine
                         |
                         v
                  Plugin Registry
                         |
                         v
               Capability Provisioning
```

---

## 2. Skill 数据结构

### 2.1 Skill Manifest Schema

每个 Skill 由 skill.json 定义，存储在 resources/skills/<skill-id>/ 目录。

```json
{
  "skillManifestVersion": 1,
  "id": "deg-analysis-standard",
  "name": "标准差异表达分析",
  "version": "1.0.0",
  "description": "从原始计数矩阵到火山图的完整 DEG 分析流程。",
  "category": "bioinformatics/ngs",
  "tags": ["deg", "rna-seq", "deseq2", "volcano-plot"],

  "source": "built-in",
  "capabilities": ["r-enrichment"],

  "plugins": {
    "required": ["expression-qc", "deseq2", "volcano-plot"],
    "optional": ["go-kegg", "gsea"]
  },

  "workflows": {
    "default": "deg-standard-pipeline",
    "variants": ["deg-quick", "deg-comprehensive"]
  },

  "prompts": {
    "system": "prompts/system.md",
    "user_templates": ["prompts/user/standard-deg.md"]
  },

  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "method": {
        "type": "select",
        "options": ["deseq2", "edger", "limma"],
        "default": "deseq2",
        "description": "差异分析方法"
      },
      "padj_threshold": {
        "type": "number",
        "default": 0.05,
        "min": 0,
        "max": 1,
        "step": 0.01,
        "description": "校正后 P 值阈值"
      }
    }
  },

  "recovery_strategies": [
    {
      "when": "sample_group_mismatch",
      "description": "样本分组不匹配",
      "do": "尝试自动检测分组或请求用户确认",
      "fallback": "提供分组模板让用户填写",
      "recoverable": true
    }
  ],

  "outputs": {
    "primary": [
      { "id": "volcano_plot", "type": "plot", "label": "火山图" },
      { "id": "degs_table", "type": "table", "label": "DEGs 结果表" }
    ],
    "secondary": [
      { "id": "go_enrichment", "type": "table", "requires_plugin": "go-kegg" }
    ]
  },

  "metadata": {
    "author": "Petri Team",
    "license": "MIT",
    "source": "built-in",
    "created": "2026-08-14",
    "updated": "2026-08-14",
    "compatibility": {
      "min_app_version": "0.1.0",
      "platform": ["macos-arm64", "macos-x64", "windows-x64"]
    }
  }
}
```

### 2.2 字段说明

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| skillManifestVersion | integer | 是 | 固定为 1 |
| id | string | 是 | 唯一标识，kebab-case 格式 |
| name | string | 是 | 人类可读名称 |
| version | string | 是 | 语义化版本 (semver) |
| description | string | 是 | 详细描述，支持 Markdown |
| category | string | 是 | 分类，格式 domain/subdomain |
| tags | string[] | 否 | 搜索标签 |
| source | string | 是 | 来源：built-in / installed / marketplace |
| capabilities | string[] | 否 | 依赖的能力 ID |
| plugins.required | string[] | 是 | 必需插件 ID |
| plugins.optional | string[] | 否 | 可选插件 ID |
| workflows.default | string | 否 | 默认 workflow ID |
| workflows.variants | string[] | 否 | 可用 workflow 变体 |
| prompts.system | string | 否 | 系统提示词或文件路径 |
| prompts.user_templates | string[] | 否 | 用户提示词模板 |
| parameters.required | string[] | 是 | 必填参数名 |
| parameters.optional | object | 否 | 可选参数定义 |
| recovery_strategies | object[] | 否 | 失败恢复策略 |
| outputs.primary | object[] | 否 | 主要产物 |
| outputs.secondary | object[] | 否 | 次要/可选产物 |
| metadata | object | 否 | 元数据 |

---

## 3. Workflow 数据结构

### 3.1 Workflow Manifest Schema

Workflow 定义存储在 resources/workflows/<workflow-id>/workflow.json：

```json
{
  "workflowManifestVersion": 1,
  "id": "deg-standard-pipeline",
  "name": "标准 DEG 分析流程",
  "version": "1.0.0",
  "description": "从原始计数矩阵到火山图的完整差异表达分析流程",
  "category": "bioinformatics/ngs",
  "source": "built-in",

  "steps": [
    {
      "id": "qc",
      "skill": "expression-qc",
      "description": "表达量质控",
      "condition": "always",
      "outputs": {
        "qc_report": "qc_report"
      }
    },
    {
      "id": "deg",
      "skill": "deg-analysis",
      "description": "差异分析",
      "condition": "has_two_groups",
      "inputs": {
        "dataset": "dataset",
        "group_column": "params.group_column"
      }
    },
    {
      "id": "visualization",
      "skill": "volcano-plot",
      "description": "火山图可视化",
      "condition": "deg.success",
      "inputs": {
        "deg_results": "deg.output.degs_table"
      }
    }
  ],

  "conditions": {
    "has_two_groups": {
      "type": "expr",
      "expr": "context.groups.length >= 2",
      "error": "需要至少两组样本才能进行差异分析"
    },
    "deg.success": {
      "type": "step_success",
      "step": "deg"
    }
  },

  "error_handling": {
    "default": "fail",
    "step_overrides": {
      "qc": { "on_error": "warn_continue" }
    }
  }
}
```

### 3.2 Step 执行模型

```
Step 执行循环：
1. 评估 condition
   - "always" → 执行
   - "expr" → 求值表达式
   - "step_success" → 检查上游步骤

2. 解析 inputs（绑定上游输出）
   - "normalization.output" → 从上游 artifact 取值

3. 调用 SkillRuntime.execute(params)
   - 参数校验
   - 依赖检查
   - 执行 workflow

4. 收集 outputs（存入 context）
   - "degs_table" → 供下游使用

5. 错误处理
   - "fail" → 整个 workflow 失败
   - "warn_continue" → 警告但继续
   - "skip_continue" → 跳过但继续
```

---

## 4. Skills SDK

### 4.1 SDK 职责

Skills SDK 是 Agent 与 Skills 层交互的统一入口：

- 发现：加载所有可用 Skills
- 查询：按 ID、类别、标签搜索
- 执行：触发 Skill 执行
- 校验：验证 Skill 定义

### 4.2 API 设计

```javascript
// core/shared-backend/skills-sdk.js

class SkillsSDK {
  constructor(options) {
    this.registry = options.registry;        // SkillRegistry 实例
    this.runtimeFactory = options.runtimeFactory; // SkillRuntime 工厂
    this.workflowEngine = options.workflowEngine; // WorkflowEngine 实例
  }

  // 发现
  listSkills(filter?: { source?, category?, tag? }): SkillEntry[];
  getSkill(id: string): SkillEntry | null;
  searchSkills(query: string): SkillEntry[];

  // 执行
  executeSkill(skillId: string, params: object, context?: object): Promise<ExecutionResult>;
  executeWorkflow(workflowId: string, params: object, context?: object): Promise<ExecutionResult>;

  // 校验
  validateSkill(manifest: object): ValidationResult;

  // 依赖检查
  canExecute(skillId: string, context?: object): { can: boolean, missing: object };
}
```

---

## 5. MCP 集成

### 5.1 MCP 工具定义

Skills 通过 MCP 暴露给 Agent：

```javascript
// MCP 工具注册
const skillsTools = [
  {
    name: 'list_skills',
    description: '列出所有可用的 Skills',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '按类别筛选' },
        tag: { type: 'string', description: '按标签筛选' }
      }
    }
  },
  {
    name: 'get_skill',
    description: '获取 Skill 详细信息',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID' }
      },
      required: ['id']
    }
  },
  {
    name: 'execute_skill',
    description: '执行一个 Skill',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Skill ID' },
        params: { type: 'object', description: '执行参数' },
        workflow: { type: 'string', description: '指定 workflow 变体' }
      },
      required: ['id']
    }
  },
  {
    name: 'search_skills',
    description: '搜索 Skills',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词' }
      },
      required: ['query']
    }
  }
];
```

### 5.2 Agent 交互示例

```
Agent: "我想对 scRNA-seq 数据进行差异表达分析"
  |
  v
list_skills({ category: "bioinformatics/ngs" })
  |
  v
get_skill({ id: "deg-analysis-standard" })
  |
  v
execute_skill({
  id: "deg-analysis-standard",
  params: {
    dataset: "/path/to/count_matrix.csv",
    group_column: "condition",
    method: "deseq2"
  }
})
```

---

## 6. 与现有系统的关系

### 6.1 Plugin 系统兼容性

Skills 层构建在现有 Plugin 系统之上，不破坏现有功能：

```
Skills 层 (L4)
  Skill Manifest → SkillRuntime → Workflow Engine
                依赖
                      v
Plugins 层 (L2)
  Plugin Registry → Tool Registry → Plugin Executor
                依赖
                      v
Capabilities 层 (L1)
  Capability Provisioning → Runtime Management
```

### 6.2 向后兼容保证

1. Plugin 继续独立工作：现有 Plugin 仍可通过 run_tool 直接调用
2. MCP 工具共存：新增的 Skills 工具与现有工具并存
3. 数据格式不变：Skill 输出遵循现有 artifact 格式
4. 配置可迁移：Plugin 配置可转化为 Skill 参数定义

---

## 7. 目录结构

```
resources/
├── skills/                      # Skills 定义
│   ├── manifest.json           # 全局 Skills 清单
│   ├── deg-analysis-standard/
│   │   ├── skill.json         # Skill Manifest
│   │   ├── prompts/
│   │   │   ├── system.md      # 系统提示词
│   │   │   └── user/
│   │   │       └── standard-deg.md
│   │   └── README.md
│   └── go-enrichment-analysis/
│       ├── skill.json
│       └── ...
└── workflows/                  # Workflow 定义（未来）
    └── deg-standard-pipeline/
        └── workflow.json

core/shared-backend/
├── skill-registry.js           # Skills 注册与发现
├── skill-schema.js             # Skill Manifest 校验
├── skill-runtime.js            # Skill 执行运行时
├── skills-sdk.js               # Skills SDK（新增）
└── workflow-engine.js          # Workflow 执行引擎（新增）
```

---

## 8. 实现状态

| 模块 | 文件 | 状态 |
|---|---|---|
| Skill 注册发现 | skill-registry.js | 已实现 |
| Skill Schema 校验 | skill-schema.js | 已实现 |
| Skill 执行运行时 | skill-runtime.js | 已实现 |
| Skills SDK | skills-sdk.js | 进行中 |
| Workflow 引擎 | workflow-engine.js | 进行中 |

---

## 9. 参考文献

- core/shared-backend/skill-registry.js — Skills 注册与发现实现
- core/shared-backend/skill-schema.js — Skill Manifest Schema 定义
- core/shared-backend/skill-runtime.js — Skill 执行运行时实现
- docs/skills-registry.md — Skills 注册与发现详细设计
- docs/skills-schema.md — Skills 数据结构详细定义
- docs/skills-workflow-integration.md — Skills 与 Workflow 集成设计
- docs/third-party-plugin-guide.md — Plugin 开发指南（参考）
