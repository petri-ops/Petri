# BioF3 Desktop Skill 定义 Schema

> 状态：**设计稿**（待实现）
>
> 最后更新：2026-08-14
>
> 阅读前置：`docs/skills-architecture.md`（整体架构）、`docs/plugin-artifact-schema.md`（Plugin Schema）

---

## 概述

本文档定义 Skill 的标准结构（Schema），包括身份声明、能力引用、参数契约、Prompt 模板、恢复策略等完整定义。

**设计原则**：
- 与 Plugin Schema 保持一致风格
- 参数校验使用 JSON Schema
- 支持自然语言 Prompt 模板化

---

## 1. Skill Manifest 结构

```json
{
  "skillManifestVersion": 1,
  "id": "deg-analysis-standard",
  "name": "标准差异表达分析",
  "version": "1.0.0",
  "description": "从原始计数矩阵到火山图的完整 DEG 分析流程",
  "category": "bioinformatics/ngs",
  "tags": ["deg", "rna-seq", "deseq2"],
  
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
    "system": "你是一位资深的生物信息分析师，擅长差异表达分析。你的工作流程包括：\n1. 评估数据质量\n2. 执行标准化\n3. 运行差异分析\n4. 可视化结果\n\n始终基于科学最佳实践，为用户提供准确的分析建议。",
    "user_templates": [
      "对 {dataset} 进行标准 DEG 分析",
      "使用 {method} 方法比较 {group1} vs {group2}",
      "分析 {sample_count} 个样本，检测 {condition} 条件的影响",
      "用 {padj_threshold} 的显著性阈值重新分析"
    ]
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
      },
      "logfc_threshold": {
        "type": "number",
        "default": 1,
        "min": 0,
        "max": 10,
        "step": 0.5,
        "description": "Log2 Fold Change 阈值"
      },
      "species": {
        "type": "select",
        "options": ["human", "mouse", "rat", "zebrafish"],
        "default": "human",
        "description": "物种"
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
    },
    {
      "when": "insufficient_replicates",
      "description": "生物学重复不足",
      "do": "警告用户并建议使用 limma-voom 方法",
      "fallback": "使用 DESeq2 的 nbinomWaldTest",
      "recoverable": true
    },
    {
      "when": "low_gene_count",
      "description": "基因表达量过低",
      "do": "自动过滤低表达基因并重试",
      "fallback": "提示用户检查数据质量",
      "recoverable": true
    }
  ],
  
  "outputs": {
    "primary": [
      {
        "id": "volcano_plot",
        "type": "plot",
        "label": "火山图",
        "description": "差异基因可视化"
      },
      {
        "id": "degs_table",
        "type": "table",
        "label": "DEGs 结果表",
        "description": "差异表达基因详情"
      }
    ],
    "secondary": [
      {
        "id": "go_enrichment",
        "type": "table",
        "label": "GO 富集结果",
        "requires_plugin": "go-kegg"
      },
      {
        "id": "kegg_pathway",
        "type": "plot",
        "label": "KEGG 通路图",
        "requires_plugin": "go-kegg"
      }
    ]
  },
  
  "metadata": {
    "author": "BioF3 Team",
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

---

## 2. 字段说明

### 2.1 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `skillManifestVersion` | integer | 是 | Manifest 版本，当前为 1 |
| `id` | string | 是 | Skill 全局唯一标识，格式 `kebab-case` |
| `name` | string | 是 | 人类可读名称 |
| `version` | string | 是 | 语义化版本 `major.minor.patch` |
| `description` | string | 是 | 详细描述（支持 Markdown） |
| `category` | string | 是 | 分类，格式 `domain/subdomain` |
| `tags` | string[] | 否 | 标签，用于搜索和过滤 |
| `source` | string | 是 | 来源：`built-in`、`installed`、`marketplace` |

### 2.2 能力引用

| 字段 | 类型 | 说明 |
|------|------|------|
| `capabilities` | string[] | 依赖的环境能力 ID（如 `r-enrichment`） |
| `plugins.required` | string[] | 必须的 Plugin ID |
| `plugins.optional` | string[] | 可选的 Plugin ID |

### 2.3 Prompt 模板

| 字段 | 类型 | 说明 |
|------|------|------|
| `prompts.system` | string | System Prompt，支持模板变量 |
| `prompts.user_templates` | string[] | 用户 Prompt 模板，`{var}` 占位 |

### 2.4 参数定义

```json
{
  "parameters": {
    "required": ["dataset", "group_column"],
    "optional": {
      "param_name": {
        "type": "select|number|string|boolean|file",
        "options": [],        // select 类型专用
        "default": null,
        "min": 0,            // number 类型专用
        "max": 100,
        "step": 1,
        "accept": ".csv",    // file 类型专用
        "description": ""
      }
    }
  }
}
```

### 2.5 恢复策略

```json
{
  "recovery_strategies": [
    {
      "when": "failure_code",
      "description": "失败场景描述",
      "do": "尝试的恢复动作",
      "fallback": "降级方案",
      "recoverable": true
    }
  ]
}
```

---

## 3. 完整示例

### 3.1 GO/KEGG 富集 Skill

```json
{
  "skillManifestVersion": 1,
  "id": "go-enrichment-full",
  "name": "完整 GO/KEGG 富集分析",
  "version": "1.0.0",
  "description": "对差异基因进行 Gene Ontology 和 KEGG Pathway 富集分析，包含 BP、CC、MF 三个ontology。",
  "category": "bioinformatics/enrichment",
  "tags": ["go", "kegg", "enrichment", "deg"],
  "source": "built-in",
  
  "capabilities": ["r-enrichment"],
  
  "plugins": {
    "required": ["go-kegg"],
    "optional": ["gsea"]
  },
  
  "workflows": {
    "default": "enrichment-standard",
    "variants": ["enrichment-quick"]
  },
  
  "prompts": {
    "system": "你是一位功能富集分析专家。你的专长包括：\n1. GO 富集分析（BP/CC/MF）\n2. KEGG Pathway 分析\n3. 结果解读与可视化\n\n你会根据基因数量和物种选择最合适的分析方法。",
    "user_templates": [
      "对 {deg_file} 进行 GO/KEGG 富集分析",
      "对 {gene_count} 个基因进行 {ontology} 富集",
      "使用 {species} 物种分析 {organism_db}"
    ]
  },
  
  "parameters": {
    "required": ["deg_table", "species"],
    "optional": {
      "ontology": {
        "type": "select",
        "options": ["BP", "CC", "MF", "ALL"],
        "default": "ALL",
        "description": "GO Ontology"
      },
      "pvalue_cutoff": {
        "type": "number",
        "default": 0.05,
        "min": 0.001,
        "max": 0.1,
        "step": 0.01,
        "description": "P 值截断值"
      },
      "qvalue_cutoff": {
        "type": "number",
        "default": 0.05,
        "min": 0.001,
        "max": 0.1,
        "step": 0.01,
        "description": "Q 值截断值"
      },
      "min_gset_size": {
        "type": "number",
        "default": 10,
        "min": 1,
        "max": 100,
        "description": "最小基因集大小"
      },
      "max_gset_size": {
        "type": "number",
        "default": 500,
        "min": 100,
        "max": 2000,
        "description": "最大基因集大小"
      },
      "top_n": {
        "type": "number",
        "default": 20,
        "min": 5,
        "max": 100,
        "description": "展示 Top N 结果"
      }
    }
  },
  
  "recovery_strategies": [
    {
      "when": "no_significant_results",
      "description": "没有显著富集结果",
      "do": "放宽阈值后重试：pvalue_cutoff * 2",
      "fallback": "提示用户可能没有显著富集通路",
      "recoverable": true
    },
    {
      "when": "gene_id_type_mismatch",
      "description": "基因 ID 类型不匹配",
      "do": "尝试自动检测并转换基因 ID",
      "fallback": "提示用户提供正确格式的基因 ID",
      "recoverable": true
    },
    {
      "when": "species_not_supported",
      "description": "物种不支持",
      "do": "检查物种数据库是否安装，尝试在线获取",
      "fallback": "提示用户当前物种暂不支持",
      "recoverable": false
    }
  ],
  
  "outputs": {
    "primary": [
      {
        "id": "go_bp_results",
        "type": "table",
        "label": "GO-BP 富集结果"
      },
      {
        "id": "go_cc_results",
        "type": "table",
        "label": "GO-CC 富集结果"
      },
      {
        "id": "go_mf_results",
        "type": "table",
        "label": "GO-MF 富集结果"
      },
      {
        "id": "kegg_results",
        "type": "table",
        "label": "KEGG 通路富集结果"
      }
    ],
    "secondary": [
      {
        "id": "go_dotplot",
        "type": "plot",
        "label": "GO 富集气泡图"
      },
      {
        "id": "kegg_pathway_map",
        "type": "plot",
        "label": "KEGG 通路图"
      },
      {
        "id": "enrichment_report",
        "type": "html",
        "label": "富集分析报告"
      }
    ]
  },
  
  "metadata": {
    "author": "BioF3 Team",
    "license": "MIT",
    "source": "built-in",
    "created": "2026-08-14"
  }
}
```

### 3.2 WGCNA 分析 Skill

```json
{
  "skillManifestVersion": 1,
  "id": "wgcna-analysis",
  "name": "WGCNA 共表达网络分析",
  "version": "1.0.0",
  "description": "使用加权基因共表达网络分析（WGCNA）识别基因模块和关键基因。",
  "category": "bioinformatics/network",
  "tags": ["wgcna", "co-expression", "network", "module"],
  "source": "built-in",
  
  "capabilities": ["r-wgcna"],
  
  "plugins": {
    "required": ["wgcna"],
    "optional": ["go-kegg"]
  },
  
  "workflows": {
    "default": "wgcna-standard",
    "variants": ["wgcna-step-by-step"]
  },
  
  "prompts": {
    "system": "你是 WGCNA 分析专家。你的工作包括：\n1. 数据预处理与质量控制\n2. 软阈值选择\n3. 模块识别与聚类\n4. 模块与性状关联分析\n5. 核心基因鉴定\n\nWGCNA 是一种无监督分析方法，不依赖先验知识，适合探索性研究。",
    "user_templates": [
      "对 {dataset} 进行 WGCNA 分析",
      "识别与 {trait} 相关的基因模块",
      "构建 {sample_count} 个样本的共表达网络"
    ]
  },
  
  "parameters": {
    "required": ["expression_matrix", "metadata"],
    "optional": {
      "network_type": {
        "type": "select",
        "options": ["unsigned", "signed", "signed_hybrid"],
        "default": "signed",
        "description": "网络类型"
      },
      "power": {
        "type": "number",
        "default": 6,
        "min": 1,
        "max": 30,
        "description": "软阈值幂次（自动选择时可设为 0）"
      },
      "min_module_size": {
        "type": "number",
        "default": 30,
        "min": 10,
        "max": 100,
        "description": "最小模块大小"
      },
      "merge_threshold": {
        "type": "number",
        "default": 0.25,
        "min": 0.1,
        "max": 0.5,
        "description": "模块合并相似度阈值"
      },
      "max_block_size": {
        "type": "number",
        "default": 20000,
        "min": 5000,
        "max": 50000,
        "description": "最大模块基因数"
      }
    }
  },
  
  "recovery_strategies": [
    {
      "when": "power_selection_failed",
      "description": "软阈值选择失败",
      "do": "使用默认幂次 6 或让用户指定",
      "fallback": "尝试 powers 1-20 自动选择",
      "recoverable": true
    },
    {
      "when": "too_few_genes",
      "description": "基因数过少",
      "do": "降低 min_module_size",
      "fallback": "提示数据可能不适合 WGCNA",
      "recoverable": true
    },
    {
      "when": "memory_exceeded",
      "description": "内存不足",
      "do": "分块处理，增加 max_block_size 控制",
      "fallback": "建议过滤低变异基因后重试",
      "recoverable": true
    }
  ],
  
  "outputs": {
    "primary": [
      {
        "id": "sample_dendrogram",
        "type": "plot",
        "label": "样本聚类树状图"
      },
      {
        "id": "gene_dendrogram",
        "type": "plot",
        "label": "基因聚类树状图"
      },
      {
        "id": "module_trait_correlation",
        "type": "plot",
        "label": "模块-性状相关性热图"
      },
      {
        "id": "module_membership",
        "type": "table",
        "label": "模块成员信息"
      }
    ],
    "secondary": [
      {
        "id": "eigen_gene_network",
        "type": "plot",
        "label": "特征基因网络图"
      },
      {
        "id": "hub_genes",
        "type": "table",
        "label": "Hub 基因列表"
      },
      {
        "id": "module_enrichment",
        "type": "table",
        "label": "模块富集分析"
      }
    ]
  },
  
  "metadata": {
    "author": "BioF3 Team",
    "license": "MIT",
    "source": "built-in",
    "created": "2026-08-14"
  }
}
```

---

## 4. 参数类型定义

### 4.1 select 类型

```json
{
  "type": "select",
  "options": ["option1", "option2", "option3"],
  "default": "option1",
  "description": "选择项说明"
}
```

### 4.2 number 类型

```json
{
  "type": "number",
  "default": 0.05,
  "min": 0,
  "max": 1,
  "step": 0.01,
  "description": "数值参数说明"
}
```

### 4.3 string 类型

```json
{
  "type": "string",
  "default": "default_value",
  "pattern": "^[A-Z].*",
  "description": "字符串参数说明"
}
```

### 4.4 boolean 类型

```json
{
  "type": "boolean",
  "default": false,
  "description": "布尔参数说明"
}
```

### 4.5 file 类型

```json
{
  "type": "file",
  "accept": ".csv,.tsv",
  "description": "文件输入说明"
}
```

---

## 5. 输出类型定义

### 5.1 plot 类型

```json
{
  "id": "volcano_plot",
  "type": "plot",
  "label": "火山图",
  "description": "差异基因可视化展示",
  "format": "png",
  "dpi": 300
}
```

### 5.2 table 类型

```json
{
  "id": "degs_table",
  "type": "table",
  "label": "DEGs 结果表",
  "description": "差异表达基因详细信息",
  "format": "csv",
  "columns": ["gene", "log2FC", "pvalue", "padj"]
}
```

### 5.3 html 类型

```json
{
  "id": "analysis_report",
  "type": "html",
  "label": "分析报告",
  "description": "完整的交互式分析报告",
  "template": "report-template.html"
}
```

---

## 6. 与 Plugin Schema 的兼容性

Skill Schema 与 Plugin Schema 的映射关系：

| Skill 字段 | Plugin 对应 |
|------------|-------------|
| `plugins.required` | `plugin.json` 独立使用 |
| `plugins.optional` | `plugin.json` 独立使用 |
| `parameters` | `tool-definition.json.inputs` |
| `outputs.primary` | `tool-definition.json.outputs` |
| `outputs.secondary` | `tool-definition.json.outputs` |
| `recovery_strategies` | `tool-definition.json.failureModes` |

**关键区别**：
- Skill 是**编排层**，组合多个 Plugins
- Plugin 是**执行层**，单个分析能力
- Skill 不直接定义 inputs/outputs，而是引用 Plugin 的契约

---

## 7. 目录结构

```
resources/skills/<skill-id>/
├── skill.json              # Skill Manifest（必须）
├── prompts/
│   ├── system.md          # System Prompt 模板
│   └── user/
│       ├── template1.md    # 用户模板 1
│       └── template2.md    # 用户模板 2
├── workflows/
│   └── default.json        # 默认 Workflow 定义
├── templates/              # 输出模板
│   └── report.html
└── demo-data/               # 演示数据
    └── demo-deg.csv
```

---

## 8. 验证规则

### 8.1 必须字段

- `skillManifestVersion` = 1
- `id` 非空，kebab-case 格式
- `name` 非空
- `version` 符合 semver
- `plugins.required` 非空数组

### 8.2 约束检查

```javascript
// 示例验证逻辑
function validateSkillManifest(manifest) {
  const errors = [];
  
  if (manifest.skillManifestVersion !== 1) {
    errors.push("skillManifestVersion must be 1");
  }
  
  if (!/^[a-z][a-z0-9-]*$/.test(manifest.id)) {
    errors.push("id must be kebab-case");
  }
  
  if (!semver.valid(manifest.version)) {
    errors.push("version must be valid semver");
  }
  
  if (!manifest.plugins?.required?.length) {
    errors.push("plugins.required must be non-empty array");
  }
  
  return { valid: errors.length === 0, errors };
}
```

### 8.3 门禁命令

```bash
# Manifest 验证
npm run skills:check -- --manifest resources/skills/deg-analysis-standard/skill.json

# 批量验证
npm run skills:check
```
