import type { FigCard } from './_data';

export const cards_dimred: FigCard[] = [
  {
    id: 'pca',
    figLayout: 'default',
    title: 'PCA Scatter',
    subtitle: 'PCA 散点图',
    category: '降维可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk02/02-pca.png',
    description: '样本在 PC1/PC2 上的投影，按条件着色。',
    inputFormat: 'DESeqDataSet 或归一化矩阵',
    biologicalQuestion: '样本的主要变异来源是什么？实验分组是否是最大的变异因素？',
    scenarios: [
      'RNA-seq 样本质控与分组验证',
      '检测批次效应',
      '多因素实验设计的变异分解',
      '处理前后样本变化趋势',
    ],
    keyParams: [
      'ntop 用于 PCA 的高变基因数（500）',
      '归一化方法（VST / rlog）',
      '展示的 PC 组合（PC1 vs PC2）',
      'intgroup 分组变量',
      '是否添加置信椭圆',
    ],
    code: `library(ggplot2)
library(ggrepel)

# --- Demo data ---
set.seed(42)
samples <- paste0("S", 1:10)
condition <- rep(c("Treatment", "Control"), each = 5)
# Simulate PCA coordinates
pc1 <- c(rnorm(5, 10, 2), rnorm(5, -10, 2))
pc2 <- rnorm(10, 0, 3)
pca_df <- data.frame(PC1 = pc1, PC2 = pc2, condition = condition, name = samples)
pct <- c(45, 18)  # variance explained

# --- Plot ---
ggplot(pca_df, aes(PC1, PC2, color = condition)) +
  geom_point(size = 4) +
  geom_text_repel(aes(label = name), size = 3) +
  stat_ellipse(level = 0.95, linetype = "dashed") +
  labs(x = paste0("PC1 (", pct[1], "%)"), y = paste0("PC2 (", pct[2], "%)"),
       title = "PCA - Sample Clustering") +
  scale_color_manual(values = c(Treatment="#dc2626", Control="#2563eb")) +
  theme_classic()`,
    packages: ['ggplot2', 'ggrepel'],
    slogan: '分得开是真本事，分不开是真编剧',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 8,
      prerequisites: ['/docs/basics/r-ggplot2'],
      learning_outcomes: [
        '能用 PCA 散点检查样本分组是否符合预期',
        '会用前两个主成分定位离群样本',
        '理解什么时候该看 PC3/PC4',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sample-cor', '/figcode#combat-pca', '/figcode#umap'],
    },
  },
  {
    id: 'umap',
    figLayout: 'default',
    title: 'UMAP',
    subtitle: 'UMAP 聚类图',
    category: '降维可视化',
    image: '/img/tutorial/single-cell/module08/06-wnn-clusters-labeled.png',
    description: '单细胞 UMAP 按 cluster 着色，带标签。',
    inputFormat: 'Seurat 对象（已跑 RunUMAP + FindClusters）',
    biologicalQuestion: '单细胞数据中存在哪些细胞亚群？各亚群之间的关系如何？',
    scenarios: [
      '单细胞聚类结果展示',
      '细胞类型注释可视化',
      '不同样本/条件的细胞分布对比',
      '多模态整合（WNN）降维展示',
    ],
    keyParams: [
      'resolution 聚类分辨率（0.1-2.0）',
      'n.neighbors UMAP 邻居数（30）',
      'min.dist 最小距离（0.3）',
      'dims 使用的 PC 数（1:30）',
      'label.size 标签大小',
    ],
    code: `library(ggplot2)
library(ggrepel)

# --- Demo: simulate UMAP coordinates ---
set.seed(42)
n_cells <- 800
clusters <- sample(paste0("C", 0:7), n_cells, replace = TRUE, prob = c(0.2,0.18,0.15,0.13,0.1,0.1,0.08,0.06))
# Generate cluster centers
centers <- data.frame(
  cluster = paste0("C", 0:7),
  cx = c(-5, 5, 0, -3, 4, -6, 6, 0),
  cy = c(3, 3, -4, -2, -3, -5, 0, 5)
)
umap_df <- data.frame(cluster = clusters)
umap_df <- merge(umap_df, centers, by = "cluster")
umap_df$UMAP1 <- umap_df$cx + rnorm(n_cells, 0, 0.8)
umap_df$UMAP2 <- umap_df$cy + rnorm(n_cells, 0, 0.8)

# Cluster labels at centroids
label_df <- aggregate(cbind(UMAP1, UMAP2) ~ cluster, data = umap_df, FUN = mean)

# --- Plot ---
ggplot(umap_df, aes(x = UMAP1, y = UMAP2, color = cluster)) +
  geom_point(size = 0.5, alpha = 0.7) +
  geom_label_repel(data = label_df, aes(label = cluster), size = 3.5, fontface = "bold") +
  labs(title = "UMAP Clustering", x = "UMAP 1", y = "UMAP 2") +
  theme_classic() +
  theme(legend.position = "none")`,
    packages: ['ggplot2', 'ggrepel'],
    slogan: 'UMAP 上的每个点都是参数调出来的，别太当真',
    tutorialUrl: '/docs/single-cell/module07',
    onlineToolUrl: '/tools?tool=seurat-standard',
    copilot: {
      domain: 'single-cell',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/single-cell/module03'],
      learning_outcomes: [
        '会用 UMAP 二维投影查看细胞亚群',
        '能在 UMAP 上叠加聚类标签或 marker 表达',
      ],
      hands_on: true,
      related_concepts: ['/docs/single-cell/module03', '/figcode#pseudotime', '/figcode#violin'],
    },
  },
  {
    id: 'combat-pca',
    figLayout: 'default',
    title: 'Batch Effect PCA',
    subtitle: '批次 PCA',
    category: '降维可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk06/01-combat-pca.png',
    description: '对比批次校正前后的 PCA 图，验证 ComBat/limma 去批次效果。',
    inputFormat: '校正前后的表达矩阵 + 批次和分组注释',
    biologicalQuestion: '批次效应是否被成功去除？校正后样本是否按生物学分组而非批次聚类？',
    scenarios: [
      'ComBat-seq 批次校正效果验证',
      'limma removeBatchEffect 评估',
      '多中心数据整合质控',
      '校正前后对比展示',
    ],
    keyParams: [
      'batch 批次变量',
      'mod 保护的生物学变量',
      'method 校正方法（ComBat / limma）',
      'par.prior 是否参数化先验',
      'ntop PCA 使用基因数',
    ],
    code: `library(ggplot2)
library(patchwork)

# --- Demo: simulate batch effect before/after ---
set.seed(42)
n <- 12
batch <- rep(c("Batch1", "Batch2"), each = 6)
condition <- rep(c("Treatment", "Control"), times = 6)

# Before: samples cluster by batch
pc1_before <- c(rnorm(6, -5, 1.5), rnorm(6, 5, 1.5))
pc2_before <- rnorm(n, 0, 2)

# After: samples cluster by condition
pc1_after <- ifelse(condition == "Treatment", rnorm(n, 5, 1.5), rnorm(n, -5, 1.5))
pc2_after <- rnorm(n, 0, 2)

df_before <- data.frame(PC1=pc1_before, PC2=pc2_before, Batch=batch, Condition=condition)
df_after <- data.frame(PC1=pc1_after, PC2=pc2_after, Batch=batch, Condition=condition)

# --- Plot ---
p1 <- ggplot(df_before, aes(PC1, PC2, color=Batch, shape=Condition)) +
  geom_point(size=4) + ggtitle("Before Correction") +
  theme_classic() + theme(legend.position="bottom")

p2 <- ggplot(df_after, aes(PC1, PC2, color=Condition, shape=Batch)) +
  geom_point(size=4) + ggtitle("After Correction") +
  scale_color_manual(values=c(Treatment="#dc2626", Control="#2563eb")) +
  theme_classic() + theme(legend.position="bottom")

p1 + p2`,
    packages: ['ggplot2', 'patchwork'],
    slogan: '校完还按批次聚？这 ComBat 等于没跑',
    tutorialUrl: '/docs/bulk-rnaseq/module06',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/bulk-rnaseq/module06'],
      learning_outcomes: [
        '能用前后 PCA 对比检查批次效应是否被去除',
        '会判断校正后样本是否按生物学分组而非批次聚类',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pca', '/figcode#sample-cor'],
    },
  },
  {
    id: 'pseudotime',
    figLayout: 'wide',
    title: 'Pseudotime UMAP',
    subtitle: '拟时序 UMAP',
    category: '降维可视化',
    image: '/img/tutorial/single-cell/module06/03-umap-pseudotime.png',
    description: 'UMAP 上按拟时序值着色，展示细胞分化轨迹方向。',
    inputFormat: 'Monocle3 cds 对象（已 learn_graph + order_cells）',
    biologicalQuestion: '细胞沿分化轨迹的排列顺序如何？哪些细胞处于分化早期或晚期？',
    scenarios: [
      '单细胞拟时序分析结果展示',
      '细胞分化轨迹可视化',
      '发育过程细胞状态转换',
      '肿瘤演化轨迹推断',
    ],
    keyParams: [
      'color_cells_by 着色变量（pseudotime）',
      'trajectory_graph_color 轨迹线颜色',
      'label_cell_groups 是否标注细胞群',
      'cell_size 点大小',
      'root_cells 起始细胞选择',
    ],
    code: `library(ggplot2)

# --- Demo: simulate pseudotime on UMAP ---
set.seed(42)
n <- 600
# Create a curved trajectory
t <- seq(0, 2*pi*0.7, length.out = n)
umap1 <- t * cos(t/2) + rnorm(n, 0, 0.4)
umap2 <- t * sin(t/2) + rnorm(n, 0, 0.4)
pseudotime <- seq(0, 1, length.out = n) + rnorm(n, 0, 0.02)
pseudotime <- pmin(pmax(pseudotime, 0), 1)

df <- data.frame(UMAP1 = umap1, UMAP2 = umap2, pseudotime = pseudotime)

# --- Plot ---
ggplot(df, aes(x = UMAP1, y = UMAP2, color = pseudotime)) +
  geom_point(size = 0.8, alpha = 0.8) +
  scale_color_viridis_c(option = "inferno") +
  labs(title = "Pseudotime Trajectory", color = "Pseudotime",
       x = "UMAP 1", y = "UMAP 2") +
  theme_void() +
  theme(legend.position = "right")`,
    packages: ['ggplot2'],
    slogan: '细胞排队这事儿，伪时间比 KPI 准',
    tutorialUrl: '/docs/single-cell/module06',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/docs/single-cell/module05'],
      learning_outcomes: [
        '会把 pseudotime 染色到 UMAP 上展示分化梯度',
        '能识别轨迹起点与终点的细胞群',
      ],
      hands_on: true,
      related_concepts: ['/figcode#umap', '/docs/single-cell/module05'],
    },
  },
  {
    id: 'spatial-cluster',
    figLayout: 'wide',
    title: 'Spatial Clusters',
    subtitle: '空间聚类图',
    category: '降维可视化',
    image: '/img/tutorial/single-cell/module10/03-clusters-spatial.png',
    description:
      '在组织切片坐标上展示空间转录组聚类结果，揭示组织空间结构。用 Squidpy 内置真实 Visium 小鼠脑数据。',
    inputFormat: 'AnnData 空间对象（adata.obsm["spatial"] 含坐标 + obs.cluster）',
    biologicalQuestion: '组织中不同区域的转录组特征如何？空间聚类是否对应已知解剖结构？',
    scenarios: [
      '10x Visium 空间聚类展示',
      '组织微环境区域划分',
      '肿瘤异质性空间分布',
      '空间与单细胞聚类对比',
    ],
    keyParams: [
      'img_key = "hires"（叠加 H&E 组织底图）',
      'color = "cluster"（着色字段）',
      'spot_size（spot 点大小）',
      'crop_coord（裁剪空白区域）',
    ],
    code: `import squidpy as sq
import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo: Squidpy 内置小鼠脑 Visium HnE 真实数据 ---
# 含组织 H&E 高清底图 + 预计算的聚类标签
adata = sq.datasets.visium_hne_adata()

# --- 在组织切片上展示空间聚类（叠加 H&E 底图）---
sc.pl.spatial(
    adata, color="cluster",
    img_key="hires",          # 叠加 H&E 高清组织图
    size=1.5,                 # spot 相对大小
    legend_loc="right margin",
    title="Spatial clusters (mouse brain, Visium H&E)",
    show=False,
)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'matplotlib'],
    language: 'python',
    slogan: '细胞讲究地段，门牌号就是聚类',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-standard',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/docs/single-cell/module09'],
      learning_outcomes: ['能将聚类标签映射回组织切片坐标', '识别空间聚类是否对应已知解剖结构'],
      hands_on: true,
      related_concepts: ['/figcode#feature-spatial', '/docs/single-cell/module09'],
    },
  },
  {
    id: 'py-umap-scanpy',
    figLayout: 'default',
    title: 'Scanpy UMAP',
    subtitle: 'Scanpy 聚类图',
    category: '降维可视化',
    image: '/img/figcode/py-umap-scanpy.png',
    description: '用 Scanpy 绘制单细胞 UMAP 聚类图，按 Leiden 聚类着色。',
    inputFormat: 'AnnData 对象（.h5ad）或 cells × genes 矩阵',
    biologicalQuestion: '单细胞数据中存在哪些细胞亚群？Scanpy 流程下的聚类结果如何？',
    scenarios: ['Scanpy 单细胞聚类展示', '与 Seurat 结果对比', 'Python 生态下的细胞类型可视化'],
    keyParams: [
      'resolution 聚类分辨率（0.1-2.0）',
      'n_neighbors 邻居数（15）',
      'n_pcs 使用的 PC 数（30）',
      'color 着色变量',
    ],
    language: 'python',
    code: `import scanpy as sc
import numpy as np
import anndata as ad
import matplotlib.pyplot as plt

# --- Demo: simulate single-cell data ---
np.random.seed(42)
n_cells = 500
n_genes = 200

# Create clusters
X = np.vstack([
    np.random.randn(150, n_genes) + [2, 0] + [0]*(n_genes-2),
    np.random.randn(120, n_genes) + [-2, 1] + [0]*(n_genes-2),
    np.random.randn(100, n_genes) + [0, -2] + [0]*(n_genes-2),
    np.random.randn(80, n_genes) + [3, 3] + [0]*(n_genes-2),
    np.random.randn(50, n_genes) + [-3, -3] + [0]*(n_genes-2),
])
adata = ad.AnnData(X)
adata.obs_names = [f"Cell_{i}" for i in range(n_cells)]
adata.var_names = [f"Gene_{i}" for i in range(n_genes)]

# --- Standard Scanpy pipeline ---
sc.pp.pca(adata, n_comps=30)
sc.pp.neighbors(adata, n_neighbors=15, n_pcs=20)
sc.tl.umap(adata)
sc.tl.leiden(adata, resolution=0.5)

# --- Plot ---
sc.pl.umap(adata, color=["leiden"], legend_loc="on data",
           title="Scanpy UMAP Clustering", show=False)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print(f"Done: {adata.n_obs} cells, {adata.obs['leiden'].nunique()} clusters")`,
    packages: ['scanpy', 'anndata', 'matplotlib'],
    slogan: 'Seurat 用腻了？试试 Scanpy 的味道',
    copilot: {
      domain: 'single-cell',
      level: 'intermediate',
      estimated_minutes: 10,
      learning_outcomes: [
        '能用 Scanpy 完成 PCA → neighbors → UMAP → Leiden 全流程',
        '会用 sc.pl.umap 着色展示聚类结果',
      ],
      hands_on: true,
    },
  },
  {
    id: 'trajectory-branch',
    figLayout: 'wide',
    title: 'Trajectory Branch',
    subtitle: '轨迹分叉图',
    category: '降维可视化',
    image: '/img/figcode/trajectory-branch.png',
    description: 'monocle3 学到的细胞分化轨迹，主路径 + 分支节点 + 拟时序方向，揭示命运决定点。',
    inputFormat: 'cell_data_set 对象（monocle3::new_cell_data_set 后跑完 learn_graph）',
    biologicalQuestion:
      '细胞从一个状态分化到另一个状态时，在哪个时间点出现命运分叉？分叉后各分支的差异基因是什么？',
    scenarios: ['造血干细胞分化树', '神经发育时间序列', 'iPSC 重编程轨迹', '免疫细胞活化分化'],
    keyParams: [
      'root_cells（指定起点细胞）',
      'color_cells_by = "pseudotime"（着色方式）',
      'label_branch_points = TRUE（标分叉点）',
      'show_trajectory_graph = TRUE（叠加 graph）',
    ],
    code: `library(monocle3)
library(ggplot2)

# --- Demo: load packaged data ---
expression_matrix <- readRDS(url(
  "http://staff.washington.edu/hpliner/data/cao_l2_expression.rds"
))
cell_metadata <- readRDS(url(
  "http://staff.washington.edu/hpliner/data/cao_l2_colData.rds"
))
gene_metadata <- readRDS(url(
  "http://staff.washington.edu/hpliner/data/cao_l2_rowData.rds"
))

cds <- new_cell_data_set(expression_matrix, cell_metadata, gene_metadata)
cds <- preprocess_cds(cds, num_dim = 50)
cds <- reduce_dimension(cds)
cds <- cluster_cells(cds)
cds <- learn_graph(cds, use_partition = TRUE)

# --- Pick a root by clicking — for demo we set programmatically ---
cds <- order_cells(cds, root_cells = colnames(cds)[1])

# --- Plot trajectory graph with pseudotime ---
plot_cells(
  cds,
  color_cells_by = "pseudotime",
  label_branch_points = TRUE,
  label_leaves = TRUE,
  label_cell_groups = FALSE,
  graph_label_size = 3
) +
  scale_color_viridis_c() +
  ggtitle("monocle3 Trajectory + Pseudotime")`,
    packages: ['monocle3', 'ggplot2'],
    slogan: '细胞命运到底在哪叉路口决定的，画出来看',
    tutorialUrl: '/docs/single-cell/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 18,
      prerequisites: ['/figcode#pseudotime', '/docs/single-cell/module05'],
      learning_outcomes: [
        '理解 monocle3 graph + pseudotime 的关系',
        '会用 root_cells 指定轨迹起点',
        '能识别分叉点 (branch point) 和叶节点 (leaf)',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pseudotime', '/figcode#umap'],
    },
  },
  {
    id: 'spatial-deconv',
    figLayout: 'wide',
    title: 'Spatial Deconvolution',
    subtitle: '空间细胞解卷积',
    category: '降维可视化',
    image: '/img/figcode/spatial-deconv.png',
    description:
      '在空间组 spot 上叠加各细胞类型比例（饼图），把 single-cell 注释映射回组织切片。scatterpie 饼图地图是 R 生态的经典空间组可视化。',
    inputFormat:
      'spot 空间坐标 + 解卷积结果矩阵（spot × celltype proportions，来自 cell2location / Tangram / SPOTlight）',
    biologicalQuestion: '每个 spot 实际上是几种细胞的混合？组织上哪些区域被哪些细胞类型占据？',
    scenarios: [
      'Visium 空间组细胞构成',
      'Stereo-seq 高分辨率组织图谱',
      '肿瘤微环境空间分布',
      '胚胎发育空间细胞图',
    ],
    keyParams: [
      'cols（参与饼图的细胞类型列）',
      'pie_scale / r（饼图半径）',
      'scale_fill_brewer（细胞类型配色）',
      'coord_equal + scale_y_reverse（组织坐标方向）',
    ],
    code: `library(ggplot2)
library(scatterpie)

# --- Demo: 模拟 Visium 网格 + 解卷积结果（spot × celltype proportions）---
# 实际比例矩阵由 cell2location / Tangram / SPOTlight 生成
set.seed(42)
grid <- expand.grid(x = seq(1, 20), y = seq(1, 20))
n <- nrow(grid)
celltypes <- c("Astro", "Excit", "Inhib", "Oligo", "Microglia")

# 让细胞类型有空间结构（不同区域不同主导细胞）
region <- with(grid, ifelse(y > 13, 1, ifelse(y < 7, 3, 2)))
props <- t(sapply(region, function(r) {
  base <- runif(5, 0.05, 0.2)
  base[r] <- base[r] + runif(1, 0.5, 1.0)  # 该区域主导细胞
  base / sum(base)
}))
colnames(props) <- celltypes
df <- cbind(grid, props)

# --- scatterpie：每个 spot 一个饼图，叠在组织坐标上 ---
ggplot() +
  geom_scatterpie(aes(x = x, y = y, r = 0.45), data = df,
                  cols = celltypes, color = NA) +
  scale_fill_brewer(palette = "Set1") +
  coord_equal() +
  theme_void() +
  labs(title = "Spatial Cell Type Composition (scatterpie)", fill = "Cell type")`,
    packages: ['ggplot2', 'scatterpie'],
    slogan: '空间组的每个点都是细胞拼盘，饼图地图一眼看清谁占多',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-deconv',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#spatial-cluster', '/docs/single-cell/module10'],
      learning_outcomes: [
        '理解空间组 spot 是细胞混合体的概念',
        '会用 scatterpie 画饼图地图',
        '能把 single-cell 注释映射到 spatial spots',
      ],
      hands_on: true,
      related_concepts: ['/figcode#spatial-cluster', '/figcode#spatial-deconv-c2l'],
    },
  },
  {
    id: 'spatial-deconv-c2l',
    figLayout: 'wide',
    title: 'Spatial Deconvolution (Python)',
    subtitle: '空间细胞解卷积',
    category: '降维可视化',
    image: '/img/figcode/spatial-deconv-c2l.png',
    description:
      '空间组解卷积结果可视化：把每个 spot 的细胞类型丰度映射回组织切片，看哪类细胞占据哪片区域。',
    inputFormat:
      'AnnData 空间对象 + 细胞类型丰度矩阵（spot × celltype，来自 cell2location / Tangram）',
    biologicalQuestion: '组织上每个 spot 是哪几种细胞的混合？各细胞类型的空间分布如何？',
    scenarios: [
      'Visium 细胞类型空间图谱',
      'cell2location / Tangram 解卷积结果展示',
      '肿瘤微环境细胞构成',
      '空间组论文 Figure 3',
    ],
    keyParams: [
      'cell_abundance（spot × celltype 丰度矩阵）',
      'cmap = "Reds"（丰度热度配色）',
      'ncols = 2（拼图列数）',
      'spot_size（spot 点大小）',
    ],
    code: `import squidpy as sq
import scanpy as sc
import numpy as np
import matplotlib.pyplot as plt

# --- Demo: Squidpy 内置小鼠脑 Visium HnE 真实数据 ---
adata = sq.datasets.visium_hne_adata()

# --- 模拟解卷积输出（实际由 cell2location / Tangram 生成）---
# 用 marker 平均表达近似各细胞类型在 spot 的丰度，避免运行时长训练
sc.pp.normalize_total(adata, target_sum=1e4); sc.pp.log1p(adata)
celltype_markers = {
    "Astrocyte": ["Gfap", "Aqp4"], "Neuron": ["Snap25", "Rbfox3"],
    "Oligodendrocyte": ["Mbp", "Plp1"], "Microglia": ["Cx3cr1", "C1qa"],
}
for ct, genes in celltype_markers.items():
    g = [x for x in genes if x in adata.var_names]
    adata.obs[ct] = np.asarray(adata[:, g].X.mean(axis=1)).flatten() if g else 0.0

# --- Top 细胞类型空间丰度（2x2 拼图）---
sc.pl.spatial(adata, color=list(celltype_markers.keys()), img_key="hires",
              ncols=2, cmap="Reds", show=False)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'numpy', 'matplotlib'],
    language: 'python',
    slogan: '一个 spot 是细胞拼盘，解卷积告诉你各占几成',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-deconv',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#spatial-cluster', '/docs/single-cell/module10'],
      learning_outcomes: [
        '理解空间组 spot 是细胞混合体的概念',
        '会把细胞类型丰度矩阵映射回组织切片',
        '能解读各细胞类型的空间分布模式',
      ],
      hands_on: true,
      related_concepts: ['/figcode#spatial-deconv', '/figcode#spatial-cluster'],
    },
  },
  {
    id: 'mofa-factors',
    figLayout: 'default',
    title: 'MOFA Factor Loadings',
    subtitle: 'MOFA 因子载荷',
    category: '降维可视化',
    image: '/img/figcode/mofa-factors.png',
    description: 'MOFA2 训练后展示每个因子在各组学上的方差解释 + 因子值与样本属性的关联。',
    inputFormat: 'MOFA 对象（MOFA2::run_mofa 输出）',
    biologicalQuestion: '提取出的潜在因子捕获了哪些组学层的变异？哪个因子和我的临床表型相关？',
    scenarios: ['多组学无监督整合', '稀疏因子分解', '隐藏亚型发现', '组学之间共享/独有变异分解'],
    keyParams: [
      'factors（要展示的因子索引）',
      'covariate1（连续协变量）',
      'group_by（分组着色）',
      'plot_variance_explained 看因子覆盖度',
    ],
    code: `library(MOFA2)
library(ggplot2)

# --- Demo: 用包内置示例 ---
filepath <- system.file("extdata", "test_model.hdf5", package = "MOFA2")
mofa <- load_model(filepath)

# --- Variance explained per factor / view ---
p1 <- plot_variance_explained(
  mofa,
  x = "view", y = "factor"
) + ggtitle("Variance Explained (R²)")

# --- Factor values colored by sample group ---
p2 <- plot_factor(
  mofa,
  factors = c(1, 2),
  color_by = "group"
) + ggtitle("MOFA Factor Values")

cowplot::plot_grid(p1, p2, ncol = 2, rel_widths = c(1, 1.2))`,
    packages: ['MOFA2', 'ggplot2', 'cowplot'],
    slogan: '把多组学的潜变量挖出来，看哪个因子说了哪层的话',
    tutorialUrl: '/docs/integration/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 18,
      prerequisites: ['/docs/integration/module05'],
      learning_outcomes: [
        '理解 MOFA 因子的语义：跨组学共享变异',
        '会读 variance_explained 矩阵',
        '能把因子值和临床变量关联检验',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pca', '/docs/integration/module05'],
    },
  },
  {
    id: 'sc-cell-cycle',
    figLayout: 'compact',
    title: 'Cell Cycle Scoring',
    subtitle: '细胞周期评分',
    category: '降维可视化',
    image: '/img/figcode/sc-cell-cycle.png',
    description: 'S/G2M 评分散点 + UMAP 上着色，识别周期异质性，决定是否需要在分析中回归。',
    inputFormat: 'Seurat 对象（含 RNA assay）',
    biologicalQuestion: '我的细胞分群是不是被细胞周期主导？需不需要在 ScaleData 中 regress.out？',
    scenarios: [
      '增殖型肿瘤数据',
      '干细胞分化研究',
      '免疫激活相关 cluster 排查',
      '回归周期效应前后对比',
    ],
    keyParams: [
      's.features / g2m.features = cc.genes（包内置）',
      'set.ident = TRUE 把 Phase 当主标签',
      'regress.out = TRUE/FALSE 决定是否在 ScaleData 去除',
    ],
    code: `library(Seurat)
library(patchwork)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small

# Built-in cell cycle gene lists (pbmc_small uses human symbols)
s.genes   <- intersect(cc.genes$s.genes, rownames(seu))
g2m.genes <- intersect(cc.genes$g2m.genes, rownames(seu))

# --- Score cells ---
seu <- CellCycleScoring(seu, s.features = s.genes, g2m.features = g2m.genes,
                        set.ident = FALSE)

# --- Visualizations ---
# (1) S vs G2M scatter, colored by called Phase
p1 <- FeatureScatter(seu, "S.Score", "G2M.Score", group.by = "Phase",
                     plot.cor = FALSE) +
        geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
        geom_vline(xintercept = 0, linetype = "dashed", color = "grey60") +
        ggtitle("S vs G2M score")

# (2) UMAP colored by Phase (compute UMAP first if missing)
if (!"umap" %in% Reductions(seu)) {
  seu <- ScaleData(seu, verbose = FALSE)
  seu <- RunPCA(seu, verbose = FALSE)
  seu <- RunUMAP(seu, dims = 1:10, verbose = FALSE)
}
p2 <- DimPlot(seu, reduction = "umap", group.by = "Phase",
              cols = c(G1 = "#94a3b8", S = "#dc2626", G2M = "#2563eb")) +
        ggtitle("UMAP by Phase")

p1 | p2`,
    packages: ['Seurat', 'patchwork'],
    slogan: '分群被周期带跑了？S/G2M 评分先看一眼',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/figcode#umap'],
      learning_outcomes: [
        '会用 CellCycleScoring 给每个细胞打 S/G2M 分',
        '能判断分群是否被周期主导',
        '知道何时该 regress.out 周期效应',
      ],
      hands_on: true,
      related_concepts: ['/figcode#umap', '/docs/single-cell/module03'],
    },
  },
  {
    id: 'sc-doublet',
    figLayout: 'compact',
    title: 'Doublet Detection',
    subtitle: '双胞检测',
    category: '降维可视化',
    image: '/img/figcode/sc-doublet.png',
    description: 'DoubletFinder / scDblFinder 输出后在 UMAP 上标记疑似双胞，决定是否过滤。',
    inputFormat: 'Seurat 对象（已跑 PCA / UMAP）',
    biologicalQuestion: '我的数据里有多少疑似双胞？它们集中在哪个 cluster？过滤后影响大吗？',
    scenarios: [
      '10x 高 loading rate 数据',
      '多样本合并前 QC',
      '罕见 cluster 真假判断',
      '论文质控章节标准图',
    ],
    keyParams: [
      'expected_doublet_rate（0.075 per 10k cells）',
      'sct = FALSE/TRUE（是否用 SCTransform）',
      'pN / pK 网格搜索参数',
    ],
    code: `library(Seurat)
library(scDblFinder)
library(SingleCellExperiment)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small

if (!"umap" %in% Reductions(seu)) {
  seu <- ScaleData(seu, verbose = FALSE) %>%
    RunPCA(verbose = FALSE) %>%
    RunUMAP(dims = 1:10, verbose = FALSE)
}

# --- Convert to SCE and run scDblFinder ---
sce <- as.SingleCellExperiment(seu)
sce <- scDblFinder(sce, samples = NULL)

# Transfer back to Seurat
seu$doublet_class <- sce$scDblFinder.class
seu$doublet_score <- sce$scDblFinder.score

# --- Plot ---
p1 <- DimPlot(seu, group.by = "doublet_class",
              cols = c(singlet = "#e5e7eb", doublet = "#dc2626"),
              order = "doublet") +
        ggtitle(sprintf("Doublets: %d / %d (%.1f%%)",
                        sum(seu$doublet_class == "doublet"),
                        ncol(seu),
                        100 * mean(seu$doublet_class == "doublet")))

p2 <- FeaturePlot(seu, features = "doublet_score") +
        scale_color_gradient(low = "#e5e7eb", high = "#dc2626") +
        ggtitle("Doublet score (continuous)")

p1 | p2`,
    packages: ['Seurat', 'scDblFinder', 'SingleCellExperiment'],
    slogan: '一颗液滴两个细胞，先剔出来再说',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#sc-qc-violin'],
      learning_outcomes: [
        '理解双胞为什么需要专门检测',
        '会用 scDblFinder 跑双胞预测',
        '能在 UMAP 上识别双胞富集 cluster',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sc-qc-violin', '/figcode#umap'],
    },
  },
  {
    id: 'py-paga',
    figLayout: 'wide',
    title: 'Scanpy PAGA',
    subtitle: 'Python 轨迹图',
    category: '降维可视化',
    image: '/img/figcode/py-paga.png',
    description:
      'PAGA (Partition-based Graph Abstraction)：把 cluster 抽象成节点 + 连接强度，单细胞轨迹分析的 Python 标杆方法。',
    inputFormat: 'AnnData 对象（已跑 sc.tl.leiden）',
    biologicalQuestion: '我的 cluster 之间是否存在分化连接？哪些 cluster 是过渡态？',
    scenarios: [
      '造血/神经发育轨迹',
      '免疫细胞分化连接',
      '替代 monocle3 的 Python 流程',
      'scVelo 预测前的 PAGA 草图',
    ],
    keyParams: [
      'groups = "leiden"（分组列）',
      'threshold（连接强度阈值，0-1）',
      'init_pos = "paga" 用 PAGA 初始化 UMAP',
      'plot = True 自动出图',
    ],
    code: `import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo data ---
adata = sc.datasets.paul15()
sc.pp.recipe_zheng17(adata)
sc.tl.pca(adata, n_comps=20)
sc.pp.neighbors(adata, n_neighbors=15)
sc.tl.leiden(adata, resolution=0.6)

# --- PAGA ---
sc.tl.paga(adata, groups="leiden")

fig, axes = plt.subplots(1, 2, figsize=(14, 6))

# Panel 1: PAGA graph
sc.pl.paga(
    adata, threshold=0.05,
    color="leiden", title="PAGA graph",
    fontsize=10, ax=axes[0], show=False
)

# Panel 2: PAGA-initialized UMAP
sc.tl.umap(adata, init_pos="paga")
sc.pl.umap(
    adata, color="leiden",
    title="UMAP (PAGA-initialized)",
    legend_loc="on data", legend_fontsize=8,
    ax=axes[1], show=False
)

plt.suptitle("PAGA Trajectory — Paul15 hematopoiesis", y=1.02)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print(f"Clusters: {adata.obs['leiden'].nunique()}")`,
    packages: ['scanpy', 'matplotlib'],
    language: 'python',
    slogan: 'cluster 之间有没有连线，PAGA 看一眼就明白',
    tutorialUrl: '/docs/single-cell/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#py-umap-scanpy'],
      learning_outcomes: [
        '理解 PAGA 把 cluster 抽象成 graph 的逻辑',
        '会用 threshold 控制连接显示',
        '能用 init_pos="paga" 让 UMAP 保留 graph 结构',
      ],
      hands_on: true,
      related_concepts: ['/figcode#py-umap-scanpy', '/figcode#trajectory-branch'],
    },
  },
  {
    id: 'cytotrace',
    figLayout: 'compact',
    title: 'CytoTRACE',
    subtitle: '干性评分',
    category: '降维可视化',
    image: '/img/figcode/cytotrace.png',
    description:
      '基于"已表达基因数"预测细胞分化潜能（干性 vs 终末分化），UMAP 着色直观看分化方向。',
    inputFormat: 'Seurat 对象 / 表达矩阵（行 = 基因，列 = 细胞）',
    biologicalQuestion: '我的细胞群里哪些是干性细胞？哪些是已分化的？分化方向是什么？',
    scenarios: [
      '造血干细胞分化树',
      '肿瘤干细胞识别',
      '替代 monocle3 简单评分',
      '与 PAGA / scVelo 互相印证',
    ],
    keyParams: [
      'enableFast = TRUE 大数据加速',
      'subsamplesize（采样到 N 个细胞加速）',
      'parallel = TRUE 多线程',
    ],
    code: `library(CytoTRACE)
library(Seurat)
library(ggplot2)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small

if (!"umap" %in% Reductions(seu)) {
  seu <- ScaleData(seu, verbose = FALSE) %>%
    RunPCA(verbose = FALSE) %>%
    RunUMAP(dims = 1:10, verbose = FALSE)
}

# --- CytoTRACE ---
expr_mat <- as.matrix(GetAssayData(seu, slot = "counts"))
ct <- CytoTRACE(expr_mat, ncores = 1, subsamplesize = 100)

seu$cytotrace <- ct$CytoTRACE

# --- Plot UMAP colored by CytoTRACE ---
FeaturePlot(seu, features = "cytotrace") +
  scale_color_gradientn(colours = c("#2563eb", "white", "#dc2626"),
                        name = "CytoTRACE\\n(stemness)") +
  ggtitle("Predicted differentiation potential")`,
    packages: ['CytoTRACE', 'Seurat', 'ggplot2'],
    slogan: '哪些细胞还是干的，哪些已经分化定型，一图分清',
    tutorialUrl: '/docs/single-cell/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#umap'],
      learning_outcomes: [
        '理解"已表达基因数与分化潜能负相关"的核心假设',
        '会用 CytoTRACE 给细胞打干性分',
        '能与 PAGA / pseudotime 对照印证',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pseudotime', '/figcode#trajectory-branch'],
    },
  },
  {
    id: 'plotly-3d',
    figLayout: 'default',
    title: '3D PCA / UMAP (Plotly)',
    subtitle: '交互三维降维',
    category: '降维可视化',
    image: '/img/figcode/plotly-3d.png',
    description: '用 plotly 画交互式 3D 散点：可旋转、缩放、hover，PCA / UMAP 的三维版本。',
    inputFormat: '数据框：PC1, PC2, PC3 (或 UMAP1/2/3) + group',
    biologicalQuestion: '2D 投影看不出来的子结构，3D 视角下能否揭示？',
    scenarios: [
      '报告 PPT 里展示交互降维',
      '论文补充材料 HTML 嵌入',
      '复杂数据集探索性分析',
      '教学演示降维概念',
    ],
    keyParams: [
      'n_components = 3',
      'marker.size = 4',
      'opacity = 0.8',
      'scene.aspectmode = "data"',
    ],
    code: `library(plotly)
library(Rtsne)

# --- Demo: iris in 3D ---
data(iris)
set.seed(42)

# --- PCA in 3D ---
pca <- prcomp(iris[, 1:4], scale. = TRUE)
df <- data.frame(
  PC1 = pca$x[, 1],
  PC2 = pca$x[, 2],
  PC3 = pca$x[, 3],
  Species = iris$Species
)

plot_ly(
  df, x = ~PC1, y = ~PC2, z = ~PC3,
  color = ~Species,
  colors = c("#dc2626", "#2563eb", "#059669"),
  marker = list(size = 5, opacity = 0.85),
  type = "scatter3d", mode = "markers"
) %>%
  layout(
    title = "3D PCA — Iris",
    scene = list(
      xaxis = list(title = "PC1"),
      yaxis = list(title = "PC2"),
      zaxis = list(title = "PC3"),
      aspectmode = "data"
    )
  )`,
    packages: ['plotly', 'Rtsne'],
    slogan: '2D 看不清的子结构，转个 3D 角度就豁然开朗',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/figcode#pca'],
      learning_outcomes: [
        '会用 plotly::scatter3d 画交互散点',
        '能把 PCA / UMAP 的前 3 主成分映射到 xyz',
        '理解 3D 不一定比 2D 更易读，何时该选 3D',
      ],
      hands_on: true,
      related_concepts: ['/figcode#pca', '/figcode#umap'],
    },
  },
  {
    id: 'scvelo-stream',
    figLayout: 'wide',
    title: 'scVelo Stream',
    subtitle: 'RNA 速率流场图',
    category: '降维可视化',
    image: '/img/figcode/scvelo-stream.png',
    description: '基于 spliced / unspliced 比例预测细胞未来状态，UMAP 上叠加流场箭头展示分化方向。',
    inputFormat: 'AnnData 对象（含 spliced / unspliced 矩阵，loom 格式）',
    biologicalQuestion: '细胞下一刻往哪个状态走？分化轨迹的方向是从 A 到 B 还是反过来？',
    scenarios: ['分化方向推断', '伪时序的方向性补充', '动态过程速率定量', 'PAGA 轨迹的方向证据'],
    keyParams: [
      'mode = "stochastic" / "dynamical"',
      'n_neighbors = 30',
      'basis = "umap"',
      'density 流线密度',
    ],
    code: `import scvelo as scv
import scanpy as sc

# --- Demo: built-in pancreas dataset ---
adata = scv.datasets.pancreas()

# --- Standard preprocessing ---
scv.pp.filter_and_normalize(adata, min_shared_counts=20, n_top_genes=2000)
scv.pp.moments(adata, n_pcs=30, n_neighbors=30)

# --- Velocity (stochastic mode is fast for demo) ---
scv.tl.velocity(adata, mode="stochastic")
scv.tl.velocity_graph(adata)

# --- Stream plot on UMAP ---
scv.pl.velocity_embedding_stream(
    adata,
    basis="umap",
    color="clusters",
    title="RNA velocity stream",
    legend_loc="right margin",
    figsize=(8, 6),
    save="plot_001.png", show=False, dpi=150
)
print(f"Cells: {adata.n_obs}, clusters: {adata.obs['clusters'].nunique()}")`,
    packages: ['scvelo', 'scanpy'],
    language: 'python',
    slogan: '细胞下一秒往哪去，spliced / unspliced 告诉你',
    tutorialUrl: '/docs/single-cell/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 18,
      prerequisites: ['/figcode#py-paga'],
      learning_outcomes: [
        '理解 RNA velocity 的核心假设：unspliced / spliced 比例预测变化',
        '能区分 stochastic / dynamical / deterministic 三种模式',
        '会读流场图的方向和密度',
      ],
      hands_on: true,
      related_concepts: ['/figcode#py-paga', '/figcode#trajectory-branch'],
    },
  },
];
