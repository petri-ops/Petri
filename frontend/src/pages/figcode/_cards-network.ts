import type { FigCard } from './_data';

export const cards_network: FigCard[] = [
  {
    id: 'cnetplot',
    figLayout: 'complex',
    title: 'Gene-Term Network',
    subtitle: '通路网络图',
    category: '网络与互作',
    image: '/img/tutorial/bulk-rnaseq/bulk04/05-cnetplot.png',
    description: '大圆 = GO term，小点 = 基因，颜色 = log2FC。展示哪些基因被多条通路共享。',
    inputFormat: 'enrichGO 结果 + fold change 向量',
    biologicalQuestion: '富集通路之间是否共享关键基因？哪些基因是多条通路的枢纽节点？',
    scenarios: [
      '展示通路间基因重叠关系',
      '识别多通路共享的核心基因',
      '结合 fold change 展示调控方向',
      '文章 figure 展示功能网络',
    ],
    keyParams: [
      'showCategory 展示通路数（3-5）',
      'foldChange 向量（着色用）',
      'node_label 标签显示选项',
      'cex_label_gene 基因标签大小',
      'layout 网络布局算法',
    ],
    code: `library(ggplot2)
library(igraph)
library(ggraph)

# --- Demo: simulate gene-term network ---
set.seed(42)
terms <- c("Cell Cycle", "DNA Repair", "Apoptosis", "Immune Response")
genes_per_term <- list(
  c("CDK1","CDK2","CCNB1","CCNA2","CDC20"),
  c("BRCA1","RAD51","ATM","CDK2","CCNA2"),
  c("TP53","BAX","BCL2","CASP3","ATM"),
  c("IL6","TNF","IFNG","STAT1","TP53")
)

edges <- data.frame(from = character(), to = character(), stringsAsFactors = FALSE)
for (i in seq_along(terms)) {
  edges <- rbind(edges, data.frame(from = terms[i], to = genes_per_term[[i]]))
}
g <- graph_from_data_frame(edges, directed = FALSE)
V(g)$type <- ifelse(V(g)$name %in% terms, "term", "gene")
V(g)$size <- ifelse(V(g)$type == "term", 8, 3)

fc <- setNames(rnorm(length(unique(edges$to)), 0, 2), unique(edges$to))
V(g)$fc <- ifelse(V(g)$type == "gene", fc[V(g)$name], 0)

# --- Plot ---
ggraph(g, layout = "fr") +
  geom_edge_link(alpha = 0.3) +
  geom_node_point(aes(size = size, color = fc)) +
  geom_node_text(aes(label = name), repel = TRUE, size = 3) +
  scale_color_gradient2(low = "#2563eb", mid = "grey90", high = "#dc2626", midpoint = 0) +
  scale_size_continuous(range = c(2, 10), guide = "none") +
  labs(title = "Gene-Term Network", color = "log2FC") +
  theme_void()`,
    packages: ['ggplot2', 'igraph', 'ggraph'],
    slogan: '基因和通路缠成毛线团，靠它一根根抽出来',
    tutorialUrl: '/docs/bulk-rnaseq/module04',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/docs/bulk-rnaseq/module04'],
      learning_outcomes: ['能用网络图展示基因-通路的多对多关系', '识别多个通路共享的枢纽基因'],
      hands_on: true,
      related_concepts: ['/figcode#go-emap', '/figcode#dotplot'],
    },
  },
  {
    id: 'chord-plot',
    figLayout: 'wide',
    title: 'Chord Diagram',
    subtitle: '通讯弦图',
    category: '网络与互作',
    image: '/img/tutorial/single-cell/module07/05-pathway-chord.png',
    description: '弦图展示细胞类型间的配体-受体通讯强度，弧宽代表互作数量或概率。',
    inputFormat: 'CellChat 对象（已 computeCommunProb）',
    biologicalQuestion: '不同细胞类型之间通过哪些信号通路进行通讯？通讯强度如何分布？',
    scenarios: [
      '细胞间通讯全景展示',
      '特定信号通路的通讯网络',
      '不同条件下通讯变化对比',
      '配体-受体互作强度排序',
    ],
    keyParams: [
      'signaling 目标信号通路',
      'sources.use 发送细胞类型',
      'targets.use 接收细胞类型',
      'slot 通讯概率类型（net / netP）',
      'color.use 细胞类型配色',
    ],
    code: `library(circlize)

# --- Demo: simulate cell-cell communication ---
set.seed(42)
cell_types <- c("T cells", "B cells", "Macrophages", "Fibroblasts", "Epithelial")
n <- length(cell_types)

# Create interaction matrix
mat <- matrix(sample(0:20, n*n, replace = TRUE), nrow = n,
              dimnames = list(cell_types, cell_types))
diag(mat) <- sample(0:5, n, replace = TRUE)

colors <- c("#dc2626", "#2563eb", "#059669", "#d97706", "#7c3aed")
names(colors) <- cell_types

# --- Plot ---
circos.clear()
chordDiagram(mat, grid.col = colors, transparency = 0.3,
             annotationTrack = c("grid", "name"),
             preAllocateTracks = list(track.height = 0.05))
title("Cell-Cell Communication Network")`,
    packages: ['circlize'],
    slogan: '细胞之间也搞群聊，你看不见而已',
    tutorialUrl: '/docs/single-cell/module07',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/docs/single-cell/module06'],
      learning_outcomes: [
        '会用弦图展示 cell-cell 通讯网络',
        '能识别主导信号通路与 sender/receiver 角色',
      ],
      hands_on: true,
      related_concepts: ['/docs/single-cell/module06'],
    },
  },
  {
    id: 'cellchat-bubble',
    figLayout: 'complex',
    title: 'CellChat Bubble',
    subtitle: '细胞通讯气泡图',
    category: '网络与互作',
    image: '/img/figcode/cellchat-bubble.png',
    description: '气泡图展示细胞类型对之间的配体-受体通讯：气泡颜色 = 通讯概率，大小 = p 值。',
    inputFormat: 'CellChat 对象（CellChat::createCellChat 输出后跑完 computeCommunProb）',
    biologicalQuestion: '哪些细胞类型在用哪些信号通路对话？通讯方向是什么？',
    scenarios: [
      '肿瘤微环境免疫细胞通讯',
      '组织发育中信号传递',
      'CAR-T 治疗后的免疫重塑',
      '空间转录组配套通讯分析',
    ],
    keyParams: [
      'sources.use（发送方细胞类型索引）',
      'targets.use（接收方）',
      'signaling（指定信号通路名，如 "TGFb"）',
      'sort.by.source = TRUE（按发送方分组）',
      'remove.isolate = TRUE（去掉无通讯的对）',
    ],
    code: `library(CellChat)
library(ggplot2)

# --- Demo: load packaged toy CellChat object ---
# 真实使用时把它替换成自己跑出来的 cellchat 对象
data(cellchat, package = "CellChat")

# --- Bubble plot for selected source/target pairs ---
# 选 2 个发送方 vs 4 个接收方
netVisual_bubble(
  cellchat,
  sources.use = c(1, 2),
  targets.use = c(3, 4, 5, 6),
  remove.isolate = TRUE,
  angle.x = 45,
  font.size = 9,
  title.name = "Cell-cell Communication"
)`,
    packages: ['CellChat', 'ggplot2'],
    slogan: '哪种细胞跟哪种细胞讲话，气泡一摊全看清',
    tutorialUrl: '/docs/single-cell/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/docs/single-cell/module07'],
      learning_outcomes: [
        '能读懂 CellChat 气泡图的源/靶细胞对',
        '会用 sources.use / targets.use 筛选通讯对',
        '理解 communication probability 与 p 值的关系',
      ],
      hands_on: true,
      related_concepts: ['/figcode#chord-plot', '/docs/single-cell/module07'],
    },
  },
  {
    id: 'ppi-network',
    figLayout: 'complex',
    title: 'PPI Network',
    subtitle: '蛋白互作网络',
    category: '网络与互作',
    image: '/img/figcode/ppi-network.png',
    description: '基于 STRING 数据库构建差异蛋白的互作网络，节点大小 = 度数，颜色 = log2FC。',
    inputFormat: '差异基因/蛋白列表 + 物种 ID（人 = 9606）',
    biologicalQuestion: '我的差异蛋白之间有多少已知的互作关系？哪些是 hub 节点？',
    scenarios: [
      '蛋白组分析后找 hub 蛋白',
      'RNA-seq 差异基因功能模块',
      '药靶筛选与靶点优先级',
      '通路成员物理交互验证',
    ],
    keyParams: [
      'species = 9606（人）',
      'score_threshold（互作置信度，400 / 700 / 900）',
      'network_type = "physical"（物理互作）/ "full"',
      'add_diff_exp_color（按 log2FC 着色）',
    ],
    code: `library(STRINGdb)
library(igraph)
library(ggraph)
library(tidygraph)

# --- Demo gene list ---
genes <- c("TP53","BRCA1","BRCA2","EGFR","MYC","CDK1","CDK2","CCNB1",
           "MDM2","RB1","E2F1","CCNE1","CDKN1A","CDKN2A","ATM")
log2fc <- setNames(rnorm(length(genes), 0, 1.5), genes)

# --- STRING ---
string_db <- STRINGdb$new(
  version = "12.0",
  species = 9606,
  score_threshold = 700,
  network_type = "physical",
  input_directory = ""
)
mapped <- string_db$map(data.frame(gene = genes), "gene", removeUnmappedRows = TRUE)
edges <- string_db$get_interactions(mapped$STRING_id)

# Convert STRING IDs back to gene symbols
id_to_gene <- setNames(mapped$gene, mapped$STRING_id)
edges_g <- data.frame(
  from = id_to_gene[edges$from],
  to   = id_to_gene[edges$to],
  weight = edges$combined_score / 1000
)

g <- as_tbl_graph(edges_g, directed = FALSE) %>%
  activate(nodes) %>%
  mutate(degree  = centrality_degree(),
         log2fc  = log2fc[name])

# --- Plot ---
ggraph(g, layout = "fr") +
  geom_edge_link(aes(alpha = weight), edge_colour = "grey60") +
  geom_node_point(aes(size = degree, color = log2fc)) +
  geom_node_text(aes(label = name), repel = TRUE, size = 3) +
  scale_color_gradient2(low = "#2563eb", mid = "white", high = "#dc2626") +
  scale_size(range = c(2, 8)) +
  theme_void() +
  ggtitle("PPI Network — STRING (score > 700)")`,
    packages: ['STRINGdb', 'igraph', 'ggraph', 'tidygraph'],
    slogan: '差异基因之间谁牵着谁的手，STRING 一拉就清楚',
    tutorialUrl: '/docs/proteomics/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/docs/proteomics/module07'],
      learning_outcomes: [
        '会用 STRINGdb 拉取互作数据',
        '理解 score_threshold 在互作可信度过滤中的作用',
        '能用 ggraph 自定义网络图布局和着色',
      ],
      hands_on: true,
      related_concepts: ['/figcode#cnetplot', '/docs/proteomics/module07'],
    },
  },
  {
    id: 'sankey',
    figLayout: 'complex',
    title: 'Sankey Plot',
    subtitle: '桑基图',
    category: '网络与互作',
    image: '/img/figcode/sankey.png',
    description: '从左到右展示分类变量的流转：原 cluster → 注释类型 → 治疗后亚群，宽度 = 数量。',
    inputFormat: '数据框：source, target, value（每条流的起点 / 终点 / 权重）',
    biologicalQuestion: '细胞类型在不同条件下如何重新分布？通路成员如何映射到下游模块？',
    scenarios: [
      '细胞类型在治疗前后流转',
      '原始 cluster 与人工注释对应',
      'Pathway → 基因 → 表型映射',
      'GO term 在多通路间的重叠',
    ],
    keyParams: [
      'nodes data.frame（label / color）',
      'links data.frame（source / target / value）',
      'fontSize（节点字号）',
      'sinksRight = TRUE 终点对齐右',
    ],
    code: `library(networkD3)

# --- Demo data: cell type re-distribution after treatment ---
nodes <- data.frame(
  name = c("Pre_T","Pre_B","Pre_NK","Pre_Mono",
           "Post_T","Post_B","Post_NK","Post_Mono","Post_Apoptotic")
)
links <- data.frame(
  source = c(0, 0, 1, 1, 2, 3, 3),
  target = c(4, 8, 5, 8, 6, 7, 8),
  value  = c(60, 15, 40, 20, 30, 50, 25)
)

sankeyNetwork(
  Links = links, Nodes = nodes,
  Source = "source", Target = "target", Value = "value",
  NodeID = "name",
  fontSize = 12, nodeWidth = 18,
  sinksRight = TRUE,
  height = 400, width = 700
)`,
    packages: ['networkD3'],
    slogan: '细胞或基因在分类间怎么流，宽窄一目了然',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: [],
      learning_outcomes: [
        '能把关系数据转成 nodes + links 两表',
        '会用 networkD3 出交互式桑基图',
        '理解何时用 Sankey 比堆叠条形图更清晰',
      ],
      hands_on: true,
      related_concepts: ['/figcode#chord-plot', '/figcode#cnetplot'],
    },
  },
  {
    id: 'squidpy-neighbors',
    figLayout: 'wide',
    title: 'Squidpy Spatial Neighbors',
    subtitle: '空间邻接图',
    category: '网络与互作',
    image: '/img/figcode/squidpy-neighbors.png',
    description: 'Squidpy 计算空间邻接关系 + 邻居富集统计，看哪些细胞类型在物理上相邻聚集。',
    inputFormat: 'AnnData 空间对象（adata.obsm["spatial"] 含坐标 + obs.cell_type）',
    biologicalQuestion: '空间组里哪些细胞类型彼此挨着？哪些是空间隔离的？',
    scenarios: [
      '肿瘤微环境邻接结构',
      '组织 niche 识别',
      '免疫细胞与肿瘤细胞接触分析',
      '空间组论文 Figure 4 经典图',
    ],
    keyParams: [
      'coord_type = "generic" / "grid"',
      'n_neighs = 6',
      'cluster_key = "cell_type"',
      'mode = "zscore"',
    ],
    code: `import squidpy as sq
import scanpy as sc
import matplotlib.pyplot as plt

# --- Demo: Squidpy built-in mouse brain ---
adata = sq.datasets.visium_hne_adata()

# --- Compute spatial neighbors graph ---
sq.gr.spatial_neighbors(adata, coord_type="generic", n_neighs=6)

# --- Neighborhood enrichment (z-score) ---
sq.gr.nhood_enrichment(adata, cluster_key="cluster")

fig, axes = plt.subplots(1, 2, figsize=(13, 5.5))

# Panel 1: spatial scatter
sc.pl.spatial(
    adata, color="cluster",
    img_key=None, spot_size=15,
    ax=axes[0], show=False, title="Tissue clusters"
)

# Panel 2: neighborhood enrichment heatmap
sq.pl.nhood_enrichment(
    adata, cluster_key="cluster",
    method="ward", cmap="RdBu_r",
    ax=axes[1], title="Neighborhood enrichment (z-score)"
)

plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'matplotlib'],
    language: 'python',
    slogan: '空间上谁挨着谁，邻接富集一图说清',
    tutorialUrl: '/docs/single-cell/module09',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#spatial-cluster'],
      learning_outcomes: [
        '理解 spatial neighbors graph 的邻接定义',
        '会用 nhood_enrichment 跑 z-score 检验',
        '能识别"空间共定位"vs"空间排斥"的细胞对',
      ],
      hands_on: true,
      related_concepts: ['/figcode#spatial-cluster', '/figcode#spatial-deconv'],
    },
  },
  {
    id: 'spatial-lr-liana',
    figLayout: 'wide',
    title: 'Spatial Ligand-Receptor (LIANA)',
    subtitle: '空间配体受体',
    category: '网络与互作',
    image: '/img/figcode/spatial-lr-liana.png',
    description:
      'LIANA bivariate 在空间邻居 spot 上算配体-受体局部共现，无需预先注释细胞类型，找空间通讯热点。',
    inputFormat: 'AnnData 空间对象（adata.obsm["spatial"] 含坐标 + log-normalized 表达）',
    biologicalQuestion: '组织上哪些配体-受体对在物理邻近的 spot 间活跃？通讯热点对应什么解剖区域？',
    scenarios: [
      'Visium 空间细胞通讯',
      '肿瘤微环境 LR 互作',
      '发育梯度信号通路',
      '空间组论文通讯 Figure',
    ],
    keyParams: [
      'resource_name = "mouseconsensus" / "consensus"',
      'local_name = "cosine"（局部相似度）',
      'n_perms = 100（置换显著性）',
      'nz_prop = 0.05（非零比例下限）',
    ],
    code: `import squidpy as sq
import scanpy as sc
import liana as li
import numpy as np
import matplotlib.pyplot as plt

# --- Demo: Squidpy 内置小鼠脑 Visium HnE 真实数据 ---
adata = sq.datasets.visium_hne_adata()
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)

# --- 空间邻居图 + LIANA bivariate（空间感知 LR）---
# 演示用 n_perms=None（秒级）；正式分析建议 n_perms=100 做置换显著性
sq.gr.spatial_neighbors(adata, coord_type="generic", n_neighs=6)
lr = li.mt.bivariate(adata, resource_name="mouseconsensus",
                     local_name="cosine", n_perms=None,
                     use_raw=False, nz_prop=0.05, verbose=False)

# --- Top-1 LR pair 的空间局部得分 ---
import scipy.sparse as sp
X = lr.X.toarray() if sp.issparse(lr.X) else np.asarray(lr.X)
mean_score = X.mean(axis=0)
top_lr = lr.var.index[int(np.argmax(mean_score))]
adata.obs["LR_score"] = X[:, int(np.argmax(mean_score))]
sc.pl.spatial(adata, color="LR_score", img_key="hires",
              cmap="Reds", title=f"LR: {top_lr}", show=False)
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")`,
    packages: ['squidpy', 'scanpy', 'liana', 'matplotlib'],
    language: 'python',
    slogan: '不用先认细胞，邻居 spot 上配体受体谁跟谁对话直接算',
    tutorialUrl: '/docs/single-cell/module09',
    onlineToolUrl: '/tools/#spatial-lr',
    copilot: {
      domain: 'single-cell',
      level: 'advanced',
      estimated_minutes: 15,
      prerequisites: ['/figcode#squidpy-neighbors'],
      learning_outcomes: [
        '理解 bivariate 空间 LR 与 cluster-level LR 的区别',
        '会用 LIANA li.mt.bivariate 跑空间感知配体受体',
        '能把 LR 局部得分映射回组织看通讯热点',
      ],
      hands_on: true,
      related_concepts: ['/figcode#squidpy-neighbors', '/figcode#spatial-deconv-c2l'],
    },
  },
  {
    id: 'cci-heatmap',
    figLayout: 'complex',
    title: 'CCI Strength Heatmap',
    subtitle: '细胞通讯总数热图',
    category: '网络与互作',
    image: '/img/figcode/cci-heatmap.png',
    description:
      'CellChat netVisual_heatmap：发送方 × 接收方的通讯总强度热图，比 chord 更易读出对子。',
    inputFormat: 'CellChat 对象（已跑 aggregateNet）',
    biologicalQuestion: '哪两种细胞类型之间的通讯总量最高？通讯方向是双向还是单向？',
    scenarios: [
      '细胞通讯总览 figure',
      '配对 chord plot 对比',
      '治疗前后通讯强度变化',
      '通讯主导细胞识别',
    ],
    keyParams: [
      'measure = "count" / "weight"',
      'color.heatmap = "Reds" / "Blues"',
      'sources.use / targets.use 子集筛选',
    ],
    code: `library(CellChat)

# --- Demo data ---
data(cellchat, package = "CellChat")

# --- Aggregate net (count and weighted strength) ---
cellchat <- aggregateNet(cellchat)

par(mfrow = c(1, 2))

# Panel 1: number of interactions
netVisual_heatmap(
  cellchat,
  measure = "count",
  color.heatmap = "Reds",
  title.name  = "Number of interactions"
)

# Panel 2: total interaction strength
netVisual_heatmap(
  cellchat,
  measure = "weight",
  color.heatmap = "Reds",
  title.name  = "Interaction strength"
)`,
    packages: ['CellChat'],
    slogan: '哪两种细胞通讯最热闹，热图一目了然',
    tutorialUrl: '/docs/single-cell/module07',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 10,
      prerequisites: ['/figcode#cellchat-bubble'],
      learning_outcomes: [
        '理解 count vs weight 度量的不同含义',
        '能用 netVisual_heatmap 比 chord 看得更清',
        '会选择 sources.use / targets.use 聚焦特定细胞对',
      ],
      hands_on: true,
      related_concepts: ['/figcode#cellchat-bubble', '/figcode#chord-plot'],
    },
  },
];
