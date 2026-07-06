import type { FigCard } from './_data';

export const cards_enrichment: FigCard[] = [
  {
    id: 'dotplot',
    figLayout: 'complex',
    title: 'GO/KEGG Dotplot',
    subtitle: '富集气泡图',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk03/01-go-bp-dotplot.png',
    description: '点大小 = 基因数，颜色 = p.adjust，横轴 = gene ratio。',
    inputFormat: 'enrichGO / enrichKEGG 结果对象',
    biologicalQuestion: '差异基因主要富集在哪些生物学通路或功能类别中？',
    scenarios: [
      'GO 富集结果可视化',
      'KEGG 通路富集展示',
      '多组对比富集结果',
      '上下调基因分别富集分析',
    ],
    keyParams: [
      'showCategory 展示通路数（10-20）',
      'pvalueCutoff 阈值',
      'OrgDb 物种注释库',
      'ont 本体类型（BP/MF/CC）',
      'gene ratio vs count 选择',
    ],
    code: `library(ggplot2)

# --- Demo data (simulated enrichment result) ---
set.seed(42)
terms <- c("Cell cycle regulation", "DNA repair", "Apoptosis signaling",
           "Immune response", "Metabolic process", "Signal transduction",
           "Protein folding", "mRNA processing", "Chromatin remodeling",
           "Lipid metabolism", "Oxidative phosphorylation", "Autophagy")
enrich_df <- data.frame(
  Description = terms,
  GeneRatio = runif(12, 0.05, 0.25),
  p.adjust = sort(runif(12, 0.0001, 0.04)),
  Count = sample(5:40, 12)
)

# --- Plot ---
ggplot(enrich_df, aes(x = GeneRatio, y = reorder(Description, GeneRatio))) +
  geom_point(aes(size = Count, color = p.adjust)) +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  scale_size_continuous(range = c(3, 10)) +
  labs(x = "Gene Ratio", y = NULL, title = "GO Enrichment Dotplot",
       color = "p.adjust", size = "Count") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 10))`,
    packages: ['ggplot2'],
    slogan: '气泡又大又红，老板看了能多发奖金',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    onlineToolUrl: '/tools?tool=go-kegg',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: [
        '能用气泡大小 + 颜色同时编码 gene count 与显著性',
        '会按 padj 排序展示 top 富集通路',
      ],
      hands_on: true,
      related_concepts: ['/figcode#kegg-dotplot', '/figcode#go-bar'],
    },
  },
  {
    id: 'gsea-running',
    figLayout: 'wide',
    title: 'GSEA Running Score',
    subtitle: 'GSEA 曲线',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk03/06-gsea-running-score.png',
    description: '经典 GSEA 图：enrichment score 曲线 + hit 位置 + ranking。',
    inputFormat: 'gseGO / gseKEGG 结果对象 + geneSetID',
    biologicalQuestion: '目标基因集的成员是否倾向于富集在排序列表的顶部或底部？',
    scenarios: [
      '展示单条通路的 GSEA 富集模式',
      '比较不同基因集的富集方向',
      '验证先验通路假设',
      '文章 figure 展示核心通路',
    ],
    keyParams: [
      'geneSetID 目标通路',
      'pvalue_table 是否显示统计量',
      'nPerm 置换次数（1000+）',
      'minGSSize / maxGSSize 基因集大小过滤',
      'ranking metric（log2FC × -log10p）',
    ],
    code: `library(ggplot2)

# --- Demo: simulate GSEA running score ---
set.seed(42)
n <- 500
ranks <- sort(rnorm(n, 0, 2), decreasing = TRUE)
hits <- sort(sample(1:n, 30))

# Calculate running enrichment score
es <- numeric(n)
hit_indicator <- rep(0, n)
hit_indicator[hits] <- 1
nr <- sum(abs(ranks[hits]))
miss_penalty <- 1 / (n - length(hits))

running <- 0
for (i in 1:n) {
  if (hit_indicator[i] == 1) {
    running <- running + abs(ranks[i]) / nr
  } else {
    running <- running - miss_penalty
  }
  es[i] <- running
}

df_es <- data.frame(Position = 1:n, ES = es)
df_hits <- data.frame(Position = hits, y = 0)

# --- Plot ---
p1 <- ggplot(df_es, aes(x = Position, y = ES)) +
  geom_line(color = "#059669", linewidth = 1.2) +
  geom_hline(yintercept = 0, linetype = "dashed", color = "grey50") +
  geom_segment(data = df_hits, aes(x = Position, xend = Position, y = -0.02, yend = 0.02),
               color = "#dc2626", linewidth = 0.3) +
  labs(x = "Rank", y = "Enrichment Score", title = "GSEA Running Score") +
  theme_classic()
print(p1)`,
    packages: ['ggplot2'],
    slogan: '曲线翘了，毕业有望',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    onlineToolUrl: '/tools?tool=gsea',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: [
        '能解读 GSEA running enrichment score 曲线',
        '理解曲线峰值的位置与 leading edge 基因关系',
      ],
      hands_on: true,
      related_concepts: ['/figcode#gsea-waterfall', '/figcode#gsea-forest'],
    },
  },
  {
    id: 'gsea-waterfall',
    figLayout: 'wide',
    title: 'NES Waterfall',
    subtitle: 'GSEA 瀑布图',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk03/05-gsea-waterfall.png',
    description: 'Top activated + suppressed 通路按 NES 排序的条形图。',
    inputFormat: 'GSEA 结果表（NES, p.adjust, Description）',
    biologicalQuestion: '哪些通路在实验组中被显著激活或抑制？激活与抑制的通路数量是否平衡？',
    scenarios: [
      'GSEA 结果全景展示',
      '对比激活与抑制通路',
      '多数据库（GO/KEGG/Hallmark）结果汇总',
      '筛选后续验证的候选通路',
    ],
    keyParams: [
      '展示通路数（top 5-10 each direction）',
      'NES 阈值过滤',
      'p.adjust 阈值（0.05 / 0.25）',
      '条形颜色方案（红蓝对比）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
pathways <- c("Oxidative phosphorylation", "Cell cycle", "DNA repair",
              "Fatty acid metabolism", "mTOR signaling", "Apoptosis",
              "Immune activation", "Wnt signaling", "Notch signaling",
              "Hedgehog signaling", "TGF-beta signaling", "p53 pathway")
top_terms <- data.frame(
  Description = pathways,
  NES = c(2.3, 1.9, 1.7, 1.5, 1.3, 1.1, -1.2, -1.4, -1.6, -1.8, -2.0, -2.4),
  p.adjust = runif(12, 0.001, 0.04)
)
top_terms$direction <- ifelse(top_terms$NES > 0, "Activated", "Suppressed")

# --- Plot ---
ggplot(top_terms, aes(x = reorder(Description, NES), y = NES, fill = direction)) +
  geom_col(width = 0.7) + coord_flip() +
  scale_fill_manual(values = c(Activated="#dc2626", Suppressed="#2563eb")) +
  labs(x = NULL, y = "Normalized Enrichment Score (NES)", title = "GSEA NES Waterfall") +
  theme_classic() +
  theme(legend.position = "top")`,
    packages: ['ggplot2'],
    slogan: '激活归激活，抑制归抑制，骑墙派出局',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    onlineToolUrl: '/tools?tool=gsea',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: [
        '能用 NES 瀑布图同时看通路激活与抑制',
        '会按 NES 排序展示 top up/down 通路',
      ],
      hands_on: true,
      related_concepts: ['/figcode#gsea-running', '/figcode#gsea-forest'],
    },
  },
  {
    id: 'go-bar',
    figLayout: 'default',
    title: 'GO Bar Plot',
    subtitle: 'GO 条形图',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk03/02-go-bar-bpmfcc.png',
    description: '将 BP、MF、CC 三类 GO 富集结果合并展示在同一条形图中，按 p 值着色。',
    inputFormat: 'enrichGO 结果（分别跑 BP/MF/CC 后合并）',
    biologicalQuestion: '差异基因在生物过程、分子功能和细胞组分三个维度分别富集了哪些功能？',
    scenarios: [
      'GO 三大类别全景展示',
      '对比 BP/MF/CC 富集差异',
      '文章 figure 综合功能注释',
      '多组差异基因功能对比',
    ],
    keyParams: [
      'showCategory 每类展示数（5-10）',
      'ont 本体类型（ALL / BP / MF / CC）',
      'pvalueCutoff 阈值',
      'facet 是否分面展示',
      'color 着色变量（p.adjust / Count）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
bp_terms <- c("Cell division", "DNA repair", "Apoptotic process", "Signal transduction", "Immune response")
mf_terms <- c("Protein binding", "ATP binding", "Kinase activity", "DNA binding", "Receptor activity")
cc_terms <- c("Nucleus", "Cytoplasm", "Membrane", "Mitochondrion", "Extracellular")

go_df <- data.frame(
  Description = c(bp_terms, mf_terms, cc_terms),
  Count = sample(5:35, 15),
  p.adjust = runif(15, 0.0001, 0.04),
  ONTOLOGY = rep(c("BP", "MF", "CC"), each = 5)
)

# --- Plot ---
ggplot(go_df, aes(x = reorder(Description, Count), y = Count, fill = p.adjust)) +
  geom_col(width = 0.7) +
  coord_flip() +
  facet_grid(ONTOLOGY ~ ., scales = "free_y", space = "free_y") +
  scale_fill_gradient(low = "#dc2626", high = "#93c5fd") +
  labs(x = NULL, y = "Gene Count", title = "GO Enrichment (BP/MF/CC)", fill = "p.adjust") +
  theme_classic() +
  theme(strip.text = element_text(face = "bold"))`,
    packages: ['ggplot2'],
    slogan: '审稿人最爱看的就是这种三连图',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: [
        '会用条形图按 GO 三大类（BP/MF/CC）展示富集',
        '能用 facet 把不同 ontology 并排比较',
      ],
      hands_on: true,
      related_concepts: ['/figcode#dotplot', '/figcode#go-emap'],
    },
  },
  {
    id: 'kegg-dotplot',
    figLayout: 'complex',
    title: 'KEGG Dotplot',
    subtitle: 'KEGG 气泡',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk03/04-kegg-dotplot.png',
    description: 'KEGG 通路富集气泡图，点大小 = 基因数，颜色 = p.adjust。',
    inputFormat: 'enrichKEGG 结果对象',
    biologicalQuestion: '差异基因主要参与哪些 KEGG 信号通路？哪些通路的富集最为显著？',
    scenarios: [
      'KEGG 通路富集结果展示',
      '信号通路优先级排序',
      '多组对比通路差异',
      '筛选后续实验验证通路',
    ],
    keyParams: [
      'showCategory 展示通路数（15-20）',
      'organism KEGG 物种代码（hsa）',
      'pvalueCutoff 阈值',
      'x 轴变量（GeneRatio / Count）',
      'color 着色变量（p.adjust / qvalue）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
kegg_terms <- c("PI3K-Akt signaling", "MAPK signaling", "Cell cycle",
                "p53 signaling", "Apoptosis", "TNF signaling",
                "NF-kappa B signaling", "Wnt signaling", "mTOR signaling",
                "Jak-STAT signaling", "HIF-1 signaling", "FoxO signaling")
kegg_df <- data.frame(
  Description = kegg_terms,
  GeneRatio = runif(12, 0.04, 0.2),
  p.adjust = sort(runif(12, 0.001, 0.045)),
  Count = sample(8:45, 12)
)

# --- Plot ---
ggplot(kegg_df, aes(x = GeneRatio, y = reorder(Description, GeneRatio))) +
  geom_point(aes(size = Count, color = p.adjust)) +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  scale_size_continuous(range = c(3, 10)) +
  labs(x = "Gene Ratio", y = NULL, title = "KEGG Pathway Enrichment",
       color = "p.adjust", size = "Count") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 9))`,
    packages: ['ggplot2'],
    slogan: '通路堆成山，前三条够吹一年',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    onlineToolUrl: '/tools?tool=go-kegg',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: ['会用气泡图展示 KEGG 通路富集', '能选择合适的 padj 阈值过滤噪音通路'],
      hands_on: true,
      related_concepts: ['/figcode#dotplot', '/figcode#kegg-bubble'],
    },
  },
  {
    id: 'kegg-bubble',
    figLayout: 'complex',
    title: 'KEGG Bubble',
    subtitle: '气泡图',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk04/04-kegg-bubble.png',
    description: '自定义 KEGG 气泡图，支持多组对比，气泡大小和颜色分别映射不同统计量。',
    inputFormat: 'compareCluster 结果或自定义富集数据框',
    biologicalQuestion: '不同实验条件下的 KEGG 通路富集模式有何异同？',
    scenarios: [
      '多组差异基因通路对比',
      '时间序列通路动态变化',
      '上下调基因分别富集对比',
      '多组学通路交叉验证',
    ],
    keyParams: [
      'compareCluster formula 分组公式',
      'size 气泡大小映射（Count / GeneRatio）',
      'color 颜色映射（p.adjust）',
      'facet 分面变量',
      'label_format 标签换行宽度',
    ],
    code: `library(ggplot2)

# --- Demo: multi-group comparison ---
set.seed(42)
pathways <- c("Cell cycle", "Apoptosis", "MAPK signaling", "PI3K-Akt",
              "TNF signaling", "p53 signaling", "Wnt signaling", "mTOR signaling")
groups <- c("Up-regulated", "Down-regulated")

compare_df <- expand.grid(Description = pathways, Cluster = groups)
compare_df$GeneRatio <- runif(16, 0.03, 0.2)
compare_df$p.adjust <- runif(16, 0.001, 0.05)
compare_df$Count <- sample(5:30, 16, replace = TRUE)

# --- Plot ---
ggplot(compare_df, aes(x = Cluster, y = reorder(Description, GeneRatio))) +
  geom_point(aes(size = Count, color = p.adjust)) +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  scale_size_continuous(range = c(3, 10)) +
  labs(x = NULL, y = NULL, title = "KEGG Pathway Comparison",
       color = "p.adjust", size = "Count") +
  theme_classic() +
  theme(axis.text.x = element_text(angle = 30, hjust = 1))`,
    packages: ['ggplot2'],
    slogan: '哪一组的气泡最亮，故事就从哪一组讲',
    tutorialUrl: '/docs/bulk-rnaseq/module04',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 12,
      prerequisites: ['/docs/bulk-rnaseq/module04'],
      learning_outcomes: ['会用气泡矩阵对比多组之间的 KEGG 富集', '能识别每组特异和共同富集的通路'],
      hands_on: true,
      related_concepts: ['/figcode#kegg-dotplot'],
    },
  },
  {
    id: 'gsea-forest',
    figLayout: 'wide',
    title: 'NES Forest Plot',
    subtitle: 'GSEA 森林图',
    category: '功能富集',
    image: '/img/tutorial/bulk-rnaseq/bulk04/06-gsea-forest.png',
    description: '以森林图形式展示多条通路的 NES 及置信区间，直观比较富集强度。',
    inputFormat: 'GSEA 结果表（NES, pvalue, Description, setSize）',
    biologicalQuestion: '多条候选通路的富集强度和可信度如何排序？哪些通路的 NES 最为稳健？',
    scenarios: [
      'GSEA 结果多通路对比',
      '展示 NES 置信区间',
      '筛选稳健富集通路',
      '文章 figure 森林图展示',
    ],
    keyParams: [
      '展示通路数（top 10-15）',
      'NES 点估计及 CI',
      'pvalue 显著性标记',
      'setSize 基因集大小',
      'color 按方向着色（activated / suppressed）',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
gsea_top <- data.frame(
  Description = c("Oxidative phosphorylation", "Cell cycle", "DNA repair",
                  "Fatty acid metabolism", "mTOR signaling",
                  "Immune activation", "Wnt signaling", "Notch signaling",
                  "TGF-beta signaling", "p53 pathway"),
  NES = c(2.1, 1.8, 1.5, 1.3, 1.1, -1.2, -1.5, -1.7, -2.0, -2.3),
  p.adjust = runif(10, 0.001, 0.04),
  setSize = sample(20:150, 10)
)
gsea_top$direction <- ifelse(gsea_top$NES > 0, "Activated", "Suppressed")

# --- Plot ---
ggplot(gsea_top, aes(x = NES, y = reorder(Description, NES))) +
  geom_point(aes(size = setSize, color = direction)) +
  geom_errorbarh(aes(xmin = NES - 0.3, xmax = NES + 0.3), height = 0.2, color = "grey50") +
  geom_vline(xintercept = 0, linetype = "dashed") +
  scale_color_manual(values = c(Activated="#dc2626", Suppressed="#2563eb")) +
  scale_size_continuous(range = c(3, 8)) +
  labs(x = "Normalized Enrichment Score", y = NULL, title = "GSEA Forest Plot",
       size = "Set Size", color = "Direction") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: 'NES 飘到天上，置信区间要是绷不住就尴尬了',
    tutorialUrl: '/docs/bulk-rnaseq/module04',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module04'],
      learning_outcomes: ['能用森林图按 NES 排序展示 GSEA 通路', '区分激活与抑制通路的可信度'],
      hands_on: true,
      related_concepts: ['/figcode#gsea-running', '/figcode#gsea-waterfall'],
    },
  },
  {
    id: 'ridge-gsea',
    figLayout: 'default',
    title: 'Ridge Plot (GSEA)',
    subtitle: 'GSEA 山脊图',
    category: '功能富集',
    image: '/img/figcode/ridge-gsea.png',
    description:
      '把 GSEA top 通路的 leading edge 基因 log2FC 分布画成山脊图，看每条通路的富集方向和分散度。',
    inputFormat: 'gseaResult 对象（clusterProfiler::gseGO / gseKEGG 输出）',
    biologicalQuestion:
      '富集到的通路里，core enrichment 基因的 fold change 是集中还是分散？方向如何？',
    scenarios: ['GSEA 结果纵览', '上调 / 下调通路对比', '配合 NES waterfall 多角度展示'],
    keyParams: [
      'showCategory（展示 top N 通路）',
      'fill = "p.adjust"（按 p 值着色）',
      'orderBy（NES 或 enrichmentScore）',
      'core_enrichment 只展示核心富集基因',
    ],
    code: `library(clusterProfiler)
library(enrichplot)
library(org.Hs.eg.db)

# --- Demo: build a fake gseaResult-like data structure with real fgsea ---
set.seed(42)
n <- 5000
genelist <- rnorm(n)
names(genelist) <- paste0("Gene", 1:n)
genelist <- sort(genelist, decreasing = TRUE)

# --- Use a small built-in gene set list for demo ---
data(geneList, package = "DOSE")
gsea <- gseGO(
  geneList     = geneList,
  OrgDb        = org.Hs.eg.db,
  ont          = "BP",
  minGSSize    = 20,
  maxGSSize    = 500,
  pvalueCutoff = 0.05,
  verbose      = FALSE
)

# --- Ridge plot ---
ridgeplot(gsea, showCategory = 12, fill = "p.adjust", orderBy = "NES") +
  scale_fill_gradient(low = "#dc2626", high = "#2563eb") +
  labs(title = "GSEA Ridge Plot — leading edge gene log2FC")`,
    packages: ['clusterProfiler', 'enrichplot', 'org.Hs.eg.db', 'DOSE'],
    slogan: '一座山一条通路，山头偏左偏右就是上调下调',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    copilot: {
      domain: 'enrichment',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#gsea-running'],
      learning_outcomes: [
        '能读懂山脊图：山的位置 = 富集方向，宽度 = 基因离散度',
        '会用 ridgeplot() 配合 fill 参数',
        '能区分 ridge 与 dotplot 各自适用场景',
      ],
      hands_on: true,
      related_concepts: ['/figcode#gsea-running', '/figcode#gsea-waterfall'],
    },
  },
  {
    id: 'reactome-tree',
    figLayout: 'complex',
    title: 'Reactome Pathway Tree',
    subtitle: 'Reactome 通路树',
    category: '功能富集',
    image: '/img/figcode/reactome-tree.png',
    description: 'enrichplot::treeplot 将相似通路聚成树状簇，避免气泡图通路冗余、揭示功能模块。',
    inputFormat: 'enrichResult 对象（clusterProfiler::enrichGO / enrichKEGG / enrichPathway）',
    biologicalQuestion: '富集到几十条通路，但很多是冗余的——能不能把它们按相似性聚成几大主题？',
    scenarios: [
      '富集结果去冗余呈现',
      '论文图替代长 dotplot',
      'GO BP 大量条目时聚类',
      '多组对比通路主题对比',
    ],
    keyParams: [
      'showCategory = 30（参与聚类的 top N）',
      'nCluster = 4-6（树枝数）',
      'hclust_method = "ward.D"',
      'group_color 自定义簇配色',
    ],
    code: `library(clusterProfiler)
library(enrichplot)
library(org.Hs.eg.db)

# --- Demo: built-in geneList ---
data(geneList, package = "DOSE")
genes <- names(geneList)[abs(geneList) > 2]

ego <- enrichGO(
  gene          = genes,
  OrgDb         = org.Hs.eg.db,
  ont           = "BP",
  pAdjustMethod = "BH",
  pvalueCutoff  = 0.05,
  qvalueCutoff  = 0.1,
  readable      = TRUE
)

# --- Tree plot ---
ego2 <- pairwise_termsim(ego)
treeplot(
  ego2,
  showCategory = 30,
  cluster.params = list(label_words_n = 4),
  fontsize = 4
) +
  ggtitle("Reactome / GO Enrichment Tree")`,
    packages: ['clusterProfiler', 'enrichplot', 'org.Hs.eg.db', 'DOSE'],
    slogan: '一堆通路冗余得很，treeplot 一下分组就清爽了',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    copilot: {
      domain: 'enrichment',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/figcode#dotplot'],
      learning_outcomes: [
        '理解 pairwise_termsim 计算的是基因重叠相似度',
        '会用 treeplot 把通路聚成主题簇',
        '知道何时用 tree 替代 dotplot',
      ],
      hands_on: true,
      related_concepts: ['/figcode#dotplot', '/figcode#go-emap'],
    },
  },
  {
    id: 'treemap',
    figLayout: 'complex',
    title: 'Treemap',
    subtitle: '树状图',
    category: '功能富集',
    image: '/img/figcode/treemap.png',
    description:
      '矩形面积代表数值大小，按层级嵌套：GO 大类→ 子通路→基因数；或 突变基因→样本占比 等。',
    inputFormat: '层级数据框：parent, child, value',
    biologicalQuestion: '富集到的几十个 GO term 按"父类"汇总后，哪些大类占主导？',
    scenarios: [
      'GO BP/MF/CC 三大类占比',
      'KEGG 通路类别汇总',
      '突变频谱分类展示',
      '基金分类资金占比',
    ],
    keyParams: [
      'index = c(parent, child) 嵌套层级',
      'vSize = 数值列',
      'palette / type = "categorical"',
      'fontsize.labels 字号',
    ],
    code: `library(treemap)

# --- Demo: GO BP top categories ---
df <- data.frame(
  category = c(rep("Immune Response", 4),
               rep("Cell Cycle", 4),
               rep("Metabolism", 5),
               rep("Signal Transduction", 4),
               rep("Apoptosis", 3)),
  term = c(
    "T cell activation","B cell proliferation","Cytokine response","Interferon signaling",
    "Mitotic G1/S","Spindle checkpoint","DNA replication","Cytokinesis",
    "Lipid metabolism","Glycolysis","Amino acid","Cholesterol","Fatty acid oxidation",
    "MAPK","Wnt","TGFb","Hedgehog",
    "Caspase activation","BCL2 family","Mitochondrial apoptosis"
  ),
  count = c(45, 32, 28, 25,
            56, 42, 38, 30,
            48, 36, 33, 30, 28,
            52, 41, 35, 31,
            38, 30, 25)
)

treemap(
  df,
  index   = c("category", "term"),
  vSize   = "count",
  vColor  = "category",
  type    = "categorical",
  palette = c("#dc2626","#2563eb","#059669","#d97706","#7c3aed"),
  title   = "GO BP — Enrichment by Category",
  fontsize.labels = c(15, 9),
  fontcolor.labels = c("white","white"),
  border.col = "white",
  border.lwds = c(2, 1),
  align.labels = list(c("left","top"), c("center","center"))
)`,
    packages: ['treemap'],
    slogan: '一堆通路怎么按主题归类，方块大小说话',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: [],
      learning_outcomes: [
        '会构造层级数据框（parent + child）',
        '理解 treemap 何时比饼图清晰',
        '能用 vColor + palette 控制大类着色',
      ],
      hands_on: true,
      related_concepts: ['/figcode#dotplot', '/figcode#reactome-tree'],
    },
  },
  {
    id: 'go-emap',
    figLayout: 'complex',
    title: 'Enrichment Map',
    subtitle: '富集网络图',
    category: '功能富集',
    image: '/img/figcode/go-emap.png',
    description:
      '基于通路间基因重叠度（Jaccard / overlap coefficient）构建的网络图：节点 = 通路，边 = 相似度，聚团 = 功能模块。',
    inputFormat: 'enrichResult 对象（经 pairwise_termsim 计算相似度后）',
    biologicalQuestion: '富集到的几十条通路之间有没有冗余？能不能归成几个功能模块？',
    scenarios: [
      'GO/KEGG 富集结果去冗余展示',
      '识别功能模块（如"免疫相关"聚团）',
      'GSEA 结果的通路关系可视化',
      '文章 figure 展示富集全景',
    ],
    keyParams: [
      'pairwise_termsim() 计算相似度矩阵',
      'showCategory 展示通路数（20-50）',
      'layout 网络布局（默认 nicely）',
      'cluster 是否按模块着色',
    ],
    code: `library(ggplot2)
library(igraph)
library(ggraph)

# --- Demo: simulate enrichment map ---
set.seed(42)
n_terms <- 25
terms <- paste0("GO:", sprintf("%07d", sample(1e6, n_terms)))
labels <- paste("Process", LETTERS[1:n_terms])

# Simulate pairwise similarity (Jaccard-like)
sim_mat <- matrix(0, n_terms, n_terms)
for (i in 1:(n_terms-1)) {
  for (j in (i+1):n_terms) {
    # Create 3 clusters of related terms
    same_cluster <- (ceiling(i/8) == ceiling(j/8))
    sim_mat[i,j] <- sim_mat[j,i] <- ifelse(same_cluster, runif(1, 0.2, 0.7), runif(1, 0, 0.1))
  }
}

# Build network from similarity > threshold
threshold <- 0.15
edges <- which(sim_mat > threshold, arr.ind = TRUE)
edges <- edges[edges[,1] < edges[,2], ]
edge_df <- data.frame(from = labels[edges[,1]], to = labels[edges[,2]],
                      weight = sim_mat[edges])

g <- graph_from_data_frame(edge_df, directed = FALSE, vertices = data.frame(name = labels))
V(g)$pvalue <- runif(n_terms, 1e-8, 0.05)
V(g)$size <- -log10(V(g)$pvalue)
V(g)$cluster <- ceiling(1:n_terms / 8)

# --- Plot ---
ggraph(g, layout = "fr") +
  geom_edge_link(aes(width = weight), alpha = 0.3, color = "grey60") +
  geom_node_point(aes(size = size, color = factor(cluster))) +
  geom_node_text(aes(label = name), repel = TRUE, size = 2.5, max.overlaps = 12) +
  scale_edge_width(range = c(0.3, 2), guide = "none") +
  scale_size_continuous(range = c(3, 10), name = "-log10(p)") +
  scale_color_brewer(palette = "Set2", name = "Module") +
  labs(title = "Enrichment Map (GO-BP)") +
  theme_void()`,
    packages: ['ggplot2', 'igraph', 'ggraph'],
    slogan: '几十条通路看着多，画成网络一下就分出三四个功能模块',
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    onlineToolUrl: '/tools?tool=go-kegg',
    copilot: {
      domain: 'enrichment',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#dotplot', '/figcode#cnetplot'],
      learning_outcomes: [
        '理解 pairwise_termsim 计算通路相似度的原理',
        '能用 emapplot 或手动 ggraph 画富集网络',
        '会识别网络中的功能模块聚团',
      ],
      hands_on: true,
      related_concepts: ['/figcode#cnetplot', '/figcode#dotplot', '/figcode#reactome-tree'],
    },
  },
];
