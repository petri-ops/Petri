// ============================================================
// Data model for scRNA analysis platform
// ============================================================

export type AnalysisStatus = 'pending' | 'running' | 'done' | 'failed' | 'queued';

export type AnalysisType =
  | 'scrna_standard'
  | 'recluster'
  | 'deg'
  | 'enrichment'
  | 'cell_annotation'
  | 'scrna_integration'
  | 'trajectory'
  | 'communication'
  | 'velocity'
  | 'spatial'
  | 'multimodal'
  | 'cnv_inference'
  | 'gene_regulatory'
  | 'cell_cycle'
  | 'doublet_detection';

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  isPublic?: boolean;
}

export interface Dataset {
  id: string;
  projectId: string;
  name: string; // original filename
  ossUrl: string;
  size: number;
  uploadedAt: string;
  description?: string;
  // Inferred stats (optional, populated from first analysis)
  nCells?: number;
  nGenes?: number;
  // Pre-extracted tables (populated after standard analysis)
  metaUrl?: string; // metadata.csv URL on OSS
  featuresUrl?: string; // features.csv URL on OSS
  // Parent dataset (for subsets)
  parentDatasetId?: string;
  // Merged dataset (multiple sources)
  sourceDatasetIds?: string[];
}

export interface Analysis {
  id: string;
  datasetId: string;
  taskId: string; // R server task ID
  type: AnalysisType;
  name: string; // user-facing name, e.g. "标准分析 v1"
  parentAnalysisId?: string; // DEG/annotation references the standard analysis
  params: Record<string, unknown>;
  status: AnalysisStatus;
  summary?: Record<string, unknown>; // from R server results.summary
  results?: { plots?: unknown[]; files?: unknown[]; summary?: Record<string, unknown> }; // full persisted results
  error?: string;
  createdAt: string;
  finishedAt?: string;
}

// ============================================================
// Subsets & cell labels
// ============================================================

export interface Subset {
  id: string;
  datasetId: string;
  name: string;
  description?: string;
  cellIds: string[];
  nCells: number;
  createdAt: string;
}

export interface LabelGroup {
  id: string;
  value: string;
  cells: number;
  createdAt: string;
}

/** Cell labels grouped by label_name — { tumor_focus: [{value: 'yes', cells: 100, ...}], ... } */
export type LabelsSummary = Record<string, LabelGroup[]>;

// ============================================================
// Analysis type metadata
// ============================================================

export const ANALYSIS_TYPES: Record<
  AnalysisType,
  {
    name: string;
    shortName: string;
    desc: string;
    icon: string; // emoji or short string
    color: string; // badge color
    requiresResult: boolean; // true = requires parent analysis result (Seurat .rds)
    intro: string; // tool introduction (shown in modal)
    input: string; // what input it needs
    output: string; // what it produces
    packages: string[]; // R packages used
  }
> = {
  scrna_standard: {
    name: 'scRNA 标准分析',
    shortName: '标准分析',
    desc: 'QC · 降维 · 聚类 · Marker',
    icon: 'S',
    color: '#0f766e',
    requiresResult: false,
    intro:
      '从原始表达矩阵出发，完成质量控制、归一化、高变基因选择、PCA 降维、UMAP 可视化、聚类和 Marker 基因鉴定。这是所有下游分析的起点。',
    input: '10x 表达矩阵（.h5 / .rds / matrix.mtx）',
    output: 'Seurat 对象 (.rds)、UMAP 图、QC 图、Marker 列表',
    packages: ['Seurat', 'ggplot2'],
  },
  recluster: {
    name: '降维聚类',
    shortName: '降维聚类',
    desc: 'PCA · UMAP · 聚类 · Marker',
    icon: 'R',
    color: '#0f766e',
    requiresResult: true,
    intro:
      '对已有的 Seurat 对象重新进行 PCA 降维、UMAP 可视化和聚类分析。适用于子集数据或需要调整聚类参数的场景。跳过 QC 步骤。',
    input: '已有的 Seurat 对象（来自标准分析或子集）',
    output: 'Seurat 对象 (.rds)、UMAP 图、Marker 列表',
    packages: ['Seurat', 'ggplot2'],
  },
  deg: {
    name: '差异表达',
    shortName: 'DEG',
    desc: 'DESeq2 / Wilcoxon',
    icon: 'D',
    color: '#dc2626',
    requiresResult: false,
    intro:
      '比较两组细胞（或两个 cluster）之间的基因表达差异，找出显著上调/下调的基因。支持 Wilcoxon 秩和检验（单细胞推荐）和 DESeq2（bulk-like 伪批量）。',
    input: 'Seurat 对象 + 分组信息',
    output: '差异基因列表、火山图、热图',
    packages: ['Seurat', 'DESeq2', 'ggplot2'],
  },
  enrichment: {
    name: '富集分析',
    shortName: '富集',
    desc: 'GO / KEGG / GSEA',
    icon: 'E',
    color: '#7c3aed',
    requiresResult: false,
    intro:
      '对差异基因列表做功能富集，回答"这些基因集中参与了哪些生物学过程/通路"。支持 GO（BP/MF/CC）、KEGG 通路和 GSEA 排序富集。',
    input: '差异基因列表（或全基因 logFC 排序）',
    output: 'GO/KEGG 气泡图、条形图、富集结果表',
    packages: ['clusterProfiler', 'org.Hs.eg.db', 'enrichplot'],
  },
  cell_annotation: {
    name: '细胞注释',
    shortName: '注释',
    desc: 'SingleR',
    icon: 'A',
    color: '#ea580c',
    requiresResult: true,
    intro:
      '使用 SingleR 算法，将每个细胞与参考数据集（如 HumanPrimaryCellAtlas）比对，自动识别细胞类型。无需手动查 marker。',
    input: '已聚类的 Seurat 对象',
    output: '注释后的 UMAP 图、细胞类型比例表',
    packages: ['SingleR', 'celldex', 'Seurat'],
  },
  scrna_integration: {
    name: '多样本整合',
    shortName: '整合',
    desc: 'Harmony / CCA',
    icon: 'I',
    color: '#0891b2',
    requiresResult: false,
    intro:
      '当数据来自多个样本/批次时，消除技术性批次效应，保留生物学差异。支持 Harmony（快速）、CCA 和 RPCA（Seurat 原生）。',
    input: '多样本的表达矩阵或 Seurat 对象',
    output: '整合后的 UMAP、批次效应对比图',
    packages: ['Seurat', 'harmony'],
  },
  trajectory: {
    name: '轨迹分析',
    shortName: '轨迹',
    desc: 'Monocle3',
    icon: 'T',
    color: '#65a30d',
    requiresResult: true,
    intro:
      '推断细胞的发育/分化轨迹，给每个细胞一个拟时序（pseudotime）值。适用于发育、分化、应激响应等连续过程。',
    input: '已聚类的 Seurat 对象',
    output: '轨迹图、拟时序着色图',
    packages: ['monocle3', 'SeuratWrappers'],
  },
  communication: {
    name: '细胞通讯',
    shortName: '通讯',
    desc: 'CellChat',
    icon: 'C',
    color: '#db2777',
    requiresResult: true,
    intro:
      '基于配体-受体数据库，推断不同细胞类型之间的信号传导。识别哪些细胞对在"对话"，通过哪些信号通路。',
    input: '已注释的 Seurat 对象',
    output: '互作网络图、信号通路热图、配体-受体对列表',
    packages: ['CellChat', 'Seurat'],
  },
  velocity: {
    name: 'RNA Velocity',
    shortName: '速率',
    desc: 'scVelo / Velocyto',
    icon: 'V',
    color: '#059669',
    requiresResult: true,
    intro: '利用剪接/未剪接 RNA 比例推断细胞状态变化的方向和速度，预测细胞未来的转录状态。',
    input: '已聚类的 Seurat 对象 + loom 文件',
    output: '速率流场图、latent time',
    packages: ['scVelo', 'velocyto.R'],
  },
  spatial: {
    name: '空间转录组',
    shortName: '空间',
    desc: 'Seurat Spatial / Squidpy',
    icon: 'P',
    color: '#7c2d12',
    requiresResult: false,
    intro:
      '分析带有空间坐标的转录组数据（10x Visium、MERFISH 等），识别空间基因表达模式和组织结构。',
    input: '空间转录组数据（Visium .h5 + 图像）',
    output: '空间基因表达图、空间聚类、配体-受体空间共定位',
    packages: ['Seurat', 'Squidpy', 'SpatialExperiment'],
  },
  multimodal: {
    name: '多模态整合',
    shortName: '多模态',
    desc: 'WNN / MOFA',
    icon: 'M',
    color: '#4338ca',
    requiresResult: true,
    intro:
      '整合同一细胞的多种组学数据（如 CITE-seq 的 RNA + 蛋白、Multiome 的 RNA + ATAC），构建统一的细胞表征。',
    input: '多模态数据（RNA + ADT / RNA + ATAC）',
    output: '加权最近邻图、多模态 UMAP、模态贡献分析',
    packages: ['Seurat WNN', 'MOFA2', 'ArchR'],
  },
  cnv_inference: {
    name: 'CNV 推断',
    shortName: 'CNV',
    desc: 'inferCNV / CopyKAT',
    icon: 'N',
    color: '#92400e',
    requiresResult: true,
    intro: '从单细胞转录组数据推断拷贝数变异，区分肿瘤细胞和正常细胞，识别亚克隆结构。',
    input: '已注释的 Seurat 对象（需要正常细胞作参考）',
    output: 'CNV 热图、肿瘤/正常分类、亚克隆树',
    packages: ['inferCNV', 'CopyKAT'],
  },
  gene_regulatory: {
    name: '基因调控网络',
    shortName: 'GRN',
    desc: 'SCENIC / pySCENIC',
    icon: 'G',
    color: '#1e40af',
    requiresResult: true,
    intro: '推断转录因子及其靶基因的调控关系，识别驱动细胞状态的关键调控模块（regulon）。',
    input: '已聚类的 Seurat 对象',
    output: '转录因子活性矩阵、regulon 网络图、AUCell 评分',
    packages: ['SCENIC', 'pySCENIC', 'AUCell'],
  },
  cell_cycle: {
    name: '细胞周期',
    shortName: '周期',
    desc: 'Seurat CellCycleScoring',
    icon: 'Y',
    color: '#6d28d9',
    requiresResult: true,
    intro: '评估每个细胞的细胞周期阶段（G1/S/G2M），可选择回归掉周期效应以聚焦其他生物学差异。',
    input: '已归一化的 Seurat 对象',
    output: '周期评分、周期阶段标注、回归后的数据',
    packages: ['Seurat'],
  },
  doublet_detection: {
    name: '双胞体检测',
    shortName: '双胞体',
    desc: 'DoubletFinder / Scrublet',
    icon: 'X',
    color: '#475569',
    requiresResult: true,
    intro: '识别并标记可能的双胞体（doublet），即两个细胞被错误地捕获为一个 barcode 的情况。',
    input: '已聚类的 Seurat 对象',
    output: '双胞体评分、标记后的数据',
    packages: ['DoubletFinder', 'scDblFinder'],
  },
};

// ============================================================
// Status display
// ============================================================

export const STATUS_LABELS: Record<AnalysisStatus, { label: string; color: string }> = {
  pending: { label: '排队中', color: '#94a3b8' },
  queued: { label: '排队中', color: '#94a3b8' },
  running: { label: '运行中', color: '#f59e0b' },
  done: { label: '已完成', color: '#10b981' },
  failed: { label: '失败', color: '#ef4444' },
};
