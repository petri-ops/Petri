import type { FigCard } from './_data';

export const cards_cluster: FigCard[] = [
  {
    id: 'heatmap',
    figLayout: 'complex',
    title: 'Heatmap',
    subtitle: '表达热图',
    category: '聚类可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk04/02-heatmap-top40.png',
    description: 'Row z-score 归一化的 top DE 基因热图，列按条件排序。',
    inputFormat: '矩阵：gene × sample + 样本注释表',
    biologicalQuestion: '差异基因在各样本间的表达模式是否一致？是否存在共表达模块？',
    scenarios: [
      '展示 top DE 基因的表达模式',
      '样本聚类验证分组',
      '识别共调控基因模块',
      '多组比较的表达全景',
    ],
    keyParams: [
      '展示基因数（top 20-50）',
      '聚类方法（ward.D2 / complete）',
      '距离度量（euclidean / correlation）',
      'z-score 归一化方向（row）',
      '颜色断点范围（-3 到 3）',
    ],
    code: `library(pheatmap)

# --- Demo data ---
set.seed(42)
genes <- paste0("Gene", 1:30)
samples <- paste0("S", 1:8)
mat <- matrix(rnorm(30*8, mean = 8, sd = 2), nrow = 30, dimnames = list(genes, samples))
mat[1:15, 1:4] <- mat[1:15, 1:4] + 3  # Group A upregulated
mat[16:30, 5:8] <- mat[16:30, 5:8] + 3  # Group B upregulated

anno <- data.frame(Group = rep(c("Treatment", "Control"), each = 4), row.names = samples)
mat_z <- t(scale(t(mat)))

# --- Plot ---
pheatmap(mat_z,
  color = colorRampPalette(c("#2563eb","white","#dc2626"))(100),
  breaks = seq(-3, 3, length.out = 101),
  annotation_col = anno,
  show_colnames = TRUE, fontsize_row = 8,
  main = "Top DE Genes Heatmap")`,
    packages: ['pheatmap'],
    slogan: '聚类乱成一锅粥，多半是 normalization 没过关',
    tutorialUrl: '/docs/bulk-rnaseq/module04',
    onlineToolUrl: '/tools?tool=complexheatmap',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/bulk-rnaseq/module03', '/docs/basics/r-ggplot2'],
      learning_outcomes: [
        '能选合适的归一化方向（z-score by row）',
        '会用聚类参数突出共表达模块',
        '能控制颜色断点避免极端值压扁色阶',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sample-cor', '/figcode#volcano'],
    },
  },
  {
    id: 'sample-cor',
    figLayout: 'complex',
    title: 'Correlation Heatmap',
    subtitle: '相关性热图',
    category: '聚类可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk02/03-sample-distance.png',
    description: '样本两两 Pearson/Euclidean 距离热图，检查分组和离群值。',
    inputFormat: '归一化表达矩阵（VST / log2）',
    biologicalQuestion: '样本之间的整体相似性如何？是否存在批次效应或离群样本？',
    scenarios: ['RNA-seq 实验质控', '检测批次效应', '识别离群样本', '验证生物学重复一致性'],
    keyParams: [
      '距离度量（euclidean / pearson / spearman）',
      '归一化方法（VST / rlog）',
      '颜色梯度（Blues / RdBu）',
      '是否显示数值标签',
    ],
    code: `library(pheatmap)
library(RColorBrewer)

# --- Demo data ---
set.seed(42)
samples <- paste0("S", 1:8)
mat <- matrix(rnorm(5000*8, mean = 10, sd = 3), nrow = 5000, dimnames = list(NULL, samples))
# Add batch effect to first 4 samples
mat[, 1:4] <- mat[, 1:4] + 1.5

anno <- data.frame(
  Group = rep(c("Treatment", "Control"), each = 4),
  row.names = samples
)

d <- dist(t(mat))

# --- Plot ---
pheatmap(as.matrix(d),
  clustering_distance_rows = d,
  clustering_distance_cols = d,
  annotation_row = anno,
  col = colorRampPalette(rev(brewer.pal(9, "Blues")))(255),
  main = "Sample Distance Heatmap")`,
    packages: ['pheatmap', 'RColorBrewer'],
    slogan: '重复样本都不相关，钱花哪儿了',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 8,
      prerequisites: ['/docs/bulk-rnaseq/module02'],
      learning_outcomes: [
        '能用样本相关性热图发现批次效应或离群样本',
        '会用 RColorBrewer 调色方案突出分组',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pca', '/figcode#combat-pca'],
    },
  },
  {
    id: 'cluster-trajectory',
    figLayout: 'wide',
    title: 'Cluster Trajectories',
    subtitle: '聚类轨迹图',
    category: '聚类可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk05/04-cluster-trajectories.png',
    description: '将时间序列基因按表达模式聚类，每个 cluster 展示成员基因轨迹和均值趋势。',
    inputFormat: '时间序列表达矩阵 + 聚类结果',
    biologicalQuestion: '时间序列数据中存在几种主要的表达变化模式？各模式包含哪些功能基因？',
    scenarios: [
      'Mfuzz / TCseq 聚类结果展示',
      '时间序列基因共表达模块',
      '发育阶段表达模式分类',
      '药物响应动态模式识别',
    ],
    keyParams: [
      'k 聚类数（4-12）',
      'membership 模糊隶属度阈值',
      'min.std 最小标准差过滤',
      'color 聚类配色方案',
      'alpha 成员基因透明度',
    ],
    code: `library(ggplot2)

# --- Demo: simulate clustered time-series ---
set.seed(42)
time_points <- paste0("T", 1:6)
n_genes <- 60
k <- 4

# Define cluster patterns
patterns <- matrix(c(
  0, 1, 2, 2, 1, 0,   # Transient up
  2, 1.5, 1, 0.5, 0, 0, # Early decay
  0, 0, 0.5, 1, 1.5, 2, # Late rise
  1, 1, 1, 1, 1, 1      # Stable
), nrow = k, byrow = TRUE)

cluster_assign <- rep(1:k, each = n_genes/k)
mat <- matrix(0, nrow = n_genes, ncol = 6)
for (i in 1:n_genes) {
  mat[i, ] <- patterns[cluster_assign[i], ] + rnorm(6, 0, 0.3)
}

df <- data.frame(
  gene = rep(paste0("G", 1:n_genes), each = 6),
  time = rep(1:6, times = n_genes),
  expr = as.vector(t(mat)),
  cluster = rep(paste0("Cluster ", cluster_assign), each = 6)
)

# --- Plot ---
ggplot(df, aes(x = time, y = expr, group = gene)) +
  geom_line(alpha = 0.3, color = "grey50") +
  stat_summary(aes(group = cluster, color = cluster), fun = mean,
               geom = "line", linewidth = 2) +
  facet_wrap(~ cluster, nrow = 2) +
  scale_x_continuous(breaks = 1:6, labels = time_points) +
  labs(x = "Time Point", y = "Scaled Expression", title = "Time-Series Clustering") +
  theme_classic() +
  theme(legend.position = "none")`,
    packages: ['ggplot2'],
    slogan: '一起涨一起跌的基因，多半在一个群里',
    tutorialUrl: '/docs/bulk-rnaseq/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/docs/bulk-rnaseq/module05'],
      learning_outcomes: ['会按时序聚类把相似变化模式的基因归类', '能展示每个聚类的代表性轨迹'],
      hands_on: true,
      related_concepts: ['/figcode#time-trajectory', '/figcode#heatmap'],
    },
  },
  {
    id: 'py-dotplot-scanpy',
    figLayout: 'complex',
    title: 'Scanpy Dotplot',
    subtitle: 'Marker 气泡图',
    category: '聚类可视化',
    image: '/img/figcode/py-dotplot-scanpy.png',
    description: '用 Scanpy 绘制 marker 基因在各 cluster 中的表达气泡图。',
    inputFormat: 'AnnData 对象 + marker 基因列表',
    biologicalQuestion: '各细胞亚群的 marker 基因表达模式是否符合预期？',
    scenarios: ['细胞类型注释验证', 'marker 基因表达模式展示', '多 cluster 基因表达对比'],
    keyParams: [
      'var_names marker 基因列表',
      'groupby 分组变量',
      'standard_scale 标准化方向',
      'color_map 颜色映射',
    ],
    language: 'python',
    code: `import scanpy as sc
import numpy as np
import anndata as ad
import matplotlib.pyplot as plt

# --- Demo data ---
np.random.seed(42)
n_cells, n_genes = 300, 20
X = np.random.rand(n_cells, n_genes)
adata = ad.AnnData(X)
adata.var_names = [f"Marker_{i}" for i in range(n_genes)]
adata.obs["cluster"] = np.random.choice(["T cell", "B cell", "Monocyte", "NK", "DC"], n_cells)

# Simulate marker expression patterns
for i, ct in enumerate(["T cell", "B cell", "Monocyte", "NK", "DC"]):
    mask = adata.obs["cluster"] == ct
    adata.X[mask, i*4:(i+1)*4] += 3  # Each type has 4 marker genes

# --- Plot ---
markers = {
    "T cell": ["Marker_0", "Marker_1", "Marker_2", "Marker_3"],
    "B cell": ["Marker_4", "Marker_5", "Marker_6", "Marker_7"],
    "Monocyte": ["Marker_8", "Marker_9", "Marker_10", "Marker_11"],
    "NK": ["Marker_12", "Marker_13", "Marker_14", "Marker_15"],
    "DC": ["Marker_16", "Marker_17", "Marker_18", "Marker_19"],
}
sc.pl.dotplot(adata, var_names=markers, groupby="cluster",
              standard_scale="var", show=False)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print("Dotplot done")`,
    packages: ['scanpy', 'anndata', 'matplotlib'],
    slogan: '气泡大小看比例，颜色深浅看表达',
    copilot: {
      domain: 'single-cell',
      level: 'intermediate',
      estimated_minutes: 8,
      learning_outcomes: [
        '会用 sc.pl.dotplot 展示 marker 基因在各 cluster 的表达',
        '能用 dict 格式按细胞类型分组展示 markers',
      ],
      hands_on: true,
    },
  },
  {
    id: 'py-heatmap-clustermap',
    figLayout: 'complex',
    title: 'Clustermap',
    subtitle: '聚类热图',
    category: '聚类可视化',
    image: '/img/figcode/py-heatmap-clustermap.png',
    description: '用 seaborn clustermap 绘制带层次聚类的表达热图。',
    inputFormat: '基因 × 样本矩阵 + 样本注释',
    biologicalQuestion: '差异基因在各样本间的表达模式是否一致？是否存在共表达模块？',
    scenarios: ['差异基因热图展示', '样本聚类验证', '共表达模块识别', 'Python 替代 pheatmap'],
    keyParams: [
      'method 聚类方法（ward）',
      'metric 距离度量（euclidean）',
      'z_score 标准化方向（0=行）',
      'cmap 颜色映射（RdBu_r）',
    ],
    language: 'python',
    code: `import numpy as np
import pandas as pd
import seaborn as sns
import matplotlib.pyplot as plt

# --- Demo data ---
np.random.seed(42)
genes = [f"Gene_{i}" for i in range(30)]
samples = [f"S{i}" for i in range(8)]
data = np.random.randn(30, 8) + 8

# Add group effect
data[:15, :4] += 3   # Group A upregulated
data[15:, 4:] += 3   # Group B upregulated

df = pd.DataFrame(data, index=genes, columns=samples)

# Sample annotation
col_colors = ["#dc2626"]*4 + ["#2563eb"]*4  # Treatment vs Control

# --- Plot ---
g = sns.clustermap(df, z_score=0, cmap="RdBu_r",
                   col_colors=col_colors,
                   figsize=(8, 10),
                   dendrogram_ratio=(0.1, 0.15),
                   cbar_pos=(0.02, 0.8, 0.03, 0.15),
                   method="ward",
                   xticklabels=True, yticklabels=True)
g.ax_heatmap.set_xlabel("")
g.ax_heatmap.set_ylabel("")
g.fig.suptitle("Clustered Heatmap (seaborn)", y=1.02, fontsize=12)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print("Clustermap done: 30 genes × 8 samples")`,
    packages: ['seaborn', 'numpy', 'pandas', 'matplotlib'],
    slogan: 'pheatmap 的 Python 平替，一行搞定聚类热图',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      learning_outcomes: [
        '会用 seaborn clustermap 画带聚类树的热图',
        '能用 z_score 参数控制行/列标准化',
        '会添加样本分组颜色条',
      ],
      hands_on: true,
      related_concepts: ['/figcode#heatmap'],
    },
  },
  {
    id: 'upset',
    figLayout: 'complex',
    title: 'UpSet Plot',
    subtitle: '集合交集图',
    category: '聚类可视化',
    image: '/img/figcode/upset.png',
    description: '可视化多集合的交并差关系，三个以上集合时比维恩图清晰得多。',
    inputFormat: '基因集列表（list of vectors）或 0/1 矩阵',
    biologicalQuestion: '不同分析方法 / 不同条件之间的差异基因有多少交集？哪些是各方法独有？',
    scenarios: [
      'DESeq2 / edgeR / limma 多工具对比',
      '多组比较的差异基因交集',
      '富集结果的通路重叠',
      'Multi-omics 共享 feature',
    ],
    keyParams: [
      'nsets（要展示的集合数量）',
      'order.by = "freq"（按交集大小排序）',
      'mainbar.y.label / sets.x.label',
      'sets.bar.color（每个集合的颜色）',
    ],
    code: `library(UpSetR)

# --- Demo data: gene lists from 4 methods ---
set.seed(42)
all_genes <- paste0("Gene", 1:500)
gene_sets <- list(
  DESeq2 = sample(all_genes, 200),
  edgeR  = sample(all_genes, 220),
  limma  = sample(all_genes, 180),
  NOISeq = sample(all_genes, 160)
)

# --- UpSet plot ---
upset(
  fromList(gene_sets),
  nsets         = 4,
  nintersects   = 15,
  order.by      = "freq",
  decreasing    = TRUE,
  mainbar.y.label = "Intersection size",
  sets.x.label    = "Set size",
  sets.bar.color  = c("#dc2626", "#2563eb", "#059669", "#d97706"),
  matrix.color    = "#0f172a",
  main.bar.color  = "#475569",
  point.size  = 3,
  line.size   = 1,
  text.scale  = c(1.2, 1.1, 1.1, 1, 1.1, 1.1)
)`,
    packages: ['UpSetR'],
    slogan: 'Venn 撑死三集合，交集多了用 UpSet',
    tutorialUrl: '/docs/bulk-rnaseq/module07',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: [],
      learning_outcomes: [
        '能读懂 UpSet 图的矩阵和柱状图',
        '会把基因列表转成 fromList 输入',
        '理解为什么超过 3 个集合时 UpSet 比 Venn 清晰',
      ],
      hands_on: true,
      related_concepts: ['/figcode#volcano'],
    },
  },
  {
    id: 'multi-omics-heatmap',
    figLayout: 'complex',
    title: 'Multi-omics Heatmap',
    subtitle: '多组学整合热图',
    category: '聚类可视化',
    image: '/img/figcode/multi-omics-heatmap.png',
    description: '多 panel 拼接：上面 mRNA、中间蛋白、下面代谢物，列共享样本注释，揭示跨层一致性。',
    inputFormat: '三个矩阵：rna_mat、prot_mat、metab_mat（行 = feature，列 = 样本）+ 样本注释',
    biologicalQuestion: '不同组学层在样本水平上的变化是否一致？哪些样本在多个层面同时异常？',
    scenarios: [
      'CPTAC 蛋白基因组联合',
      'Multi-omics 肿瘤亚型',
      '代谢通路与基因表达对应',
      '药物响应多层联合分析',
    ],
    keyParams: [
      'HeatmapList %v% 垂直拼接',
      'cluster_columns 共享列聚类',
      'top_annotation 共享样本注释',
      'show_row_dend = FALSE 简化外观',
    ],
    code: `library(ComplexHeatmap)
library(circlize)

# --- Demo data: 3 omics layers, same 12 samples ---
set.seed(42)
n_samp <- 12
sample_names <- paste0("S", 1:n_samp)

# Group: 6 tumor + 6 normal
group <- factor(rep(c("Tumor","Normal"), each = 6))

mk_layer <- function(n_feat, label) {
  m <- matrix(rnorm(n_feat * n_samp), nrow = n_feat)
  # Inject group difference
  m[1:floor(n_feat / 2), 1:6] <- m[1:floor(n_feat / 2), 1:6] + 2
  rownames(m) <- paste0(label, "_", 1:n_feat)
  colnames(m) <- sample_names
  m
}
rna   <- mk_layer(20, "Gene")
prot  <- mk_layer(15, "Prot")
metab <- mk_layer(10, "Metab")

# --- Shared column annotation ---
col_anno <- HeatmapAnnotation(
  Group = group,
  col = list(Group = c(Tumor = "#dc2626", Normal = "#2563eb")),
  show_legend = TRUE
)

col_fun <- colorRamp2(c(-2, 0, 2), c("#2563eb", "white", "#dc2626"))

ht1 <- Heatmap(rna, name = "mRNA", col = col_fun,
               top_annotation = col_anno,
               row_title = "mRNA", show_column_names = FALSE,
               show_row_dend = FALSE)
ht2 <- Heatmap(prot, name = "Protein", col = col_fun,
               row_title = "Protein", show_column_names = FALSE,
               show_row_dend = FALSE, show_column_dend = FALSE)
ht3 <- Heatmap(metab, name = "Metabolite", col = col_fun,
               row_title = "Metabolite",
               show_row_dend = FALSE, show_column_dend = FALSE)

draw(ht1 %v% ht2 %v% ht3,
     column_title = "Multi-omics Integration",
     merge_legend = TRUE)`,
    packages: ['ComplexHeatmap', 'circlize'],
    slogan: '基因蛋白代谢叠在一起，多组学一致性一眼看穿',
    tutorialUrl: '/docs/integration/module03',
    onlineToolUrl: '/tools?tool=complexheatmap',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#heatmap', '/docs/integration/module03'],
      learning_outcomes: [
        '理解 ComplexHeatmap 的 %v% 垂直拼接',
        '能让多个 panel 共享列聚类和注释',
        '会为多组学整合数据画出版级图',
      ],
      hands_on: true,
      related_concepts: ['/figcode#heatmap', '/figcode#sample-cor'],
    },
  },
  {
    id: 'wgcna-module-trait',
    figLayout: 'complex',
    title: 'WGCNA Module-Trait',
    subtitle: 'WGCNA 模块-性状',
    category: '聚类可视化',
    image: '/img/figcode/wgcna-module-trait.png',
    description: 'WGCNA 模块特征基因 (ME) 与临床性状的相关性热图，定位"和某性状相关"的关键模块。',
    inputFormat: 'MEs 矩阵（样本 × 模块）+ trait 矩阵（样本 × 性状）',
    biologicalQuestion: '哪些共表达模块与肿瘤分期/生存/突变状态最相关？后续重点研究哪个模块？',
    scenarios: [
      'WGCNA 标准下游分析',
      '肿瘤模块-临床关联',
      '发育时期-基因模块对应',
      '药物处理时间-模块响应',
    ],
    keyParams: [
      'cor.method = "pearson" / "spearman"',
      'textMatrix 在每格写 r 和 p',
      'colorRamp 红蓝对称',
    ],
    code: `library(WGCNA)
library(ComplexHeatmap)
library(circlize)

# --- Demo: 50 样本 × 8 模块 + 4 性状 ---
set.seed(42)
n_samp <- 50
mod_names <- paste0("ME_", c("turquoise","blue","brown","yellow","green","red","black","pink"))
MEs <- matrix(rnorm(n_samp * length(mod_names)), nrow = n_samp,
              dimnames = list(paste0("S", 1:n_samp), mod_names))

traits <- data.frame(
  Stage   = sample(1:4, n_samp, replace = TRUE),
  OS_time = rexp(n_samp, 0.05),
  Status  = rbinom(n_samp, 1, 0.4),
  Age     = sample(40:80, n_samp, replace = TRUE)
)

# --- Compute correlations ---
mod_trait_cor <- cor(MEs, traits, method = "pearson")
mod_trait_p   <- corPvalueStudent(mod_trait_cor, n_samp)

# --- Build text matrix: r (p) ---
text_mat <- matrix(
  paste0(round(mod_trait_cor, 2), "\\n(", signif(mod_trait_p, 1), ")"),
  nrow = nrow(mod_trait_cor)
)

# --- Heatmap ---
col_fun <- colorRamp2(c(-1, 0, 1), c("#2563eb", "white", "#dc2626"))
Heatmap(
  mod_trait_cor,
  name = "Cor (r)",
  col = col_fun,
  cluster_rows = FALSE, cluster_columns = FALSE,
  cell_fun = function(j, i, x, y, w, h, fill) {
    grid::grid.text(text_mat[i, j], x, y,
                    gp = grid::gpar(fontsize = 9))
  },
  column_title = "Module–Trait Relationships",
  row_names_side = "left",
  rect_gp = grid::gpar(col = "white", lwd = 1)
)`,
    packages: ['WGCNA', 'ComplexHeatmap', 'circlize'],
    slogan: '哪个模块跟你想要的性状最铁，一格一格写得清清楚楚',
    tutorialUrl: '/docs/integration/module04',
    onlineToolUrl: '/tools?tool=wgcna',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/docs/integration/module04'],
      learning_outcomes: [
        '理解 module eigengene (ME) 和性状的关联意义',
        '会构造 trait 矩阵（数值化性状）',
        '能在热图中同时显示 r 和 p',
      ],
      hands_on: true,
      related_concepts: ['/figcode#heatmap', '/docs/integration/module04'],
    },
  },
  {
    id: 'sc-marker-bubble',
    figLayout: 'complex',
    title: 'Marker Bubble',
    subtitle: 'Marker 气泡图',
    category: '聚类可视化',
    image: '/img/figcode/sc-marker-bubble.png',
    description:
      'Seurat DotPlot：横轴 marker 基因，纵轴 cluster，点大小 = 表达比例，颜色 = 平均表达。注释 cluster 必备。',
    inputFormat: 'Seurat 对象 + marker 基因列表',
    biologicalQuestion:
      '哪些 marker 在哪些 cluster 中特异表达？这些 cluster 应该注释成什么细胞类型？',
    scenarios: [
      '手动 cluster 注释',
      '已知 marker 验证 cluster',
      '论文 Figure 1B 经典图',
      '多 marker panel 一图汇总',
    ],
    keyParams: [
      'features（marker 基因列表）',
      'cols（min/max 颜色）',
      'dot.scale（点大小缩放）',
      'cluster.idents = TRUE 重排 cluster',
    ],
    code: `library(Seurat)
library(ggplot2)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small

# --- Marker panel ---
markers <- c(
  "CD3D", "CD3E", "CD8A",       # T cells
  "MS4A1", "CD79A",             # B cells
  "LYZ", "CD14", "FCGR3A",      # Monocytes
  "GNLY", "NKG7"                # NK
)
markers <- markers[markers %in% rownames(seu)]

# --- DotPlot ---
DotPlot(
  seu,
  features  = markers,
  cols      = c("#e5e7eb", "#dc2626"),
  dot.scale = 8,
  cluster.idents = TRUE
) +
  RotatedAxis() +
  labs(x = NULL, y = NULL, title = "Cell Type Markers across Clusters") +
  theme(axis.text.x = element_text(face = "italic"))`,
    packages: ['Seurat', 'ggplot2'],
    slogan: '注释细胞类型最快方式：横看 marker，纵看 cluster',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#umap', '/docs/single-cell/module03'],
      learning_outcomes: [
        '能用 DotPlot 一次展示多 marker × 多 cluster',
        '会读"点大小 = pct.expressed，颜色 = avg.exp"',
        '理解 cluster.idents 重排的好处',
      ],
      hands_on: true,
      related_concepts: ['/figcode#umap', '/figcode#py-dotplot-scanpy'],
    },
  },
  {
    id: 'sc-deg-heatmap',
    figLayout: 'complex',
    title: 'Cluster DEG Heatmap',
    subtitle: '聚类 marker 热图',
    category: '聚类可视化',
    image: '/img/figcode/sc-deg-heatmap.png',
    description:
      '每个 cluster 的 top markers 拼成大热图：行 = top markers，列 = 细胞（按 cluster 分块），快速看 marker 特异性。',
    inputFormat: 'Seurat 对象 + FindAllMarkers 结果',
    biologicalQuestion:
      '每个 cluster 的 top marker 是否真的特异？有没有 marker 跨多个 cluster 表达？',
    scenarios: [
      '注释 cluster 后展示 markers',
      '论文补充图 marker 全貌',
      '比较两批数据 marker 一致性',
      'SubCluster 内部异质性检查',
    ],
    keyParams: [
      'top_n（每 cluster 取前 N markers）',
      'group.by = "seurat_clusters"',
      'slot = "scale.data"（z-score）',
      'angle = 0 横排 cluster 标签',
    ],
    code: `library(Seurat)
library(dplyr)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small

# --- Compute markers ---
all_markers <- FindAllMarkers(
  seu, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.25,
  verbose = FALSE
)

top_n <- 5
top_markers <- all_markers %>%
  group_by(cluster) %>%
  slice_max(order_by = avg_log2FC, n = top_n) %>%
  pull(gene) %>% unique()

# --- Heatmap (Seurat built-in) ---
DoHeatmap(
  seu,
  features = top_markers,
  size = 3.5,
  angle = 0
) +
  scale_fill_gradientn(colours = c("#2563eb", "white", "#dc2626")) +
  labs(title = sprintf("Top %d Markers per Cluster", top_n))`,
    packages: ['Seurat', 'dplyr'],
    slogan: 'cluster 注释完拍这张图，marker 特异性一目了然',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/figcode#sc-marker-bubble'],
      learning_outcomes: [
        '会用 FindAllMarkers + slice_max 抽 top markers',
        '理解 DoHeatmap 的 scale.data 是 z-score',
        '能识别"跨 cluster 表达"的非特异 marker',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sc-marker-bubble', '/figcode#heatmap'],
    },
  },
  {
    id: 'alluvial',
    figLayout: 'complex',
    title: 'Alluvial Plot',
    subtitle: '冲积图',
    category: '聚类可视化',
    image: '/img/figcode/alluvial.png',
    description: '多分类变量随时间/条件变化的流动图：每个时间点一列，宽度 = 该类别样本数。',
    inputFormat: '宽表数据框：每行一个个体，每列一个时间点的类别',
    biologicalQuestion: '同一批患者在 3 个随访时间点的疾病状态如何变化？哪些转归路径最常见？',
    scenarios: ['临床纵向随访', '发育时序细胞类型变化', '多步骤分类决策树', '基因表达模块时间动态'],
    keyParams: ['axes（每列一个轴）', 'fill（按某变量着色）', 'curve_type = "sigmoid" / "linear"'],
    code: `library(ggalluvial)
library(ggplot2)
library(dplyr)
library(tidyr)

# --- Demo: 100 患者, 3 个时间点的疾病状态 ---
set.seed(42)
n <- 100
df_wide <- data.frame(
  patient = paste0("P", 1:n),
  T0 = sample(c("Stable","Progressive","Remission"), n, replace = TRUE,
              prob = c(0.5, 0.3, 0.2)),
  T1 = sample(c("Stable","Progressive","Remission"), n, replace = TRUE,
              prob = c(0.4, 0.3, 0.3)),
  T2 = sample(c("Stable","Progressive","Remission","Deceased"), n, replace = TRUE,
              prob = c(0.3, 0.25, 0.3, 0.15))
)

# --- ggalluvial wants long-ish format with frequencies ---
df_count <- df_wide %>%
  count(T0, T1, T2)

# --- Plot ---
ggplot(df_count, aes(axis1 = T0, axis2 = T1, axis3 = T2, y = n)) +
  geom_alluvium(aes(fill = T2), alpha = 0.85) +
  geom_stratum(width = 1/4, fill = "grey95", color = "grey50") +
  geom_text(stat = "stratum", aes(label = after_stat(stratum)),
            size = 3.5) +
  scale_x_discrete(limits = c("Baseline", "3 months", "12 months"),
                   expand = c(0.1, 0.1)) +
  scale_fill_brewer(palette = "Set1") +
  labs(title = "Disease Trajectory (n = 100)",
       y = "Patients", fill = "Final state") +
  theme_minimal()`,
    packages: ['ggalluvial', 'ggplot2', 'dplyr', 'tidyr'],
    slogan: '同一群人随时间走出多少路径，冲积图全画出来',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: [],
      learning_outcomes: [
        '区分 Sankey（任意点对）与 Alluvial（按轴顺序流动）',
        '会把宽表转成 ggalluvial 的频次格式',
        '能用 stratum 和 alluvium 两层语义构图',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sankey'],
    },
  },
  {
    id: 'py-violin-stack',
    figLayout: 'default',
    title: 'Scanpy Stacked Violin',
    subtitle: 'Python 堆叠小提琴',
    category: '聚类可视化',
    image: '/img/figcode/py-violin-stack.png',
    description:
      'Scanpy 堆叠小提琴图：每行一个基因，每列一个 cluster，看 marker 在不同细胞类型中的表达分布。',
    inputFormat: 'AnnData 对象 + marker 基因列表',
    biologicalQuestion: '每个 marker 在各 cluster 的表达分布形状如何？是双峰还是单峰？',
    scenarios: [
      '替代 DotPlot 看分布形状',
      'Bimodal expression 检测',
      '论文 Figure 2 marker 详情图',
      'Scanpy 流程标准图',
    ],
    keyParams: [
      'stripplot = False（不叠 strip）',
      'jitter = False',
      'rotation = 90 旋转 cluster 标签',
      'swap_axes = False',
    ],
    code: `import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo: built-in PBMC 3k ---
adata = sc.datasets.pbmc3k_processed()

# --- Marker panel ---
markers = [
    "CD3D", "CD3E", "CD8A",      # T cells
    "MS4A1", "CD79A",            # B cells
    "LYZ", "CD14",               # Monocytes
    "GNLY", "NKG7",              # NK
    "FCER1A",                    # Dendritic
    "PPBP",                      # Megakaryocyte
]
markers = [m for m in markers if m in adata.var_names]

# --- Stacked violin ---
sc.pl.stacked_violin(
    adata,
    var_names=markers,
    groupby="louvain",
    swap_axes=False,
    figsize=(10, 6),
    cmap="Reds",
    standard_scale="var",
    title="Marker expression — stacked violin",
    save=False, show=False
)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print(f"Plotted {len(markers)} markers across {adata.obs['louvain'].nunique()} clusters")`,
    packages: ['scanpy', 'matplotlib'],
    language: 'python',
    slogan: '每个基因每种细胞的分布形状一图汇总',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/figcode#sc-marker-bubble'],
      learning_outcomes: [
        '能区分 stacked_violin 与 dotplot 的不同信息量',
        '会用 standard_scale="var" 让基因间可比',
        '知道何时用 violin 而不是 bubble（分布形状重要时）',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sc-marker-bubble', '/figcode#py-dotplot-scanpy'],
    },
  },
  {
    id: 'py-rank-heatmap',
    figLayout: 'complex',
    title: 'Scanpy Rank Heatmap',
    subtitle: 'Python 差异 marker 热图',
    category: '聚类可视化',
    image: '/img/figcode/py-rank-heatmap.png',
    description:
      'Scanpy rank_genes_groups 后的 heatmap：每个 cluster 的 top markers 拼成单细胞分辨率热图。',
    inputFormat: 'AnnData 对象（已跑 sc.tl.rank_genes_groups）',
    biologicalQuestion: 'Python 流程下，每个 cluster 的特异 marker 在所有细胞上的分布如何？',
    scenarios: [
      'Scanpy 标准下游',
      '替代 Seurat::DoHeatmap',
      '细胞数大时的高效热图',
      '聚类质量直观验证',
    ],
    keyParams: [
      'n_genes（每 cluster 取前 N）',
      'groupby = "leiden"',
      'show_gene_labels = True',
      'standard_scale = "var"',
    ],
    code: `import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo ---
adata = sc.datasets.pbmc3k_processed()

# --- Find DEGs per cluster ---
sc.tl.rank_genes_groups(adata, "louvain", method="wilcoxon", n_genes=10)

# --- Heatmap ---
sc.pl.rank_genes_groups_heatmap(
    adata,
    n_genes=5,
    groupby="louvain",
    standard_scale="var",
    show_gene_labels=True,
    cmap="RdBu_r",
    figsize=(11, 7),
    save=False, show=False
)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print("Top 5 markers per cluster plotted")`,
    packages: ['scanpy', 'matplotlib'],
    language: 'python',
    slogan: 'Scanpy 一行 rank_genes 出来直接出图',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/figcode#py-violin-stack'],
      learning_outcomes: [
        '会用 sc.tl.rank_genes_groups + heatmap 一条龙',
        '理解 standard_scale="var" 行内归一',
        '能识别 cluster 间互相污染的非特异 marker',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sc-deg-heatmap', '/figcode#py-violin-stack'],
    },
  },
  {
    id: 'scenic-regulon',
    figLayout: 'complex',
    title: 'SCENIC Regulon Heatmap',
    subtitle: 'TF 活性热图',
    category: '聚类可视化',
    image: '/img/figcode/scenic-regulon.png',
    description: 'SCENIC 推断转录因子 (TF) 活性矩阵 → 热图，揭示 cluster 特异的 TF 调控网络。',
    inputFormat: 'SCENIC AUCell 矩阵：行 = regulons (TF)，列 = 细胞',
    biologicalQuestion:
      '每个 cluster 的细胞身份由哪些 TF 主导？驱动这些细胞类型的"主控调控子"是谁？',
    scenarios: [
      '替代 marker 基因的 TF 视角',
      '寻找细胞身份的驱动 TF',
      'Multi-omics 整合 ATAC + RNA',
      '癌症细胞身份重塑研究',
    ],
    keyParams: [
      'top_regulons（每 cluster 取前 N TF）',
      'aggregateby = "cluster"（聚合到 cluster 平均）',
      'col_fun viridis 配色',
    ],
    code: `library(ComplexHeatmap)
library(circlize)

# --- Demo: 简化版（实际使用要先跑完 SCENIC pipeline 拿 AUCell 矩阵） ---
set.seed(42)
n_tf <- 30
n_cluster <- 6
TFs <- paste0(c("CEBPA","SPI1","GATA1","KLF4","IRF8","HOXA9",
                "TAL1","RUNX1","FOXP3","RORC","TBX21","BATF",
                "MYB","JUNB","STAT1","STAT3","NF","RELA",
                "PRDM1","XBP1","BACH2","MAFB","ETS1","CIITA",
                "EOMES","TCF7","BCL6","IRF4","ID2","TFEB"))
clusters <- paste0("C", 1:n_cluster)

# Simulate cluster-specific TF activity
auc_mat <- matrix(rnorm(n_tf * n_cluster, 0, 0.3), nrow = n_tf,
                  dimnames = list(TFs, clusters))
# Inject specificity: each cluster has 3-4 active TFs
for (i in 1:n_cluster) {
  active_tf <- sample(1:n_tf, 4)
  auc_mat[active_tf, i] <- auc_mat[active_tf, i] + 1.5
}

# --- Heatmap ---
col_fun <- colorRamp2(c(-1, 0, 2), c("#2563eb", "white", "#dc2626"))
Heatmap(
  auc_mat,
  name = "AUCell\\nactivity",
  col = col_fun,
  show_row_dend = FALSE,
  cluster_columns = TRUE,
  row_names_gp = grid::gpar(fontsize = 9),
  column_names_gp = grid::gpar(fontsize = 11),
  column_title = "Regulon Activity per Cluster",
  rect_gp = grid::gpar(col = "white", lwd = 0.5)
)`,
    packages: ['ComplexHeatmap', 'circlize'],
    slogan: '每个细胞身份背后是哪些 TF 在主控，热图说话',
    tutorialUrl: '/docs/single-cell/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/docs/single-cell/module07'],
      learning_outcomes: [
        '理解 SCENIC pipeline：GENIE3 → cisTarget → AUCell',
        '能从 regulon AUC 矩阵识别 cluster 特异 TF',
        '知道何时用 TF 视角替代 marker 视角',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sc-deg-heatmap', '/figcode#sc-marker-bubble'],
    },
  },
];
