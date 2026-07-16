/**
 * tool-registry.js — TOOL_REGISTRY_v1
 *
 * Single source of truth for all online R / Python tools (deseq2 / go-kegg / ...).
 * Before this file existed, tool metadata was duplicated in 4+ places:
 *   - routes/tools.js getToolConfig()    — script + container
 *   - routes/tools.js toolNames          — display label
 *   - routes/tools.js validateUploadedFiles  — csvTools list, size limits
 *   - src/pages/tools/_data.ts            — frontend display + form
 *   - agent-tools/tool-defs.js            — open_tool whitelist (was implicit *)
 *
 * Adding a new tool meant remembering to update each of those, with no
 * automated check. This file collapses backend-side metadata to one map.
 *
 * Frontend metadata (input forms, output specs, demo data) still lives in
 * `src/pages/tools/_data.ts` — those are UI concerns and the schema is much
 * richer than what the backend needs. Validation that the two are in sync
 * lives in `scripts/validate-tool-registry.mjs`.
 *
 * To add a new online tool:
 *   1. Drop the R/Python script into /opt/biof3-r-server/tool-scripts/<id>.{R,py}
 *   2. Drop the report template at /opt/biof3-r-server/tool-scripts/<id>-report-template.html
 *   3. Add an entry to TOOLS below (display + script + lang + csvInputs)
 *   4. Add a matching entry to src/pages/tools/_data.ts (UI form + outputs)
 *   5. Run `npm run validate:tool-registry` to verify the two are in sync
 */

// Sentinel: any tool not in this list cannot be invoked. Adding a tool to the
// frontend `_data.ts` without adding it here will fail validation.
const TOOLS = {
  'deseq2': {
    displayName: 'DESeq2',
    container: 'omichub_react_backend_1',
    script: 'deseq2.R',
    lang: 'r',
    description: 'Bulk RNA-seq 差异表达分析(DESeq2)',
    csvInputs: ['counts', 'coldata'],
    sizeLimitMB: 100,
  },
  'go-kegg': {
    displayName: 'GO/KEGG ORA',
    container: 'omichub_react_backend_1',
    script: 'go-kegg.R',
    lang: 'r',
    description: 'GO / KEGG 富集分析(超几何检验,clusterProfiler)',
    csvInputs: ['genes'],
    sizeLimitMB: 100,
  },
  'gsea': {
    displayName: 'GSEA',
    container: 'omichub_react_backend_1',
    script: 'gsea.R',
    lang: 'r',
    description: 'Gene Set Enrichment Analysis(GSEA,fgsea/clusterProfiler)',
    csvInputs: ['ranked_list'],
    sizeLimitMB: 100,
  },
  'km-survival': {
    displayName: 'KM 生存',
    container: 'omichub_react_backend_1',
    script: 'km-survival.R',
    lang: 'r',
    description: 'Kaplan-Meier 生存曲线 + log-rank 检验',
    csvInputs: ['expression', 'clinical'],
    sizeLimitMB: 100,
  },
  'lasso-cox': {
    displayName: 'LASSO Cox',
    container: 'omichub_react_backend_1',
    script: 'lasso-cox.R',
    lang: 'r',
    description: 'LASSO Cox 风险评分模型(glmnet + survival)',
    csvInputs: ['expression', 'clinical'],
    sizeLimitMB: 100,
  },
  'bindea-immune': {
    displayName: '免疫浸润',
    container: 'omichub_react_backend_1',
    script: 'bindea-immune.R',
    lang: 'r',
    description: '免疫浸润分析(ssGSEA/CIBERSORT,Bindea 28 类)',
    csvInputs: ['tpm_matrix', 'group_file'],
    sizeLimitMB: 100,
  },
  'wgcna': {
    displayName: 'WGCNA',
    container: 'omichub_react_backend_1',
    script: 'wgcna.R',
    lang: 'r',
    description: '加权基因共表达网络(WGCNA)',
    csvInputs: ['expression', 'traits'],
    sizeLimitMB: 100,
  },
  'complexheatmap': {
    displayName: 'ComplexHeatmap',
    container: 'omichub_react_backend_1',
    script: 'complexheatmap.R',
    lang: 'r',
    description: '复杂热图绘制(ComplexHeatmap)',
    csvInputs: ['matrix', 'annotation'],
    sizeLimitMB: 100,
  },
  'cellchat': {
    displayName: 'CellChat',
    container: 'omichub_react_backend_1',
    script: 'cellchat.R',
    lang: 'r',
    description: '细胞通讯分析(CellChat)',
    csvInputs: ['expression', 'meta'],
    sizeLimitMB: 500,  // single-cell 矩阵较大
  },
  'seurat-standard': {
    displayName: 'Seurat',
    container: 'omichub_react_backend_1',
    script: 'seurat-standard.R',
    lang: 'r',
    description: 'scRNA-seq 标准分析流程(Seurat v5)',
    csvInputs: ['matrix'],
    sizeLimitMB: 500,
  },
  'maftools-mutation': {
    displayName: 'maftools',
    container: 'omichub_react_backend_1',
    script: 'maftools-mutation.R',
    lang: 'r',
    description: '体细胞突变分析(maftools,MAF + signature)',
    csvInputs: ['clinical'],  // maf_file 是二进制 .gz
    sizeLimitMB: 200,
  },
  // ============================================================
  // 机器学习专栏 — Wave 1 占位(2026-05-26)
  // 7 个工具 ID 先就位,后端脚本 + 报告模板将在 Wave 2-4 完成。
  // 当前 comingSoon=true,前端显示占位卡,提交时会被前端拦下。
  // 详细 spec: .kiro/drafts/machine-learning-spec.md
  // ============================================================
  'ml-feature-select': {
    displayName: 'ML 特征选择',
    container: 'omichub_react_backend_1',
    script: 'ml-feature-select.R',
    lang: 'r',
    description: '特征选择 5 法对比(方差 / 单因素 / mRMR / Boruta / RFE)+ 韦恩图共识',
    csvInputs: ['features', 'labels'],
    sizeLimitMB: 100,
  },
  'ml-classifier': {
    displayName: 'ML 分类器',
    container: 'omichub_react_backend_1',
    script: 'ml-classifier.R',
    lang: 'r',
    description: '经典 ML 分类(LR / SVM / RF / XGBoost 4 算法)+ 全套评估(ROC / PR / Calibration / DCA)',
    csvInputs: ['features', 'labels'],
    sizeLimitMB: 100,
  },
  'rsf-survival': {
    displayName: '随机生存森林',
    container: 'omichub_react_backend_1',
    script: 'rsf-survival.R',
    lang: 'r',
    description: '随机生存森林 RSF 预后建模(randomForestSRC + timeROC + VIMP)',
    csvInputs: ['features', 'clinical'],
    sizeLimitMB: 100,
  },
  'shap-explain': {
    displayName: 'SHAP 可解释性',
    container: 'omichub_react_backend_1',
    script: 'shap-explain.R',
    lang: 'r',
    description: 'SHAP 模型可解释性(全局 summary + 单样本 force + 依赖图)',
    csvInputs: [],  // 从上游 ml-classifier 任务导入,不直接上传 CSV
    sizeLimitMB: 100,
  },
  'consensus-cluster': {
    displayName: '一致性聚类',
    container: 'omichub_react_backend_1',
    script: 'consensus-cluster.R',
    lang: 'r',
    description: '无监督亚型发现(ConsensusClusterPlus + CDF + Δarea + Silhouette)',
    csvInputs: ['matrix', 'known_labels'],
    sizeLimitMB: 100,
  },
  'ml-autoencoder': {
    displayName: 'Autoencoder 表征',
    container: 'biof3-py-server',  // py-server 容器,与 r 工具不同
    script: 'ml_autoencoder',  // py-server 是 type 而非脚本路径
    lang: 'python',
    description: '深度学习降维(PyTorch Autoencoder,p → hidden → latent → hidden → p)',
    csvInputs: ['matrix'],
    sizeLimitMB: 200,
  },
  'ml-scvi-annotate': {
    displayName: 'scVI 自动注释',
    container: 'biof3-py-server',
    script: 'scvi_annotation',  // 复用 py-server 现有 task type
    lang: 'python',
    description: '单细胞 scVI 整合 + UMAP/Leiden 聚类(scvi-tools)',
    csvInputs: [],  // h5ad 二进制
    sizeLimitMB: 500,
  },
  // ============================================================
  // 多组学整合专栏 — 第二期补缺(2026-05-28)
  // 4 个工具:mo-mofa / mo-snf(R) + mo-multivi / mo-citeseq(Python)
  // 详细 spec: .kiro/drafts/multi-omics-spec.md
  // ============================================================
  'mo-mofa': {
    displayName: 'MOFA2 因子分析',
    container: 'omichub_react_backend_1',
    script: 'mo-mofa.R',
    lang: 'r',
    description: '多组学因子分析(MOFA2,方差分解 + 因子权重 + 因子散点)',
    csvInputs: ['omics_layer1', 'omics_layer2', 'omics_layer3'],
    sizeLimitMB: 200,
  },
  'mo-snf': {
    displayName: 'SNF 网络融合',
    container: 'omichub_react_backend_1',
    script: 'mo-snf.R',
    lang: 'r',
    description: '相似性网络融合亚型发现(SNFtool,谱聚类 + NMI/ARI 验证)',
    csvInputs: ['omics_layer1', 'omics_layer2'],
    sizeLimitMB: 200,
  },
  'mo-multivi': {
    displayName: 'MultiVI 多模态',
    container: 'biof3-py-server',
    script: 'mo_multivi',
    lang: 'python',
    description: '单细胞多模态整合(scRNA + scATAC,scvi-tools MultiVI)',
    csvInputs: [],  // h5ad 二进制
    sizeLimitMB: 500,
  },
  'mo-citeseq': {
    displayName: 'CITE-seq WNN',
    container: 'biof3-py-server',
    script: 'mo_citeseq',
    lang: 'python',
    description: 'CITE-seq 多模态整合(scRNA + ADT,WNN 加权最近邻)',
    csvInputs: [],  // h5ad 二进制
    sizeLimitMB: 500,
  },
  // ============================================================
  // 空间组学专栏 — Wave 2 (2026-05-28)
  // spec: .kiro/drafts/spatial-spec.md
  // ============================================================
  'spatial-standard': {
    displayName: 'Spatial Standard',
    container: 'biof3-py-server',
    script: 'spatial_standard',  // py-server task type
    lang: 'python',
    description: '空间转录组标准流程(scanpy + Squidpy: QC → 聚类 → UMAP → 邻域富集 → 空间高变基因 Moran\'s I)',
    csvInputs: [],  // .h5ad 二进制
    sizeLimitMB: 500,
  },
  // ============================================================
  // 空间组学专栏 — Wave 4-B (2026-05-29) 三件套高阶工具
  // ============================================================
  'spatial-svg': {
    displayName: '空间高变基因 (SVG)',
    container: 'biof3-py-server',
    script: 'spatial_svg',
    lang: 'python',
    description: '空间高变基因检测(Squidpy: Moran\'s I + Geary\'s C + Sepal 三方法 + 韦恩图共识)',
    csvInputs: [],
    sizeLimitMB: 500,
  },
  'spatial-deconv': {
    displayName: '空间细胞解卷积',
    container: 'biof3-py-server',
    script: 'spatial_deconv',
    lang: 'python',
    description: '基于 Tangram 的细胞类型空间解卷积(单细胞参考集 → 每 spot 细胞类型丰度)',
    csvInputs: [],
    sizeLimitMB: 500,
  },
  'spatial-lr': {
    displayName: '空间配体受体',
    container: 'biof3-py-server',
    script: 'spatial_lr',
    lang: 'python',
    description: 'LIANA 空间感知 bivariate 配体-受体分析(无需细胞注释,直接在邻居 spot 上算 LR 共现)',
    csvInputs: [],
    sizeLimitMB: 500,
  },
};

// Backward compatibility aliases (for old job records / external links)
const TOOL_ALIASES = {
  'enrichment': 'go-kegg',  // 老 ID
};

/** Resolve a tool id (handling aliases). Returns the canonical id, or null if unknown. */
function resolveToolId(toolId) {
  if (!toolId) return null;
  const aliased = TOOL_ALIASES[toolId] || toolId;
  return TOOLS[aliased] ? aliased : null;
}

/** Get full config for a tool (resolves aliases). Null if unknown. */
function getToolConfig(toolId) {
  const id = resolveToolId(toolId);
  return id ? {...TOOLS[id], id} : null;
}

/** Display label for a tool (handles aliases + falls back to id). */
function getToolDisplayName(toolId) {
  const cfg = getToolConfig(toolId);
  return cfg ? cfg.displayName : toolId;
}

/** All canonical tool ids (sorted). Use this when you need to list everything. */
function listToolIds() {
  return Object.keys(TOOLS).sort();
}

/** All tools with their full config (for UI / AI context / validation). */
function listTools() {
  return Object.entries(TOOLS).map(([id, cfg]) => ({id, ...cfg}));
}

/** Tools that accept CSV/TSV inputs (used by tools.js validateUploadedFiles). */
function listCsvTools() {
  return Object.entries(TOOLS)
    .filter(([_, cfg]) => Array.isArray(cfg.csvInputs) && cfg.csvInputs.length > 0)
    .map(([id]) => id);
}

/** Per-tool size limit in MB (defaults to 100). */
function getToolSizeLimitMB(toolId) {
  const cfg = getToolConfig(toolId);
  return cfg ? (cfg.sizeLimitMB || 100) : 100;
}

module.exports = {
  TOOLS,
  TOOL_ALIASES,
  resolveToolId,
  getToolConfig,
  getToolDisplayName,
  listToolIds,
  listTools,
  listCsvTools,
  getToolSizeLimitMB,
};
