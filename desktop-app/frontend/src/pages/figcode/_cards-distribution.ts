import type { FigCard } from './_data';

export const cards_distribution: FigCard[] = [
  {
    id: 'violin',
    figLayout: 'default',
    title: 'Violin + Boxplot',
    subtitle: '表达分布图',
    category: '分布可视化',
    image: '/img/tutorial/proteomics/prot04/03-intensity-profiles.png',
    description: '小提琴 + 箱线 + jitter 展示基因在不同条件下的分布。',
    inputFormat: '长格式：gene, condition, expression',
    biologicalQuestion:
      '宝儿，这个图真好看！！！目标基因在不同实验条件或细胞类型中的表达分布是否存在差异？',
    scenarios: [
      '候选基因在各组中的表达验证',
      '单细胞 marker 基因表达展示',
      '蛋白丰度分布对比',
      '药物处理前后表达变化',
    ],
    keyParams: [
      '展示基因列表',
      'fill 分组变量',
      'scales 是否自由 y 轴（free_y）',
      'jitter width 抖动宽度',
      'alpha 透明度',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
genes <- c("TP53", "BRCA1", "MYC", "EGFR")
conditions <- c("Control", "Treatment")
df <- expand.grid(gene = genes, condition = conditions, rep = 1:20)
df$expression <- rnorm(nrow(df), mean = 8, sd = 1.5)
# Add treatment effect
df$expression[df$condition == "Treatment" & df$gene %in% c("MYC","EGFR")] <-
  df$expression[df$condition == "Treatment" & df$gene %in% c("MYC","EGFR")] + 2.5

# --- Plot ---
ggplot(df, aes(x = condition, y = expression, fill = condition)) +
  geom_violin(width = 0.8, alpha = 0.7, color = NA) +
  geom_boxplot(width = 0.15, fill = "white", outlier.shape = NA) +
  geom_jitter(width = 0.1, size = 1.5, alpha = 0.6) +
  facet_wrap(~ gene, scales = "free_y") +
  scale_fill_manual(values = c(Control="#475569", Treatment="#dc2626"), guide = "none") +
  labs(x = NULL, y = "Expression", title = "Gene Expression Distribution") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '只看均值的人，统计学得重学',
    tutorialUrl: '/docs/proteomics/module04',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 8,
      prerequisites: ['/docs/basics/r-ggplot2'],
      learning_outcomes: ['会用小提琴图同时看分组分布与中位数', '能叠加 boxplot 强调四分位距'],
      hands_on: true,
      related_concepts: ['/figcode#umap', '/figcode#heatmap'],
    },
  },
  {
    id: 'expr-dist',
    figLayout: 'compact',
    title: 'Expression Distribution',
    subtitle: '表达分布直方图',
    category: '分布可视化',
    image: '/img/figcode/km-curve-example.png',
    description: '按分组展示基因表达分布直方图，标注截断值位置。',
    inputFormat: '数据框：gene_expr, group',
    biologicalQuestion: '目标基因在高/低表达组中的分布是否清晰分离？截断值是否合理？',
    scenarios: ['生存分析分组验证', '基因表达二分类合理性检查', '截断值敏感性分析'],
    keyParams: ['bins 直方图柱数', 'cutoff 截断值', 'fill 分组颜色', 'alpha 透明度'],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
n <- 100
df <- data.frame(
  gene_expr = rnorm(n, mean = 8, sd = 2),
  group = factor(rep(c("Low", "High"), each = 50), levels = c("Low", "High"))
)
cutoff_val <- median(df$gene_expr)

# --- Plot ---
ggplot(df, aes(x = gene_expr, fill = group)) +
  geom_histogram(bins = 30, alpha = 0.7, position = "identity") +
  geom_vline(xintercept = cutoff_val, linetype = "dashed", color = "gray30", linewidth = 0.8) +
  scale_fill_manual(values = c(Low = "#2563eb", High = "#dc2626")) +
  labs(x = "Gene Expression", y = "Count",
       title = "Expression Distribution",
       subtitle = paste0("Cutoff = ", round(cutoff_val, 3))) +
  theme_classic() +
  theme(plot.title = element_text(size = 13, face = "bold"), legend.position = "top")`,
    packages: ['ggplot2'],
    slogan: '分组前先看分布，截断值不是拍脑袋',
    tutorialUrl: '/docs/project-practice/module05',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 5,
      prerequisites: ['/docs/basics/r-ggplot2'],
      learning_outcomes: ['会用直方图检查分组截断值的合理性', '能判断表达分布是否适合二分类'],
      hands_on: true,
      related_concepts: ['/figcode#km-curve', '/figcode#violin'],
    },
  },
  {
    id: 'library-size',
    figLayout: 'compact',
    title: 'Library Size Bar',
    subtitle: 'QC 条形图',
    category: '分布可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk02/01-library-size.png',
    description: '每个样本的测序文库大小（总 reads 数）条形图，快速识别低质量样本。',
    inputFormat: '数据框：sample, library_size + 分组注释',
    biologicalQuestion: '各样本的测序深度是否均匀？是否存在文库量异常偏低的样本需要剔除？',
    scenarios: [
      'RNA-seq 测序质控',
      '样本间文库大小均一性评估',
      '判断是否需要额外归一化',
      '多批次数据合并前检查',
    ],
    keyParams: [
      'fill 分组变量（condition）',
      'reorder 排序方式（升序/降序）',
      'geom_hline 最低阈值线',
      'scale_y 单位（百万 reads）',
      'coord_flip 是否水平展示',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
qc_df <- data.frame(
  sample = paste0("Sample_", sprintf("%02d", 1:12)),
  lib_size = c(rnorm(6, 25e6, 5e6), rnorm(6, 22e6, 4e6)),
  group = rep(c("Treatment", "Control"), each = 6)
)
qc_df$lib_size[3] <- 5e6  # One low-quality sample

# --- Plot ---
ggplot(qc_df, aes(x = reorder(sample, lib_size), y = lib_size / 1e6, fill = group)) +
  geom_col(width = 0.7) +
  geom_hline(yintercept = 10, linetype = "dashed", color = "red") +
  labs(x = NULL, y = "Library size (millions)", title = "Library Size QC") +
  coord_flip() +
  scale_fill_manual(values = c(Treatment="#0f766e", Control="#64748b")) +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '文库相差五倍，下游分析就是听个响',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 5,
      prerequisites: ['/docs/bulk-rnaseq/module02'],
      learning_outcomes: [
        '会用文库大小条形图检查测序深度是否均匀',
        '能识别需要剔除或额外归一化的样本',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sample-cor'],
    },
  },
  {
    id: 'top-genes-count',
    figLayout: 'compact',
    title: 'Top Gene Counts',
    subtitle: 'Top 基因',
    category: '分布可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk02/06-top-genes.png',
    description: '展示表达量最高的基因在各样本中的归一化计数，用于检测异常高表达基因。',
    inputFormat: 'DESeqDataSet 或归一化计数矩阵',
    biologicalQuestion: '哪些基因占据了最多的测序资源？是否存在单个基因主导文库的情况？',
    scenarios: [
      '检测 rRNA 或线粒体基因污染',
      '识别高表达管家基因',
      '评估文库复杂度',
      '判断是否需要过滤特定基因',
    ],
    keyParams: [
      'ntop 展示基因数（10-20）',
      'normalized 是否使用归一化值',
      'intgroup 分组变量',
      'transform 是否 log 变换',
      'geom 展示方式（bar / point）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
genes <- c("ACTB", "GAPDH", "MT-CO1", "MT-ND4", "EEF1A1", "RPL13",
           "RPS27A", "MALAT1", "FTL", "B2M", "TMSB4X", "TPT1",
           "MT-CO3", "MT-CYB", "RPS4X")
counts_df <- data.frame(
  gene = rep(genes, each = 8),
  sample = rep(paste0("S", 1:8), times = 15),
  counts = rpois(120, lambda = rep(seq(50000, 5000, length.out = 15), each = 8))
)

# --- Plot ---
ggplot(counts_df, aes(x = reorder(gene, counts, FUN = median), y = counts / 1000)) +
  geom_boxplot(fill = "#e0f2fe", color = "#0369a1", outlier.size = 0.5) +
  coord_flip() +
  labs(x = NULL, y = "Normalized counts (x1000)", title = "Top Expressed Genes") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '一个基因吃掉半个文库，赶紧问问它收了多少钱',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 5,
      prerequisites: ['/docs/bulk-rnaseq/module02'],
      learning_outcomes: [
        '会用 top gene 条形图诊断单基因主导文库的情况',
        '能识别需要剔除的过表达 outlier',
      ],
      hands_on: true,
      related_concepts: ['/figcode#library-size', '/figcode#dispersion'],
    },
  },
  {
    id: 'time-trajectory',
    figLayout: 'wide',
    title: 'Time Trajectory',
    subtitle: '时序轨迹图',
    category: '分布可视化',
    image: '/img/tutorial/bulk-rnaseq/bulk05/03-top-trajectories.png',
    description: '展示基因在多个时间点的表达变化轨迹，识别动态表达模式。',
    inputFormat: '数据框：gene, time_point, expression（长格式）',
    biologicalQuestion: '基因表达随时间如何变化？哪些基因呈现相似的时序表达模式？',
    scenarios: [
      '时间序列 RNA-seq 表达趋势',
      '药物处理后基因响应动态',
      '发育过程基因表达变化',
      '多时间点差异基因轨迹',
    ],
    keyParams: [
      'time 时间变量',
      'group 基因分组/聚类',
      'geom 展示方式（line + point）',
      'facet 是否按模块分面',
      'smooth 是否添加趋势线（loess）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
time_points <- c(0, 2, 6, 12, 24, 48)
genes <- paste0("Gene", 1:20)
clusters <- rep(c("Early response", "Late response", "Transient", "Stable"), each = 5)

traj_df <- expand.grid(gene = genes, time = time_points)
traj_df$cluster <- rep(clusters, each = length(time_points))

# Different patterns per cluster
traj_df$expression <- with(traj_df, ifelse(
  cluster == "Early response", 2 * exp(-time/10) + rnorm(nrow(traj_df), 0, 0.3),
  ifelse(cluster == "Late response", 2 * (1 - exp(-time/20)) + rnorm(nrow(traj_df), 0, 0.3),
  ifelse(cluster == "Transient", 2 * dnorm(time, 12, 8) * 20 + rnorm(nrow(traj_df), 0, 0.3),
  rnorm(nrow(traj_df), 1, 0.3)))))

# --- Plot ---
ggplot(traj_df, aes(x = time, y = expression, group = gene, color = cluster)) +
  geom_line(alpha = 0.4) +
  geom_point(size = 1) +
  stat_summary(aes(group = cluster), fun = mean, geom = "line", linewidth = 1.5) +
  facet_wrap(~ cluster) +
  labs(x = "Time (hours)", y = "Scaled Expression", title = "Gene Expression Trajectories") +
  theme_classic() +
  theme(legend.position = "none")`,
    packages: ['ggplot2'],
    slogan: '基因也分早八党和夜猫子',
    tutorialUrl: '/docs/bulk-rnaseq/module05',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/bulk-rnaseq/module05'],
      learning_outcomes: [
        '会用时序折线图展示基因随时间变化',
        '能识别周期性、单调性、瞬时型表达模式',
      ],
      hands_on: true,
      related_concepts: ['/figcode#cluster-trajectory'],
    },
  },
  {
    id: 'feature-spatial',
    figLayout: 'wide',
    title: 'Spatial Feature Plot',
    subtitle: '空间表达',
    category: '分布可视化',
    image: '/img/tutorial/single-cell/module10/04-anatomy-markers.png',
    description:
      '在组织空间坐标上展示单个基因的表达强度，揭示基因的空间表达模式。用 Squidpy 内置真实 Visium 小鼠脑数据。',
    inputFormat: 'AnnData 空间对象（adata.obsm["spatial"] 含坐标）+ 目标基因名',
    biologicalQuestion: '目标基因在组织中的空间表达模式如何？是否局限于特定解剖区域？',
    scenarios: [
      'Marker 基因空间表达验证',
      '空间差异表达基因展示',
      '组织特异性基因定位',
      '多基因空间共表达分析',
    ],
    keyParams: [
      'color = [基因列表]（多基因拼图）',
      'img_key = "hires"（叠加组织底图）',
      'cmap = "viridis"（表达热度配色）',
      'ncols（拼图列数）',
    ],
    code: `import squidpy as sq
import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo: Squidpy 内置小鼠脑 Visium HnE 真实数据 ---
adata = sq.datasets.visium_hne_adata()
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)

# --- 经典小鼠脑区 marker 基因空间表达 ---
# Mbp: 髓鞘（白质）; Hpca: 海马; Lamp5: 皮层; Ttr: 脉络丛
genes = [g for g in ["Mbp", "Hpca", "Lamp5", "Ttr"] if g in adata.var_names]
sc.pl.spatial(
    adata, color=genes,
    img_key="hires", ncols=2,
    cmap="viridis", show=False,
)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'matplotlib'],
    language: 'python',
    slogan: '基因住哪片儿，比 marker 更直观',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-svg',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/docs/single-cell/module09'],
      learning_outcomes: [
        '能用 spatial feature plot 在切片坐标上叠加单基因表达',
        '会一次画多个 marker 的空间图做对比',
      ],
      hands_on: true,
      related_concepts: ['/figcode#spatial-cluster', '/docs/single-cell/module09'],
    },
  },
  {
    id: 'spatial-svg-moran',
    figLayout: 'wide',
    title: "Spatial Variable Genes (Moran's I)",
    subtitle: '空间高变基因',
    category: '分布可视化',
    image: '/img/figcode/spatial-svg-moran.png',
    description:
      "用 Squidpy 的 Moran's I 空间自相关检验找空间高变基因（SVG），把 top SVG 的空间表达模式画出来。",
    inputFormat: 'AnnData 空间对象（adata.obsm["spatial"] 含坐标 + log-normalized 表达）',
    biologicalQuestion:
      '哪些基因的表达在空间上呈显著的聚集模式（而非随机分布）？这些 SVG 对应什么解剖区域？',
    scenarios: [
      '空间区域 marker 发现',
      'Visium 论文 Figure 2 SVG 展示',
      '组织层次结构识别',
      '空间高变基因 vs 单细胞 HVG 对比',
    ],
    keyParams: [
      'mode = "moran"（空间自相关方法）',
      'n_perms = 100（置换检验次数）',
      'genes（测试的基因子集，控制运行时长）',
      "I（Moran's I 值，越大越聚集）",
    ],
    code: `import squidpy as sq
import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo: Squidpy 内置小鼠脑 Visium HnE 真实数据 ---
adata = sq.datasets.visium_hne_adata()
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=200)

# --- 空间邻居图 + Moran's I 空间自相关 ---
# 演示用解析法 p 值（n_perms=None，秒级）；正式分析建议加 n_perms=100 做置换检验
sq.gr.spatial_neighbors(adata, coord_type="generic", n_neighs=6)
hvg = adata.var_names[adata.var["highly_variable"]].tolist()
sq.gr.spatial_autocorr(adata, mode="moran", genes=hvg, n_perms=None, n_jobs=4)

# --- Top 4 SVG 空间分布 ---
top_svgs = adata.uns["moranI"].sort_values("I", ascending=False).head(4).index.tolist()
sc.pl.spatial(adata, color=top_svgs, img_key="hires", ncols=2,
              cmap="viridis", show=False)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'matplotlib'],
    language: 'python',
    slogan: '基因在组织上扎不扎堆，Moran 的 I 一算便知',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-svg',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#spatial-cluster'],
      learning_outcomes: [
        "理解 Moran's I 空间自相关检验的原理",
        '会用 sq.gr.spatial_autocorr 检测空间高变基因',
        '能区分"空间聚集"与"随机分布"的基因',
      ],
      hands_on: true,
      related_concepts: ['/figcode#feature-spatial', '/figcode#squidpy-neighbors'],
    },
  },
  {
    id: 'bland-altman',
    figLayout: 'compact',
    title: 'Bland-Altman Plot',
    subtitle: '一致性分析图',
    category: '分布可视化',
    image: '/img/figcode/bland-altman.png',
    description: '两种测量方法的均值 vs 差值散点图，加 95% 一致性界限，判断是否可互换。',
    inputFormat: '数据框：method1, method2（同一批样本两次测量）',
    biologicalQuestion: '新的测量方法和金标准是不是可以互换？系统性偏差有多大？',
    scenarios: [
      '新仪器/试剂盒与金标准对比',
      '批次重复性评估',
      '不同测序平台同基因表达对比',
      '蛋白定量方法间一致性',
    ],
    keyParams: [
      'conf.int.level = 0.95（一致性界限）',
      'difference.type = "absolute" / "percentage" / "ratio"',
      'graph.sys = "ggplot2"',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
n <- 100
true_val <- rnorm(n, 100, 20)
method1 <- true_val + rnorm(n, 0, 4)
method2 <- true_val + rnorm(n, 1, 5) + 0.02 * true_val   # systematic + proportional bias

df <- data.frame(
  mean = (method1 + method2) / 2,
  diff = method1 - method2
)

# --- Limits of agreement ---
mean_diff <- mean(df$diff)
sd_diff   <- sd(df$diff)
upper_lim <- mean_diff + 1.96 * sd_diff
lower_lim <- mean_diff - 1.96 * sd_diff

# --- Plot ---
ggplot(df, aes(mean, diff)) +
  geom_point(alpha = 0.6, color = "#0f172a") +
  geom_hline(yintercept = mean_diff, linetype = "solid", color = "#dc2626") +
  geom_hline(yintercept = c(upper_lim, lower_lim),
             linetype = "dashed", color = "#2563eb") +
  annotate("text", x = max(df$mean), y = mean_diff,
           label = sprintf("Mean diff = %.2f", mean_diff),
           hjust = 1, vjust = -0.4, size = 3.5, color = "#dc2626") +
  annotate("text", x = max(df$mean), y = upper_lim,
           label = sprintf("+1.96 SD = %.2f", upper_lim),
           hjust = 1, vjust = -0.4, size = 3.5, color = "#2563eb") +
  annotate("text", x = max(df$mean), y = lower_lim,
           label = sprintf("-1.96 SD = %.2f", lower_lim),
           hjust = 1, vjust = 1.4, size = 3.5, color = "#2563eb") +
  labs(title = "Bland-Altman Plot",
       x = "Mean of Method 1 and 2",
       y = "Difference (Method 1 - Method 2)") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '新方法能不能替代金标准，看这条均值±1.96SD',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: [],
      learning_outcomes: [
        '理解 Bland-Altman 比相关系数更适合"一致性"评估的原因',
        '会计算并解读 95% limits of agreement',
        '能识别 proportional bias 的曲线模式',
      ],
      hands_on: true,
      related_concepts: ['/figcode#sample-cor', '/figcode#lfc-scatter'],
    },
  },
  {
    id: 'sc-qc-violin',
    figLayout: 'complex',
    title: 'scRNA QC Violin',
    subtitle: '单细胞质控三联图',
    category: '分布可视化',
    image: '/img/figcode/sc-qc-violin.png',
    description: '三联小提琴图：nFeature_RNA / nCount_RNA / percent.mt，单细胞质控必备第一步。',
    inputFormat: 'Seurat 对象（已计算 percent.mt）',
    biologicalQuestion: '哪些细胞应该被过滤掉？我的过滤阈值合理吗？',
    scenarios: [
      '10x Chromium 数据 QC',
      'Drop-seq / Smart-seq2 质控',
      '多样本 QC 对比',
      '过滤阈值定标参考',
    ],
    keyParams: [
      'features = c("nFeature_RNA","nCount_RNA","percent.mt")',
      'group.by（按样本/批次分组）',
      'pt.size = 0（不显示散点）',
      'log = TRUE 对 count 取 log',
    ],
    code: `library(Seurat)
library(patchwork)

# --- Demo data ---
data("pbmc_small")
seu <- pbmc_small
seu[["percent.mt"]] <- PercentageFeatureSet(seu, pattern = "^MT-")

# Inject demo MT% if absent
if (all(seu$percent.mt == 0)) {
  set.seed(42)
  seu$percent.mt <- runif(ncol(seu), 0, 25)
}

# --- Three-panel violin ---
p1 <- VlnPlot(seu, features = "nFeature_RNA", pt.size = 0.3) +
        NoLegend() + ggtitle("Detected genes / cell")
p2 <- VlnPlot(seu, features = "nCount_RNA", pt.size = 0.3, log = TRUE) +
        NoLegend() + ggtitle("Total UMI / cell (log)")
p3 <- VlnPlot(seu, features = "percent.mt", pt.size = 0.3) +
        NoLegend() + ggtitle("% Mitochondrial reads")

p1 | p2 | p3`,
    packages: ['Seurat', 'patchwork'],
    slogan: '单细胞质控第一图，三个指标定生死',
    tutorialUrl: '/docs/single-cell/module03',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 8,
      prerequisites: ['/docs/single-cell/module03'],
      learning_outcomes: [
        '能识别低质量细胞的三种典型指标',
        '会用 PercentageFeatureSet 算线粒体比例',
        '理解为什么 nCount 通常用 log scale',
      ],
      hands_on: true,
      related_concepts: ['/figcode#violin', '/docs/single-cell/module03'],
    },
  },
  {
    id: 'qq-plot',
    figLayout: 'compact',
    title: 'QQ Plot',
    subtitle: '分位数图',
    category: '分布可视化',
    image: '/img/figcode/qq-plot.png',
    description:
      '观测 vs 理论分位数对比：诊断检验的 p 值是否符合 null（GWAS 必出），或残差是否正态。',
    inputFormat: '一维数值向量（p 值列表 / 残差）',
    biologicalQuestion: '我的检验 p 值在 null 假设下应该均匀分布，实际有偏离吗？模型残差正态吗？',
    scenarios: [
      'GWAS p 值诊断（系数膨胀 λ）',
      '差异分析 p 值诊断',
      '回归残差正态性检查',
      '群体遗传学 inflation 检测',
    ],
    keyParams: [
      'distribution = "uniform"（GWAS）/ "normal"（残差）',
      'envelope = TRUE 95% 置信带',
      'main 标题含 lambda',
    ],
    code: `library(qqman)

# --- Demo: simulate p-values with mild inflation ---
set.seed(42)
n <- 10000
p_null <- runif(n)
p_inflated <- pmin(runif(n) * 0.95, 1)   # mild inflation

# True GWAS-like with a few hits + inflation
p_real <- c(p_inflated, runif(20, 1e-12, 1e-7))

# --- QQ plot of p-values ---
par(mfrow = c(1, 2))
qq(p_null, main = "Null (well-calibrated)", cex = 0.5)
qq(p_real, main = "Mild inflation + real hits", cex = 0.5)

# Compute genomic inflation factor lambda
chisq <- qchisq(1 - p_real, 1)
lambda <- median(chisq) / qchisq(0.5, 1)
mtext(sprintf("lambda = %.3f", lambda),
      side = 3, line = -1.4, adj = 0.95, cex = 0.9)`,
    packages: ['qqman'],
    slogan: '检验跑完先来一张 QQ，膨胀还是漂亮一目了然',
    tutorialUrl: '/docs/genomics/module07',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: [],
      learning_outcomes: [
        '能读懂 QQ plot 的对角线和置信带',
        '理解 genomic inflation factor lambda 的含义',
        '会判断"早离线" vs "晚离线"代表什么',
      ],
      hands_on: true,
      related_concepts: ['/figcode#manhattan'],
    },
  },
  {
    id: 'cnv-expression',
    figLayout: 'default',
    title: 'CNV-Expression Scatter',
    subtitle: 'CNV-表达散点',
    category: '分布可视化',
    image: '/img/figcode/cnv-expression.png',
    description:
      '横轴 CNV log2 ratio，纵轴基因表达，按染色体着色。验证拷贝数变化是否传递到表达层。',
    inputFormat: '数据框：gene, chr, cnv_log2, expression_log2',
    biologicalQuestion: '哪些基因的拷贝数变化真的影响了表达？哪些是"沉默扩增"或"补偿性下调"？',
    scenarios: [
      'CNV-RNA dosage effect 验证',
      '驱动基因筛选（CNV + 表达双高/双低）',
      'iCluster 多组学整合质控',
      'TCGA 多组学论文 Figure 3 经典图',
    ],
    keyParams: [
      'method = "lm" / "loess"（拟合方法）',
      'color_by = "chromosome"',
      'highlight 高亮特定基因',
    ],
    code: `library(ggplot2)
library(ggrepel)

# --- Demo data ---
set.seed(42)
n <- 1500
df <- data.frame(
  gene = paste0("Gene", 1:n),
  chr  = sample(paste0("chr", c(1:22, "X")), n, replace = TRUE),
  cnv_log2 = rnorm(n, 0, 0.6),
  noise    = rnorm(n, 0, 1)
)
# Real dosage effect: expression follows CNV with noise
df$expr_log2 <- 0.7 * df$cnv_log2 + df$noise

# Highlight top |CNV × expr|
df$score <- df$cnv_log2 * df$expr_log2
top <- df[order(-abs(df$score)), ][1:15, ]

# --- Plot ---
ggplot(df, aes(cnv_log2, expr_log2)) +
  geom_point(aes(color = chr), alpha = 0.4, size = 0.9) +
  geom_smooth(method = "lm", color = "#0f172a", se = TRUE, size = 0.8) +
  geom_text_repel(data = top, aes(label = gene), size = 3,
                  max.overlaps = 15) +
  geom_vline(xintercept = c(-0.3, 0.3), linetype = "dashed", color = "grey60") +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey60") +
  scale_color_manual(values = rep(c("#dc2626","#2563eb","#059669","#d97706",
                                    "#7c3aed","#0891b2"), length.out = 23)) +
  labs(title = "CNV vs Expression (per gene)",
       x = "CNV log2 ratio", y = "Expression log2 (z-score)") +
  theme_classic() +
  theme(legend.position = "none")`,
    packages: ['ggplot2', 'ggrepel'],
    slogan: '扩增了但表达没动？沉默扩增揪出来',
    tutorialUrl: '/docs/integration/module03',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/figcode#cnv-heatmap'],
      learning_outcomes: [
        '理解 CNV 与表达的"剂量效应"假设',
        '能识别 silent amplification 与 compensation 模式',
        '会拟合 lm 并标注异常基因',
      ],
      hands_on: true,
      related_concepts: ['/figcode#cnv-heatmap', '/figcode#multi-omics-heatmap'],
    },
  },
  {
    id: 'shap-summary',
    figLayout: 'complex',
    title: 'SHAP Summary Plot',
    subtitle: 'SHAP 特征重要性',
    category: '分布可视化',
    image: '/img/figcode/shap-summary.png',
    description:
      'SHAP 值蜂群图：每个特征的全样本 SHAP 分布，颜色 = 特征值大小。一图看清"哪些特征推高 / 拉低预测"。',
    inputFormat: 'sklearn / xgboost 训练好的模型 + 特征矩阵',
    biologicalQuestion: '我的机器学习模型是被哪些特征驱动的？高表达基因 X 推高还是拉低预测概率？',
    scenarios: [
      'ML 模型可解释性',
      '特征重要性排序',
      '论文回答审稿人"模型为什么这样预测"',
      '黑盒模型变白盒',
    ],
    keyParams: [
      'max_display（展示 top N 特征）',
      'plot_type = "dot" / "bar" / "violin"',
      'feature_names',
    ],
    code: `import numpy as np
import xgboost as xgb
import shap
import matplotlib.pyplot as plt
from sklearn.datasets import load_breast_cancer

# --- Demo data ---
data = load_breast_cancer()
X, y = data.data, data.target
feature_names = data.feature_names

# --- Train XGBoost ---
model = xgb.XGBClassifier(n_estimators=200, max_depth=4,
                           use_label_encoder=False, eval_metric="logloss")
model.fit(X, y)

# --- SHAP values ---
explainer = shap.Explainer(model, X)
shap_values = explainer(X)

# --- Summary plot (beeswarm) ---
plt.figure(figsize=(9, 7))
shap.summary_plot(
    shap_values, X,
    feature_names=feature_names,
    max_display=15,
    plot_type="dot",
    show=False
)
plt.title("SHAP feature importance — Breast Cancer")
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print(f"Trained on {X.shape[0]} samples × {X.shape[1]} features")`,
    packages: ['xgboost', 'shap', 'scikit-learn', 'matplotlib'],
    language: 'python',
    slogan: '黑盒模型也得给出解释，SHAP 一锤定音',
    tutorialUrl: '/docs/integration/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#py-roc-confusion'],
      learning_outcomes: [
        '理解 SHAP 值的语义（边际贡献）',
        '能读 summary plot：x = SHAP，颜色 = 原值',
        '区分 SHAP 与简单 feature_importances_',
      ],
      hands_on: true,
      related_concepts: ['/figcode#py-roc-confusion', '/figcode#meta-forest'],
    },
  },
  {
    id: 'power-curve',
    figLayout: 'compact',
    title: 'Power Curve',
    subtitle: '样本量-功效曲线',
    category: '分布可视化',
    image: '/img/figcode/power-curve.png',
    description: '横轴样本量，纵轴检验功效（power），多条曲线对应不同效应量。实验设计阶段必备。',
    inputFormat: '参数：effect_size 范围、显著性水平 α、检验类型',
    biologicalQuestion: '我要检测 1.5 倍差异需要多少样本？现有样本量能达到 80% power 吗？',
    scenarios: [
      'Grant 申请样本量论证',
      'Pilot study 后扩样决策',
      '基金课题方案设计',
      '审稿人质疑样本量时的回应',
    ],
    keyParams: [
      'effect_size = c(0.2, 0.5, 0.8)（Cohen d 小/中/大）',
      'sig.level = 0.05',
      'type = "two.sample" / "paired"',
    ],
    code: `library(pwr)
library(ggplot2)
library(tidyr)

# --- Compute power across n for several effect sizes ---
n_seq <- seq(5, 200, by = 5)
effects <- c(0.2, 0.5, 0.8)   # Cohen's d: small / medium / large

df <- expand.grid(n = n_seq, d = effects)
df$power <- mapply(
  function(n, d) pwr.t.test(n = n, d = d, sig.level = 0.05,
                             type = "two.sample")$power,
  df$n, df$d
)
df$d_label <- factor(
  paste0("d = ", df$d),
  levels = paste0("d = ", effects)
)

# --- Plot ---
ggplot(df, aes(n, power, color = d_label)) +
  geom_line(size = 1.1) +
  geom_hline(yintercept = 0.8, linetype = "dashed", color = "grey50") +
  annotate("text", x = max(n_seq), y = 0.81,
           label = "Power = 0.80", hjust = 1, size = 3.5, color = "grey40") +
  scale_color_manual(values = c("#dc2626", "#059669", "#2563eb"),
                     name = "Effect size") +
  scale_y_continuous(limits = c(0, 1), breaks = seq(0, 1, 0.2)) +
  labs(title = "Two-sample t-test Power",
       x = "Sample size per group", y = "Statistical power") +
  theme_classic()`,
    packages: ['pwr', 'ggplot2', 'tidyr'],
    slogan: '检测多大效应需要多少样本，曲线一画立省一周扯皮',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: [],
      learning_outcomes: [
        '理解 power = 1 - β 的含义',
        '会用 pwr 包做样本量 / power 计算',
        '能为不同检验类型选对应函数（pwr.t.test / pwr.r.test 等）',
      ],
      hands_on: true,
      related_concepts: ['/figcode#qq-plot'],
    },
  },
  {
    id: 'immune-composition',
    figLayout: 'complex',
    title: 'Immune Composition Stack',
    subtitle: '免疫细胞堆叠图',
    category: '分布可视化',
    image: '/img/figcode/immune-composition.png',
    description: 'ssGSEA 算分后归一化到 0-1，每个样本一根柱子，柱内填充 28 种免疫细胞的相对比例。',
    inputFormat: '矩阵：行=免疫细胞，列=样本，值=ssGSEA score（已归一化到 0-1）',
    biologicalQuestion: '每个样本的免疫微环境组成是什么样？组间免疫格局有差异吗？',
    scenarios: [
      'TCGA 队列免疫浸润全景图',
      'Tumor vs Normal 免疫格局对比',
      '治疗前后免疫细胞变化',
      '亚型分类下的免疫差异',
    ],
    keyParams: [
      '归一化（每细胞 min-max）',
      'ggplot fill 色板（28 色）',
      '样本顺序（聚类 / 风险分组）',
    ],
    code: "library(ggplot2)\nlibrary(reshape2)\n\n# --- Demo data ---\nset.seed(42)\nn_cells <- 12; n_samples <- 30\nmat <- matrix(runif(n_cells * n_samples), n_cells, n_samples)\nmat <- t(apply(mat, 1, function(x) (x - min(x)) / (max(x) - min(x) + 1e-10)))\nrownames(mat) <- c('CD8 T','CD4 T','Treg','B cells','NK','Macrophages','DC','Neutrophils','Mast','Tfh','Th1','Th17')\ncolnames(mat) <- paste0('S', 1:n_samples)\n\ndf <- melt(mat); colnames(df) <- c('CellType','Sample','Score')\ndf$Sample <- factor(df$Sample, levels = colnames(mat))\n\nggplot(df, aes(x = Sample, y = Score, fill = CellType)) +\n  geom_bar(stat = 'identity', position = 'fill', width = 0.9) +\n  scale_y_continuous(labels = scales::percent) +\n  labs(x = NULL, y = 'Relative Proportion', title = 'Immune Cell Composition (ssGSEA)', fill = 'Cell Type') +\n  theme_classic() +\n  theme(axis.text.x = element_text(angle = 90, hjust = 1, size = 7), legend.text = element_text(size = 8))",
    packages: ['ggplot2', 'reshape2'],
    slogan: '一根柱子就是一个样本的免疫故事，肿瘤里到底有多少免疫细胞',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools',
    copilot: {
      domain: 'immune',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#dotplot'],
      learning_outcomes: [
        '理解 ssGSEA 输出的免疫细胞 score 含义',
        '会用 position=fill 画相对比例堆叠图',
        '能识别免疫格局差异',
      ],
      hands_on: true,
      related_concepts: ['/figcode#immune-cor', '/figcode#immune-boxplot'],
    },
  },
  {
    id: 'immune-cor',
    figLayout: 'complex',
    title: 'Immune Correlation Heatmap',
    subtitle: '免疫细胞相关性热图',
    category: '分布可视化',
    image: '/img/figcode/immune-cor.png',
    description: '28 种免疫细胞两两 Spearman 相关，正相关 = 共同浸润，负相关 = 互斥。',
    inputFormat: '矩阵：行=免疫细胞，列=样本，值=ssGSEA raw score',
    biologicalQuestion: '哪些免疫细胞协同浸润？哪些互斥？这种共浸润模式在不同肿瘤是否一致？',
    scenarios: [
      '发现免疫共浸润模块',
      '识别拮抗的免疫细胞对',
      '免疫亚型聚类的依据',
      '和临床预后建立联系',
    ],
    keyParams: [
      '相关方法（spearman 默认，对极端值稳健）',
      '色板（红蓝双向）',
      '对角线处理（自相关 = 1）',
    ],
    code: "library(ggplot2)\nlibrary(reshape2)\n\n# --- Demo data ---\nset.seed(42)\nn_cells <- 14; n_samples <- 60\nmat <- matrix(rnorm(n_cells * n_samples), n_cells, n_samples)\n# Inject correlation structure\nmat[2,] <- mat[1,] + rnorm(n_samples, 0, 0.5)  # CD4 ~ CD8\nmat[5,] <- -mat[1,] + rnorm(n_samples, 0, 0.5) # NK anti-CD8\nrownames(mat) <- c('CD8 T','CD4 T','Treg','B','NK','Macrophages','DC','Neutrophils','Mast','Tfh','Th1','Th17','Th2','MDSC')\n\ncor_mat <- cor(t(mat), method = 'spearman')\ndf <- melt(cor_mat); colnames(df) <- c('A','B','r')\n\nggplot(df, aes(A, B, fill = r)) +\n  geom_tile(color = 'white') +\n  scale_fill_gradient2(low = '#2563eb', mid = 'white', high = '#dc2626', midpoint = 0, limits = c(-1, 1)) +\n  labs(x = NULL, y = NULL, title = 'Immune Cell Co-infiltration (Spearman)', fill = 'r') +\n  theme_classic() +\n  theme(axis.text.x = element_text(angle = 45, hjust = 1, size = 9))",
    packages: ['ggplot2', 'reshape2'],
    slogan: '免疫细胞不是各跳各的，相关性热图一眼看出谁跟谁同进退',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools',
    copilot: {
      domain: 'immune',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/figcode#heatmap', '/figcode#sample-cor'],
      learning_outcomes: [
        '会用 cor() + Spearman 计算细胞间相关',
        '能识别免疫共浸润模块',
        '理解负相关在免疫语境下的含义',
      ],
      hands_on: true,
      related_concepts: ['/figcode#immune-composition', '/figcode#immune-boxplot'],
    },
  },
  {
    id: 'immune-boxplot',
    figLayout: 'compact',
    title: 'Immune Group Boxplot',
    subtitle: '免疫细胞组间对比',
    category: '分布可视化',
    image: '/img/figcode/immune-boxplot.png',
    description:
      '选 top variable 的免疫细胞，按分组（如 Tumor vs Normal）画箱线图，找差异浸润的细胞类型。',
    inputFormat: '数据框：CellType, Sample, Score, Group',
    biologicalQuestion: '哪些免疫细胞在分组间显著差异浸润？这些差异是否和临床表型一致？',
    scenarios: [
      'Tumor vs Normal 免疫差异',
      '高低风险组免疫格局对比',
      'Responder vs Non-responder 免疫预测',
      '亚型间免疫差异',
    ],
    keyParams: [
      '筛选 top variable cells（cap 12）',
      'stat_compare_means 加 p 值',
      'facet_wrap 单独看每细胞',
    ],
    code: "library(ggplot2)\nlibrary(reshape2)\n\n# --- Demo data ---\nset.seed(42)\nn_samples <- 60\nmat <- matrix(rnorm(8 * n_samples), 8, n_samples)\nrownames(mat) <- c('CD8 T','Treg','Macrophages','NK','DC','Tfh','Th1','MDSC')\ngrp <- rep(c('Tumor','Normal'), each = n_samples/2)\nmat[1,] <- mat[1,] + ifelse(grp == 'Tumor', 0.8, 0)\nmat[3,] <- mat[3,] + ifelse(grp == 'Tumor', 1.2, 0)\n\ndf <- melt(mat); colnames(df) <- c('CellType','Sample','Score')\ndf$Group <- grp[df$Sample]\n\nggplot(df, aes(CellType, Score, fill = Group)) +\n  geom_boxplot(outlier.size = 0.5, width = 0.7) +\n  scale_fill_manual(values = c(Tumor = '#dc2626', Normal = '#2563eb')) +\n  labs(x = NULL, y = 'ssGSEA Score', title = 'Immune Infiltration: Group Comparison') +\n  theme_classic() +\n  theme(axis.text.x = element_text(angle = 45, hjust = 1, size = 9), legend.position = 'top')",
    packages: ['ggplot2', 'reshape2'],
    slogan: '找差异浸润的细胞，比平均值有用十倍',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools',
    copilot: {
      domain: 'immune',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#violin'],
      learning_outcomes: [
        '会按分组比较免疫浸润差异',
        '能筛选 top variable cells 减少视觉噪音',
        '理解箱线图配色对解读的影响',
      ],
      hands_on: true,
      related_concepts: ['/figcode#immune-composition', '/figcode#violin'],
    },
  },
  {
    id: 'immune-lollipop',
    figLayout: 'compact',
    title: 'Immune Mean Lollipop',
    subtitle: '免疫平均浸润度',
    category: '分布可视化',
    image: '/img/figcode/immune-lollipop.png',
    description:
      '队列内每种免疫细胞的平均 ssGSEA score，棒棒糖图按浸润度排序，一眼看哪类细胞主导。',
    inputFormat: '矩阵：行=免疫细胞，列=样本，值=ssGSEA score',
    biologicalQuestion: '这个队列的免疫主旋律是什么？哪种免疫细胞最主导？',
    scenarios: [
      '展示队列整体免疫格局',
      '对比不同癌种的免疫主旋律',
      'Cohort summary figure',
      '排序后做选择性后续分析',
    ],
    keyParams: ['rowMeans 计算平均', 'sort 按浸润度排序', 'geom_segment + geom_point 组合'],
    code: "library(ggplot2)\n\n# --- Demo data ---\nset.seed(42)\ncells <- c('CD8 T','CD4 T','Treg','B','NK','Macrophages','DC','Neutrophils','Mast','Tfh','Th1','Th17')\nscores <- runif(length(cells), 0, 1)\nnames(scores) <- cells\nscores <- sort(scores, decreasing = TRUE)\n\ndf <- data.frame(CellType = factor(names(scores), levels = rev(names(scores))), MeanScore = scores)\n\nggplot(df, aes(x = MeanScore, y = CellType)) +\n  geom_segment(aes(x = 0, xend = MeanScore, y = CellType, yend = CellType), color = '#dfe8e3', linewidth = 0.8) +\n  geom_point(size = 3, color = '#2e8555') +\n  labs(x = 'Mean ssGSEA Score', y = NULL, title = 'Immune Cell Infiltration Level') +\n  theme_classic() +\n  theme(plot.title = element_text(size = 13, face = 'bold'))",
    packages: ['ggplot2'],
    slogan: '一根棒一个细胞，从上到下就是这个队列的免疫主旋律',
    tutorialUrl: '/docs/project-practice/module05',
    onlineToolUrl: '/tools',
    copilot: {
      domain: 'immune',
      level: 'beginner',
      estimated_minutes: 6,
      prerequisites: [],
      learning_outcomes: [
        '会用 rowMeans + sort 做 cohort summary',
        '理解棒棒糖图相对条形图的视觉优势',
        '能识别队列的免疫主旋律',
      ],
      hands_on: true,
      related_concepts: ['/figcode#immune-composition'],
    },
  },
];
