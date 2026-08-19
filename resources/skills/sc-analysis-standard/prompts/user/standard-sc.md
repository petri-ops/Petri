# 用户 Prompt 模板：标准单细胞分析

## 模板变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `{{anndata_file}}` | AnnData 文件路径（.h5ad） | `pbmc_3k.h5ad` |
| `{{species}}` | 物种 | `human` / `mouse` |
| `{{cell_type_column}}` | 细胞类型注释结果列名 | `cell_type` |
| `{{qc_method}}` | QC 方法 | `scanpy` / `seurat` |
| `{{integration_method}}` | 整合方法 | `none` / `harmony` / `scvi` / `seurat-cca` |
| `{{annotation_method}}` | 注释方法 | `scanpy-marker` / `celltypist` / `manual` |
| `{{run_cell_cell_communication}}` | 是否运行通讯分析 | `true` / `false` |
| `{{min_genes}}` | 每细胞最少基因数 | `200` |
| `{{min_cells}}` | 基因最少检出细胞数 | `3` |
| `{{n_hvg}}` | 高变异基因数量 | `2000` |
| `{{resolution}}` | 聚类分辨率 | `0.5` |
| `{{batch_key}}` | 批次标识列名 | `batch` |

---

## 标准单细胞分析

请对 **{{anndata_file}}** 数据集进行标准的端到端单细胞分析：

### 1. 数据输入
- AnnData 文件：`{{anndata_file}}`
- 物种：{{species}}
- 批次标识列（可选）：{{batch_key}}

### 2. 分析参数
- QC 方法：`{{qc_method}}`
- 批次整合：`{{integration_method}}`
- 细胞注释：`{{annotation_method}}`
- 细胞通讯：{{run_cell_cell_communication}}
- 最小基因数：`{{min_genes}}`
- 最小细胞数：`{{min_cells}}`
- HVG 数量：`{{n_hvg}}`
- 聚类分辨率：`{{resolution}}`

### 3. 分析流程

#### Phase 1: QC 与预处理
- 导入数据，评估基本统计（n_genes, n_counts, pct_mito）
- 过滤低质量细胞：min_genes={{min_genes}}, min_cells={{min_cells}}
- 计算线粒体基因比例，过滤高占比细胞（如 >20%）
- 归一化：normalize_total + log1p（scanpy）或 NormalizeData（seurat）
- 选择高变异基因：n_top_genes={{n_hvg}}

#### Phase 2: 批次整合（当 {{integration_method}} != "none" 时）
- PCA 降维
- 根据 {{integration_method}} 选择整合策略：
  - `seurat-cca`：运行 Seurat CCA 整合
  - `harmony`：运行 Harmony 整合
  - `scvi`：训练 scVI 模型并使用隐空间
- 整合后重新计算 UMAP

#### Phase 3: 聚类与注释
- 构建邻居图（基于 PCA / 整合后隐空间）
- Leiden 聚类（resolution={{resolution}}）
- UMAP 可视化
- 细胞类型注释：
  - `celltypist`：使用 {{species}} 预训练模型
  - `scanpy-marker`：运行 FindMarkers / rank_genes_groups，基于标记基因注释
  - `manual`：基于已知标记基因手动指定

#### Phase 4: 细胞通讯（可选）
- 若 {{run_cell_cell_communication}} == true：
  - 使用 CellChat 推断配体-受体相互作用
  - 物种：{{species}}
  - 输出通讯热图和弦图

#### Phase 5: 报告生成
- 生成 HTML 分析报告
- 导出注释结果表（CSV）

### 4. 输出要求
- QC 报告（HTML）
- UMAP 图（PNG, 300 DPI，按聚类 / 细胞类型着色）
- 细胞类型注释表（CSV：cell_id, leiden, cell_type, score, annotation_method）
- 标记基因表（CSV）
- 整合后 AnnData（含 UMAP / leiden / cell_type 列）
- 细胞通讯结果（可选，CSV + 热图 + 弦图）

---

## 示例用法

### 示例 1：人类 PBMC 标准分析

```
请对 pbmc_3k.h5ad 进行标准单细胞分析：

1. 物种：human
2. 使用 scanpy 进行 QC 和预处理
3. 不做批次整合（该数据无批次效应）
4. 使用 celltypist 自动注释细胞类型
5. 运行细胞通讯分析
6. 参数：
   - min_genes: 200
   - min_cells: 3
   - n_hvg: 2000
   - resolution: 0.5
```

**预期输出**：
- 约 2635 个高质量细胞，3-6 种细胞类型（CD4 T / CD8 T / B / NK / Mono / DC）
- 常见 PBMC 标记基因：CD3D (T), CD19 (B), MS4A1 (B), CD14 (Mono), GNLY (NK)
- 细胞通讯：CD40LG-CD40 (T-B interaction), CCL5-CCR5 (T-NK interaction)

### 示例 2：小鼠胚胎数据集批次整合

```
请对小鼠胚胎数据 mouse_embryo.h5ad 进行批次整合分析：

1. 物种：mouse
2. 使用 scanpy 进行 QC
3. 使用 harmony 进行批次整合（batch_key: "sample_id"）
4. 使用 celltypist 注释（模型：Mouse_All_Tissue.pkl）
5. 不单独运行细胞通讯（已在其他分析中处理）
6. 参数：
   - min_genes: 300
   - min_cells: 5
   - n_hvg: 3000
   - resolution: 0.8
```

**预期输出**：
- 多批次数据整合后批次效应校正
- 小鼠胚胎各组织细胞类型：Epi, Mesoderm, Endoderm, ExE 等
- 整合后 UMAP 展示连续发育轨迹

### 示例 3：快速 QC 仅模式

```
请对 scQC_only.h5ad 进行快速 QC 分析（仅质控，不做注释）：

1. 使用默认参数运行 QC
2. 不做批次整合
3. 不运行细胞通讯
4. 使用 scanpy-marker 进行快速聚类注释
5. 参数：
   - min_genes: 200
   - min_cells: 3
   - n_hvg: 1000
   - resolution: 0.4
```

**适用场景**：
- 上游快速评估数据质量
- 预览聚类结构后再决定是否运行深度分析

---

## 工作流程图

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  数据导入    │ ──▶ │  QC 过滤    │ ──▶ │  归一化     │
│  AnnData    │     │  min_genes  │     │  log1p     │
│  .h5ad     │     │  min_cells  │     │            │
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

---

## 注意事项

- **数据格式**：确保输入为有效的 `.h5ad` 文件（AnnData 格式）
- **物种匹配**：CellTypist 模型必须与物种匹配（human/mouse）
- **批次效应**：如有多个批次数据，建议使用整合方法
- **细胞数**：建议每个样本至少 100 个高质量细胞
- **基因数**：人类 PBMC 通常 200-6000 基因/细胞；低于 200 可能质量较差
- **批次效应**：Harmony 适合快速整合；scVI 适合非线性批次校正；seurat-cca 适合跨平台数据

---

## 插件依赖关系

| 分析步骤 | 必需插件 | 可选插件 |
|----------|----------|----------|
| QC + 预处理 | `scanpy-advanced` 或 `seurat-standard` | - |
| 批次整合 | - | `scvi-tools`（scvi 方法） |
| 细胞注释 | - | `celltypist` |
| 细胞通讯 | - | `cellchat` |
