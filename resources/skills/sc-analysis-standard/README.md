# sc-analysis-standard Skill

标准单细胞 RNA-seq 分析 Skill，实现从原始 AnnData (.h5ad) 到细胞类型注释和通讯分析的完整端到端流程。

## 目录结构

```
sc-analysis-standard/
├── manifest.json           # Skill Manifest 定义
├── skill.json              # Skill 元数据（14 字段）
├── prompts/
│   ├── system.md          # 系统 Prompt（四段式）
│   └── user/
│       └── standard-sc.md  # 用户 Prompt 模板（3 示例）
└── README.md              # 本文档
```

## 功能概述

此 Skill 整合以下内置插件：

| 插件 | 用途 | 必需 |
|------|------|------|
| `scanpy-advanced` | Python 单细胞预处理 + QC + 聚类 | ✅ (qc_method=scanpy) |
| `seurat-standard` | R 单细胞预处理 + QC + 聚类 | ✅ (qc_method=seurat) |
| `celltypist` | 细胞类型自动注释 | 可选 |
| `cellchat` | 细胞通讯分析 | 可选 |
| `scvi-tools` | scVI 深度生成批次整合 | 可选 |

## 工作流变体

| 工作流 ID | 描述 | 使用场景 |
|-----------|------|----------|
| `sc-standard-pipeline` | 完整流程：QC → 整合 → 注释 → 通讯 → 报告 | 默认推荐 |
| `sc-quick-qc` | 仅 QC + 基本聚类注释 | 数据质量评估 |
| `sc-comprehensive-integration` | 完整流程 + scvi 深度整合 | 多批次深度校正 |
| `sc-cell-communication-only` | 仅细胞通讯分析（基于已注释数据） | 独立运行 CellChat |

## 使用方法

### 基础用法

```json
{
  "skill": "sc-analysis-standard",
  "anndata_file": "path/to/data.h5ad",
  "species": "human",
  "cell_type_column": "cell_type",
  "qc_method": "scanpy",
  "integration_method": "none",
  "annotation_method": "celltypist",
  "run_cell_cell_communication": true
}
```

### 参数说明

#### 必需参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `anndata_file` | file | AnnData 文件（.h5ad） |
| `species` | select | 物种：`human` / `mouse` |
| `cell_type_column` | string | 细胞类型注释结果列名 |

#### 可选参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `qc_method` | select | `scanpy` | QC 方法：`scanpy` / `seurat` |
| `integration_method` | select | `seurat-cca` | 批次整合：`none` / `harmony` / `scvi` / `seurat-cca` |
| `annotation_method` | select | `celltypist` | 注释：`scanpy-marker` / `celltypist` / `manual` |
| `run_cell_cell_communication` | boolean | `true` | 是否运行细胞通讯 |
| `min_genes` | number | `200` | 每细胞最少基因数 |
| `min_cells` | number | `3` | 基因最少检出细胞数 |
| `n_hvg` | number | `2000` | 高变异基因数量 |
| `resolution` | number | `0.5` | 聚类分辨率 |

## 输出产物

### 主要输出

| 输出 | 类型 | 说明 |
|------|------|------|
| `qc_report` | HTML | 质控报告 |
| `umap_plot` | PNG | UMAP 可视化（300 DPI） |
| `annotated_table` | CSV | 细胞类型注释表 |
| `marker_genes` | CSV | 标记基因表 |
| `integrated_anndata` | H5AD | 整合后 AnnData |

### 次要输出（需安装可选插件）

| 输出 | 类型 | 说明 | 需求插件 |
|------|------|------|----------|
| `cell_cell_communication_result` | CSV | 配体-受体通讯表 | `cellchat` |
| `scvi_latent` | CSV | scVI 隐空间嵌入 | `scvi-tools` |

## 示例数据

使用内置演示数据测试：

```
数据集：resources/built-in-plugins/scanpy-advanced/demo-data/
├── pbmc_3k_mini.h5ad    # AnnData demo 数据（270 cells × 100 genes）

示例分析命令：

对 pbmc_3k_mini.h5ad 进行标准单细胞分析
物种：human
使用 celltypist 自动注释
运行细胞通讯分析
```

## 工作流程

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  数据导入    │ ──▶ │  QC 过滤    │ ──▶ │  归一化     │
│  AnnData    │     │  scanpy/   │     │  log1p     │
│  .h5ad     │     │  seurat    │     │            │
└─────────────┘     └─────────────┘     └──────┬──────┘
                                               │
                                               ▼
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  细胞通讯    │ ◀── │  CellChat   │ ◀── │  批次整合   │
│  可选       │     │  配体-受体  │     │ harmony/   │
└─────────────┘     └─────────────┘     │ scvi/CCA   │
                                        └──────┬──────┘
                                               │
                                               ▼
                                    ┌─────────────┐
                                    │  Leiden     │
                                    │  聚类       │
                                    └──────┬──────┘
                                           │
                                           ▼
                              ┌────────────────────────┐
                              │  细胞类型注释            │
                              │  celltypist/marker/    │
                              │  manual               │
                              └───────────┬────────────┘
                                          │
                                          ▼
                               ┌─────────────────────┐
                               │  UMAP + 报告生成    │
                               │  HTML + CSV         │
                               └─────────────────────┘
```

## 错误恢复

| 错误场景 | 恢复策略 |
|----------|----------|
| 过滤后细胞数过少 | 降低 min_genes / min_cells 阈值 |
| AnnData / RDS 文件缺失 | 提示用户提供上游 QC 输出 |
| 无法检测批次效应 | 跳过整合步骤 |
| CellTypist 模型不匹配 | 自动降级到 scanpy-marker |
| 无显著通讯对 | 放宽阈值或输出空表 |

## 依赖环境

### Python 运行时（biof3-py-runtime）

- Python >= 3.10
- scanpy >= 1.9
- anndata >= 0.9
- numpy, pandas, scipy
- matplotlib, seaborn
- celltypist >= 1.6（可选）
- scvi-tools >= 1.0（可选）
- torch >= 2.0（scvi-tools 可选）

### R 运行时（biof3-r-runtime）

- R >= 4.4.0
- Seurat >= 5.0.0
- SeuratObject >= 5.0.0
- ggplot2, patchwork, dplyr
- CellChat >= 1.6（R 版可选）

## 已知限制

- CellTypist 预训练模型需与物种匹配
- scvi-tools 在 CPU 上训练较慢（建议 batch_size=64, max_epochs=5）
- CellChat 需要足够的细胞数（建议 >100）

## 许可证

MIT License

## 作者

BioF3 Team

## 版本历史

- **1.0.0** (2026-08-18): 初始版本
