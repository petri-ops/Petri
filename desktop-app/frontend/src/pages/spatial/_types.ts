// ============================================================
// Data model for /spatial platform
//
// 与 /single-cell `_types.ts` 同构（status / Project / Dataset / Analysis 复用语义），
// 仅 AnalysisType 联合类型不同：spatial_* 五类。
// ============================================================

// Reuse status / domain entity types — single-cell 已经定义且字段完全适用空间组学
export type { AnalysisStatus, Project, Dataset, Analysis } from '../single-cell/_types';
export { STATUS_LABELS } from '../single-cell/_types';

// 空间组学分析类型（spec §0、§3.4）
export type SpatialAnalysisType =
  | 'spatial_standard'
  | 'spatial_recluster'
  | 'spatial_svg'
  | 'spatial_deconv'
  | 'spatial_lr';

// ============================================================
// Analysis type metadata
// ============================================================

export const ANALYSIS_TYPES: Record<
  SpatialAnalysisType,
  {
    name: string;
    shortName: string;
    desc: string;
    icon: string;
    color: string;
    requiresResult: boolean; // 需要父分析的 .h5ad
    intro: string;
    input: string;
    output: string;
    packages: string[];
    /** 是否本波次（Wave 3-A）已可用——W3-B 才实现 dispatch */
    available?: boolean;
  }
> = {
  spatial_standard: {
    name: '空间标准分析',
    shortName: '标准分析',
    desc: "QC · 聚类 · UMAP · 邻域富集 · Moran's I",
    icon: 'S',
    color: '#7c2d12',
    requiresResult: false,
    intro:
      "Visium / Stereo-seq / MERFISH 等空间转录组数据的完整起始流程：质控、归一化、HVG、PCA、UMAP、Leiden 聚类、邻域富集 z-score、Moran's I 显著空间高变基因。这是所有下游空间分析的起点。",
    input: '空间转录组 .h5ad（含 obsm["spatial"]，可选 uns["spatial"] 组织底图）',
    output: 'AnnData (.h5ad)、组织切片+spot 着色图、UMAP、邻域富集热图、top SVGs 拼图',
    packages: ['scanpy', 'squidpy', 'anndata'],
    available: true,
  },
  spatial_recluster: {
    name: '空间重聚类',
    shortName: '重聚类',
    desc: '子集重聚类 · UMAP · Marker',
    icon: 'R',
    color: '#7c2d12',
    requiresResult: true,
    intro:
      '从父分析（spatial_standard）的结果中挑选某个 leiden cluster，做更细粒度的子聚类——重新选 HVG / PCA / UMAP / Leiden + 找各子簇的 marker。适合"想看 cluster 3 内部还有没有更细分的细胞类型"这类追问。',
    input: '父分析的 result_spatial.h5ad（含 obs["leiden"]）',
    output: 'AnnData (.h5ad)、子集空间分布 / UMAP / 子簇 marker dotplot / 子集在完整切片中的位置图',
    packages: ['scanpy', 'squidpy'],
    available: true,
  },
  spatial_svg: {
    name: '空间高变基因',
    shortName: 'SVG',
    desc: "Moran's I / Geary's C / Sepal",
    icon: 'V',
    color: '#0891b2',
    requiresResult: true,
    intro:
      '基于已聚类的空间数据，用三种空间统计方法独立检测空间高变基因，再做交集分析（Venn 图 + 综合排名）。Moran\'s I 抓全局自相关；Geary\'s C 抓局部异质；Sepal 基于扩散时间，对图形化模式更敏感。同时被多种方法挑中的基因（"robust SVG"）更可靠，是论文 marker 的优先候选。',
    input: '父分析的 result_spatial.h5ad（含 obsm["spatial"] + obsp["spatial_connectivities"]）',
    output:
      'top_svgs.csv（含三方法 rank/pval）、Top 4 robust SVGs 空间分布图、3 方法 Venn 图、score 相关性散点',
    packages: ['squidpy.gr.spatial_autocorr', 'squidpy.gr.sepal', 'matplotlib-venn'],
    available: true,
  },
  spatial_deconv: {
    name: '细胞解卷积',
    shortName: '解卷积',
    desc: 'Tangram 单细胞 → spot 映射',
    icon: 'D',
    color: '#7c3aed',
    requiresResult: true,
    intro:
      'Visium 等 spot 级数据每个 spot 通常含 1-30 个细胞。Tangram 用单细胞参考（默认小鼠脑 Tasic 2018，21k 细胞含 cell_subclass 标注）反推每个 spot 的细胞类型组成。CPU 模式下中等耗时（几分钟）。结果可指引"哪些细胞类型在哪个解剖区"的下游分析。',
    input: '父分析的 result_spatial.h5ad（含 obsm["spatial"]）+ 内置参考 sc_mouse_cortex',
    output:
      'cell_type_abundance.csv（spots × cell_types）、Top dominant cell type 空间分布、Top 4 abundance heatmap 2×2、组成 stacked bar、co-localization heatmap',
    packages: ['tangram-sc', 'squidpy.datasets.sc_mouse_cortex', 'scanpy'],
    available: true,
  },
  spatial_lr: {
    name: '空间配体-受体',
    shortName: 'LR',
    desc: 'LIANA bivariate 空间感知 LR 互作',
    icon: 'L',
    color: '#db2777',
    requiresResult: true,
    intro:
      '基于 LIANA bivariate 算法的空间感知配体-受体分析。不同于传统 cluster-level cellchat（依赖细胞类型注释），bivariate 方法直接在 spot 物理邻居上计算 LR pair 的 cosine 共现 — 更适合 Visium 等"每 spot 是细胞混合体"的数据。默认用 mouseconsensus 资源（覆盖 cellphonedb / cellchat / connectome / NATMI 等综合 LR 数据库）。',
    input: '父分析的 result_spatial.h5ad（含 obsm["spatial"] + obsp["spatial_connectivities"]）',
    output:
      'top_lr_pairs.csv（每对 LR 的 mean_score / frac_active）、Top-15 显著性 bar、Top-1 LR pair 空间分布、Top-N 分布 boxplot、Top-4 LR pairs 2×2 spatial scatter',
    packages: ['liana', 'squidpy.gr.spatial_neighbors'],
    available: true,
  },
};
