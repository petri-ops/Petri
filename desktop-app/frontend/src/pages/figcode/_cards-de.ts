import type { FigCard } from './_data';

export const cards_de: FigCard[] = [
  {
    id: 'volcano',
    figLayout: 'default',
    title: 'Volcano Plot',
    subtitle: '火山图',
    category: '差异分析',
    image: '/img/tutorial/bulk-rnaseq/bulk04/01-volcano.png',
    description: '横轴 log2FC，纵轴 -log10(padj)，标注 top DE 基因。',
    inputFormat: '数据框：gene, log2FoldChange, padj',
    biologicalQuestion: '哪些基因在两组之间表达差异最显著？效应大小和统计显著性如何权衡？',
    scenarios: ['RNA-seq 差异分析结果展示', '蛋白组差异蛋白展示', '代谢组差异代谢物'],
    keyParams: [
      'padj 阈值（通常 0.05）',
      '|log2FC| 阈值（通常 1）',
      '标注基因数（top 10-20）',
      'LFC shrinkage 方法（apeglm）',
    ],
    code: `library(ggplot2)
library(ggrepel)

# --- Demo data (replace with your own) ---
set.seed(42)
n <- 2000
de_df <- data.frame(
  gene = paste0("Gene", 1:n),
  log2FC = rnorm(n, 0, 1.5),
  padj = runif(n, 0, 1)
)
de_df$padj[sample(n, 100)] <- runif(100, 1e-10, 0.01)
de_df$sig <- ifelse(de_df$padj < 0.05 & de_df$log2FC > 1, "Up",
             ifelse(de_df$padj < 0.05 & de_df$log2FC < -1, "Down", "NS"))
top <- de_df[order(de_df$padj), ][1:15, ]

# --- Plot ---
ggplot(de_df, aes(x = log2FC, y = -log10(padj), color = sig)) +
  geom_point(size = 0.6, alpha = 0.5) +
  geom_text_repel(data = top, aes(label = gene), size = 3, max.overlaps = 15) +
  scale_color_manual(values = c(Up="#dc2626", Down="#2563eb", NS="#9ca3af")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed") +
  labs(x = "log2 Fold Change", y = "-log10(adjusted p-value)", title = "Volcano Plot") +
  theme_classic()`,
    packages: ['ggplot2', 'ggrepel'],
    slogan: '上调下调一锅端，剩下的就是嫌疑人',
    tutorialUrl: '/docs/bulk-rnaseq/module04',
    onlineToolUrl: '/tools?tool=deseq2',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module03'],
      learning_outcomes: [
        '能识别火山图轴含义和常用阈值线',
        '会调 padj / |log2FC| 阈值',
        '能用 ggrepel 标注 top DE 基因',
      ],
      hands_on: true,
      related_concepts: ['/figcode#ma-plot', '/docs/bulk-rnaseq/module04'],
    },
  },
  {
    id: 'ma-plot',
    figLayout: 'default',
    title: 'MA Plot',
    subtitle: 'MA 图',
    category: '差异分析',
    image: '/img/tutorial/bulk-rnaseq/bulk02/05-pvalue-ma.png',
    description: '横轴 baseMean（log10），纵轴 shrunken log2FC。红点为显著 DE。',
    inputFormat: '数据框：baseMean, log2FoldChange, padj',
    biologicalQuestion: '差异表达是否与基因表达丰度相关？低表达基因的 fold change 是否可信？',
    scenarios: [
      'DESeq2 差异分析质控',
      '评估 LFC shrinkage 效果',
      '检测表达量依赖的偏差',
      '对比不同归一化方法',
    ],
    keyParams: [
      'LFC shrinkage 方法（apeglm / ashr / normal）',
      'padj 阈值',
      'baseMean 下限过滤',
      'alpha 透明度',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(123)
n <- 3000
ma_df <- data.frame(
  baseMean = 10^runif(n, 0, 5),
  log2FC = rnorm(n, 0, 1),
  padj = runif(n, 0, 1)
)
ma_df$padj[sample(n, 150)] <- runif(150, 1e-8, 0.01)
ma_df$sig <- ifelse(ma_df$padj < 0.05, "DE", "NS")

# --- Plot ---
ggplot(ma_df, aes(x = baseMean, y = log2FC, color = sig)) +
  geom_point(size = 0.4, alpha = 0.5) +
  scale_x_log10() +
  scale_color_manual(values = c(DE="#dc2626", NS="#9ca3af")) +
  geom_hline(yintercept = 0, color = "grey40") +
  labs(x = "Mean expression (log10)", y = "log2 Fold Change", title = "MA Plot") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '低丰度基因的 fold change？听个响',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 8,
      prerequisites: ['/docs/bulk-rnaseq/module02'],
      learning_outcomes: [
        '能用 MA 图判断低丰度基因 fold change 是否可信',
        '理解 LFC shrinkage 在 MA 图上的视觉效果',
      ],
      hands_on: true,
      related_concepts: ['/figcode#volcano', '/figcode#dispersion'],
    },
  },
  {
    id: 'diffbind-ma',
    figLayout: 'default',
    title: 'DiffBind MA Plot',
    subtitle: 'MA 图',
    category: '差异分析',
    image: '/img/tutorial/epigenomics/epi03/03-ma-plot.png',
    description: 'ChIP-seq 差异结合位点的 MA 图，红点 = FDR < 0.05。',
    inputFormat: 'DiffBind DBA 对象（已 dba.analyze）',
    biologicalQuestion: '两组之间哪些染色质区域的蛋白结合或组蛋白修饰发生了显著变化？',
    scenarios: [
      'ChIP-seq 差异结合分析结果展示',
      '组蛋白修饰变化位点鉴定',
      'ATAC-seq 差异开放区域分析',
      '药物处理前后结合变化',
    ],
    keyParams: [
      'th FDR 阈值（0.05）',
      'method 分析方法（DBA_DESEQ2 / DBA_EDGER）',
      'contrast 对比设计',
      'bFlip 是否翻转 fold change 方向',
      'bSmooth 是否平滑 MA 曲线',
    ],
    code: `library(ggplot2)

# --- Demo: simulate DiffBind-style MA data ---
set.seed(42)
n <- 5000
diffbind_df <- data.frame(
  Conc = runif(n, 2, 12),
  Fold = rnorm(n, 0, 1.2),
  FDR = runif(n, 0, 1)
)
diffbind_df$FDR[sample(n, 200)] <- runif(200, 1e-6, 0.04)
diffbind_df$sig <- ifelse(diffbind_df$FDR < 0.05, "Significant", "NS")

# --- Plot ---
ggplot(diffbind_df, aes(x = Conc, y = Fold, color = sig)) +
  geom_point(size = 0.4, alpha = 0.5) +
  scale_color_manual(values = c(Significant="#dc2626", NS="#9ca3af")) +
  geom_hline(yintercept = 0, color = "grey40") +
  labs(x = "log Concentration", y = "log Fold Change",
       title = "DiffBind MA Plot", color = "FDR < 0.05") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '结合变了表达不动，那是写文章的好题目',
    tutorialUrl: '/docs/epigenomics/module03',
    copilot: {
      domain: 'epigenomics',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/epigenomics/module03'],
      learning_outcomes: ['会用 MA 图展示差异结合 peak', '能识别两组之间结合强度变化最大的位点'],
      hands_on: true,
      related_concepts: ['/figcode#peak-anno', '/figcode#ma-plot'],
    },
  },
  {
    id: 'dispersion',
    figLayout: 'default',
    title: 'Dispersion Plot',
    subtitle: '离散度图',
    category: '差异分析',
    image: '/img/tutorial/bulk-rnaseq/bulk02/04-dispersion.png',
    description: '展示 DESeq2 基因离散度估计过程：原始值、拟合曲线和收缩后的最终值。',
    inputFormat: 'DESeqDataSet 对象（已运行 DESeq()）',
    biologicalQuestion: '基因的离散度估计是否合理？低表达基因的变异是否被适当收缩？',
    scenarios: [
      'DESeq2 模型拟合质控',
      '评估离散度收缩效果',
      '检测异常高离散度基因',
      '验证实验设计的统计功效',
    ],
    keyParams: [
      'fitType 拟合类型（parametric / local / mean）',
      'genewise 原始离散度点',
      'fitted 拟合趋势线',
      'final 收缩后离散度',
      'outlier 离群基因标记',
    ],
    code: `library(ggplot2)

# --- Demo: simulate dispersion estimates ---
set.seed(42)
n <- 2000
baseMean <- 10^runif(n, 0, 4)
# Gene-wise dispersion (noisy)
disp_gene <- 0.5 / sqrt(baseMean) + rnorm(n, 0, 0.1)
disp_gene[disp_gene < 0.001] <- 0.001
# Fitted trend
disp_fitted <- 0.5 / sqrt(baseMean)
# Final (shrunk toward fitted)
disp_final <- disp_gene * 0.3 + disp_fitted * 0.7

df <- data.frame(baseMean = baseMean, gene = disp_gene, fitted = disp_fitted, final = disp_final)

# --- Plot ---
ggplot(df, aes(x = baseMean)) +
  geom_point(aes(y = gene), color = "#9ca3af", size = 0.3, alpha = 0.5) +
  geom_point(aes(y = final), color = "#2563eb", size = 0.3, alpha = 0.5) +
  geom_line(aes(y = fitted), color = "#dc2626", linewidth = 1) +
  scale_x_log10() + scale_y_log10() +
  labs(x = "Mean of normalized counts", y = "Dispersion",
       title = "Dispersion Estimates") +
  annotate("text", x = 1000, y = 2, label = "gene-wise", color = "#9ca3af", size = 3) +
  annotate("text", x = 1000, y = 0.5, label = "final", color = "#2563eb", size = 3) +
  annotate("text", x = 1000, y = 0.1, label = "fitted", color = "#dc2626", size = 3) +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: '不收缩你跑这个 DESeq2 干嘛',
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module02'],
      learning_outcomes: [
        '看懂 DESeq2 离散度估计 / 拟合 / 收缩三条曲线',
        '能判断离散度估计是否合理',
      ],
      hands_on: true,
      related_concepts: ['/figcode#ma-plot', '/figcode#volcano'],
    },
  },
  {
    id: 'lfc-scatter',
    figLayout: 'default',
    title: 'LFC Scatter',
    subtitle: 'LFC 对比图',
    category: '差异分析',
    image: '/img/tutorial/bulk-rnaseq/bulk07/04-lfc-scatter.png',
    description: '对比两种差异分析工具（如 DESeq2 vs edgeR）的 log2FC 一致性散点图。',
    inputFormat: '数据框：gene, lfc_tool1, lfc_tool2',
    biologicalQuestion: '不同差异分析工具得到的 fold change 估计是否一致？哪些基因存在工具间分歧？',
    scenarios: [
      'DESeq2 vs edgeR 结果对比',
      'limma vs DESeq2 一致性验证',
      '多工具共识 DE 基因筛选',
      '方法学比较研究',
    ],
    keyParams: [
      'x/y 两种工具的 LFC 列',
      'cor.method 相关系数方法（pearson / spearman）',
      'highlight 不一致基因标注',
      'abline 对角线参考',
      'alpha 点透明度',
    ],
    code: `library(ggplot2)

# --- Demo data ---
set.seed(42)
n <- 1500
lfc1 <- rnorm(n, 0, 2)
lfc2 <- lfc1 + rnorm(n, 0, 0.5)  # Correlated with noise
compare_df <- data.frame(lfc_deseq2 = lfc1, lfc_edger = lfc2)
cor_val <- cor(lfc1, lfc2)

# --- Plot ---
ggplot(compare_df, aes(x = lfc_deseq2, y = lfc_edger)) +
  geom_point(size = 0.8, alpha = 0.4, color = "#475569") +
  geom_abline(slope = 1, intercept = 0, linetype = "dashed", color = "red") +
  geom_smooth(method = "lm", se = FALSE, color = "#2563eb") +
  annotate("text", x = -4, y = 5, label = paste0("r = ", round(cor_val, 3)),
           size = 4, fontface = "bold") +
  labs(x = "log2FC (DESeq2)", y = "log2FC (edgeR)",
       title = "LFC Concordance: DESeq2 vs edgeR") +
  theme_classic()`,
    packages: ['ggplot2'],
    slogan: 'DESeq2 和 edgeR 打架，吃瓜的赶紧检查输入',
    tutorialUrl: '/docs/bulk-rnaseq/module07',
    copilot: {
      domain: 'visualization',
      level: 'intermediate',
      estimated_minutes: 10,
      prerequisites: ['/docs/bulk-rnaseq/module07'],
      learning_outcomes: [
        '能用 LFC 散点图对比 DESeq2 / edgeR / limma 结果',
        '识别工具间分歧的基因',
      ],
      hands_on: true,
      related_concepts: ['/figcode#volcano', '/figcode#ma-plot'],
    },
  },
  {
    id: 'py-volcano-pydeseq2',
    figLayout: 'default',
    title: 'PyDESeq2 Volcano',
    subtitle: 'Python 火山图',
    category: '差异分析',
    image: '/img/figcode/py-volcano-pydeseq2.png',
    description: '用 PyDESeq2 做差异分析，matplotlib 画火山图。纯 Python 生态。',
    inputFormat: '数据框：gene, log2FoldChange, padj',
    biologicalQuestion: '哪些基因在两组之间差异最显著？Python 生态下如何做差异分析可视化？',
    scenarios: ['Python 用户的差异分析可视化', '与 R DESeq2 结果对比', '纯 Python 流程展示'],
    keyParams: ['padj 阈值（0.05）', '|log2FC| 阈值（1）', '标注基因数', '配色方案'],
    language: 'python',
    code: `import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

# --- Demo: simulate DEG results ---
np.random.seed(42)
n = 2000
genes = [f"Gene_{i}" for i in range(n)]
log2fc = np.random.normal(0, 1.5, n)
padj = np.random.uniform(0, 1, n)
# Make some genes significant
sig_idx = np.random.choice(n, 150, replace=False)
padj[sig_idx] = np.random.uniform(1e-10, 0.01, 150)

df = pd.DataFrame({"gene": genes, "log2FC": log2fc, "padj": padj})
df["sig"] = "NS"
df.loc[(df.padj < 0.05) & (df.log2FC > 1), "sig"] = "Up"
df.loc[(df.padj < 0.05) & (df.log2FC < -1), "sig"] = "Down"

# --- Plot ---
colors = {"Up": "#dc2626", "Down": "#2563eb", "NS": "#9ca3af"}
fig, ax = plt.subplots(figsize=(7, 5))

for sig, color in colors.items():
    mask = df["sig"] == sig
    ax.scatter(df.loc[mask, "log2FC"], -np.log10(df.loc[mask, "padj"]),
               c=color, s=8, alpha=0.6, label=f"{sig} ({mask.sum()})")

ax.axhline(-np.log10(0.05), ls="--", color="#9ca3af", lw=0.8)
ax.axvline(-1, ls="--", color="#9ca3af", lw=0.8)
ax.axvline(1, ls="--", color="#9ca3af", lw=0.8)

# Label top genes
top = df.nsmallest(10, "padj")
for _, row in top.iterrows():
    ax.annotate(row["gene"], (row["log2FC"], -np.log10(row["padj"])),
                fontsize=7, ha="center", va="bottom")

ax.set_xlabel("log2 Fold Change")
ax.set_ylabel("-log10(adjusted p-value)")
ax.set_title("Volcano Plot (Python)")
ax.legend(loc="upper right", frameon=False)
ax.spines[["top", "right"]].set_visible(False)
plt.tight_layout()
plt.savefig("plot_001.png", dpi=150, bbox_inches="tight")
print(f"Up: {(df.sig=='Up').sum()}, Down: {(df.sig=='Down').sum()}")`,
    packages: ['numpy', 'pandas', 'matplotlib'],
    slogan: '不装 R 也能画火山图，Python 党的福音',
    copilot: {
      domain: 'visualization',
      level: 'beginner',
      estimated_minutes: 8,
      learning_outcomes: [
        '能用 matplotlib 画出 SCI 级别的火山图',
        '会用 annotate 标注 top 差异基因',
      ],
      hands_on: true,
      related_concepts: ['/figcode#volcano'],
    },
  },
  {
    id: 'volcano-animated',
    figLayout: 'wide',
    title: 'Animated Volcano',
    subtitle: '动态火山图',
    category: '差异分析',
    image: '/img/figcode/volcano-animated.png',
    description: '多时间点的火山图按时间过渡（gganimate），看差异基因如何随时间出现 / 消失。',
    inputFormat: '长表数据框：gene, log2FC, padj, time_point',
    biologicalQuestion: '处理后基因表达变化的动态过程是什么？哪些基因早期就响应、哪些晚期才出现？',
    scenarios: [
      '药物处理时间序列',
      '感染早期 / 中期 / 晚期',
      '发育阶段动态分化',
      '汇报演示 GIF / mp4',
    ],
    keyParams: [
      'transition_states = "time_point"',
      'transition_length = 2 / state_length = 2',
      'fps = 10',
      'renderer = gifski_renderer()',
    ],
    code: `library(gganimate)
library(ggplot2)

# --- Demo: 4 time points ---
set.seed(42)
times <- c("0h", "6h", "12h", "24h")
make_de <- function(t) {
  n <- 800
  data.frame(
    gene = paste0("Gene", 1:n),
    log2FC = rnorm(n, 0, 1.4 * (which(times == t) / length(times))),
    padj   = runif(n, 0, 1),
    time_point = factor(t, levels = times)
  )
}
df <- do.call(rbind, lapply(times, make_de))
df$padj[sample(nrow(df), 60)] <- runif(60, 1e-12, 0.001)
df$sig <- ifelse(df$padj < 0.05 & df$log2FC > 1, "Up",
          ifelse(df$padj < 0.05 & df$log2FC < -1, "Down", "NS"))

# --- Animated volcano ---
p <- ggplot(df, aes(log2FC, -log10(padj), color = sig)) +
  geom_point(size = 0.7, alpha = 0.6) +
  scale_color_manual(values = c(Up="#dc2626", Down="#2563eb", NS="#9ca3af")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed") +
  labs(title = "Volcano at {closest_state}",
       x = "log2 Fold Change", y = "-log10(padj)") +
  theme_classic()

p_anim <- p + transition_states(time_point, transition_length = 2,
                                 state_length = 1) +
  ease_aes("cubic-in-out") +
  enter_fade() + exit_fade()

# Save as gif
anim_save("plot_001.gif", animation = p_anim,
          width = 700, height = 500, fps = 10, duration = 6)`,
    packages: ['gganimate', 'ggplot2', 'gifski'],
    slogan: '处理后基因怎么演变，动起来一目了然',
    tutorialUrl: '/docs/bulk-rnaseq/module05',
    copilot: {
      domain: 'visualization',
      level: 'advanced',
      estimated_minutes: 12,
      prerequisites: ['/figcode#volcano'],
      learning_outcomes: [
        '会用 gganimate::transition_states 在分组间过渡',
        '理解 ease_aes 控制过渡曲线',
        '能用 anim_save 输出 gif / mp4',
      ],
      hands_on: true,
      related_concepts: ['/figcode#volcano', '/figcode#time-trajectory'],
    },
  },
];
