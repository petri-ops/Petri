// ============================================================
// Plot metadata — describes each plot's biological meaning,
// scenarios, key parameters, etc. Used by the right-side info panel
// and the online replot feature.
// ============================================================

export interface ReplotConfig {
  /** File name in task results to download (e.g. "result.rds") */
  needsFile: string;
  /** R code that uses the loaded data — variable name is `obj` for rds, `df` for csv */
  code: string;
}

export interface PlotMeta {
  match: string;
  category: string;
  title: string;
  subtitle: string;
  biologicalQuestion: string;
  scenarios: string[];
  inputFormat: string;
  keyParams: string[];
  packages: string[];
  /** Optional: R code template for online replotting */
  replot?: ReplotConfig;
}

export const PLOT_META: PlotMeta[] = [
  {
    match: 'qc_violin',
    category: '质控',
    title: 'QC 小提琴图',
    subtitle: 'Quality Control Violin Plot',
    biologicalQuestion:
      '评估每个细胞的测序质量，识别低质量细胞和潜在的双胞体（doublets），是否需要过滤。',
    scenarios: [
      '初步评估数据质量',
      '确定 QC 过滤阈值',
      '比较多样本间的质量差异',
      '识别异常样本或批次效应',
    ],
    inputFormat: 'Seurat 对象，包含 nFeature_RNA、nCount_RNA、percent.mt 三列 metadata。',
    keyParams: [
      'min.features：每细胞最少基因数（200）',
      'max.features：每细胞最多基因数（5000，去除双胞体）',
      'percent.mt：线粒体比例上限（20%）',
    ],
    packages: ['Seurat', 'ggplot2'],
    replot: {
      needsFile: 'result.rds',
      code: `# QC 小提琴图（自定义）
library(Seurat)
library(ggplot2)

VlnPlot(obj,
  features = c("nFeature_RNA", "nCount_RNA", "percent.mt"),
  ncol = 3,
  pt.size = 0
) & theme_classic(base_size = 11) & NoLegend()`,
    },
  },
  {
    match: 'hvg',
    category: '特征选择',
    title: '高变基因图（HVG）',
    subtitle: 'Highly Variable Features',
    biologicalQuestion:
      '哪些基因在不同细胞间表达差异最大？这些基因最可能反映细胞间的生物学异质性。',
    scenarios: ['降维前的特征选择', '识别细胞类型标记基因候选'],
    inputFormat: '标准化后的 Seurat 对象。',
    keyParams: ['selection.method：vst / mvp / disp', 'nfeatures：选择的高变基因数（默认 2000）'],
    packages: ['Seurat'],
    replot: {
      needsFile: 'result.rds',
      code: `library(Seurat)
library(ggplot2)

# 标记 top 10 高变基因
top10 <- head(VariableFeatures(obj), 10)
p <- VariableFeaturePlot(obj)
LabelPoints(plot = p, points = top10, repel = TRUE) + theme_classic(base_size = 11)`,
    },
  },
  {
    match: 'elbow',
    category: '降维',
    title: 'Elbow 图',
    subtitle: 'PC Elbow Plot',
    biologicalQuestion: '应该使用多少个主成分（PC）来代表数据的主要变异？',
    scenarios: ['决定下游分析的 PC 数量', '评估数据中真实信号的维度'],
    inputFormat: '执行过 RunPCA 的 Seurat 对象。',
    keyParams: ['ndims：展示的 PC 数量（默认 20）'],
    packages: ['Seurat'],
    replot: {
      needsFile: 'result.rds',
      code: `library(Seurat)
library(ggplot2)

ElbowPlot(obj, ndims = 30) + theme_classic(base_size = 12)`,
    },
  },
  {
    match: 'pca',
    category: '降维',
    title: 'PCA 散点图',
    subtitle: 'Principal Component Analysis',
    biologicalQuestion: '细胞在主成分空间中如何分布？是否存在明显的批次效应或样本差异？',
    scenarios: ['初步评估细胞群体结构', '检查批次效应'],
    inputFormat: '执行过 RunPCA 的 Seurat 对象。',
    keyParams: ['dims：展示的两个 PC（默认 PC1 vs PC2）', 'group.by：分组着色变量'],
    packages: ['Seurat', 'ggplot2'],
    replot: {
      needsFile: 'result.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "pca", dims = c(1, 2),
  pt.size = 0.6, label = FALSE
) + theme_classic(base_size = 12)`,
    },
  },
  {
    match: 'umap',
    category: '降维',
    title: 'UMAP 降维图',
    subtitle: 'Uniform Manifold Approximation and Projection',
    biologicalQuestion: '高维转录组数据在二维空间如何组织？哪些细胞构成独立的群体（cluster）？',
    scenarios: ['可视化聚类结果', '展示细胞类型分布', '论文 Figure 1 必备'],
    inputFormat: '执行过 RunUMAP 和 FindClusters 的 Seurat 对象。',
    keyParams: [
      'dims：使用的 PC 数量（1:20）',
      'resolution：聚类分辨率',
      'n.neighbors：邻居数（30）',
    ],
    packages: ['Seurat', 'uwot', 'ggplot2'],
    replot: {
      needsFile: 'result.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "umap",
  label = TRUE, label.size = 4, repel = TRUE,
  pt.size = 0.6
) + theme_classic(base_size = 12) +
  ggtitle(paste0("UMAP (", ncol(obj), " cells, ",
    length(unique(Idents(obj))), " clusters)"))`,
    },
  },
  {
    match: 'heatmap',
    category: '基因表达',
    title: 'Marker 基因热图',
    subtitle: 'Top Marker Genes Heatmap',
    biologicalQuestion: '每个 cluster 的特征基因是什么？这些基因如何区分不同细胞群？',
    scenarios: ['细胞类型注释依据', '论文展示 cluster 特异性基因'],
    inputFormat: '执行过 FindAllMarkers 的 Seurat 对象。',
    keyParams: ['features：要展示的基因（top 3-5 per cluster）', 'min.pct（0.25）'],
    packages: ['Seurat', 'ggplot2'],
    replot: {
      needsFile: 'result.rds',
      code: `library(Seurat)
library(dplyr)

# 重新计算 markers
markers <- FindAllMarkers(obj, only.pos = TRUE,
  min.pct = 0.25, logfc.threshold = 0.25)
top3 <- markers %>% group_by(cluster) %>%
  slice_max(n = 3, order_by = avg_log2FC) %>%
  pull(gene) %>% unique()

DoHeatmap(obj, features = top3) + NoLegend()`,
    },
  },
  // ---- DEG ----
  {
    match: 'volcano',
    category: '差异表达',
    title: '火山图',
    subtitle: 'Volcano Plot',
    biologicalQuestion: '哪些基因在两个条件间显著差异表达？变化倍数和显著性水平如何分布？',
    scenarios: ['差异表达分析的标准展示', '快速识别 top up/down regulated 基因', '论文常见图'],
    inputFormat: '差异表达结果表（含 log2FC、padj 列）。',
    keyParams: ['p.cutoff：显著性阈值（0.05）', 'fc.cutoff：log2 倍数阈值（1.0 = 2 倍）'],
    packages: ['ggplot2', 'EnhancedVolcano'],
    replot: {
      needsFile: 'deg_results.csv',
      code: `library(ggplot2)
library(ggrepel)

# 标记显著基因
df$sig <- "ns"
df$sig[df$padj < 0.05 & df$log2FoldChange > 1.0]  <- "up"
df$sig[df$padj < 0.05 & df$log2FoldChange < -1.0] <- "down"

# 标记 top 基因
top_up   <- head(df[df$sig == "up",   ][order(df$padj[df$sig == "up"]),  ], 5)
top_down <- head(df[df$sig == "down", ][order(df$padj[df$sig == "down"]),], 5)
top <- rbind(top_up, top_down)

ggplot(df, aes(x = log2FoldChange, y = -log10(padj), color = sig)) +
  geom_point(size = 0.8, alpha = 0.6) +
  scale_color_manual(values = c(up = "#dc2626", down = "#2563eb", ns = "#94a3b8")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed", linewidth = 0.3) +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed", linewidth = 0.3) +
  geom_text_repel(data = top, aes(label = gene), size = 3, max.overlaps = 20) +
  labs(x = "log2 Fold Change", y = "-log10(padj)") +
  theme_classic(base_size = 11) + theme(legend.position = "none")`,
    },
  },
  {
    match: 'top_genes',
    category: '差异表达',
    title: 'Top DEGs 柱状图',
    subtitle: 'Top Differentially Expressed Genes',
    biologicalQuestion: '差异最显著的基因有哪些？方向（上调/下调）和幅度如何？',
    scenarios: ['聚焦展示关键基因', '功能验证候选基因筛选'],
    inputFormat: '差异表达结果表（按 padj 排序）。',
    keyParams: ['topN：展示的基因数（每方向 20）'],
    packages: ['ggplot2'],
    replot: {
      needsFile: 'deg_top_genes.csv',
      code: `library(ggplot2)
library(dplyr)

df$sig <- ifelse(df$log2FoldChange > 0, "up", "down")
df$gene <- factor(df$gene, levels = df$gene[order(df$log2FoldChange)])

ggplot(df, aes(x = gene, y = log2FoldChange, fill = sig)) +
  geom_col() +
  scale_fill_manual(values = c(up = "#dc2626", down = "#2563eb")) +
  coord_flip() +
  labs(x = "", y = "log2FC") +
  theme_classic(base_size = 10) +
  theme(legend.position = "none")`,
    },
  },
  {
    match: '_ma',
    category: '差异表达',
    title: 'MA 图',
    subtitle: 'MA Plot',
    biologicalQuestion: '不同表达水平的基因，差异倍数如何分布？',
    scenarios: ['DESeq2 标准诊断图', '识别异常 outlier 基因'],
    inputFormat: 'DESeq2 results 对象。',
    keyParams: ['baseMean（X）', 'log2FoldChange（Y）'],
    packages: ['DESeq2', 'ggplot2'],
    replot: {
      needsFile: 'deg_results.csv',
      code: `library(ggplot2)

df$sig <- "ns"
df$sig[df$padj < 0.05 & df$log2FoldChange > 1.0]  <- "up"
df$sig[df$padj < 0.05 & df$log2FoldChange < -1.0] <- "down"

ggplot(df, aes(x = log10(baseMean + 1), y = log2FoldChange, color = sig)) +
  geom_point(size = 0.6, alpha = 0.5) +
  scale_color_manual(values = c(up = "#dc2626", down = "#2563eb", ns = "#94a3b8")) +
  labs(x = "log10(baseMean)", y = "log2FC") +
  theme_classic(base_size = 11) + theme(legend.position = "none")`,
    },
  },
  // ---- Enrichment ----
  {
    match: 'go_dotplot',
    category: '富集分析',
    title: 'GO 富集气泡图',
    subtitle: 'GO Biological Process Dotplot',
    biologicalQuestion: '差异基因主要富集在哪些生物学过程？哪些通路最显著？',
    scenarios: ['功能注释和机制推断', '论文 Figure 必备'],
    inputFormat: '基因列表（gene symbol 或 Entrez ID）。',
    keyParams: ['pvalueCutoff（0.05）', 'showCategory：展示条目数（15）'],
    packages: ['clusterProfiler', 'org.Hs.eg.db', 'enrichplot'],
    replot: {
      needsFile: 'go_results.csv',
      code: `library(ggplot2)

# 取 top 15
df <- df[order(df$p.adjust), ]
top <- head(df, 15)
top$Description <- factor(top$Description, levels = rev(top$Description))
top$GeneRatio_num <- sapply(strsplit(as.character(top$GeneRatio), "/"),
  function(x) as.numeric(x[1]) / as.numeric(x[2]))

ggplot(top, aes(x = GeneRatio_num, y = Description, size = Count, color = p.adjust)) +
  geom_point() +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  labs(x = "GeneRatio", y = "", title = "GO BP Enrichment") +
  theme_bw(base_size = 11)`,
    },
  },
  {
    match: 'go_barplot',
    category: '富集分析',
    title: 'GO 富集柱状图',
    subtitle: 'GO BP Top Terms',
    biologicalQuestion: '哪些 GO terms 富集最显著？',
    scenarios: ['快速概览富集结果'],
    inputFormat: 'enrichGO 结果对象。',
    keyParams: ['showCategory（15）'],
    packages: ['clusterProfiler', 'enrichplot'],
    replot: {
      needsFile: 'go_results.csv',
      code: `library(ggplot2)

df <- df[order(df$p.adjust), ]
top <- head(df, 15)
top$Description <- factor(top$Description, levels = rev(top$Description))

ggplot(top, aes(x = Count, y = Description, fill = -log10(p.adjust))) +
  geom_col() +
  scale_fill_gradient(low = "#bfdbfe", high = "#1e40af") +
  labs(x = "Gene Count", y = "", title = "GO BP - Top Terms") +
  theme_classic(base_size = 11)`,
    },
  },
  {
    match: 'kegg_dotplot',
    category: '富集分析',
    title: 'KEGG 通路富集图',
    subtitle: 'KEGG Pathway Enrichment',
    biologicalQuestion: '基因列表富集在哪些 KEGG 信号通路？',
    scenarios: ['信号通路分析', '疾病机制推断'],
    inputFormat: '基因列表（建议 Entrez ID）。',
    keyParams: ['organism：物种代号', 'pvalueCutoff'],
    packages: ['clusterProfiler', 'KEGGREST'],
    replot: {
      needsFile: 'kegg_results.csv',
      code: `library(ggplot2)

df <- df[order(df$p.adjust), ]
top <- head(df, 15)
top$Description <- factor(top$Description, levels = rev(top$Description))
top$GeneRatio_num <- sapply(strsplit(as.character(top$GeneRatio), "/"),
  function(x) as.numeric(x[1]) / as.numeric(x[2]))

ggplot(top, aes(x = GeneRatio_num, y = Description, size = Count, color = p.adjust)) +
  geom_point() +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  labs(x = "GeneRatio", y = "", title = "KEGG Pathways") +
  theme_bw(base_size = 11)`,
    },
  },
  {
    match: 'gsea',
    category: '富集分析',
    title: 'GSEA 富集图',
    subtitle: 'Gene Set Enrichment Analysis',
    biologicalQuestion: '考虑所有基因的排序信息后，哪些功能集合显著富集？',
    scenarios: ['不依赖阈值的富集分析', '小幅度但一致变化的通路识别'],
    inputFormat: '带 log2FC 的基因列表。',
    keyParams: ['gseGO / gseKEGG', 'pvalueCutoff'],
    packages: ['clusterProfiler', 'enrichplot'],
    replot: {
      needsFile: 'gsea_results.csv',
      code: `library(ggplot2)

df <- df[order(df$p.adjust), ]
top <- head(df, 15)
top$Description <- factor(top$Description, levels = rev(top$Description))

ggplot(top, aes(x = NES, y = Description, color = p.adjust, size = setSize)) +
  geom_point() +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  geom_vline(xintercept = 0, linetype = "dashed") +
  labs(x = "NES", y = "", title = "GSEA - Top Pathways") +
  theme_bw(base_size = 11)`,
    },
  },
  // ---- Cell annotation ----
  {
    match: 'annotated_umap',
    category: '细胞注释',
    title: '注释 UMAP 图',
    subtitle: 'Annotated Cell Type UMAP',
    biologicalQuestion: '每个 cluster 对应什么已知细胞类型？',
    scenarios: ['免疫细胞分类', '组织特异性细胞识别'],
    inputFormat: '完成 SingleR 注释的 Seurat 对象。',
    keyParams: ['reference', 'labelLevel'],
    packages: ['SingleR', 'celldex', 'Seurat'],
    replot: {
      needsFile: 'result_annotated.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "umap",
  group.by = "singler_labels",
  label = TRUE, label.size = 3, repel = TRUE,
  pt.size = 0.5
) + theme_classic(base_size = 11) +
  theme(legend.position = "right",
    legend.text = element_text(size = 7))`,
    },
  },
  {
    match: 'composition',
    category: '细胞注释',
    title: '细胞组成柱状图',
    subtitle: 'Cell Type Composition',
    biologicalQuestion: '各细胞类型的数量和比例如何？',
    scenarios: ['组织中细胞类型构成', '比较不同条件下的细胞比例'],
    inputFormat: '已注释的 Seurat 对象。',
    keyParams: ['singler_labels'],
    packages: ['ggplot2'],
    replot: {
      needsFile: 'result_annotated.rds',
      code: `library(Seurat)
library(ggplot2)

comp <- as.data.frame(table(obj$singler_labels))
colnames(comp) <- c("CellType", "Count")
comp <- comp[order(-comp$Count), ]
comp$CellType <- factor(comp$CellType, levels = comp$CellType)

ggplot(comp, aes(x = CellType, y = Count, fill = CellType)) +
  geom_col() +
  coord_flip() +
  labs(title = "Cell Type Composition", x = "", y = "Number of Cells") +
  theme_classic(base_size = 10) +
  theme(legend.position = "none")`,
    },
  },
  {
    match: 'score_heatmap',
    category: '细胞注释',
    title: '注释得分热图',
    subtitle: 'SingleR Score Heatmap',
    biologicalQuestion: '每个细胞对各参考类型的相似度得分如何？注释是否可信？',
    scenarios: ['评估注释置信度'],
    inputFormat: 'SingleR prediction 对象。',
    keyParams: ['max.labels'],
    packages: ['SingleR'],
  },
  // ---- Integration ----
  {
    match: 'before_integration',
    category: '多样本整合',
    title: '整合前 UMAP',
    subtitle: 'Before Integration',
    biologicalQuestion: '不同样本/批次的细胞是否分开聚集（即存在批次效应）？',
    scenarios: ['诊断批次效应'],
    inputFormat: '多样本 Seurat 对象。',
    keyParams: ['group.by：批次列名'],
    packages: ['Seurat'],
    replot: {
      needsFile: 'result_integrated.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "umap_before", group.by = "orig.ident",
  pt.size = 0.5
) + ggtitle("Before Integration") + theme_classic(base_size = 11)`,
    },
  },
  {
    match: 'after_integration',
    category: '多样本整合',
    title: '整合后 UMAP',
    subtitle: 'After Integration',
    biologicalQuestion: '整合后批次效应是否被有效消除？',
    scenarios: ['验证整合效果'],
    inputFormat: '执行过 Harmony/CCA 的 Seurat 对象。',
    keyParams: ['整合方法'],
    packages: ['Seurat', 'harmony'],
    replot: {
      needsFile: 'result_integrated.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "umap", group.by = "orig.ident",
  pt.size = 0.5
) + ggtitle("After Integration") + theme_classic(base_size = 11)`,
    },
  },
  {
    match: 'split_batch',
    category: '多样本整合',
    title: '分批次 UMAP',
    subtitle: 'UMAP Split by Batch',
    biologicalQuestion: '每个批次单独看是否一致？',
    scenarios: ['细致检查整合质量'],
    inputFormat: '整合后的 Seurat 对象。',
    keyParams: ['split.by'],
    packages: ['Seurat'],
    replot: {
      needsFile: 'result_integrated.rds',
      code: `library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "umap", split.by = "orig.ident",
  pt.size = 0.4
) + theme_classic(base_size = 10)`,
    },
  },
  // ---- Trajectory ----
  {
    match: 'trajectory_cluster',
    category: '轨迹分析',
    title: '轨迹图（按 cluster）',
    subtitle: 'Trajectory by Cluster',
    biologicalQuestion: '细胞在发育/分化过程中如何连接？',
    scenarios: ['细胞分化路径推断'],
    inputFormat: 'cell_data_set 对象。',
    keyParams: ['learn_graph', 'order_cells'],
    packages: ['monocle3', 'SeuratWrappers'],
  },
  {
    match: 'pseudotime_density',
    category: '轨迹分析',
    title: 'Pseudotime 分布密度',
    subtitle: 'Pseudotime Density by Cluster',
    biologicalQuestion: '不同 cluster 在伪时间轴上的分布如何？',
    scenarios: ['验证轨迹方向', '识别中间态 cluster'],
    inputFormat: 'Pseudotime + cluster 标签。',
    keyParams: ['density 参数'],
    packages: ['ggplot2'],
    replot: {
      needsFile: 'pseudotime_results.csv',
      code: `library(ggplot2)

df <- df[is.finite(df$pseudotime), ]
df$cluster <- factor(df$cluster)

ggplot(df, aes(x = pseudotime, fill = cluster)) +
  geom_density(alpha = 0.5) +
  labs(x = "Pseudotime", y = "Density",
    title = "Pseudotime Distribution by Cluster") +
  theme_classic(base_size = 11)`,
    },
  },
  {
    match: 'pseudotime',
    category: '轨迹分析',
    title: 'Pseudotime 图',
    subtitle: 'Pseudotime Coloring',
    biologicalQuestion: '每个细胞在分化轨迹上的相对位置（伪时间）是多少？',
    scenarios: ['识别早期/晚期细胞', '基因沿轨迹的表达动态'],
    inputFormat: '排序好的 cell_data_set 对象。',
    keyParams: ['root_cells'],
    packages: ['monocle3'],
  },
  // ---- Communication ----
  {
    match: 'interaction_count',
    category: '细胞通讯',
    title: '互作数量热图',
    subtitle: 'Number of Interactions',
    biologicalQuestion: '哪些细胞类型之间存在更多的配体-受体互作？',
    scenarios: ['识别核心通讯细胞'],
    inputFormat: 'CellChat 对象。',
    keyParams: ['min.cells（10）'],
    packages: ['CellChat'],
    replot: {
      needsFile: 'result_cellchat.rds',
      code: `library(CellChat)
# 这里 obj 实际是 cellchat 对象
cellchat <- obj

netVisual_heatmap(cellchat, measure = "count",
  title.name = "Number of Interactions")`,
    },
  },
  {
    match: 'interaction_weight',
    category: '细胞通讯',
    title: '互作强度热图',
    subtitle: 'Interaction Strength',
    biologicalQuestion: '细胞类型间的通讯强度如何？',
    scenarios: ['量化通讯强度'],
    inputFormat: 'CellChat 对象。',
    keyParams: ['type'],
    packages: ['CellChat'],
    replot: {
      needsFile: 'result_cellchat.rds',
      code: `library(CellChat)
cellchat <- obj

netVisual_heatmap(cellchat, measure = "weight",
  title.name = "Interaction Strength")`,
    },
  },
  {
    match: '_bubble',
    category: '细胞通讯',
    title: 'L-R 通讯气泡图',
    subtitle: 'Ligand-Receptor Bubble Plot',
    biologicalQuestion: '具体哪些配体-受体对在哪些细胞类型间显著？',
    scenarios: ['锁定具体的信号分子'],
    inputFormat: 'CellChat 对象。',
    keyParams: ['sources.use', 'targets.use'],
    packages: ['CellChat'],
    replot: {
      needsFile: 'result_cellchat.rds',
      code: `library(CellChat)
cellchat <- obj

n <- length(levels(cellchat@idents))
netVisual_bubble(cellchat,
  sources.use = 1:min(5, n),
  targets.use = 1:min(5, n),
  remove.isolate = TRUE)`,
    },
  },
];

/**
 * Get plot metadata by filename match.
 */
export function getPlotMeta(filename: string): PlotMeta | null {
  const lower = filename.toLowerCase();
  for (const meta of PLOT_META) {
    if (lower.includes(meta.match.toLowerCase())) return meta;
  }
  return null;
}

/**
 * Build full R code for online replotting.
 *
 * Two modes:
 * 1. useReplotService=true: data already loaded in persistent R session,
 *    only return the plotting code (fast, ~3-5 sec)
 * 2. useReplotService=false: include download + readRDS code (legacy, ~10-15 sec)
 *    If cachePath is provided, uses local cache instead of OSS download.
 */
export function buildReplotCode(
  meta: PlotMeta,
  files: Array<{ name: string; url: string }>,
  cachePath?: string | null,
  useReplotService?: boolean
): { code: string; ok: boolean; message?: string } {
  if (!meta.replot) {
    return { code: '', ok: false, message: '该图表暂不支持在线重绘' };
  }

  // Replot service mode — data already loaded as `obj` in R session
  if (useReplotService) {
    const code = `# ============================================================
# 在线重绘 — ${meta.title}
# 数据已在 R 会话内存中加载（变量名: obj）
# 修改下方代码后按 Ctrl+Enter 运行
# ============================================================

${meta.replot.code}
`;
    return { code, ok: true };
  }

  // Legacy mode — download + load (exact name, path suffix, or any .rds containing "result")
  const need = meta.replot!.needsFile;
  const needLower = need.toLowerCase();
  let file =
    files.find((f) => f.name === need) ||
    files.find((f) => f.name?.toLowerCase() === needLower) ||
    files.find((f) => (f.name || '').split('/').pop()?.toLowerCase() === needLower) ||
    files.find((f) => (f.name || '').toLowerCase().endsWith('/' + needLower));
  if (!file && needLower.endsWith('.rds')) {
    file =
      files.find(
        (f) =>
          (f.name || '').toLowerCase().includes('result') &&
          (f.name || '').toLowerCase().endsWith('.rds')
      ) || files.find((f) => (f.name || '').toLowerCase().endsWith('.rds'));
  }
  if (!file) {
    return { code: '', ok: false, message: `找不到所需的数据文件: ${meta.replot.needsFile}` };
  }

  const fileName = meta.replot.needsFile;
  const isRds = fileName.endsWith('.rds');

  let loadCode: string;
  if (isRds && cachePath) {
    loadCode = `# 使用服务器本地缓存（无需下载）
obj <- readRDS("${cachePath}")`;
  } else if (isRds) {
    loadCode = `download.file("${file.url}", "${fileName}", mode = "wb", quiet = TRUE)
obj <- readRDS("${fileName}")`;
  } else {
    loadCode = `download.file("${file.url}", "${fileName}", mode = "wb", quiet = TRUE)
df <- read.csv("${fileName}", stringsAsFactors = FALSE)`;
  }

  const code = `# ============================================================
# 在线重绘 — ${meta.title}
# 修改下方代码后按 Ctrl+Enter 运行
# ============================================================

# 加载分析结果（${fileName}）
${loadCode}

${meta.replot.code}
`;

  return { code, ok: true };
}
