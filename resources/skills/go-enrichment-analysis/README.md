# GO Enrichment Analysis Skill

GO 富集分析 Skill，使用 clusterProfiler 对差异表达基因进行 Gene Ontology 功能富集分析。

## 目录结构

```
go-enrichment-analysis/
├── manifest.json           # Skill Manifest 定义
├── prompts/
│   ├── system.md          # 系统 Prompt（分析师角色）
│   └── user/
│       └── standard-go.md  # 用户 Prompt 模板
└── README.md              # 本文档
```

## 功能概述

此 Skill 使用 clusterProfiler 进行 GO 富集分析，支持以下功能：

| 功能 | 说明 | 必需 |
|------|------|------|
| GO 富集分析 | BP、MF、CC 三个 Ontology | ✅ |
| 超几何检验 | 统计显著性评估 | ✅ |
| BH 校正 | 多重检验校正 | ✅ |
| 气泡图 | dotplot 可视化 | ✅ |
| 条形图 | barplot 可视化 | 可选 |
| 网络图 | cnetplot 基因-通路关系 | 可选 |

## 使用方法

### 基础用法

```json
{
  "skill": "go-enrichment-analysis",
  "geneList": ["TP53", "BRCA1", "EGFR", "MYC", "BCL2"],
  "organism": "hsa",
  "ontology": "ALL"
}
```

### 参数说明

#### 必需参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `geneList` | array / string | 基因列表（Entrez ID 或基因符号） |

#### 可选参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `organism` | select | `hsa` | 物种代码（hsa/mmu/rno/dre/cel/dme/ath/osa） |
| `ontology` | select | `ALL` | GO Ontology（BP/MF/CC/ALL） |
| `pvalueCutoff` | number | `0.05` | P-value 阈值 |
| `qvalueCutoff` | number | `0.2` | Q-value 阈值 |
| `minGSSize` | number | `10` | 通路最小基因数 |
| `maxGSSize` | number | `500` | 通路最大基因数 |
| `geneIDType` | select | `auto` | 基因 ID 类型（auto/entrez/symbol） |

## 输出产物

### 主要输出

| 输出 | 类型 | 说明 |
|------|------|------|
| `enrichment_table.csv` | CSV | 完整 GO 富集结果 |
| `dotplot.pdf` | PDF | 富集气泡图 |

### 次要输出（条件触发）

| 输出 | 类型 | 触发条件 |
|------|------|----------|
| `barplot.pdf` | PDF | BP 显著结果 >5 |
| `cnetplot.pdf` | PDF | 基因数 ≤100 |
| `goplot.pdf` | PDF | 总是生成（如有结果） |
| `analysis_report.md` | Markdown | 结果解读 |

## 工作流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  基因列表    │ ──▶ │  ID 转换    │ ──▶ │  enrichGO  │
│  geneList   │     │  symbol/   │     │  超几何检验 │
└─────────────┘     │  entrez    │     └─────────────┘
                    └─────────────┘            │
                                              ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  结果报告   │ ◀── │  Markdown  │ ◀── │  可视化     │
│  analysis_  │     │  解读      │     │  dotplot/   │
│  report     │     └─────────────┘     │  cnetplot   │
└─────────────┘                          └─────────────┘
```

## 示例数据

### 示例 1：人类基因富集分析

```
对 TP53, BRCA1, EGFR, MYC, BCL2 进行 GO 富集分析
物种：hsa
Ontology：ALL
```

### 示例 2：小鼠基因富集分析

```
对 deg_upregulated.csv 中的基因进行 GO 富集分析
物种：mmu（小鼠）
Ontology：BP（仅生物学过程）
P-value 阈值：0.01
```

## 错误恢复策略

| 错误场景 | 恢复策略 |
|----------|----------|
| 基因 ID 无效 | 尝试自动转换 symbol ↔ entrez |
| 物种不支持 | 列出可用物种供选择 |
| 无显著结果 | 放宽阈值重试（pvalue 0.1, qvalue 0.3） |
| 基因数过少 | 警告并降低 minGSSize 到 5 |
| 基因数过多 | 提示分批分析或使用全部基因 |

## 依赖环境

- R >= 4.4.0
- clusterProfiler >= 4.10.0
- org.Hs.eg.db / org.Mm.eg.db / org.Rn.eg.db（按物种）
- enrichplot >= 1.22.0
- ggplot2 >= 3.4.0

## 许可证

MIT License

## 作者

Petri Team

## 版本历史

- **1.0.0** (2026-08-14): 初始版本
