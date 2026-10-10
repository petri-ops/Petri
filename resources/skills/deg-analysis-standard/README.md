# DEG Analysis Standard Skill

标准差异表达分析 Skill，实现从原始计数矩阵到可发表级别火山图的完整分析流程。

## 目录结构

```
deg-analysis-standard/
├── manifest.json           # Skill Manifest 定义
├── prompts/
│   ├── system.md          # 系统 Prompt
│   └── user/
│       └── standard-deg.md # 用户 Prompt 模板
└── README.md              # 本文档
```

## 功能概述

此 Skill 整合以下内置插件：

| 插件 | 用途 | 必需 |
|------|------|------|
| `expression-qc` | 表达量质控与过滤 | ✅ |
| `deseq2` | 差异分析核心算法 | ✅ |
| `volcano-plot` | 火山图可视化 | ✅ |
| `go-kegg` | GO/KEGG 富集分析 | 可选 |
| `gsea` | GSEA 基因集富集 | 可选 |

## 使用方法

### 基础用法

```json
{
  "skill": "deg-analysis-standard",
  "dataset": "path/to/counts.csv",
  "metadata": "path/to/coldata.csv",
  "group_column": "condition",
  "comparisons": [
    ["treatment", "control"]
  ]
}
```

### 参数说明

#### 必需参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `dataset` | file | 原始计数矩阵（CSV，基因为行，样本为列） |
| `group_column` | string | 元数据中定义分组的列名 |

#### 可选参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `method` | select | `deseq2` | 差异分析方法：deseq2, edger, limma |
| `padj_threshold` | number | `0.05` | 校正后 P 值阈值 |
| `logfc_threshold` | number | `1` | Log2 Fold Change 阈值 |
| `species` | select | `human` | 物种（影响 GO/KEGG 数据库） |
| `shrinkage` | boolean | `true` | 是否使用 apeglm shrinkage |
| `run_enrichment` | boolean | `false` | 是否自动运行富集分析 |

## 输出产物

### 主要输出

| 输出 | 类型 | 说明 |
|------|------|------|
| `volcano_plot` | PNG | 火山图（300 DPI） |
| `degs_table` | CSV | 差异基因完整列表 |
| `qc_report` | HTML | 质控报告 |

### 次要输出（需安装可选插件）

| 输出 | 类型 | 说明 |
|------|------|------|
| `go_enrichment` | CSV | GO 富集结果 |
| `kegg_pathway` | PNG | KEGG 通路图 |
| `heatmap` | PNG | 差异基因热图 |

## 示例数据

使用内置演示数据测试：

```
数据集：resources/built-in-plugins/deseq2/demo-data/
├── demo-counts.csv    # 计数矩阵
└── demo-coldata.csv   # 样本元数据
```

示例分析命令：

```
对 demo-counts.csv 进行 DEG 分析
分组列为 condition
比较 WT vs KO
使用默认参数
```

## 工作流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  数据导入    │ ──▶ │  质控过滤    │ ──▶ │  DESeq2     │
│  counts.csv │     │  expression │     │  差异分析   │
└─────────────┘     │  -qc        │     └─────────────┘
                    └─────────────┘            │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  富集分析    │ ◀── │  GO/KEGG   │ ◀── │  火山图     │
│  可选       │     │  go-kegg   │     │  volcano-   │
└─────────────┘     └─────────────┘     │  plot       │
                                        └─────────────┘
```

## 错误恢复

| 错误场景 | 恢复策略 |
|----------|----------|
| 样本分组不匹配 | 自动检测或请求用户确认 |
| 生物学重复不足 | 警告并建议替代方法 |
| 低表达基因过多 | 自动过滤后重试 |
| 无显著差异基因 | 放宽阈值或提示检查实验设计 |

## 依赖环境

- R >= 4.4.0
- DESeq2 >= 1.40.0
- ggplot2 >= 3.4.0
- ggrepel >= 0.9.0

## 许可证

MIT License

## 作者

Petri Team

## 版本历史

- **1.0.0** (2026-08-14): 初始版本
