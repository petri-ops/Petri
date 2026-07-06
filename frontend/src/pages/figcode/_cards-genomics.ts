import type { FigCard } from './_data';

export const cards_genomics: FigCard[] = [
  {
    id: 'oncoplot',
    figLayout: 'complex',
    title: 'Oncoplot',
    subtitle: '突变景观图',
    category: '基因组',
    image: '/img/tutorial/genomics/genome04/02-oncoplot.png',
    description: '每列一个样本，每行一个基因，颜色代表突变类型。',
    inputFormat: 'MAF 文件（maftools::read.maf）',
    biologicalQuestion: '队列中哪些基因突变频率最高？不同突变类型在各样本中如何分布？',
    scenarios: [
      '肿瘤队列突变全景展示',
      '驱动基因突变频率排序',
      '多突变类型共现分析',
      '临床注释与突变关联',
    ],
    keyParams: [
      'top 展示基因数（10-20）',
      'clinicalFeatures 临床注释列',
      'sortByAnnotation 是否按注释排序',
      'fontSize 字体大小',
      'colors 突变类型配色',
    ],
    code: `library(maftools)

# --- Demo: use built-in TCGA LAML dataset ---
laml.maf <- system.file("extdata", "tcga_laml.maf.gz", package = "maftools")
laml.clin <- system.file("extdata", "tcga_laml_annot.tsv", package = "maftools")
laml <- read.maf(maf = laml.maf, clinicalData = laml.clin)

# --- Plot ---
oncoplot(laml, top = 10, fontSize = 0.7)`,
    packages: ['maftools'],
    slogan: 'TP53 KRAS BRCA，又是这老三样',
    tutorialUrl: '/docs/genomics/module04',
    onlineToolUrl: '/tools?tool=maftools-mutation',
    copilot: {
      domain: 'genomics',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/genomics/module04'],
      learning_outcomes: [
        '能用 oncoplot 看队列里的高频突变基因',
        '会读 oncoplot 上的突变类型颜色和样本注释',
      ],
      hands_on: true,
      related_concepts: ['/figcode#lollipop', '/figcode#km-curve'],
    },
  },
  {
    id: 'lollipop',
    figLayout: 'default',
    title: 'Lollipop Plot',
    subtitle: '突变位点图',
    category: '基因组',
    image: '/img/tutorial/genomics/genome04/03-lollipop-dnmt3a.png',
    description: '横轴蛋白结构域，棒棒糖高度 = 该位点突变频率。',
    inputFormat: 'MAF 对象 + 基因名',
    biologicalQuestion: '目标基因的突变是否集中在特定蛋白结构域或热点位置？',
    scenarios: [
      '单基因突变热点分析',
      '蛋白功能域与突变位点关联',
      '不同队列突变位点对比',
      '临床意义突变位点标注',
    ],
    keyParams: [
      'gene 目标基因名',
      'AACol 氨基酸变化列名',
      'showMutationRate 是否显示突变率',
      'domainLabelSize 结构域标签大小',
      'repel 标签是否避免重叠',
    ],
    code: `library(maftools)

# --- Demo: use built-in TCGA LAML dataset ---
laml.maf <- system.file("extdata", "tcga_laml.maf.gz", package = "maftools")
laml <- read.maf(maf = laml.maf)

# --- Plot ---
lollipopPlot(laml, gene = "DNMT3A", AACol = "Protein_Change",
             showMutationRate = TRUE, domainLabelSize = 3)`,
    packages: ['maftools'],
    slogan: '突变都挤在功能域上，不是巧合是命',
    tutorialUrl: '/docs/genomics/module04',
    copilot: {
      domain: 'genomics',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/docs/genomics/module04'],
      learning_outcomes: ['会用 lollipop 看单个基因的突变热点', '能将突变定位到蛋白结构域'],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot'],
    },
  },
  {
    id: 'peak-anno',
    figLayout: 'default',
    title: 'Peak Annotation Pie',
    subtitle: 'Peak 注释',
    category: '基因组',
    image: '/img/tutorial/epigenomics/epi02/01-anno-pie.png',
    description: 'Peak 落在启动子/内含子/基因间等区域的占比饼图。',
    inputFormat: 'narrowPeak 文件 + TxDb 注释',
    biologicalQuestion: '实验富集的 peak 主要分布在基因组的哪些功能区域？是否偏好启动子区？',
    scenarios: [
      'ChIP-seq peak 基因组分布概览',
      'ATAC-seq 开放染色质区域注释',
      '不同组蛋白修饰的分布对比',
      'TF 结合位点区域偏好分析',
    ],
    keyParams: [
      'tssRegion TSS 上下游范围（c(-3000, 3000)）',
      'TxDb 基因组注释版本',
      'level 注释层级（gene / transcript）',
      '输出图形类型（pie / bar）',
    ],
    code: `library(ggplot2)

# --- Demo: simulate peak annotation proportions ---
anno_df <- data.frame(
  Feature = c("Promoter (<=1kb)", "Promoter (1-2kb)", "Promoter (2-3kb)",
              "5' UTR", "3' UTR", "1st Exon", "Other Exon",
              "1st Intron", "Other Intron", "Distal Intergenic"),
  Percentage = c(28, 8, 5, 2, 4, 3, 5, 12, 18, 15)
)
anno_df$Feature <- factor(anno_df$Feature, levels = rev(anno_df$Feature))

# --- Plot ---
ggplot(anno_df, aes(x = "", y = Percentage, fill = Feature)) +
  geom_bar(stat = "identity", width = 1) +
  coord_polar("y") +
  labs(title = "Peak Genomic Annotation", fill = "Feature") +
  theme_void() +
  theme(legend.text = element_text(size = 8))`,
    packages: ['ggplot2'],
    slogan: 'Peak 都跑基因间区了，先怀疑抗体',
    tutorialUrl: '/docs/epigenomics/module02',
    copilot: {
      domain: 'epigenomics',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/docs/epigenomics/module02'],
      learning_outcomes: [
        '会用饼图表达 peak 在启动子/内含子/基因间的分布',
        '能识别 ChIP-seq 与 ATAC-seq 的分布差异',
      ],
      hands_on: true,
      related_concepts: ['/figcode#diffbind-ma'],
    },
  },
  {
    id: 'manhattan',
    figLayout: 'wide',
    title: 'Manhattan Plot',
    subtitle: '曼哈顿图',
    category: '基因组',
    image: '/img/figcode/manhattan.png',
    description: 'GWAS 经典图：横轴染色体位置，纵轴 -log10(p)，超过显著线的 SNP 即关联位点。',
    inputFormat: '数据框：SNP, CHR, BP, P',
    biologicalQuestion: '全基因组上哪些 SNP 与表型显著相关？显著位点在染色体上如何分布？',
    scenarios: ['GWAS 主结果展示', 'Meta-GWAS', 'eQTL 结果可视化', 'PheWAS 多表型扫描'],
    keyParams: [
      'suggestiveline = -log10(1e-5)（提示阈值）',
      'genomewideline = -log10(5e-8)（全基因组显著阈值）',
      'highlight（高亮特定 SNP 列表）',
      'annotatePval（自动注释超过阈值的 SNP）',
    ],
    code: `library(qqman)

# --- Demo GWAS data ---
set.seed(42)
n <- 50000
df <- data.frame(
  SNP = paste0("rs", 1:n),
  CHR = sample(1:22, n, replace = TRUE),
  BP  = sample(1:1e8, n, replace = TRUE),
  P   = runif(n)
)
# Inject a few significant hits
hits <- sample(n, 30)
df$P[hits] <- runif(30, 1e-12, 5e-8)

# --- Manhattan plot ---
manhattan(
  df,
  chr = "CHR", bp = "BP", p = "P", snp = "SNP",
  col = c("#1d4ed8", "#94a3b8"),
  suggestiveline = -log10(1e-5),
  genomewideline = -log10(5e-8),
  annotatePval   = 5e-8,
  main = "Manhattan Plot — GWAS"
)`,
    packages: ['qqman'],
    slogan: '满屏点点找尖塔，过线的就是嫌疑 SNP',
    tutorialUrl: '/docs/genomics/module07',
    copilot: {
      domain: 'genomics',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/genomics/module07'],
      learning_outcomes: [
        '能识别 GWAS 显著阈值（5e-8）和提示阈值',
        '会用 qqman::manhattan 一键画图',
        '知道为什么 -log10(p) 越大越显著',
      ],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#lollipop'],
    },
  },
  {
    id: 'circos',
    figLayout: 'wide',
    title: 'Circos Plot',
    subtitle: '基因组环形图',
    category: '基因组',
    image: '/img/figcode/circos.png',
    description: '环形展示基因组多种数据：染色体、CNV、突变、SV、表达——一图汇总多组学。',
    inputFormat: 'BED 风格数据框：chr, start, end, value（每个轨道一份）',
    biologicalQuestion:
      '不同染色体上的多组学特征如何同时呈现？拷贝数变化与表达异常是否在空间上对应？',
    scenarios: [
      '泛癌基因组特征汇总',
      'CNV + SV + 突变联合展示',
      '癌症基因组学论文 Figure 1',
      'Multi-omics 整合可视化',
    ],
    keyParams: [
      'ideogram(species)（指定物种）',
      'circos.par 调间距和起始角度',
      'track.height 轨道高度',
      'circos.clear() 防 panel 残留',
    ],
    code: `library(circlize)

# --- Demo: 22 染色体 + 2 个数据轨道 ---
set.seed(42)

# Track 1: CNV (随机拷贝数得分)
cnv <- do.call(rbind, lapply(1:22, function(i) {
  n <- 30
  data.frame(
    chr   = paste0("chr", i),
    start = seq(1, 1e8, length.out = n),
    end   = seq(1, 1e8, length.out = n) + 1e6,
    value = cumsum(rnorm(n, 0, 0.3))
  )
}))

# Track 2: 突变频率
mut <- do.call(rbind, lapply(1:22, function(i) {
  n <- sample(5:20, 1)
  data.frame(
    chr   = paste0("chr", i),
    start = sort(sample(1:1e8, n)),
    end   = sort(sample(1:1e8, n)) + 1e5,
    value = abs(rnorm(n, 5, 2))
  )
}))

# --- Plot ---
circos.clear()
circos.par("track.height" = 0.12, "gap.degree" = 1)
circos.initializeWithIdeogram(species = "hg19", chromosome.index = paste0("chr", 1:22))

# Track 1: CNV as line
circos.genomicTrackPlotRegion(cnv, panel.fun = function(region, value, ...) {
  circos.genomicLines(region, value, type = "l", col = "#dc2626", lwd = 1.2)
}, track.height = 0.12)

# Track 2: mutation as point
circos.genomicTrackPlotRegion(mut, panel.fun = function(region, value, ...) {
  circos.genomicPoints(region, value, pch = 16, cex = 0.4, col = "#2563eb")
}, track.height = 0.12)

title("Circos — CNV (red) + Mutation Frequency (blue)")
circos.clear()`,
    packages: ['circlize'],
    slogan: '一张环图把多组学全堆上，泛癌论文标配',
    tutorialUrl: '/docs/genomics/overview',
    copilot: {
      domain: 'genomics',
      level: 'advanced',
      estimated_minutes: 20,
      prerequisites: ['/docs/genomics/module04'],
      learning_outcomes: [
        '理解 circos 的轨道 (track) 概念',
        '会准备 BED 风格的输入数据',
        '能配置 ideogram + 多个数据轨道',
        '知道何时该用 circos（多类型数据汇总）何时不该用（单一变量趋势）',
      ],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#manhattan'],
    },
  },
  {
    id: 'mut-cooccurrence',
    figLayout: 'complex',
    title: 'Mutation Co-occurrence',
    subtitle: '突变共现矩阵',
    category: '基因组',
    image: '/img/figcode/mut-cooccurrence.png',
    description: '检测哪些基因突变倾向于共同出现 / 互斥发生，揭示通路上下游关系或合成致死。',
    inputFormat: 'maftools::read.maf 加载的 MAF 对象',
    biologicalQuestion:
      '在我的肿瘤队列中，哪些驱动基因突变倾向于一起出现？哪些是互斥的（提示功能冗余）？',
    scenarios: [
      '驱动基因功能冗余检测',
      '合成致死靶点筛选',
      '通路成员关联分析',
      '亚型特异性突变模式',
    ],
    keyParams: [
      'top（参与分析的高频突变基因数）',
      'pvalue（CoMEt / Fisher 阈值）',
      'returnAll = TRUE 拿到完整 p 值矩阵',
    ],
    code: `library(maftools)

# --- Demo: 用包内置 LAML ---
laml.maf <- system.file("extdata", "tcga_laml.maf.gz", package = "maftools")
laml.clin <- system.file("extdata", "tcga_laml_annot.tsv", package = "maftools")
laml <- read.maf(maf = laml.maf, clinicalData = laml.clin, verbose = FALSE)

# --- Somatic interactions ---
interactions <- somaticInteractions(
  maf = laml,
  top = 25,
  pvalue = c(0.05, 0.01),
  showCounts = FALSE,
  countStats = "all"
)`,
    packages: ['maftools'],
    slogan: '突变是合伙作案还是各干各的，统计学告诉你',
    tutorialUrl: '/docs/genomics/module04',
    copilot: {
      domain: 'genomics',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/figcode#oncoplot'],
      learning_outcomes: [
        '理解 co-occurrence vs mutual exclusivity 的生物学含义',
        '会用 maftools::somaticInteractions 跑成对检验',
        '能从图中读出星号代表的显著等级',
      ],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#lollipop'],
    },
  },
  {
    id: 'cnv-heatmap',
    figLayout: 'complex',
    title: 'CNV Heatmap',
    subtitle: '拷贝数热图',
    category: '基因组',
    image: '/img/figcode/cnv-heatmap.png',
    description:
      '基因组位置 × 样本的 CNV 热图：红色 = 扩增，蓝色 = 缺失。一图看清整个队列的拷贝数景观。',
    inputFormat: '矩阵：行 = 基因组 bin（按染色体排序），列 = 样本，值 = log2 copy ratio',
    biologicalQuestion: '我的队列中哪些染色体区段反复发生扩增/缺失？这些区段上有什么驱动基因？',
    scenarios: [
      '泛癌 CNV 景观',
      'TCGA 队列拷贝数',
      'inferCNV 单细胞肿瘤vs正常',
      'GISTIC peak 区域可视化',
    ],
    keyParams: [
      'cluster_columns = TRUE 样本聚类',
      'split_by_chromosome 按染色体分块',
      'col_fun 红蓝双向 colorRamp',
      'top_annotation 临床特征',
    ],
    code: `library(ComplexHeatmap)
library(circlize)

# --- Demo: 1000 bins × 30 samples ---
set.seed(42)
n_bins <- 1000
n_samp <- 30

# Spread bins across chromosomes proportional to size
chr_lens <- c(250,243,198,191,181,171,159,146,141,135,135,134,
              115,108,102,90,81,78,59,63,48,51)
chr_lens <- round(n_bins * chr_lens / sum(chr_lens))
chr_lens[1] <- chr_lens[1] + (n_bins - sum(chr_lens))   # rounding fix
chr <- rep(paste0("chr", 1:22), times = chr_lens)

# CNV matrix (mostly near 0, with some focal events)
cnv <- matrix(rnorm(n_bins * n_samp, 0, 0.3), nrow = n_bins)
# Inject amplification on chr8q (around bin 370-400)
cnv[370:400, 1:10] <- cnv[370:400, 1:10] + 2
# Inject deletion on chr17 (around bin 600-630)
cnv[600:630, 11:20] <- cnv[600:630, 11:20] - 1.8

rownames(cnv) <- paste0(chr, "_", ave(seq_along(chr), chr, FUN = seq_along))
colnames(cnv) <- paste0("S", 1:n_samp)

# --- Heatmap ---
col_fun <- colorRamp2(c(-2, 0, 2), c("#2563eb", "white", "#dc2626"))

Heatmap(
  t(cnv),                            # rows = samples, cols = bins
  name = "log2 ratio",
  col = col_fun,
  cluster_rows = TRUE,
  cluster_columns = FALSE,
  show_column_names = FALSE,
  show_row_names = FALSE,
  column_split = factor(chr, levels = paste0("chr", 1:22)),
  column_gap = grid::unit(0.5, "mm"),
  column_title_gp = grid::gpar(fontsize = 7),
  row_title = "Samples",
  heatmap_legend_param = list(title = "log2 CR")
)`,
    packages: ['ComplexHeatmap', 'circlize'],
    slogan: '整个基因组的扩增和缺失，红蓝两条带概括了',
    tutorialUrl: '/docs/genomics/module05',
    copilot: {
      domain: 'genomics',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/docs/genomics/module05'],
      learning_outcomes: [
        '能用 column_split 按染色体分块',
        '理解 log2 copy ratio 阈值（-0.3 / +0.3 通常作为 cutoff）',
        '会识别"focal" vs "arm-level" CNV 模式',
      ],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#circos'],
    },
  },
  {
    id: 'mut-signature',
    figLayout: 'complex',
    title: 'Mutation Signature',
    subtitle: '突变特征 (SBS96)',
    category: '基因组',
    image: '/img/figcode/mut-signature.png',
    description:
      'COSMIC SBS96 风格：96 种三核苷酸碱基替换的频谱图，揭示突变成因（吸烟、UV、APOBEC 等）。',
    inputFormat: 'maftools 对象（已计算 trinucleotide context）',
    biologicalQuestion: '我的肿瘤队列里突变是什么"特征"？是吸烟相关、UV 相关、还是 APOBEC？',
    scenarios: [
      '泛癌突变成因分析',
      '吸烟/UV 暴露推断',
      'POLE/MMR deficiency 检测',
      'COSMIC signatures 比对',
    ],
    keyParams: [
      'add = TRUE 在已有 maf 上加 trinucleotide context',
      'n（提取的 signature 数量）',
      'plotType = "cosine"（与 COSMIC 比对）',
    ],
    code: `library(maftools)
library(BSgenome.Hsapiens.UCSC.hg19)

# --- Demo ---
laml.maf  <- system.file("extdata", "tcga_laml.maf.gz", package = "maftools")
laml      <- read.maf(maf = laml.maf, verbose = FALSE)

# --- Trinucleotide context ---
laml.tnm <- trinucleotideMatrix(
  maf = laml,
  ref_genome = "BSgenome.Hsapiens.UCSC.hg19",
  prefix = "chr", add = TRUE,
  useSyn = TRUE
)

# --- Plot SBS96 spectrum (sum across all samples) ---
plotApobecDiff(laml.tnm, maf = laml, pVal = 0.2)

# Or extract de novo signatures and plot them
# laml.sign <- extractSignatures(mat = laml.tnm, n = 3, plotBestFitRes = FALSE)
# plotSignatures(nmfRes = laml.sign, title_size = 1.3, sig_db = "SBS")`,
    packages: ['maftools', 'BSgenome.Hsapiens.UCSC.hg19'],
    slogan: '癌症的 96 种"指纹"，看哪个特征最像',
    tutorialUrl: '/docs/genomics/module04',
    copilot: {
      domain: 'genomics',
      level: 'advanced',
      estimated_minutes: 18,
      prerequisites: ['/figcode#oncoplot'],
      learning_outcomes: [
        '理解 SBS96 的三核苷酸 context 编码',
        '能用 maftools 提取 de novo signatures',
        '会和 COSMIC signatures 数据库比对',
      ],
      hands_on: true,
      related_concepts: ['/figcode#oncoplot', '/figcode#mut-cooccurrence'],
    },
  },
  {
    id: 'lego-plot',
    figLayout: 'complex',
    title: 'Lego Plot',
    subtitle: '突变 3D 直方',
    category: '基因组',
    image: '/img/figcode/lego-plot.png',
    description:
      '突变三核苷酸 context 的 3D 立方体直方图：96 种碱基替换在 6 大类下的"乐高"风格展示。',
    inputFormat: 'maftools::trinucleotideMatrix 输出',
    biologicalQuestion: '我的肿瘤样本在 96 种突变 context 上的频谱长什么样？哪种替换最多？',
    scenarios: [
      '替代 SBS96 frequency bar 的 3D 版',
      '泛癌突变特征大类汇总',
      '报告 / PPT 视觉效果加分图',
    ],
    keyParams: ['add = TRUE 计算 trinucleotide context', 'plotLego 风格', 'sample 选取特定样本'],
    code: `library(maftools)
library(BSgenome.Hsapiens.UCSC.hg19)

# --- Demo: TCGA-LAML ---
laml.maf <- system.file("extdata", "tcga_laml.maf.gz", package = "maftools")
laml <- read.maf(maf = laml.maf, verbose = FALSE)

# --- Trinucleotide context ---
laml.tnm <- trinucleotideMatrix(
  maf = laml,
  ref_genome = "BSgenome.Hsapiens.UCSC.hg19",
  prefix = "chr", add = TRUE,
  useSyn = TRUE
)

# --- Lego-style plot ---
plotApobecDiff(laml.tnm, maf = laml, pVal = 0.05)
# 或：plotSignatures() 先 extractSignatures() 然后画 SBS96 lego`,
    packages: ['maftools', 'BSgenome.Hsapiens.UCSC.hg19'],
    slogan: '96 种突变拼成乐高，整个肿瘤队列频谱一图',
    tutorialUrl: '/docs/genomics/module04',
    copilot: {
      domain: 'genomics',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#mut-signature'],
      learning_outcomes: [
        '理解 SBS96 的 6 大类 × 16 context 编码',
        '会用 maftools 生成 lego 风格图',
        '能识别"主导替换类型"的肿瘤特征',
      ],
      hands_on: true,
      related_concepts: ['/figcode#mut-signature', '/figcode#oncoplot'],
    },
  },
];
