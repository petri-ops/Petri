# Petri Desktop Skills 与工作流集成

> 状态：**设计稿**（待实现）
>
> 最后更新：2026-08-14
>
> 阅读前置：`docs/skills-architecture.md`（整体架构）、`docs/skills-schema.md`（Skill Schema）、`docs/skills-registry.md`（注册机制）、`docs/stage3-standard-workflows-design.md`（现有 Workflow 设计）

---

## 概述

本文档说明 Skills 如何与现有系统集成，包括：
- Skills 如何调用现有 Plugins
- Skills 如何利用现有 MCP 工具
- 与 agent-workflow.js 的关系
- 迁移路径（不破坏现有 Plugin 系统）

---

## 1. 整体集成架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                        AI Agent / User                              │
│                         (自然语言请求)                               │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      MCP Server (mcp-server.js)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ list_skills │  │ run_skill   │  │ list_tools  │  │ run_tool    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │
└─────────┼────────────────┼────────────────┼────────────────┼─────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Skill Runtime (skill-runtime.js)                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Skill Manifest → 参数校验 → 依赖检查 → Workflow 选择        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Workflow Runtime (workflow-runtime.js)              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Workflow 执行 → 插件编排 → Artifact 传递 → 状态持久化        │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                 Agent Workflow (agent-workflow.js)                    │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  单步执行 → Plugin 调用 → 产物校验 → 二跳 lineage            │   │
│  └─────────────────────────────────────────────────────────────┘   │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      Plugin SDK (plugin-sdk.js)                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │
│  │ discovery   │  │ registration │  │  execution  │  │ validation  │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘ │
└───────────────────────────────┬─────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│               Capability Provisioning (capability-provisioning.js)     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │
│  │ check ready │  │  provision  │  │  bundle     │                   │
│  └─────────────┘  └─────────────┘  └─────────────┘                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Skills 调用现有 Plugins

### 2.1 调用链路

```
Skill.run(params)
    │
    ▼
┌────────────────────────────────────────────────────┐
│  1. 参数校验（Skill Manifest 定义）                  │
│     - required / optional 参数                      │
│     - 类型检查、范围校验                            │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│  2. 依赖检查（Capabilities + Plugins）              │
│     - 检查 R/Python 运行时                         │
│     - 检查 required Bundle                         │
│     - 检查 required Plugins                         │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│  3. Workflow 选择与执行                             │
│     - 选择 default 或 variant workflow             │
│     - 按步骤执行 Plugins                          │
│     - Artifact 绑定与传递                          │
└────────────────────┬───────────────────────────────┘
                     │
                     ▼
┌────────────────────────────────────────────────────┐
│  4. 产物聚合与返回                                 │
│     - 合并所有步骤的 Artifacts                     │
│     - 应用 recovery_strategies（如失败）           │
│     - 返回完整结果                                │
└────────────────────────────────────────────────────┘
```

### 2.2 代码示例

```javascript
// Skill 调用 Plugin 示例
async function executeSkill(skillId, params) {
  const skillRegistry = new SkillRegistry();
  const skill = skillRegistry.getSkill(skillId);
  
  // 1. 参数校验
  const validatedParams = skillRuntime.validateParams(skill, params);
  
  // 2. 依赖检查
  await skillRuntime.checkDependencies(skill);
  
  // 3. Workflow 执行
  const workflowRuntime = new WorkflowRuntime();
  const workflow = skill.workflows.default;
  
  let context = { params: validatedParams, artifacts: {} };
  
  for (const step of workflow.steps) {
    // 绑定上游 Artifact
    if (step.artifactBindings) {
      context = applyArtifactBindings(context, step.artifactBindings);
    }
    
    // 执行 Plugin
    const pluginResult = await pluginSDK.runPlugin(step.plugin, {
      ...context.params,
      ...context.artifacts
    });
    
    // 验证产物
    pluginSDK.validateArtifacts(pluginResult);
    
    // 更新 context
    context.artifacts = {
      ...context.artifacts,
      ...pluginResult.artifacts
    };
  }
  
  // 4. 返回结果
  return aggregateSkillOutputs(skill, context.artifacts);
}
```

### 2.3 参数映射

Skill 参数到 Plugin 参数的映射：

```javascript
// skill.json
{
  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "method": { "type": "select", "default": "deseq2" },
      "padj_threshold": { "type": "number", "default": 0.05 }
    }
  }
}

// workflow.json
{
  "steps": [
    {
      "id": "qc",
      "plugin": "expression-qc",
      "paramMapping": {
        "input": "{{params.dataset}}"
      }
    },
    {
      "id": "deseq2",
      "plugin": "deseq2",
      "paramMapping": {
        "count_matrix": "{{artifacts.qc.clean_matrix}}",
        "metadata": "{{params.group_column}}",
        "method": "{{params.method}}",
        "padj": "{{params.padj_threshold}}"
      },
      "artifactBindings": {
        "degs_table": "deseq2.degs_table"
      }
    }
  ]
}
```

---

## 3. Skills 利用现有 MCP 工具

### 3.1 MCP 工具映射

| Skill 操作 | MCP 工具 | 说明 |
|------------|----------|------|
| 列出 Skills | `list_skills` | 新增 |
| 获取 Skill 详情 | `get_skill` | 新增 |
| 执行 Skill | `run_skill` | 新增 |
| 列出 Plugins | `list_tools` | 现有 |
| 执行 Plugin | `run_tool` | 现有 |
| 列出 Workflows | `list_workflows` | 新增（可选） |
| 执行 Workflow | `run_workflow` | 新增（可选） |

### 3.2 MCP 工具定义扩展

```javascript
// src/mcp-server.js

// 新增 Skills 相关工具
const skillsTools = {
  name: "petri_skills",
  tools: [
    {
      name: "list_skills",
      description: "列出所有可用的 Skills",
      inputSchema: {
        type: "object",
        properties: {
          category: { type: "string", description: "按分类筛选" },
          tags: { 
            type: "array", 
            items: { type: "string" },
            description: "按标签筛选" 
          }
        }
      }
    },
    {
      name: "get_skill",
      description: "获取 Skill 详细信息和参数定义",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" }
        },
        required: ["id"]
      }
    },
    {
      name: "run_skill",
      description: "执行 Skill",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          params: { type: "object" },
          workflow: { 
            type: "string",
            description: "可选：指定 workflow 变体" 
          }
        },
        required: ["id", "params"]
      }
    },
    {
      name: "search_skills",
      description: "搜索 Skills",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string" }
        },
        required: ["query"]
      }
    }
  ]
};

// 现有工具保持不变
const pluginTools = {
  name: "petri_plugins",
  tools: [
    {
      name: "list_tools",
      // ... 现有定义
    },
    {
      name: "run_tool",
      // ... 现有定义
    }
  ]
};
```

### 3.3 Agent 使用示例

```
User: 对 GSE12345 数据集进行 DEG 分析

Agent:
  1. 调用 list_skills() 发现 deg-analysis-standard
  2. 调用 get_skill("deg-analysis-standard") 获取参数定义
  3. 调用 run_skill("deg-analysis-standard", {
       dataset: "GSE12345.csv",
       group_column: "condition",
       method: "deseq2",
       padj_threshold: 0.05
     })
  4. 返回完整分析结果（含火山图、DEGs 表、富集结果）
```

---

## 4. 与 agent-workflow.js 的关系

### 4.1 现有 Workflow 设计

现有 `agent-workflow.js` 提供：
- 单步 Plugin 执行
- Artifact 绑定与传递
- 断点恢复
- 执行 lineage

### 4.2 Skill 层的扩展

```
┌─────────────────────────────────────────────────────────────────┐
│                    agent-workflow.js                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  WorkflowStep {                                          │  │
│  │    plugin: string,      // Plugin ID                     │  │
│  │    params: object,     // 固定参数                       │  │
│  │    artifacts: object,   // Artifact 绑定                 │  │
│  │    onSuccess: string,   // 下一步骤                       │  │
│  │    onFailure: string    // 失败处理                      │  │
│  │  }                                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  runWorkflow(steps, initialContext)                              │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ 继承/复用
                              │
┌─────────────────────────────────────────────────────────────────┐
│                    skill-runtime.js (新增)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  SkillExecution {                                        │  │
│  │    skill: SkillManifest,                                 │  │
│  │    workflow: Workflow,           // 引用 agent-workflow   │  │
│  │    params: object,              // Skill 层参数          │  │
│  │    recovery_strategies: [],     // Skill 层恢复策略      │  │
│  │    prompts: {}                  // Prompt 模板            │  │
│  │  }                                                      │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  SkillRuntime.execute(skillId, params)                          │
│    └── 调用 WorkflowRuntime.run(workflow, context)                │
│            └── 调用 agent-workflow.js                            │
└─────────────────────────────────────────────────────────────────┘
```

### 4.3 复用 agent-workflow.js 的方式

```javascript
// skill-runtime.js

class SkillRuntime {
  constructor(skillManifest) {
    this.skill = skillManifest;
    this.agentWorkflow = new AgentWorkflow(); // 复用现有实现
  }
  
  async execute(params, options = {}) {
    // 1. Skill 层参数处理
    const validatedParams = this.validateParams(params);
    
    // 2. Skill 层依赖检查
    await this.checkSkillDependencies();
    
    // 3. 构建 Workflow 上下文
    const workflowContext = this.buildWorkflowContext(validatedParams);
    
    // 4. 选择 Workflow 变体
    const workflow = this.selectWorkflow(options.workflow);
    
    // 5. 复用 agent-workflow.js 执行
    const workflowResult = await this.agentWorkflow.run(
      workflow.steps,
      workflowContext
    );
    
    // 6. Skill 层结果聚合
    return this.aggregateResults(workflowResult);
  }
  
  buildWorkflowContext(params) {
    return {
      // Skill 参数
      skillParams: params,
      
      // Plugin 参数（从 Skill 参数映射）
      pluginParams: this.mapToPluginParams(params),
      
      // Artifact 绑定
      artifactBindings: this.skill.workflows.default.artifactBindings,
      
      // Capability 要求
      capabilities: this.skill.capabilities
    };
  }
}
```

---

## 5. 迁移路径

### 5.1 不破坏现有 Plugin 系统

**核心原则**：
- Skills 是**编排层**，不修改 Plugin 执行逻辑
- 现有 Plugins 可独立使用，不依赖 Skills
- Skills 调用 Plugins 通过现有 `run_tool` 接口

### 5.2 渐进式迁移

```
阶段 1: 核心框架（不破坏现有系统）
  - 实现 skill-registry.js（只读发现）
  - 实现 skill-runtime.js（调用现有 Plugins）
  - 添加 MCP 工具（不替换现有工具）
  → 现有系统完全不受影响

阶段 2: 内置 Skills
  - 创建 deg-analysis-standard Skill
  - 创建 go-enrichment-full Skill
  - 与现有 harness-task-packs 对齐
  → 用户可选择使用 Skills

阶段 3: Workflow 扩展
  - 扩展 agent-workflow.js 支持 Skill 层
  - 支持 recovery_strategies
  - 支持 Prompt 模板
  → 增强现有 Workflow 能力

阶段 4: 完整集成
  - UI 集成（Skill 选择器）
  - Marketplace 集成
  - 完整文档和门禁
  → 正式发布
```

### 5.3 兼容性矩阵

| 场景 | 现有系统 | Skill 层 | 兼容性 |
|------|----------|----------|--------|
| 独立 Plugin 执行 | ✅ | 不需要 | ✅ 完全兼容 |
| 独立 Workflow 执行 | ✅ | 不需要 | ✅ 完全兼容 |
| Skill 调用 Plugin | — | ✅ | ✅ 通过 run_tool |
| Plugin 调用 Skill | — | ❌ | — |
| Skill 内嵌套 Skill | — | ❌ | 计划中 |
| 混合执行 | ✅ | ✅ | ✅ 可选 |

---

## 6. 错误处理与恢复

### 6.1 错误传播链

```
Plugin 失败
    │
    ▼
agent-workflow.js
    │
    ▼
skill-runtime.js (Skill 层)
    │
    ├── recoverable: true
    │       │
    │       ▼
    │   应用 recovery_strategies
    │       │
    │       ├── 尝试 1: 参数修复
    │       ├── 尝试 2: 降级 Plugin
    │       └── 尝试 3: 简化流程
    │
    └── recoverable: false
            │
            ▼
        返回详细诊断信息
```

### 6.2 恢复策略示例

```javascript
// skill.json 中的恢复策略
{
  "recovery_strategies": [
    {
      "when": "sample_group_mismatch",
      "description": "样本分组与元数据不匹配",
      "do": [
        {
          "action": "auto_detect",
          "plugin": "expression-qc",
          "params": { "mode": "detect_groups" }
        },
        {
          "action": "prompt_user",
          "message": "检测到分组不一致，请确认或提供正确的分组信息"
        }
      ],
      "fallback": {
        "action": "use_template",
        "template": "group-template.csv"
      }
    }
  ]
}
```

---

## 7. 目录结构

```
resources/
├── built-in-plugins/          # Layer 2: Plugins（现有）
│   ├── deseq2/
│   ├── go-kegg/
│   └── volcano-plot/
│
├── skills/                    # Layer 4: Skills（新增）
│   ├── manifest.json         # built-in Skills 清单
│   │
│   ├── deg-analysis-standard/
│   │   ├── skill.json        # Skill Manifest
│   │   ├── prompts/
│   │   │   ├── system.md
│   │   │   └── user/
│   │   │       └── template.md
│   │   └── workflows/
│   │       ├── default.json  # 默认 Workflow
│   │       └── quick.json    # 快速变体
│   │
│   └── go-enrichment-full/
│       ├── skill.json
│       └── workflows/
│
└── workflows/                 # Layer 3: Workflows（新增）
    ├── enrichment-pipeline.json
    ├── qc-to-deg.json
    └── wgcna-standard.json
```

---

## 8. API 接口

### 8.1 Skill Registry API

```javascript
// GET /api/skills
// 列出所有 Skills
{
  "skills": [
    {
      "id": "deg-analysis-standard",
      "name": "标准差异表达分析",
      "version": "1.0.0",
      "source": "built-in",
      "category": "bioinformatics/ngs",
      "tags": ["deg", "rna-seq"],
      "description": "从原始计数矩阵到火山图的完整 DEG 分析流程"
    }
  ]
}

// GET /api/skills/:id
// 获取 Skill 详情
{
  "id": "deg-analysis-standard",
  "name": "标准差异表达分析",
  "version": "1.0.0",
  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "method": { "type": "select", "options": ["deseq2", "edger"] },
      "padj_threshold": { "type": "number", "default": 0.05 }
    }
  },
  "outputs": {
    "primary": ["volcano_plot", "degs_table"],
    "secondary": ["go_enrichment", "kegg_pathway"]
  },
  "plugins": {
    "required": ["deseq2", "volcano-plot"],
    "optional": ["go-kegg"]
  },
  "workflows": {
    "default": "deg-standard-pipeline",
    "variants": ["deg-quick"]
  }
}

// POST /api/skills/:id/run
// 执行 Skill
{
  "params": {
    "dataset": "/path/to/counts.csv",
    "group_column": "condition",
    "method": "deseq2",
    "padj_threshold": 0.05
  },
  "workflow": "default"  // 可选
}

// 响应
{
  "skill_id": "deg-analysis-standard",
  "execution_id": "exec-123",
  "status": "completed",
  "artifacts": {
    "volcano_plot": { "path": "/output/volcano.png", "type": "plot" },
    "degs_table": { "path": "/output/degs.csv", "type": "table" }
  },
  "duration_ms": 45230
}
```

### 8.2 Workflow API

```javascript
// GET /api/workflows
// 列出所有 Workflows
{
  "workflows": [
    {
      "id": "enrichment-pipeline",
      "name": "富集分析流程",
      "skill": "go-enrichment-full",
      "steps": [
        { "plugin": "go-kegg", "order": 1 },
        { "plugin": "gsea", "order": 2 }
      ]
    }
  ]
}

// POST /api/workflows/:id/run
// 执行 Workflow
{
  "params": {
    "deg_table": "/path/to/degs.csv",
    "species": "human"
  }
}
```

---

## 9. 验收标准

### 9.1 集成验收

```bash
# 1. Skills 发现
curl http://localhost:3002/api/skills

# 2. Skills 调用 Plugins
curl -X POST http://localhost:3002/api/skills/deg-analysis-standard/run \
  -H "Content-Type: application/json" \
  -d '{"dataset": "demo.csv", "group_column": "condition"}'

# 3. Plugin 仍可独立执行
curl -X POST http://localhost:3002/api/execute \
  -H "Content-Type: application/json" \
  -d '{"toolId": "deseq2", "params": {...}}'

# 4. 错误恢复
# - 模拟 Plugin 失败，验证 recovery_strategies 执行
```

### 9.2 回归验收

```bash
# 现有 Plugin 功能不受影响
npm run harness:plugins:acceptance

# 现有 Workflow 功能不受影响
npm run harness:check

# 全量回归
node --test test/*.test.mjs
```

### 9.3 性能验收

```bash
# Skill 执行延迟 < 2s（不含 Plugin 实际运行）
curl -w "\nTime: %{time_total}s\n" \
  -X POST http://localhost:3002/api/skills/deg-analysis-standard/run \
  -d '{"dataset": "demo.csv"}'

# Registry 列表 < 100ms
curl -w "\nTime: %{time_total}s\n" \
  http://localhost:3002/api/skills
```
