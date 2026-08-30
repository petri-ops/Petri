/**
 * tool-registry.js — TOOL_REGISTRY_v1
 *
 * Single source of truth for all online R / Python tools (deseq2 / go-kegg / ...).
 * Before this file existed, tool metadata was duplicated in 4+ places:
 *   - routes/tools.js getToolConfig()    — local script + runtime
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
 *   1. Add the R/Python script under core/biof3-server/tool-scripts/<id>.{R,py}
 *   2. Add the report template beside it as <id>-report-template.html
 *   3. Add an entry to TOOLS below (display + script + lang + csvInputs)
 *   4. Add a matching entry to src/pages/tools/_data.ts (UI form + outputs)
 *   5. Run `npm run validate:tool-registry` to verify the two are in sync
 */

// Sentinel: any tool not in this list cannot be invoked. Adding a tool to the
// frontend `_data.ts` without adding it here will fail validation.
const TOOLS = {
  'deseq2': {
    displayName: 'DESeq2',
    script: null,
    lang: 'r',
    pluginOnly: true,
    description: 'Bulk RNA-seq 差异表达分析(DESeq2)',
    csvInputs: ['counts', 'coldata'],
    sizeLimitMB: 100,
  },
  'go-kegg': {
    displayName: 'GO/KEGG ORA',
    script: 'go-kegg.R',
    lang: 'r',
    description: 'GO / KEGG 富集分析(超几何检验,clusterProfiler)',
    csvInputs: ['genes'],
    sizeLimitMB: 100,
  },
  'gsea': {
    displayName: 'GSEA',
    script: 'gsea.R',
    lang: 'r',
    description: 'Gene Set Enrichment Analysis(GSEA,fgsea/clusterProfiler)',
    csvInputs: ['ranked_list'],
    sizeLimitMB: 100,
  },
  'km-survival': {
    displayName: 'KM 生存',
    script: 'km-survival.R',
    lang: 'r',
    description: 'Kaplan-Meier 生存曲线 + log-rank 检验',
    csvInputs: ['expression', 'clinical'],
    sizeLimitMB: 100,
  },
  'lasso-cox': {
    displayName: 'LASSO Cox',
    script: 'lasso-cox.R',
    lang: 'r',
    description: 'LASSO Cox 风险评分模型(glmnet + survival)',
    csvInputs: ['expression', 'clinical'],
    sizeLimitMB: 100,
  },
  'bindea-immune': {
    displayName: '免疫浸润',
    script: 'bindea-immune.R',
    lang: 'r',
    description: '免疫浸润分析(ssGSEA/CIBERSORT,Bindea 28 类)',
    csvInputs: ['tpm_matrix', 'group_file'],
    sizeLimitMB: 100,
  },
  'wgcna': {
    displayName: 'WGCNA',
    script: 'wgcna.R',
    lang: 'r',
    description: '加权基因共表达网络(WGCNA)',
    csvInputs: ['expression', 'traits'],
    sizeLimitMB: 100,
  },
  'complexheatmap': {
    displayName: 'ComplexHeatmap',
    script: 'complexheatmap.R',
    lang: 'r',
    description: '复杂热图绘制(ComplexHeatmap)',
    csvInputs: ['matrix', 'annotation'],
    sizeLimitMB: 100,
  },
  'cellchat': {
    displayName: 'CellChat',
    script: 'cellchat.R',
    lang: 'r',
    description: '细胞通讯分析(CellChat)',
    csvInputs: ['expression', 'meta'],
    sizeLimitMB: 500,  // single-cell 矩阵较大
  },
  'seurat-standard': {
    displayName: 'Seurat',
    script: 'seurat-standard.R',
    lang: 'r',
    description: 'scRNA-seq 标准分析流程(Seurat v5)',
    csvInputs: ['matrix'],
    sizeLimitMB: 500,
  },
  'maftools-mutation': {
    displayName: 'maftools',
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
    script: 'ml-feature-select.R',
    lang: 'r',
    description: '特征选择 5 法对比(方差 / 单因素 / mRMR / Boruta / RFE)+ 韦恩图共识',
    csvInputs: ['features', 'labels'],
    sizeLimitMB: 100,
  },
  'ml-classifier': {
    displayName: 'ML 分类器',
    script: 'ml-classifier.R',
    lang: 'r',
    description: '经典 ML 分类(LR / SVM / RF / XGBoost 4 算法)+ 全套评估(ROC / PR / Calibration / DCA)',
    csvInputs: ['features', 'labels'],
    sizeLimitMB: 100,
  },
  'rsf-survival': {
    displayName: '随机生存森林',
    script: 'rsf-survival.R',
    lang: 'r',
    description: '随机生存森林 RSF 预后建模(randomForestSRC + timeROC + VIMP)',
    csvInputs: ['features', 'clinical'],
    sizeLimitMB: 100,
  },
  'shap-explain': {
    displayName: 'SHAP 可解释性',
    script: 'shap-explain.R',
    lang: 'r',
    description: 'SHAP 模型可解释性(全局 summary + 单样本 force + 依赖图)',
    csvInputs: [],  // 从上游 ml-classifier 任务导入,不直接上传 CSV
    sizeLimitMB: 100,
  },
  'consensus-cluster': {
    displayName: '一致性聚类',
    script: 'consensus-cluster.R',
    lang: 'r',
    description: '无监督亚型发现(ConsensusClusterPlus + CDF + Δarea + Silhouette)',
    csvInputs: ['matrix', 'known_labels'],
    sizeLimitMB: 100,
  },
  'ml-scvi-annotate': {
    displayName: 'scVI 自动注释',
    script: 'scvi_annotation',
    lang: 'python',
    description: '单细胞 scVI 整合 + UMAP/Leiden 聚类(scvi-tools)',
    csvInputs: [],  // h5ad 二进制
    sizeLimitMB: 500,
  },
  // ============================================================
  // 多组学整合专栏 — 第二期补缺(2026-05-28)
  // 本地已实现工具：mo-mofa / mo-snf (R)
  // 详细 spec: .kiro/drafts/multi-omics-spec.md
  // ============================================================
  'mo-mofa': {
    displayName: 'MOFA2 因子分析',
    script: 'mo-mofa.R',
    lang: 'r',
    description: '多组学因子分析(MOFA2,方差分解 + 因子权重 + 因子散点)',
    csvInputs: ['omics_layer1', 'omics_layer2', 'omics_layer3'],
    sizeLimitMB: 200,
  },
  'mo-snf': {
    displayName: 'SNF 网络融合',
    script: 'mo-snf.R',
    lang: 'r',
    description: '相似性网络融合亚型发现(SNFtool,谱聚类 + NMI/ARI 验证)',
    csvInputs: ['omics_layer1', 'omics_layer2'],
    sizeLimitMB: 200,
  },
  // ============================================================
  // 空间组学专栏 — Wave 2 (2026-05-28)
  // spec: .kiro/drafts/spatial-spec.md
  // ============================================================
  'spatial-standard': {
    displayName: 'Spatial Standard',
    script: 'spatial_standard',
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
    script: 'spatial_svg',
    lang: 'python',
    description: '空间高变基因检测(Squidpy: Moran\'s I + Geary\'s C + Sepal 三方法 + 韦恩图共识)',
    csvInputs: [],
    sizeLimitMB: 500,
  },
  'spatial-deconv': {
    displayName: '空间细胞解卷积',
    script: 'spatial_deconv',
    lang: 'python',
    description: '基于 Tangram 的细胞类型空间解卷积(单细胞参考集 → 每 spot 细胞类型丰度)',
    csvInputs: [],
    sizeLimitMB: 500,
  },
  'spatial-lr': {
    displayName: '空间配体受体',
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
