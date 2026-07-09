// ============================================================
// Tools — 在线分析工作台（单细胞风格三栏布局）
//
// 左侧：分析记录列表
// 中间：当前分析（参数表单 / 结果展示）
// 右侧：工具集（彩色图标卡片）
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { tools as staticTools, toolCategories } from '@/pages/_data';
import type { Tool } from '@/pages/_data';
import { TOOL_IMAGES } from '@/pages/_tool-images';
import { WorkbenchEmpty } from '@/components/ui/WorkbenchEmpty';
import { PageHeader } from '@/components/ui/PageHeader';
import { Lightbox } from '@/components/ui/Lightbox';
import { getToken, getApiPrefix, getStoredUser, isLoggedIn } from '@/lib/authClient';
import { LoginModal } from '@/components/auth/LoginModal';
import RunModal from '@/components/RunModal';
import { setCopilotContext } from '@/lib/copilotContext';
import type { FigCard } from '@/pages/figcode/_data';
import styles from '@/pages/tools.module.css';

type JobStatus =
  | 'idle'
  | 'uploading'
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface Job {
  id: string;
  tool_id: string;
  status: string;
  created_at: number;
  completed_at?: number;
  error?: string;
  name?: string;
}

interface JobResult {
  files?: Array<{ name: string; type: string; label?: string; url?: string }>;
  summary?: Record<string, any>;
}

// ---- Tool icon colors / report URLs / figcode map are now sourced from
// _data.ts (per-tool fields: color, reportUrl, figcodeMap). The lookup
// helpers below build maps once at module load. Single source of truth.
const TOOL_COLORS: Record<string, string> = Object.fromEntries(
  staticTools.map((t) => [t.id, t.color])
);

const REPORT_URLS: Record<string, string | undefined> = Object.fromEntries(
  staticTools.filter((t) => t.reportUrl).map((t) => [t.id, t.reportUrl])
);

// Combined output-filename → cardId map across all tools. Tools whose
// figcodeMap defines the same filename will collide; in practice keys are
// scoped enough (e.g. 'volcano.png' is DESeq2-specific) but if a future
// collision happens, prefer the active tool's map at lookup time via
// getFigcodeCardId(filename, toolId).
const FIGCODE_MAP: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const t of staticTools) {
    if (t.figcodeMap) Object.assign(m, t.figcodeMap);
  }
  return m;
})();

function getFigcodeCardId(filename: string): string | null {
  return FIGCODE_MAP[filename] || null;
}

// ---- Generate FigCode code that uses actual analysis result data ----
function generateFigcodeWithData(cardId: string, dataUrl: string, fallbackCode: string): string {
  // Build a full HTTP URL that R can read from
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://biof3.com';
  const fullUrl = dataUrl.startsWith('http') ? dataUrl : baseUrl + dataUrl;
  // Derive base job URL for other files
  const jobBase = fullUrl.replace(/\/[^/]+\.csv.*$/, '');
  // Token suffix for authenticated URLs
  const tokenSuffix = fullUrl.includes('?token=') ? '?' + fullUrl.split('?')[1] : '';

  // Cached read helper — only downloads once per session
  const cacheHeader = `# --- 数据加载（首次从服务器读取，后续使用缓存） ---
if (!exists("de_df")) {
  de_df <- read.csv("${fullUrl}")
  de_df <- de_df[!is.na(de_df$padj), ]
  cat("✓ 差异基因表已加载:", nrow(de_df), "个基因\\n")
}
`;

  const vstHeader = `# --- 加载 VST 表达矩阵 + 样本信息 ---
if (!exists("vst_mat")) {
  vst_mat <- read.csv("${jobBase}/vst_matrix.csv${tokenSuffix}", row.names = 1, check.names = FALSE)
  col_info <- read.csv("${jobBase}/coldata_info.csv${tokenSuffix}", row.names = 1)
  cat("✓ VST 矩阵已加载:", nrow(vst_mat), "基因 x", ncol(vst_mat), "样本\\n")
}
`;

  const dispHeader = `# --- 加载离散度数据 ---
if (!exists("disp_df")) {
  disp_df <- read.csv("${jobBase}/dispersion_data.csv${tokenSuffix}")
  cat("✓ 离散度数据已加载:", nrow(disp_df), "基因\\n")
}
`;

  const templates: Record<string, string> = {
    volcano: `library(ggplot2)
library(ggrepel)

${cacheHeader}
# 标记显著性
de_df$sig <- ifelse(de_df$padj < 0.05 & de_df$log2FoldChange > 1, "Up",
             ifelse(de_df$padj < 0.05 & de_df$log2FoldChange < -1, "Down", "NS"))
top <- head(de_df[de_df$sig != "NS", ], 15)

ggplot(de_df, aes(x = log2FoldChange, y = -log10(padj), color = sig)) +
  geom_point(size = 0.6, alpha = 0.5) +
  geom_text_repel(data = top, aes(label = gene), size = 3, max.overlaps = 15) +
  scale_color_manual(values = c(Up = "#dc2626", Down = "#2563eb", NS = "#9ca3af")) +
  geom_vline(xintercept = c(-1, 1), linetype = "dashed") +
  geom_hline(yintercept = -log10(0.05), linetype = "dashed") +
  labs(x = "log2 Fold Change", y = "-log10(padj)", title = "Volcano Plot") +
  theme_classic()`,

    'ma-plot': `library(ggplot2)

${cacheHeader}
de_df$sig <- abs(de_df$log2FoldChange) > 1 & de_df$padj < 0.05

ggplot(de_df, aes(x = log10(baseMean + 1), y = log2FoldChange, color = sig)) +
  geom_point(size = 0.5, alpha = 0.4) +
  scale_color_manual(values = c("FALSE" = "#9ca3af", "TRUE" = "#dc2626")) +
  geom_hline(yintercept = c(-1, 0, 1), linetype = c("dashed", "solid", "dashed"), color = c("#2563eb", "black", "#dc2626")) +
  labs(x = "log10(baseMean)", y = "log2 Fold Change", title = "MA Plot") +
  theme_classic() + theme(legend.position = "none")`,

    heatmap: `library(ggplot2)
library(pheatmap)

${vstHeader}
${cacheHeader}
# Top 50 差异基因热图（和分析脚本完全一致）
sig <- de_df[de_df$padj < 0.05 & abs(de_df$log2FoldChange) > 1, ]
top50 <- head(sig[order(sig$padj), "gene"], 50)
top50 <- top50[top50 %in% rownames(vst_mat)]

mat <- vst_mat[top50, ]
mat_z <- t(scale(t(mat)))
anno_col <- data.frame(Group = col_info[[1]], row.names = rownames(col_info))

pheatmap(mat_z, annotation_col = anno_col, show_colnames = FALSE,
         clustering_method = "ward.D2", fontsize_row = 7,
         color = colorRampPalette(c("#2563eb", "white", "#dc2626"))(100),
         main = "Top 50 DEGs")`,

    pca: `library(ggplot2)

${vstHeader}
# PCA（和分析脚本完全一致，使用 VST 数据）
pca_res <- prcomp(t(vst_mat), scale. = FALSE)
pca_df <- data.frame(PC1 = pca_res$x[,1], PC2 = pca_res$x[,2], group = col_info[[1]])
pct <- round(100 * pca_res$sdev^2 / sum(pca_res$sdev^2), 1)

ggplot(pca_df, aes(PC1, PC2, color = group)) +
  geom_point(size = 3) +
  labs(title = "PCA", x = paste0("PC1 (", pct[1], "%)"), y = paste0("PC2 (", pct[2], "%)")) +
  theme_classic()`,

    'library-size': `library(ggplot2)

${vstHeader}
# 文库大小条形图（和分析脚本一致）
lib_df <- data.frame(
  sample = colnames(vst_mat),
  millions = colSums(2^vst_mat) / 1e6,
  group = col_info[[1]]
)

ggplot(lib_df, aes(sample, millions, fill = group)) +
  geom_col() +
  scale_fill_manual(values = c("#2563eb", "#dc2626")) +
  labs(title = "Library Size", y = "Millions", x = "") +
  theme_classic() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1))`,

    dispersion: `library(ggplot2)

${dispHeader}
# 离散度估计图（和分析脚本一致）
disp_df <- disp_df[disp_df$baseMean > 0 & !is.na(disp_df$dispGeneEst), ]

ggplot(disp_df, aes(x = baseMean, y = dispGeneEst)) +
  geom_point(size = 0.3, alpha = 0.3, color = "black") +
  geom_line(aes(y = dispFit), color = "red", linewidth = 0.8) +
  geom_point(aes(y = dispersion), size = 0.3, alpha = 0.3, color = "#2563eb") +
  scale_x_log10() + scale_y_log10() +
  labs(title = "Dispersion Estimates", x = "mean of normalized counts", y = "dispersion") +
  theme_classic()`,

    'sample-cor': `library(ggplot2)
library(pheatmap)

${vstHeader}
# 样本距离热图（和分析脚本完全一致）
sampleDists <- dist(t(as.matrix(vst_mat)))
sampleDistMatrix <- as.matrix(sampleDists)
rownames(sampleDistMatrix) <- paste0(colnames(vst_mat), " (", col_info[[1]], ")")
colnames(sampleDistMatrix) <- rownames(sampleDistMatrix)

pheatmap(sampleDistMatrix, main = "Sample Distance",
         color = colorRampPalette(c("white", "#dc2626"))(50))`,

    // ---- GO/KEGG Enrichment templates ----
    dotplot: `library(ggplot2)

# --- 加载 GO-BP 富集数据 ---
if (!exists("go_bp")) {
  go_bp <- read.csv("${fullUrl}")
  cat("✓ GO-BP 数据已加载:", nrow(go_bp), "条通路\\n")
}

# 取 Top 20
top <- head(go_bp[order(go_bp$p.adjust), ], 20)
top$GeneRatio_num <- sapply(top$GeneRatio, function(x) eval(parse(text=x)))

ggplot(top, aes(x = GeneRatio_num, y = reorder(Description, GeneRatio_num), size = Count, color = p.adjust)) +
  geom_point() +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  labs(x = "GeneRatio", y = "", title = "GO-BP Enrichment Dotplot", size = "Count", color = "p.adjust") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 9))`,

    'go-bar': `library(ggplot2)

# --- 加载 GO-BP 富集数据 ---
if (!exists("go_bp")) {
  go_bp <- read.csv("${fullUrl}")
  cat("✓ GO-BP 数据已加载:", nrow(go_bp), "条通路\\n")
}

top <- head(go_bp[order(go_bp$p.adjust), ], 20)

ggplot(top, aes(x = Count, y = reorder(Description, Count), fill = p.adjust)) +
  geom_col() +
  scale_fill_gradient(low = "#dc2626", high = "#2563eb") +
  labs(x = "Gene Count", y = "", title = "GO-BP Enrichment Barplot") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 9))`,

    'kegg-dotplot': `library(ggplot2)

# --- 加载 KEGG 富集数据 ---
if (!exists("kegg_data")) {
  kegg_data <- read.csv("${jobBase}/kegg_data.csv${tokenSuffix}")
  cat("✓ KEGG 数据已加载:", nrow(kegg_data), "条通路\\n")
}

top <- head(kegg_data[order(kegg_data$p.adjust), ], 20)
top$GeneRatio_num <- sapply(top$GeneRatio, function(x) eval(parse(text=x)))

ggplot(top, aes(x = GeneRatio_num, y = reorder(Description, GeneRatio_num), size = Count, color = p.adjust)) +
  geom_point() +
  scale_color_gradient(low = "#dc2626", high = "#2563eb") +
  labs(x = "GeneRatio", y = "", title = "KEGG Pathway Enrichment", size = "Count", color = "p.adjust") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 9))`,

    cnetplot: `library(clusterProfiler)
library(enrichplot)
library(org.Hs.eg.db)

# --- 加载完整 enrichResult 对象 ---
if (!exists("ego_bp_obj")) {
  ego_bp_obj <- readRDS(url("${jobBase}/ego_bp.rds${tokenSuffix}"))
  cat("✓ GO-BP enrichResult 对象已加载\\n")
}

cnetplot(ego_bp_obj, showCategory = 5, categorySize = "pvalue") +
  ggtitle("GO-BP Gene-Concept Network")`,

    treemap: `library(clusterProfiler)
library(enrichplot)

# --- 加载完整 enrichResult 对象 ---
if (!exists("ego_bp_obj")) {
  ego_bp_obj <- readRDS(url("${jobBase}/ego_bp.rds${tokenSuffix}"))
  cat("✓ GO-BP enrichResult 对象已加载\\n")
}

ego_bp_sim <- pairwise_termsim(ego_bp_obj)
treeplot(ego_bp_sim, showCategory = 30) +
  ggtitle("GO-BP Enrichment Tree")`,

    'go-emap': `library(clusterProfiler)
library(enrichplot)

# --- 加载完整 enrichResult 对象 ---
if (!exists("ego_bp_obj")) {
  ego_bp_obj <- readRDS(url("${jobBase}/ego_bp.rds${tokenSuffix}"))
  cat("✓ GO-BP enrichResult 对象已加载\\n")
}

ego_bp_sim <- pairwise_termsim(ego_bp_obj)
emapplot(ego_bp_sim, showCategory = 30) +
  ggtitle("GO-BP Enrichment Map")`,

    // ---- KM Survival templates ----
    'km-curve': `library(survival)
library(survminer)

# --- 加载生存数据 ---
if (!exists("surv_df")) {
  surv_df <- read.csv("${jobBase}/survival_data.csv${tokenSuffix}")
  surv_df$group <- factor(surv_df$group, levels = c("Low", "High"))
  cat("✓ 生存数据已加载:", nrow(surv_df), "样本\\n")
}

fit <- survfit(Surv(time, event) ~ group, data = surv_df)

ggsurvplot(fit, data = surv_df,
           pval = TRUE, pval.method = TRUE,
           risk.table = TRUE, risk.table.height = 0.25,
           palette = c("#2563eb", "#dc2626"),
           legend.labs = c("Low", "High"),
           xlab = "Time", ylab = "Survival Probability",
           title = "Kaplan-Meier Survival Curve",
           ggtheme = theme_classic())`,

    'forest-cox': `library(survival)
library(ggplot2)

# --- 加载 Cox 回归结果 ---
if (!exists("cox_df")) {
  cox_df <- read.csv("${jobBase}/cox_results.csv${tokenSuffix}")
  cat("✓ Cox 结果已加载\\n")
}

ggplot(cox_df, aes(x = HR, y = Variable)) +
  geom_point(size = 4, color = "#2e8555") +
  geom_errorbarh(aes(xmin = HR_lower, xmax = HR_upper), height = 0.2, color = "#2e8555") +
  geom_vline(xintercept = 1, linetype = "dashed", color = "gray50") +
  scale_x_log10() +
  labs(x = "Hazard Ratio (95% CI)", y = NULL,
       title = "Cox Regression Forest Plot",
       subtitle = paste0("HR = ", cox_df$HR, " (", cox_df$HR_lower, "-", cox_df$HR_upper, "), p = ", cox_df$P_value)) +
  theme_classic() +
  theme(plot.title = element_text(size = 13, face = "bold"))`,

    'time-roc': `library(timeROC)
library(survival)

# --- 加载生存数据 ---
if (!exists("surv_df")) {
  surv_df <- read.csv("${jobBase}/survival_data.csv${tokenSuffix}")
  cat("✓ 生存数据已加载:", nrow(surv_df), "样本\\n")
}

# 自动检测时间单位
max_t <- max(surv_df$time)
if (max_t > 365) { times <- c(365, 365*3, 365*5); labels <- c("1-year", "3-year", "5-year") }
else if (max_t > 12) { times <- c(12, 36, 60); labels <- c("1-year", "3-year", "5-year") }
else { times <- c(1, 3, 5); labels <- c("1-year", "3-year", "5-year") }
times <- times[times <= max_t * 0.9]
labels <- labels[1:length(times)]

roc_res <- timeROC(T = surv_df$time, delta = surv_df$event,
                   marker = surv_df$gene_expr, cause = 1, times = times, iid = TRUE)

colors <- c("#dc2626", "#2563eb", "#16a34a")
plot(roc_res, time = times[1], col = colors[1], lwd = 2, title = "Time-dependent ROC")
if (length(times) >= 2) plot(roc_res, time = times[2], col = colors[2], lwd = 2, add = TRUE)
if (length(times) >= 3) plot(roc_res, time = times[3], col = colors[3], lwd = 2, add = TRUE)
abline(0, 1, lty = 2, col = "gray")
legend("bottomright", legend = paste0(labels, " (AUC=", sprintf("%.3f", roc_res$AUC), ")"),
       col = colors[1:length(times)], lwd = 2, bty = "n")`,

    'expr-dist': `library(ggplot2)

# --- 加载生存数据 ---
if (!exists("surv_df")) {
  surv_df <- read.csv("${jobBase}/survival_data.csv${tokenSuffix}")
  surv_df$group <- factor(surv_df$group, levels = c("Low", "High"))
  cat("✓ 生存数据已加载:", nrow(surv_df), "样本\\n")
}

cutoff_val <- median(surv_df$gene_expr)

ggplot(surv_df, aes(x = gene_expr, fill = group)) +
  geom_histogram(bins = 30, alpha = 0.7, position = "identity") +
  geom_vline(xintercept = cutoff_val, linetype = "dashed", color = "gray30", linewidth = 0.8) +
  scale_fill_manual(values = c(Low = "#2563eb", High = "#dc2626")) +
  labs(x = "Gene Expression", y = "Count",
       title = "Expression Distribution",
       subtitle = paste0("Cutoff = ", round(cutoff_val, 3))) +
  theme_classic() +
  theme(plot.title = element_text(size = 13, face = "bold"), legend.position = "top")`,

    'immune-composition': `library(ggplot2)
library(reshape2)

# --- 加载本次分析的免疫细胞 score ---
mat <- as.matrix(read.csv("${jobBase}/immune_scores_normalized.csv${tokenSuffix}", row.names = 1, check.names = FALSE))
df <- melt(mat); colnames(df) <- c('CellType','Sample','Score')
df$Sample <- factor(df$Sample, levels = colnames(mat))

ggplot(df, aes(x = Sample, y = Score, fill = CellType)) +
  geom_bar(stat = 'identity', position = 'fill', width = 0.9) +
  scale_y_continuous(labels = scales::percent) +
  labs(x = NULL, y = 'Relative Proportion', title = 'Immune Cell Composition (ssGSEA)', fill = 'Cell Type') +
  theme_classic() +
  theme(axis.text.x = element_text(angle = 90, hjust = 1, size = 7), legend.text = element_text(size = 8))`,

    'immune-cor': `library(ggplot2)
library(reshape2)

# --- 加载本次分析的免疫细胞 raw score ---
mat <- as.matrix(read.csv("${jobBase}/immune_scores_raw.csv${tokenSuffix}", row.names = 1, check.names = FALSE))

cor_mat <- cor(t(mat), method = 'spearman')
df <- melt(cor_mat); colnames(df) <- c('A','B','r')

ggplot(df, aes(A, B, fill = r)) +
  geom_tile(color = 'white') +
  scale_fill_gradient2(low = '#2563eb', mid = 'white', high = '#dc2626', midpoint = 0, limits = c(-1, 1)) +
  labs(x = NULL, y = NULL, title = 'Immune Cell Co-infiltration (Spearman)', fill = 'r') +
  theme_classic() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1, size = 9))`,

    'immune-boxplot': `library(ggplot2)
library(reshape2)

# --- 加载本次分析的免疫细胞 score + 分组 ---
mat <- as.matrix(read.csv("${jobBase}/immune_scores_raw.csv${tokenSuffix}", row.names = 1, check.names = FALSE))
# Top 12 by variance
cell_var <- apply(mat, 1, var)
top_cells <- names(sort(cell_var, decreasing = TRUE))[1:min(12, nrow(mat))]
mat <- mat[top_cells, ]

df <- melt(mat); colnames(df) <- c('CellType','Sample','Score')
# 用户需手动添加 Group 列（如从 group.csv 加载）
# df$Group <- group_info$group[match(df$Sample, group_info$sample)]

ggplot(df, aes(CellType, Score)) +
  geom_boxplot(outlier.size = 0.5, width = 0.7, fill = '#a78bfa') +
  labs(x = NULL, y = 'ssGSEA Score', title = 'Immune Infiltration: Top 12 Variable Cells') +
  theme_classic() +
  theme(axis.text.x = element_text(angle = 45, hjust = 1, size = 9))`,

    'immune-lollipop': `library(ggplot2)

# --- 加载本次分析的免疫细胞 score ---
mat <- as.matrix(read.csv("${jobBase}/immune_scores_raw.csv${tokenSuffix}", row.names = 1, check.names = FALSE))

mean_scores <- sort(rowMeans(mat), decreasing = TRUE)
df <- data.frame(
  CellType = factor(names(mean_scores), levels = rev(names(mean_scores))),
  MeanScore = mean_scores
)

ggplot(df, aes(x = MeanScore, y = CellType)) +
  geom_segment(aes(x = 0, xend = MeanScore, y = CellType, yend = CellType), color = '#dfe8e3', linewidth = 0.8) +
  geom_point(size = 3, color = '#2e8555') +
  labs(x = 'Mean ssGSEA Score', y = NULL, title = 'Immune Cell Infiltration Level') +
  theme_classic() +
  theme(plot.title = element_text(size = 13, face = 'bold'))`,

    // ============================================================
    // Seurat-standard 在线绘图模板
    // 中间数据: qc_metrics.csv / umap_coords.csv / hvg_table.csv /
    //          markers_table.csv / pca_loadings.csv / seurat_obj.rds
    // ============================================================
    'sc-qc-violin': `library(ggplot2)
library(tidyr)

# --- 加载本次分析的 QC 指标 ---
qc <- read.csv("${jobBase}/qc_metrics.csv${tokenSuffix}")
cat("✓ QC 指标已加载:", nrow(qc), "细胞\\n")

# Long format for facet_wrap
qc_long <- pivot_longer(qc, cols = c("nFeature_RNA", "nCount_RNA", "percent.mt"),
                         names_to = "metric", values_to = "value")

ggplot(qc_long, aes(x = metric, y = value, fill = metric)) +
  geom_violin(scale = "width", trim = FALSE) +
  geom_jitter(size = 0.1, alpha = 0.3) +
  facet_wrap(~ metric, scales = "free", nrow = 1) +
  scale_fill_manual(values = c(nFeature_RNA = "#2e8555", nCount_RNA = "#2563eb", percent.mt = "#dc2626")) +
  labs(x = NULL, y = "Value", title = "QC: nFeature, nCount, percent.mt") +
  theme_classic() +
  theme(strip.background = element_blank(), legend.position = "none")`,

    umap: `library(ggplot2)

# --- 加载本次分析的 UMAP 坐标 + cluster ---
umap <- read.csv("${jobBase}/umap_coords.csv${tokenSuffix}")
umap$cluster <- factor(umap$cluster)
cat("✓ UMAP 已加载:", nrow(umap), "细胞,", length(levels(umap$cluster)), "clusters\\n")

# Cluster centroid for label
centroids <- aggregate(cbind(UMAP_1, UMAP_2) ~ cluster, data = umap, FUN = mean)

ggplot(umap, aes(x = UMAP_1, y = UMAP_2, color = cluster)) +
  geom_point(size = 0.6, alpha = 0.8) +
  geom_text(data = centroids, aes(label = cluster), color = "black", size = 5, fontface = "bold") +
  labs(x = "UMAP_1", y = "UMAP_2", title = paste0("UMAP — ", length(levels(umap$cluster)), " clusters")) +
  theme_classic() +
  theme(legend.position = "none")`,

    'sc-pca': `library(ggplot2)

# --- 加载 UMAP 坐标（含 cluster） ---
# 注意: 完整 PCA 散点图需要 seurat_obj.rds, 此处用 UMAP 坐标 + cluster 作演示
# 如需真正的 PC1 vs PC2, 请加载 RDS:
# obj <- readRDS("${jobBase}/seurat_obj.rds${tokenSuffix}")
# pca_data <- as.data.frame(Seurat::Embeddings(obj, "pca"))
# pca_data$cluster <- as.character(Seurat::Idents(obj))

umap <- read.csv("${jobBase}/umap_coords.csv${tokenSuffix}")
umap$cluster <- factor(umap$cluster)

ggplot(umap, aes(x = UMAP_1, y = UMAP_2, color = cluster)) +
  geom_point(size = 0.6) +
  scale_color_brewer(palette = "Set2") +
  labs(title = "Cell embedding (UMAP, colored by cluster)") +
  theme_classic()`,

    'sc-deg-heatmap': `library(ggplot2)
library(dplyr)

# --- 加载本次分析的 marker 表 ---
markers <- read.csv("${jobBase}/markers_table.csv${tokenSuffix}")
cat("✓ Markers 表已加载:", nrow(markers), "条记录,", length(unique(markers$cluster)), "clusters\\n")

# Top N per cluster
top_n <- 5  # 可改：每 cluster 显示几个 marker
top_markers <- markers %>%
  group_by(cluster) %>%
  slice_max(order_by = avg_log2FC, n = top_n) %>%
  ungroup()

# Bubble plot 替代 DoHeatmap (后者需要 RDS 中的 scaled data)
ggplot(top_markers, aes(x = factor(cluster), y = gene, size = -log10(p_val_adj + 1e-300), color = avg_log2FC)) +
  geom_point() +
  scale_color_gradient2(low = "#2563eb", mid = "white", high = "#dc2626", midpoint = 0) +
  scale_size_continuous(range = c(1, 6)) +
  labs(x = "Cluster", y = NULL, title = paste0("Top ", top_n, " Markers per Cluster"),
       size = "-log10(padj)", color = "log2FC") +
  theme_classic() +
  theme(axis.text.y = element_text(size = 7),
        axis.text.x = element_text(size = 9))`,

    'sc-marker-bubble': `library(ggplot2)
library(dplyr)

# --- 加载 marker 表 ---
markers <- read.csv("${jobBase}/markers_table.csv${tokenSuffix}")

# Top 1 marker per cluster
top1 <- markers %>%
  group_by(cluster) %>%
  slice_max(order_by = avg_log2FC, n = 1) %>%
  ungroup() %>%
  head(8)  # 限制为前 8 个 cluster

ggplot(top1, aes(x = factor(cluster), y = avg_log2FC, fill = factor(cluster))) +
  geom_col() +
  geom_text(aes(label = gene), vjust = -0.3, size = 3.5, fontface = "bold") +
  scale_fill_brewer(palette = "Set2") +
  labs(x = "Cluster", y = "avg log2FC", title = "Top Marker per Cluster") +
  theme_classic() +
  theme(legend.position = "none")`,

    // ============================================================
    // LASSO-Cox 在线绘图模板
    // 中间数据: signature_genes.csv (gene, coefficient) /
    //          risk_scores.csv (sample, risk_score, group, time, event, set) /
    //          signature_expr_matrix.csv (gene, [samples sorted by risk]) /
    //          lasso_cv_fit.rds (cv.glmnet object, optional)
    // ============================================================
    'lasso-cv-plot': `library(glmnet)
library(survival)

# --- 加载本次分析的 cv.glmnet 对象 ---
# RDS 路径需要带 token 的下载（R 不能直接跨域 readRDS HTTPS URL，先 download.file 到 tmp）
rds_url <- "${jobBase}/lasso_cv_fit.rds${tokenSuffix}"
tmp_rds <- tempfile(fileext = ".rds")
download.file(rds_url, tmp_rds, mode = "wb", quiet = TRUE)
cv_fit <- readRDS(tmp_rds)
cat("✓ cv.glmnet 对象已加载，lambda.min =", round(cv_fit$lambda.min, 4),
    ", lambda.1se =", round(cv_fit$lambda.1se, 4), "\\n")

# --- 绘 CV 曲线 ---
plot(cv_fit, main = "LASSO Cox Cross-Validation")
abline(v = log(cv_fit$lambda.min), col = "red", lty = 2)
abline(v = log(cv_fit$lambda.1se), col = "blue", lty = 2)
legend("topright", legend = c("lambda.min", "lambda.1se"),
       col = c("red", "blue"), lty = 2, bty = "n")`,

    'lasso-coef': `library(ggplot2)

# --- 加载本次分析的 signature 系数 ---
sig_table <- read.csv("${jobBase}/signature_genes.csv${tokenSuffix}")
cat("✓ Signature:", nrow(sig_table), "个基因\\n")

# 按系数大小排序 + 染色
sig_table$gene <- factor(sig_table$gene, levels = sig_table$gene[order(sig_table$coefficient)])
sig_table$direction <- ifelse(sig_table$coefficient > 0, "Risk", "Protective")

ggplot(sig_table, aes(x = coefficient, y = gene, fill = direction)) +
  geom_col(width = 0.7) +
  scale_fill_manual(values = c(Risk = "#dc2626", Protective = "#2563eb")) +
  geom_vline(xintercept = 0, color = "gray30") +
  labs(x = "LASSO Coefficient", y = NULL,
       title = paste0("Signature: ", nrow(sig_table), " Genes"),
       subtitle = "Red = Risk Factor, Blue = Protective") +
  theme_classic() +
  theme(plot.title = element_text(size = 13, face = "bold"),
        legend.position = "top")`,

    'risk-triple': `library(ggplot2)
library(gridExtra)

# --- 加载 risk score + 表达矩阵 ---
risk_df <- read.csv("${jobBase}/risk_scores.csv${tokenSuffix}")
sig_expr <- read.csv("${jobBase}/signature_expr_matrix.csv${tokenSuffix}", check.names = FALSE)
cat("✓ Risk score:", nrow(risk_df), "样本; Signature 表达:", nrow(sig_expr), "基因\\n")

# 按 risk score 排序（risk_scores.csv 顺序未必排好）
risk_sorted <- risk_df[order(risk_df$risk_score), ]
risk_sorted$rank <- 1:nrow(risk_sorted)
risk_cutoff <- median(risk_sorted$risk_score)

# Panel 1: risk score scatter
p1 <- ggplot(risk_sorted, aes(x = rank, y = risk_score, color = group)) +
  geom_point(size = 1) +
  scale_color_manual(values = c(Low = "#2563eb", High = "#dc2626")) +
  geom_hline(yintercept = risk_cutoff, linetype = "dashed") +
  labs(x = "Patients (sorted)", y = "Risk Score", title = "Risk Score Distribution") +
  theme_classic() + theme(legend.position = "none")

# Panel 2: survival status scatter
p2 <- ggplot(risk_sorted, aes(x = rank, y = time, color = factor(event))) +
  geom_point(size = 1) +
  scale_color_manual(values = c("0" = "#16a34a", "1" = "#dc2626"),
                     labels = c("Alive", "Dead"), name = NULL) +
  labs(x = "Patients (sorted)", y = "Survival Time", title = "Survival Status") +
  theme_classic() + theme(legend.position = "top")

# Panel 3: signature gene heatmap
gene_col <- sig_expr[[1]]
heat_mat <- as.matrix(sig_expr[, -1, drop = FALSE])
rownames(heat_mat) <- gene_col
heat_mat <- heat_mat[, risk_sorted$sample, drop = FALSE]  # 重新排序到 risk 顺序
heat_mat_z <- t(scale(t(heat_mat)))
heat_mat_z[heat_mat_z >  2] <-  2
heat_mat_z[heat_mat_z < -2] <- -2

heat_df <- expand.grid(gene = rownames(heat_mat_z), sample = 1:ncol(heat_mat_z))
heat_df$value <- as.vector(heat_mat_z)

p3 <- ggplot(heat_df, aes(x = sample, y = gene, fill = value)) +
  geom_tile() +
  scale_fill_gradient2(low = "#2563eb", mid = "white", high = "#dc2626", midpoint = 0) +
  labs(x = "Patients (sorted)", y = NULL, title = "Signature Genes (Z-score)") +
  theme_classic() +
  theme(axis.text.x = element_blank(), axis.ticks.x = element_blank())

grid.arrange(p1, p2, p3, ncol = 1, heights = c(1, 1, 1.2))`,
  };

  return templates[cardId] || fallbackCode;
}

function ToolsInner() {
  const [selectedTool, setSelectedTool] = useState<Tool | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [activeResult, setActiveResult] = useState<JobResult | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showLogin, setShowLogin] = useState(false);

  // 桌面版：已装插件工具（从后端 /api/tools/manifest 动态拉取）
  const [pluginTools, setPluginTools] = useState<Tool[]>([]);

  // 工具列表：桌面版只显示已装插件（未安装的工具不出现，符合插件化设计）
  const tools: Tool[] = useMemo(() => {
    return pluginTools;
  }, [pluginTools]);

  // 桌面版启动时拉取已装插件工具定义
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(getApiPrefix() + '/tools/manifest');
        const data = await resp.json();
        if (!cancelled && data.ok && Array.isArray(data.tools)) {
          // 插件 tool-definition.json 字段对齐 Tool 接口（缺的字段补默认值）
          const normalized: Tool[] = data.tools.map((d: Record<string, unknown>) => ({
            id: String(d.id),
            title: String(d.title ?? d.id),
            subtitle: String(d.subtitle ?? ''),
            category: String(d.category ?? '插件'),
            language: (d.language === 'python' ? 'python' : 'r') as 'r' | 'python',
            description: String(d.description ?? ''),
            longDescription: String(d.longDescription ?? d.description ?? ''),
            inputs: Array.isArray(d.inputs) ? (d.inputs as Tool['inputs']) : [],
            outputs: Array.isArray(d.outputs) ? (d.outputs as Tool['outputs']) : [],
            tutorialUrl: String(d.tutorialUrl ?? ''),
            demoDataUrl: d.demoDataUrl ? String(d.demoDataUrl) : undefined,
            estimatedMinutes: Number(d.estimatedMinutes ?? 5),
            packages: Array.isArray(d.packages) ? (d.packages as string[]) : [],
            color: String(d.color ?? '#7c3aed'),
            reportUrl: String(d.reportUrl ?? ''),
            figcodeMap: (d.figcodeMap as Record<string, string>) || undefined,
            comingSoon: false,
          }));
          if (!cancelled) setPluginTools(normalized);
        }
      } catch {
        /* 拉取失败静默处理，保留静态工具列表 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Form state
  const [params, setParams] = useState<Record<string, any>>({});
  const [files, setFiles] = useState<Record<string, string>>({});
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [filePreviews, setFilePreviews] = useState<Record<string, string[][]>>({});
  const [status, setStatus] = useState<JobStatus>('idle');
  const [importLoading, setImportLoading] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | EventSource | null>(null);

  // Load job history
  const fetchHistory = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const resp = await fetch(getApiPrefix() + '/tools/history', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const data = await resp.json();
      if (data.ok) setJobs(data.jobs || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Auto-select tool from URL param (?tool=deseq2) — used by docs/figcode cross-links.
  // Only fires on mount; doesn't react to URL changes after that.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const params = new URLSearchParams(window.location.search);
      const toolId = params.get('tool');
      if (!toolId) return;
      const tool = tools.find((t) => t.id === toolId);
      if (!tool) return;
      // If not logged in, show login; selectTool will be invoked after success
      if (!isLoggedIn()) {
        setShowLogin(true);
        return;
      }
      setSelectedTool(tool);
      setShowNewModal(true);
      const defaults: Record<string, unknown> = {};
      tool.inputs.forEach((inp) => {
        if (inp.default !== undefined) defaults[inp.id] = inp.default;
      });
      setParams(defaults);
    } catch {}
  }, []);

  // Load a specific job result
  const loadJobResult = useCallback(async (job: Job) => {
    setActiveJob(job);
    setActiveResult(null);
    setStatus(job.status as JobStatus);
    const tool = tools.find((t) => t.id === job.tool_id) || null;
    setSelectedTool(tool);
    if (job.status === 'completed') {
      const token = getToken();
      const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
      try {
        const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + job.id, {
          headers: token ? { Authorization: 'Bearer ' + token } : {},
        });
        const data = await resp.json();
        if (data.ok && data.result) setActiveResult(data.result);
      } catch {}
    }
  }, []);

  const [showNewModal, setShowNewModal] = useState(false);
  const [showMobileToolSheet, setShowMobileToolSheet] = useState(false);
  // Lazy-loaded figCards full data (only fetched when user clicks "用 FigCode 自定义")
  const [figCardsFull, setFigCardsFull] = useState<FigCard[] | null>(null);
  const [figcodeCardId, setFigcodeCardId] = useState<string | null>(null);

  // When figcodeCardId is set for the first time, dynamic-import figCards data
  useEffect(() => {
    if (figcodeCardId && !figCardsFull) {
      import('@/pages/figcode/_data').then((mod) => setFigCardsFull(mod.figCards)).catch(() => {});
    }
  }, [figcodeCardId, figCardsFull]);
  const [reportUrl, setReportUrl] = useState<string | null>(null);
  const [imageVersion, setImageVersion] = useState(0);
  const [savedCodes, setSavedCodes] = useState<Record<string, string>>({});
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 220;
    const saved = localStorage.getItem('biof3-tools-left-w');
    return saved ? parseInt(saved, 10) : 220;
  });
  const [rightWidth, setRightWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 200;
    const saved = localStorage.getItem('biof3-tools-right-w');
    return saved ? parseInt(saved, 10) : 200;
  });

  const _onResizeRight = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = rightWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(120, Math.min(400, startW - (ev.clientX - startX)));
        setRightWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setRightWidth((w) => {
          localStorage.setItem('biof3-tools-right-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [rightWidth]
  );

  const onResizeLeft = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = leftWidth;
      const onMove = (ev: MouseEvent) => {
        const newW = Math.max(160, Math.min(360, startW + (ev.clientX - startX)));
        setLeftWidth(newW);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        setLeftWidth((w) => {
          localStorage.setItem('biof3-tools-left-w', String(w));
          return w;
        });
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [leftWidth]
  );

  // Select a tool to start new analysis (opens modal)
  const selectTool = useCallback((tool: Tool) => {
    if (!isLoggedIn()) {
      setShowLogin(true);
      return;
    }
    setSelectedTool(tool);
    setShowNewModal(true);
    setError(null);
    // Init defaults
    const defaults: Record<string, unknown> = {};
    tool.inputs.forEach((inp) => {
      if (inp.default !== undefined) defaults[inp.id] = inp.default;
    });
    setParams(defaults);
    setFiles({});
    setFileNames({});
    setFilePreviews({});
  }, []);

  // File handling — convert text to base64 in chunks to avoid stack overflow / encodeURIComponent
  // hangs on large files (16+ MB demos).
  // Strategy: convert text → UTF-8 bytes via TextEncoder → base64 in 32KB chunks.
  const textToBase64 = useCallback((text: string): string => {
    if (typeof TextEncoder === 'undefined') {
      // Legacy fallback (small files only) — uses old btoa+encodeURI route
      return btoa(unescape(encodeURIComponent(text)));
    }
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    const chunk = 32 * 1024;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }, []);

  // Fetch a binary file (e.g. .gz, .h5, .maf.gz) and return its base64 representation.
  // Used by demo loaders for binary files that textToBase64 cannot handle.
  const fetchBinaryAsBase64 = useCallback(async (url: string): Promise<string> => {
    const r = await fetch(url);
    const buf = await r.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 32 * 1024;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }, []);

  const handleFileChange = useCallback(
    (inputId: string, file: File | null) => {
      if (!file) return;
      setFileNames((prev) => ({ ...prev, [inputId]: file.name }));
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        const base64 = textToBase64(text);
        setFiles((prev) => ({ ...prev, [inputId]: base64 }));
        const lines = text
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 6);
        const sep = text.includes('\t') ? '\t' : ',';
        const rows = lines.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews((prev) => ({ ...prev, [inputId]: rows }));
      };
      reader.readAsText(file);
    },
    [textToBase64]
  );

  // Submit
  const handleSubmit = useCallback(async () => {
    if (!selectedTool) return;
    // Wave 1 placeholder tools (machine-learning column) are not yet runnable.
    // Block submit and explain. Will be flipped to false in Wave 2-4 as scripts ship.
    if (selectedTool.comingSoon) {
      setError(
        `${selectedTool.title} 还在开发中，预计 Wave 2-4 上线（详见教程页底部）。当前可点"示例数据"按钮预览输入格式。`
      );
      return;
    }
    const token = getToken();
    if (!token) {
      setShowLogin(true);
      return;
    }
    for (const inp of selectedTool.inputs) {
      if (inp.required && inp.type === 'file' && !files[inp.id]) {
        setError(`请上传：${inp.label}`);
        return;
      }
      if (inp.required && inp.type !== 'file' && !params[inp.id]) {
        setError(`请填写：${inp.label}`);
        return;
      }
    }
    setStatus('uploading');
    setError(null);
    const lang = selectedTool.language; // 'r' | 'python' — routes to correct backend
    try {
      // Generate request-id for tracing (stored in sessionStorage for bug reports)
      const rid = crypto.randomUUID?.() || Math.random().toString(36).slice(2, 14);
      const resp = await fetch(getApiPrefix(lang) + '/tools/run', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
          'X-Request-Id': rid,
        },
        body: JSON.stringify({ toolId: selectedTool.id, params, files }),
      });
      const data = await resp.json();
      if (!data.ok) {
        setError(data.error || '提交失败');
        setStatus('idle');
        return;
      }
      // Store request-id → jobId mapping for debugging
      try {
        sessionStorage.setItem('biof3_last_rid', rid);
        sessionStorage.setItem('biof3_last_job', data.jobId);
      } catch {}
      setJobId(data.jobId);
      setStatus('pending');
      setShowNewModal(false);
      startPolling(data.jobId, selectedTool.id, lang);
      fetchHistory();
    } catch (e: any) {
      setError(e.message);
      setStatus('idle');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool, params, files, fetchHistory]);

  const stopPolling = useCallback(() => {
    if (!pollRef.current) return;
    if (pollRef.current instanceof EventSource) pollRef.current.close();
    else clearInterval(pollRef.current);
    pollRef.current = null;
  }, []);

  const startPolling = useCallback(
    (jid: string, toolId: string, lang: 'r' | 'python' = 'r') => {
      stopPolling();
      // py-server 暂无 SSE 端点 → 保留轮询兜底
      if (lang === 'python') {
        pollRef.current = setInterval(async () => {
          const token = getToken();
          try {
            const resp = await fetch(getApiPrefix(lang) + '/tools/status/' + jid, {
              headers: token ? { Authorization: 'Bearer ' + token } : {},
            });
            const data = await resp.json();
            if (data.status === 'completed') {
              stopPolling();
              const completedJob: Job = {
                id: jid,
                tool_id: toolId,
                status: 'completed',
                created_at: Date.now(),
              };
              setStatus('idle');
              fetchHistory();
              setTimeout(() => loadJobResult(completedJob), 300);
            } else if (data.status === 'failed') {
              setStatus('failed');
              setError(data.error || '分析失败');
              stopPolling();
              fetchHistory();
            } else {
              setStatus(data.status as JobStatus);
            }
          } catch {}
        }, 2000);
        return;
      }
      // r-server: SSE 实时状态推送（替代 2s 轮询）
      const token = getToken();
      const url =
        getApiPrefix('r') +
        '/tools/stream/' +
        jid +
        (token ? '?token=' + encodeURIComponent(token) : '');
      const es = new EventSource(url);
      pollRef.current = es;
      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.error === 'not_found') {
            stopPolling();
            return;
          }
          if (data.status === 'completed') {
            stopPolling();
            const completedJob: Job = {
              id: jid,
              tool_id: toolId,
              status: 'completed',
              created_at: Date.now(),
            };
            setStatus('idle');
            fetchHistory();
            setTimeout(() => loadJobResult(completedJob), 300);
          } else if (data.status === 'failed') {
            setStatus('failed');
            setError(data.error || '分析失败');
            stopPolling();
            fetchHistory();
          } else if (data.status === 'cancelled') {
            stopPolling();
          } else {
            setStatus(data.status as JobStatus);
          }
        } catch {}
      };
      es.onerror = () => {
        // 连接异常（服务端关闭/网络断开）— 关闭避免 EventSource 自动重连
        stopPolling();
      };
    },
    [fetchHistory, loadJobResult, stopPolling]
  );

  // Load demo data for form pre-fill
  const loadDemoForForm = useCallback(async () => {
    if (!selectedTool) return;
    if (selectedTool.id === 'deseq2') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/deseq2';
        const [cr, cd] = await Promise.all([
          fetch(base + '/demo-counts.csv'),
          fetch(base + '/demo-coldata.csv'),
        ]);
        const ct = await cr.text();
        const cdt = await cd.text();
        setFiles({ counts: textToBase64(ct), coldata: textToBase64(cdt) });
        setFileNames({ counts: 'demo-counts.csv', coldata: 'demo-coldata.csv' });
        setParams((p) => ({
          ...p,
          design: 'condition',
          contrast_ref: 'Control',
          contrast_treat: 'Treatment',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ counts: mp(ct), coldata: mp(cdt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'go-kegg') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/go-kegg';
        const resp = await fetch(base + '/genes.csv');
        const text = await resp.text();
        setFiles({ genes: textToBase64(text) });
        setFileNames({ genes: 'genes.csv' });
        setParams((p) => ({
          ...p,
          species: 'human',
          analysis_type: 'all',
          gene_id_type: 'SYMBOL',
          padj_cutoff: '0.05',
          lfc_cutoff: '1',
          enrich_pvalue: '0.05',
          enrich_qvalue: '0.2',
          top_n: '20',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ genes: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'gsea') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/gsea';
        const resp = await fetch(base + '/ranked_list.csv');
        const text = await resp.text();
        setFiles({ ranked_list: textToBase64(text) });
        setFileNames({ ranked_list: 'ranked_list.csv' });
        setParams((p) => ({
          ...p,
          organism: 'hsa',
          gene_set: 'GO_BP',
          min_size: '15',
          max_size: '500',
        }));
        const sep = text.includes('\t') ? '\t' : ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ ranked_list: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'km-survival') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/km-survival';
        const [er, cr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/clinical.csv'),
        ]);
        const et = await er.text();
        const ct = await cr.text();
        setFiles({ expression: textToBase64(et), clinical: textToBase64(ct) });
        setFileNames({ expression: 'expression.csv', clinical: 'clinical.csv' });
        setParams((p) => ({
          ...p,
          gene: 'TP53',
          cutoff_method: 'median',
          time_col: 'OS.time',
          event_col: 'OS',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), clinical: mp(ct) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'lasso-cox') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/lasso-cox';
        const [er, cr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/clinical.csv'),
        ]);
        const et = await er.text();
        const ct = await cr.text();
        setFiles({ expression: textToBase64(et), clinical: textToBase64(ct) });
        setFileNames({ expression: 'expression.csv', clinical: 'clinical.csv' });
        setParams((p) => ({ ...p, train_ratio: '0.7', seed: '42' }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), clinical: mp(ct) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'bindea-immune') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/bindea-immune';
        const [tr, gr] = await Promise.all([
          fetch(base + '/tpm_matrix.csv'),
          fetch(base + '/group.csv'),
        ]);
        const tt = await tr.text();
        const gt = await gr.text();
        setFiles({ tpm_matrix: textToBase64(tt), group_file: textToBase64(gt) });
        setFileNames({ tpm_matrix: 'tpm_matrix.csv', group_file: 'group.csv' });
        setParams((p) => ({ ...p, method: 'ssgsea' }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ tpm_matrix: mp(tt), group_file: mp(gt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'maftools-mutation') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/maftools-mutation';
        // maf_file is gzipped MAF (binary), clinical is TSV (text)
        const mafB64 = await fetchBinaryAsBase64(base + '/maf_file');
        const cr = await fetch(base + '/clinical');
        const ct = await cr.text();
        setFiles({ maf_file: mafB64, clinical: textToBase64(ct) });
        setFileNames({
          maf_file: 'TCGA-LAML maf_file (193 AML samples, gz)',
          clinical: 'TCGA-LAML clinical (FAB + survival)',
        });
        setParams((p) => ({
          ...p,
          genome: 'hg19',
          top_n_oncoplot: '20',
          lollipop_top_n: '2',
          n_signatures: '3',
        }));
        const sep = '\t';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ clinical: mp(ct) });
      } catch (e: unknown) {
        setError('加载示例数据失败: ' + (errMsg(e) || ''));
      }
    } else if (selectedTool.id === 'cellchat') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/cellchat';
        const [er, mr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/meta.csv'),
        ]);
        const et = await er.text();
        const mt = await mr.text();
        setFiles({ expression: textToBase64(et), meta: textToBase64(mt) });
        setFileNames({
          expression: 'PBMC 3k expression.csv (9821 genes × 605 cells)',
          meta: 'PBMC 3k meta.csv (9 cell types)',
        });
        setParams((p) => ({
          ...p,
          species: 'human',
          signaling_db: 'Secreted Signaling',
          min_cells_per_group: '10',
          top_pathways_to_visualize: '5',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), meta: mp(mt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'complexheatmap') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/complexheatmap';
        const [mr, ar] = await Promise.all([
          fetch(base + '/matrix.csv'),
          fetch(base + '/annotation.csv'),
        ]);
        const mt = await mr.text();
        const at = await ar.text();
        setFiles({ matrix: textToBase64(mt), annotation: textToBase64(at) });
        setFileNames({
          matrix: 'TCGA-BRCA matrix.csv (100 HVGs × 80 samples)',
          annotation: 'TCGA-BRCA annotation.csv (PAM50/ER/HER2/Stage/Age)',
        });
        setParams((p) => ({
          ...p,
          z_score: 'TRUE',
          cluster_rows: 'TRUE',
          cluster_columns: 'TRUE',
          clustering_distance: 'pearson',
          clustering_method: 'ward.D2',
          color_scheme: 'div',
          top_n_label: '20',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ matrix: mp(mt), annotation: mp(at) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'wgcna') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/wgcna';
        const [er, tr] = await Promise.all([
          fetch(base + '/expression.csv'),
          fetch(base + '/traits.csv'),
        ]);
        const et = await er.text();
        const tt = await tr.text();
        setFiles({ expression: textToBase64(et), traits: textToBase64(tt) });
        setFileNames({
          expression: 'TCGA-BRCA expression.csv (5000 HVGs × 218 samples)',
          traits: 'TCGA-BRCA traits.csv (10 traits)',
        });
        setParams((p) => ({
          ...p,
          min_module_size: '30',
          merge_cut_height: '0.25',
          network_type: 'signed',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ expression: mp(et), traits: mp(tt) });
      } catch {
        setError('加载示例数据失败');
      }
    } else if (selectedTool.id === 'seurat-standard') {
      try {
        const base = getApiPrefix() + '/tools/demo-data/seurat-standard';
        // PBMC 3k subset (3009 HVGs + MT genes × 2700 cells, ~16 MB CSV)
        // Source: 10X Genomics PBMC 3k filtered_gene_bc_matrices, pre-filtered to top HVGs
        const resp = await fetch(base + '/pbmc3k_demo.csv');
        const text = await resp.text();
        setFiles({ matrix: textToBase64(text) });
        setFileNames({ matrix: 'pbmc3k_demo.csv (PBMC 3k)' });
        setParams((p) => ({
          ...p,
          species: 'human',
          min_features: '200',
          max_features: '2500',
          max_mt: '5',
          nfeatures: '2000',
          dims: '10',
          resolution: '0.5',
          top_n_markers: '10',
        }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews({ matrix: mp(text) });
      } catch {
        setError('加载示例数据失败');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTool]);

  // Load demo results for display
  const [demoFiles, setDemoFiles] = useState<Array<{ name: string; type: string; url: string }>>(
    []
  );
  const [demoToolId, setDemoToolId] = useState<string>('deseq2');

  const loadToolDemo = useCallback(async (toolId: string) => {
    setDemoToolId(toolId);
    setSelectedTool(null);
    setActiveJob(null);
    setActiveResult(null);
    setStatus('idle');
    // Pick backend based on the tool's language ('r' or 'python').
    const tool = tools.find((t) => t.id === toolId);
    const lang: 'r' | 'python' = tool?.language === 'python' ? 'python' : 'r';
    try {
      const resp = await fetch(getApiPrefix(lang) + '/tools/public-demo/' + toolId);
      const data = await resp.json();
      if (data.ok) setDemoFiles(data.files || []);
      else setDemoFiles([]);
    } catch {
      setDemoFiles([]);
    }
  }, []);

  useEffect(() => {
    loadToolDemo('deseq2');
  }, [loadToolDemo]);

  // Auto-open tool from URL hash (e.g. /tools#deseq2)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      const tool = tools.find((t) => t.id === hash);
      if (tool) {
        setTimeout(() => selectTool(tool), 300);
      } else {
        loadToolDemo(hash);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Publish context to Copilot AI assistant
  useEffect(() => {
    setCopilotContext({
      page: 'tools',
      pageTitle: '分析工具',
      toolId: selectedTool?.id || demoToolId,
      toolName: selectedTool?.title || tools.find((t) => t.id === demoToolId)?.title,
      toolResult: activeResult?.summary || null,
      availableTools: tools.map((t) => t.title),
    });
  }, [selectedTool, demoToolId, activeResult]);

  // Listen for AI assistant tool actions
  useEffect(() => {
    const handleOpenTool = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.toolId) return;
      const tool = tools.find((t) => t.id === detail.toolId);
      if (!tool) return;
      selectTool(tool);
      // KILLER_USE_CASE_1_v1 — auto-import data from a prior tool's job.
      // Currently maps two known flows:
      //   - go-kegg / gsea ← deseq2's deg_table.csv (genes / ranked_list slot)
      // Extend AUTOFILL_RECIPES below as new flows emerge.
      if (detail.autofillFromJobId && detail.autofillSourceTool) {
        await autofillFromJob(tool.id, detail.autofillFromJobId, detail.autofillSourceTool);
      }
    };
    window.addEventListener('biof3:tools-open', handleOpenTool);
    return () => window.removeEventListener('biof3:tools-open', handleOpenTool);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectTool]);

  // agent-led Task 3：open_result handler 触发，按 jobId 加载结果。
  // 收 toolJobId → fetch /tools/status/:id 拿 tool_id + status → 构造 Job 调 loadJobResult。
  const openResultByJobId = useCallback(
    async (toolJobId: string) => {
      const token = getToken();
      try {
        const resp = await fetch(
          getApiPrefix() + '/tools/status/' + encodeURIComponent(toolJobId),
          {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          }
        );
        const data = await resp.json();
        if (!data || data.error) return;
        // status 端点返回 toolId（驼峰），构造 Job 适配 snake_case 字段
        const job: Job = {
          id: String(toolJobId),
          tool_id: data.toolId || data.tool_id || '',
          status: data.status || 'completed',
          created_at: data.createdAt ? new Date(data.createdAt).getTime() : Date.now(),
          completed_at: data.completedAt ? new Date(data.completedAt).getTime() : undefined,
          error: data.error,
        };
        loadJobResult(job);
      } catch {}
    },
    [loadJobResult]
  );

  // 同页：直接监听事件
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.toolJobId) openResultByJobId(String(detail.toolJobId));
    };
    window.addEventListener('biof3:tools-open-result', handler);
    return () => window.removeEventListener('biof3:tools-open-result', handler);
  }, [openResultByJobId]);

  // 跨页：从 sessionStorage 消费 pending result（open_result handler 跨页导航时 stash）
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('biof3_pending_tool_result');
      if (!raw) return;
      sessionStorage.removeItem('biof3_pending_tool_result');
      // 延迟一拍等 tools 列表加载完，loadJobResult 内部 find 才能命中 tool
      setTimeout(() => openResultByJobId(raw), 600);
    } catch {}
  }, [openResultByJobId]);

  // KILLER_USE_CASE_1_v1 — autofill recipes describe how to import data from
  // a source tool's job into a target tool's input slot. Same logic as the
  // manual <select> dropdowns the user can use, just driven by the AI.
  const AUTOFILL_RECIPES: Record<
    string,
    Record<string, { file: string; slot: string; label: string }>
  > = {
    // target tool → {source tool: {file in source job's output, slot in target form, friendly label}}
    'go-kegg': {
      deseq2: { file: 'deg_table.csv', slot: 'genes', label: 'deg_table.csv (来自 DESeq2)' },
    },
    gsea: {
      deseq2: { file: 'deg_table.csv', slot: 'ranked_list', label: 'deg_table.csv (来自 DESeq2)' },
    },
  };

  const autofillFromJob = useCallback(
    async (targetTool: string, sourceJobId: string, sourceTool: string) => {
      const recipe = AUTOFILL_RECIPES[targetTool] && AUTOFILL_RECIPES[targetTool][sourceTool];
      if (!recipe) {
        console.warn('[autofill] no recipe for ' + sourceTool + ' → ' + targetTool);
        return;
      }
      setImportLoading(true);
      try {
        const token = getToken();
        const resp = await fetch(
          getApiPrefix() + '/tools/file/' + sourceJobId + '/' + recipe.file,
          {
            headers: token ? { Authorization: 'Bearer ' + token } : {},
          }
        );
        if (!resp.ok) {
          console.warn('[autofill] fetch failed: HTTP ' + resp.status);
          setImportLoading(false);
          return;
        }
        const text = await resp.text();
        setFiles((f) => ({ ...f, [recipe.slot]: textToBase64(text) }));
        setFileNames((f) => ({ ...f, [recipe.slot]: recipe.label }));
        const sep = ',';
        const mp = (t: string) =>
          t
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 6)
            .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setFilePreviews((f) => ({ ...f, [recipe.slot]: mp(text) }));
      } catch (e) {
        console.warn('[autofill] error:', e);
      }
      setImportLoading(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [textToBase64]
  );

  // KILLER_USE_CASE_1_v1 — pick up cross-page autofill from sessionStorage
  // (set when CopilotChat is on a different page when AI fires open_tool).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = sessionStorage.getItem('biof3_pending_tool_autofill');
      if (!raw) return;
      sessionStorage.removeItem('biof3_pending_tool_autofill');
      const detail = JSON.parse(raw);
      if (detail.toolId && detail.autofillFromJobId && detail.autofillSourceTool) {
        // Wait a tick for selectTool from hash effect to finish, then autofill.
        setTimeout(
          () => autofillFromJob(detail.toolId, detail.autofillFromJobId, detail.autofillSourceTool),
          600
        );
      }
    } catch {}
  }, [autofillFromJob]);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  // Pick API base based on the currently-active tool's language. When viewing
  // a job from history, fall back to selectedTool (set by loadJobResult).
  const activeLang: 'r' | 'python' = selectedTool?.language === 'python' ? 'python' : 'r';
  const apiBase = getApiPrefix(activeLang);
  const token = getToken();

  return (
    <div
      className={styles.workspace}
      style={{ gridTemplateColumns: `${leftWidth}px 4px 1fr 4px ${rightWidth}px` }}
    >
      {/* Left: Tool navigation + job history by category */}
      <aside className={styles.leftPanel}>
        <div className={styles.leftHeader}>
          <h3>工具导航</h3>
        </div>
        <div className={styles.toolNav}>
          {toolCategories.map((cat) => {
            const catTools = tools.filter((t) => t.category === cat);
            if (catTools.length === 0) return null;
            return (
              <div key={cat} className={styles.navCategory}>
                <div className={styles.navCatLabel}>{cat}</div>
                {catTools.map((t) => {
                  const toolJobs = jobs.filter((j) => j.tool_id === t.id);
                  return (
                    <div key={t.id} id={t.id} className={styles.navTool}>
                      <button
                        className={`${styles.navToolBtn} ${!selectedTool && !activeJob && demoToolId === t.id ? styles.navToolBtnActive : ''}`}
                        onClick={() => loadToolDemo(t.id)}
                      >
                        <span
                          className={styles.navDot}
                          style={{ background: TOOL_COLORS[t.id] || '#6b7280' }}
                        />
                        {t.title}
                      </button>
                      {toolJobs.map((job) => (
                        <div key={job.id} className={styles.navJobRow}>
                          <button
                            className={`${styles.navJobBtn} ${activeJob?.id === job.id ? styles.navJobBtnActive : ''}`}
                            onClick={() => loadJobResult(job)}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              e.currentTarget.style.display = 'none';
                              const input = e.currentTarget.nextElementSibling as HTMLInputElement;
                              if (input && input.classList.contains(styles.navJobRenameInput)) {
                                input.style.display = 'block';
                                input.focus();
                                input.select();
                              }
                            }}
                            title="双击修改名称"
                          >
                            <span
                              className={`${styles.navJobStatus} ${styles['jobStatus_' + job.status]}`}
                            >
                              {job.status === 'completed'
                                ? '✓'
                                : job.status === 'failed'
                                  ? '✗'
                                  : '·'}
                            </span>
                            {job.name ||
                              new Date(job.created_at).toLocaleString('zh-CN', {
                                month: 'numeric',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                          </button>
                          <input
                            className={styles.navJobRenameInput}
                            style={{ display: 'none' }}
                            defaultValue={job.name || ''}
                            onBlur={async (e) => {
                              const newName = e.currentTarget.value.trim();
                              e.currentTarget.style.display = 'none';
                              const btn = e.currentTarget.previousElementSibling as HTMLElement;
                              if (btn) btn.style.display = '';
                              if (newName && newName !== job.name) {
                                const tk = getToken();
                                await fetch(getApiPrefix() + '/tools/job/' + job.id + '/name', {
                                  method: 'PUT',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    ...(tk ? { Authorization: 'Bearer ' + tk } : {}),
                                  },
                                  body: JSON.stringify({ name: newName }),
                                });
                                fetchHistory();
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                              if (e.key === 'Escape') {
                                e.currentTarget.value = job.name || '';
                                e.currentTarget.blur();
                              }
                            }}
                          />
                          <button
                            className={styles.navJobDelete}
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (confirmDeleteId === job.id) {
                                // Already confirming — do the delete
                                const token = getToken();
                                await fetch(getApiPrefix() + '/tools/job/' + job.id, {
                                  method: 'DELETE',
                                  headers: token ? { Authorization: 'Bearer ' + token } : {},
                                });
                                setConfirmDeleteId(null);
                                fetchHistory();
                                if (activeJob?.id === job.id) {
                                  setActiveJob(null);
                                  setActiveResult(null);
                                }
                              } else {
                                // First click — show confirm state
                                setConfirmDeleteId(job.id);
                                setTimeout(
                                  () =>
                                    setConfirmDeleteId((prev) => (prev === job.id ? null : prev)),
                                  3000
                                );
                              }
                            }}
                            title={confirmDeleteId === job.id ? '再次点击确认删除' : '删除'}
                          >
                            {confirmDeleteId === job.id ? '✓' : '×'}
                          </button>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Left resize handle */}
      <div className={styles.resizeHandle} onMouseDown={onResizeLeft} title="拖拽调整宽度" />

      {/* Center: Main content */}
      <main className={styles.mainPanel}>
        {!activeJob && status !== 'completed' && status !== 'failed' && !activeResult && (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <h3>{tools.find((t) => t.id === demoToolId)?.title || demoToolId}</h3>
            </div>

            {demoFiles.length === 0 ? (
              <WorkbenchEmpty desc="该工具暂无 Demo 结果，点击右侧工具图标提交分析。" />
            ) : (
              <ResultTabs
                files={demoFiles}
                buildUrl={(name: string) => {
                  // W2 (2026-05-28): demo url 必须用工具自身 language 的 prefix
                  // 否则 python 工具的 demo 文件会被拼到 /api/r 而 404
                  const demoTool = tools.find((t) => t.id === demoToolId);
                  const demoLang: 'r' | 'python' = demoTool?.language === 'python' ? 'python' : 'r';
                  const f = demoFiles.find((x) => x.name === name);
                  return f?.url
                    ? `${getApiPrefix(demoLang)}${f.url}`
                    : `${getApiPrefix(demoLang)}/tools/demo/${demoToolId}/${name}`;
                }}
                onFigcode={setFigcodeCardId}
                onReport={() => {
                  const demoTool = tools.find((t) => t.id === demoToolId);
                  const demoLang: 'r' | 'python' = demoTool?.language === 'python' ? 'python' : 'r';
                  const reportFile = demoFiles.find((f) => f.name === 'report.html');
                  if (reportFile?.url) {
                    setReportUrl(`${getApiPrefix(demoLang)}${reportFile.url}`);
                  } else if (REPORT_URLS[demoToolId]) {
                    setReportUrl(REPORT_URLS[demoToolId]);
                  }
                }}
              />
            )}
          </div>
        )}

        {selectedTool && showNewModal && !activeJob && (
          <div className={styles.inlineForm}>
            <div className={styles.inlineFormHeader}>
              <h2>{selectedTool.title}</h2>
              <div className={styles.inlineFormActions}>
                <button className={styles.demoBtn} onClick={loadDemoForForm}>
                  示例数据
                </button>
                <button
                  className={styles.submitBtn}
                  onClick={handleSubmit}
                  disabled={status === 'uploading' || status === 'pending' || importLoading}
                >
                  {importLoading ? '导入中...' : status === 'uploading' ? '提交中...' : '开始分析'}
                </button>
                <button className={styles.modalClose} onClick={() => setShowNewModal(false)}>
                  ×
                </button>
              </div>
            </div>
            {error && <div className={styles.formError}>{error}</div>}
            <div className={styles.inlineFormBody}>
              {selectedTool.inputs
                .filter((inp) => inp.required)
                .map((inp) => (
                  <div key={inp.id} className={styles.formField}>
                    <label>
                      {inp.label}
                      <span className={styles.required}>*</span>
                    </label>
                    {inp.type === 'file' && (
                      <>
                        <input
                          type="file"
                          accept={inp.accept}
                          onChange={(e) => handleFileChange(inp.id, e.target.files?.[0] || null)}
                        />
                        {/* Data linkage: import from previous DESeq2 results */}
                        {selectedTool.id === 'go-kegg' &&
                          inp.id === 'genes' &&
                          jobs.filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                            .length > 0 && (
                            <select
                              className={styles.importSelect}
                              defaultValue=""
                              disabled={importLoading}
                              onChange={async (e) => {
                                const jid = e.target.value;
                                if (!jid) return;
                                setImportLoading(true);
                                try {
                                  const token = getToken();
                                  const resp = await fetch(
                                    getApiPrefix() + '/tools/file/' + jid + '/deg_table.csv',
                                    {
                                      headers: token ? { Authorization: 'Bearer ' + token } : {},
                                    }
                                  );
                                  const text = await resp.text();
                                  setFiles((f) => ({ ...f, genes: textToBase64(text) }));
                                  setFileNames((f) => ({
                                    ...f,
                                    genes: 'deg_table.csv (来自 DESeq2)',
                                  }));
                                  const sep = ',';
                                  const mp = (t: string) =>
                                    t
                                      .split('\n')
                                      .filter((l) => l.trim())
                                      .slice(0, 6)
                                      .map((l) =>
                                        l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())
                                      );
                                  setFilePreviews((f) => ({ ...f, genes: mp(text) }));
                                } catch {
                                  setError('导入失败');
                                }
                                setImportLoading(false);
                              }}
                            >
                              <option value="">
                                {importLoading ? '导入中...' : '从已有 DESeq2 结果导入...'}
                              </option>
                              {jobs
                                .filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                                .map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {j.name || `DESeq2 #${j.id.slice(-6)}`}
                                  </option>
                                ))}
                            </select>
                          )}
                        {/* Data linkage: GSEA can import DESeq2 results */}
                        {selectedTool.id === 'gsea' &&
                          inp.id === 'ranked_list' &&
                          jobs.filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                            .length > 0 && (
                            <select
                              className={styles.importSelect}
                              defaultValue=""
                              disabled={importLoading}
                              onChange={async (e) => {
                                const jid = e.target.value;
                                if (!jid) return;
                                setImportLoading(true);
                                try {
                                  const token = getToken();
                                  const resp = await fetch(
                                    getApiPrefix() + '/tools/file/' + jid + '/deg_table.csv',
                                    {
                                      headers: token ? { Authorization: 'Bearer ' + token } : {},
                                    }
                                  );
                                  const text = await resp.text();
                                  setFiles((f) => ({ ...f, ranked_list: textToBase64(text) }));
                                  setFileNames((f) => ({
                                    ...f,
                                    ranked_list: 'deg_table.csv (来自 DESeq2)',
                                  }));
                                  const sep = ',';
                                  const mp = (t: string) =>
                                    t
                                      .split('\n')
                                      .filter((l) => l.trim())
                                      .slice(0, 6)
                                      .map((l) =>
                                        l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim())
                                      );
                                  setFilePreviews((f) => ({ ...f, ranked_list: mp(text) }));
                                } catch {
                                  setError('导入失败');
                                }
                                setImportLoading(false);
                              }}
                            >
                              <option value="">
                                {importLoading ? '导入中...' : '从已有 DESeq2 结果导入...'}
                              </option>
                              {jobs
                                .filter((j) => j.tool_id === 'deseq2' && j.status === 'completed')
                                .map((j) => (
                                  <option key={j.id} value={j.id}>
                                    {j.name || `DESeq2 #${j.id.slice(-6)}`}
                                  </option>
                                ))}
                            </select>
                          )}
                        {fileNames[inp.id] && (
                          <span className={styles.fileName}>{fileNames[inp.id]}</span>
                        )}
                        {filePreviews[inp.id] && (
                          <div className={styles.filePreview}>
                            <table>
                              <tbody>
                                {filePreviews[inp.id].map((row, i) => (
                                  <tr key={i} className={i === 0 ? styles.previewHeader : ''}>
                                    {row.slice(0, 6).map((c, j) => (
                                      <td key={j}>{c.length > 12 ? c.slice(0, 12) + '…' : c}</td>
                                    ))}
                                    {row.length > 6 && <td>…</td>}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </>
                    )}
                    {inp.type === 'select' && (
                      <select
                        value={params[inp.id] || ''}
                        onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                      >
                        {inp.options?.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    )}
                    {inp.type === 'number' && (
                      <input
                        type="number"
                        value={params[inp.id] ?? ''}
                        placeholder={inp.placeholder}
                        step="any"
                        onChange={(e) =>
                          setParams((p) => ({ ...p, [inp.id]: parseFloat(e.target.value) }))
                        }
                      />
                    )}
                    {inp.type === 'text' && (
                      <input
                        type="text"
                        value={params[inp.id] || ''}
                        placeholder={inp.placeholder}
                        onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                      />
                    )}
                    {inp.hint && <span className={styles.fieldHint}>{inp.hint}</span>}
                  </div>
                ))}

              {selectedTool.inputs.some((inp) => !inp.required) && (
                <details className={styles.optionalParams}>
                  <summary>高级参数（可选，已有默认值）</summary>
                  {selectedTool.inputs
                    .filter((inp) => !inp.required)
                    .map((inp) => (
                      <div key={inp.id} className={styles.formField}>
                        <label>{inp.label}</label>
                        {inp.type === 'file' && (
                          <>
                            <input
                              type="file"
                              accept={inp.accept}
                              onChange={(e) =>
                                handleFileChange(inp.id, e.target.files?.[0] || null)
                              }
                            />
                            {fileNames[inp.id] && (
                              <span className={styles.fileName}>{fileNames[inp.id]}</span>
                            )}
                          </>
                        )}
                        {inp.type === 'select' && (
                          <select
                            value={params[inp.id] || ''}
                            onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                          >
                            {inp.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {inp.type === 'number' && (
                          <input
                            type="number"
                            value={params[inp.id] ?? ''}
                            placeholder={inp.placeholder}
                            step="any"
                            onChange={(e) =>
                              setParams((p) => ({ ...p, [inp.id]: parseFloat(e.target.value) }))
                            }
                          />
                        )}
                        {inp.type === 'text' && (
                          <input
                            type="text"
                            value={params[inp.id] || ''}
                            placeholder={inp.placeholder}
                            onChange={(e) => setParams((p) => ({ ...p, [inp.id]: e.target.value }))}
                          />
                        )}
                        {inp.hint && <span className={styles.fieldHint}>{inp.hint}</span>}
                      </div>
                    ))}
                </details>
              )}
            </div>
          </div>
        )}

        {(status === 'uploading' || status === 'pending' || status === 'running') && (
          <div className={styles.progressBar}>
            <div className={styles.spinner} />
            <div className={styles.progressSteps}>
              <span
                className={
                  status === 'uploading' ? styles.progressStepActive : styles.progressStepDone
                }
              >
                ① 提交
              </span>
              <span
                className={
                  status === 'pending'
                    ? styles.progressStepActive
                    : status === 'running'
                      ? styles.progressStepDone
                      : styles.progressStepPending
                }
              >
                ② 排队
              </span>
              <span
                className={
                  status === 'running' ? styles.progressStepActive : styles.progressStepPending
                }
              >
                ③ 执行
              </span>
              <span className={styles.progressStepPending}>④ 完成</span>
            </div>
            <span className={styles.progressHintInline}>
              预计 {selectedTool?.estimatedMinutes || 2} 分钟
            </span>
          </div>
        )}

        {status === 'completed' && !activeResult && (
          <div
            className={styles.progressBar}
            style={{ background: '#d1fae5', borderColor: '#6ee7b7' }}
          >
            <span>✓ 分析完成，加载结果中...</span>
          </div>
        )}

        {status === 'failed' && (
          <div className={styles.errorPanel}>
            <h3>分析失败</h3>
            <pre className={styles.errorPre}>{error}</pre>
            <button
              className={styles.retryBtn}
              onClick={() => {
                setStatus('idle');
                setError(null);
                setActiveJob(null);
              }}
            >
              重新配置
            </button>
          </div>
        )}

        {status === 'completed' && activeResult && (
          <div className={styles.resultPanel}>
            <div className={styles.resultHeader}>
              <h3>{selectedTool?.title || '分析完成'}</h3>
              <div className={styles.resultHeaderRight}>
                {getStoredUser()?.role === 'admin' && (
                  <button
                    className={styles.demoTag}
                    onClick={async () => {
                      const jid = jobId || activeJob?.id;
                      if (!jid) return;
                      const tk = getToken();
                      await fetch(getApiPrefix() + '/tools/job/' + jid + '/public', {
                        method: 'PUT',
                        headers: {
                          'Content-Type': 'application/json',
                          ...(tk ? { Authorization: 'Bearer ' + tk } : {}),
                        },
                        body: JSON.stringify({ is_public: true }),
                      });
                      alert('已设为公开 Demo');
                    }}
                  >
                    设为 Demo
                  </button>
                )}
                {selectedTool && (
                  <span className={styles.tutorialLink} style={{ opacity: 0.5, pointerEvents: 'none' }}>
                    {/* 桌面端已移除教程入口，"查看教程"链接已禁用。如需恢复取消下面注释即可。 */}
                    {/* <Link to={selectedTool.tutorialUrl} className={styles.tutorialLink}>
                      查看教程 →
                    </Link> */}
                  </span>
                )}
              </div>
            </div>

            {activeResult.summary && (
              <div className={styles.resultSummary}>
                {Object.entries(activeResult.summary).map(([k, v]) => (
                  <div key={k} className={styles.resultStat}>
                    <span className={styles.resultStatValue}>{String(v)}</span>
                    <span className={styles.resultStatLabel}>{k}</span>
                  </div>
                ))}
              </div>
            )}

            <ResultTabs
              files={activeResult.files || []}
              buildUrl={(name: string) =>
                `${apiBase}/tools/file/${jobId || activeJob?.id}/${name}${token ? '?token=' + token : ''}${imageVersion ? '&v=' + imageVersion : ''}`
              }
              onFigcode={setFigcodeCardId}
              onReport={() =>
                setReportUrl(
                  `${apiBase}/tools/file/${jobId || activeJob?.id}/report.html${token ? '?token=' + token : ''}`
                )
              }
            />
          </div>
        )}
      </main>

      {/* Right resize handle (between center and right panel) */}
      <div className={styles.resizeHandle} onMouseDown={_onResizeRight} title="拖拽调整宽度" />

      {/* Right: Tool palette (grid column, no longer floating) */}
      <aside className={styles.rightToolbar}>
        <div className={styles.toolbarTitle}>工具</div>
        <div className={styles.toolGrid}>
          {toolCategories.map((cat) => {
            const catTools = tools.filter((t) => t.category === cat);
            if (catTools.length === 0) return null;
            return (
              <React.Fragment key={cat}>
                <div className={styles.toolGridCatLabel}>{cat}</div>
                {catTools.map((t) => {
                  const img = TOOL_IMAGES[t.id];
                  return (
                    <button
                      key={t.id}
                      className={`${styles.toolIcon} ${selectedTool?.id === t.id ? styles.toolIconActive : ''}`}
                      style={
                        { '--tool-color': TOOL_COLORS[t.id] || '#6b7280' } as React.CSSProperties
                      }
                      onClick={() => selectTool(t)}
                      title={t.comingSoon ? `${t.title}（开发中,Wave 2-4 上线）` : t.title}
                    >
                      {img ? (
                        <img
                          src={img}
                          alt={t.title}
                          className={styles.toolIconCover}
                          loading="lazy"
                        />
                      ) : (
                        <span className={styles.toolIconCircle}>{t.title[0]}</span>
                      )}
                      <span className={styles.toolIconLabel}>
                        {t.title}
                        {t.comingSoon && (
                          <span style={{ fontSize: 9, color: '#d97706', marginLeft: 4 }}>🚧</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </React.Fragment>
            );
          })}
        </div>
      </aside>

      <LoginModal open={showLogin} onClose={() => setShowLogin(false)} />

      {/* Report Modal */}
      {reportUrl && (
        <div className={styles.modalOverlay} onClick={() => setReportUrl(null)}>
          <div className={styles.reportModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>结果解读报告</h2>
              <div className={styles.modalHeaderActions}>
                <button
                  className={styles.demoBtn}
                  onClick={() => {
                    try {
                      const ifr = document.querySelector(
                        `.${styles.reportIframe}`
                      ) as HTMLIFrameElement | null;
                      if (ifr && ifr.contentWindow) {
                        ifr.contentWindow.focus();
                        ifr.contentWindow.print();
                      } else {
                        // Fallback: open in new tab and print there
                        const w = window.open(reportUrl, '_blank');
                        if (w) {
                          w.addEventListener('load', () => {
                            try {
                              w.print();
                            } catch {}
                          });
                        }
                      }
                    } catch {
                      alert('打印失败,请尝试在新标签页打开报告后使用 Ctrl/Cmd+P');
                    }
                  }}
                  title="打印或另存为 PDF"
                >
                  🖨 打印 / PDF
                </button>
                <a
                  href={reportUrl}
                  download={`${selectedTool?.title || demoToolId || 'BioF3'}-解读报告.html`}
                  className={styles.demoBtn}
                >
                  下载 HTML
                </a>
                <button className={styles.modalClose} onClick={() => setReportUrl(null)}>
                  ×
                </button>
              </div>
            </div>
            <iframe src={reportUrl} className={styles.reportIframe} title="报告" />
          </div>
        </div>
      )}

      {/* FigCode RunModal — opens when user clicks "用 FigCode 自定义" */}
      {figcodeCardId &&
        figCardsFull &&
        (() => {
          const card = figCardsFull.find((c) => c.id === figcodeCardId);
          if (!card) return null;

          // Generate code that uses the actual analysis result data
          const currentJobId = jobId || activeJob?.id;
          const tk = getToken();
          const currentToolId = selectedTool?.id || activeJob?.tool_id || demoToolId;
          const dataUrl = currentJobId
            ? `${getApiPrefix()}/tools/file/${currentJobId}/${currentToolId === 'go-kegg' ? 'go_bp_data.csv' : 'deg_table.csv'}${tk ? '?token=' + tk : ''}`
            : `${getApiPrefix()}/tools/demo/${currentToolId || 'deseq2'}/deg_table.csv`;

          // Find which output PNG filename this figcode card corresponds to
          let targetFilename: string | undefined;
          for (const [fname, cid] of Object.entries(FIGCODE_MAP)) {
            if (cid === figcodeCardId && fname.endsWith('.png')) {
              targetFilename = fname;
              break;
            }
          }

          const customCode =
            (targetFilename && savedCodes[targetFilename]) ||
            generateFigcodeWithData(figcodeCardId, dataUrl, card.code);

          // Try to load saved code if not already loaded
          if (targetFilename && !savedCodes[targetFilename] && currentJobId) {
            const tk = getToken();
            fetch(
              `${getApiPrefix()}/tools/file/${currentJobId}/${targetFilename}.R${tk ? '?token=' + tk : ''}`
            )
              .then((r) => (r.ok ? r.text() : null))
              .then((text) => {
                if (text) setSavedCodes((prev) => ({ ...prev, [targetFilename]: text }));
              })
              .catch(() => {});
          }

          return (
            <RunModal
              isOpen={true}
              onClose={() => {
                delete (window as unknown as Record<string, unknown>).__biof3_pending_image;
                setFigcodeCardId(null);
              }}
              title={`${card.subtitle} — 基于分析结果绘图`}
              initialCode={customCode}
              initialImage={
                targetFilename && currentJobId
                  ? `${getApiPrefix()}/tools/file/${currentJobId}/${targetFilename}${tk ? '?token=' + tk : ''}`
                  : targetFilename
                    ? `${getApiPrefix()}/tools/demo/${currentToolId || 'deseq2'}/${targetFilename}`
                    : undefined
              }
              cardId={card.id}
              subtitle={card.subtitle}
              slogan={card.slogan}
              language={card.language || 'r'}
              figLayout={card.figLayout || 'default'}
              onSaveToResult={async (imageUrl: string, savedCode: string) => {
                const jid = jobId || activeJob?.id;
                const fname = targetFilename;
                if (!jid || !fname) {
                  alert('无法保存：请从分析结果页面打开在线绘图');
                  return;
                }
                const tk = getToken();
                // Save image
                const imgResp = await fetch(imageUrl);
                const blob = await imgResp.blob();
                await fetch(getApiPrefix() + '/tools/file/' + jid + '/' + fname, {
                  method: 'PUT',
                  headers: tk ? { Authorization: 'Bearer ' + tk } : {},
                  body: blob,
                });
                // Save code alongside the image
                const codeBlob = new Blob([savedCode], { type: 'text/plain' });
                await fetch(getApiPrefix() + '/tools/file/' + jid + '/' + fname + '.R', {
                  method: 'PUT',
                  headers: tk ? { Authorization: 'Bearer ' + tk } : {},
                  body: codeBlob,
                });
                setSavedCodes((prev) => ({ ...prev, [fname]: savedCode }));
                setImageVersion((v) => v + 1);
              }}
              onImageReady={
                targetFilename && (jobId || activeJob?.id)
                  ? (imageUrl: string) => {
                      (window as unknown as Record<string, unknown>).__biof3_pending_image = {
                        imageUrl,
                        jobId: jobId || activeJob?.id,
                        filename: targetFilename,
                      };
                    }
                  : undefined
              }
            />
          );
        })()}

      {/* Mobile-only: tool picker FAB + bottom sheet (shown when ≤900px via CSS) */}
      <button
        className={styles.mobileToolFab}
        onClick={() => setShowMobileToolSheet(true)}
        aria-label="选择工具"
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        <span>选择工具</span>
      </button>

      {showMobileToolSheet && (
        <div
          className={styles.mobileToolSheetOverlay}
          onClick={() => setShowMobileToolSheet(false)}
        >
          <div className={styles.mobileToolSheet} onClick={(e) => e.stopPropagation()}>
            <div className={styles.mobileToolSheetHandle} />
            <div className={styles.mobileToolSheetHeader}>
              <h3>选择分析工具</h3>
              <button
                className={styles.mobileToolSheetClose}
                onClick={() => setShowMobileToolSheet(false)}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
            <div className={styles.mobileToolList}>
              {toolCategories.map((cat) => {
                const catTools = tools.filter((t) => t.category === cat);
                if (catTools.length === 0) return null;
                return (
                  <React.Fragment key={cat}>
                    <div className={styles.mobileToolCatLabel}>{cat}</div>
                    {catTools.map((t) => (
                      <button
                        key={t.id}
                        className={styles.mobileToolItem}
                        onClick={() => {
                          setShowMobileToolSheet(false);
                          selectTool(t);
                        }}
                      >
                        <span
                          className={styles.mobileToolItemDot}
                          style={{ background: TOOL_COLORS[t.id] || '#6b7280' }}
                        >
                          {t.title[0]}
                        </span>
                        <span>{t.title}</span>
                      </button>
                    ))}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Result tabs (card layout for both job results and demo) ----
function ResultTabs({
  files,
  buildUrl,
  onFigcode,
  onReport,
}: {
  files: Array<{ name: string; type: string; label?: string; url?: string }>;
  buildUrl: (name: string) => string;
  onFigcode: (id: string) => void;
  onReport?: () => void;
}) {
  const [tab, setTab] = useState<'plots' | 'files'>('plots');
  const [previewData, setPreviewData] = useState<string[][] | null>(null);
  const [previewName, setPreviewName] = useState<string>('');
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const plots = files.filter((f) => f.type === 'plot');
  const tables = files.filter((f) => f.type === 'table' || f.type === 'file' || f.type === 'text');

  const previewCsv = useCallback(
    async (name: string) => {
      try {
        const resp = await fetch(buildUrl(name));
        const text = await resp.text();
        const sep = text.includes('\t') ? '\t' : ',';
        const rows = text
          .split('\n')
          .filter((l) => l.trim())
          .slice(0, 20)
          .map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
        setPreviewData(rows);
        setPreviewName(name);
      } catch {
        setPreviewData(null);
      }
    },
    [buildUrl]
  );

  return (
    <>
      <div className={styles.resultTabs}>
        <button
          className={`${styles.resultTab} ${tab === 'plots' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('plots')}
        >
          图表 ({plots.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'files' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('files')}
        >
          数据文件 ({tables.length})
        </button>
        {onReport && (
          <button className={styles.demoTag} onClick={onReport} style={{ marginLeft: 'auto' }}>
            报告
          </button>
        )}
      </div>

      {tab === 'plots' && (
        <div className={styles.plotCardGrid}>
          {plots.map((f, idx) => {
            const figId = getFigcodeCardId(f.name);
            return (
              <div key={f.name} className={styles.plotCard}>
                <div className={styles.plotCardHeader}>
                  <span className={styles.plotCardNum}>图{idx + 1}</span>
                  <span className={styles.plotCardLabel}>
                    {f.label || f.name.replace('.png', '')}
                  </span>
                </div>
                <div className={styles.plotCardImg}>
                  <img
                    src={buildUrl(f.name)}
                    alt={f.label || f.name}
                    onClick={() => setLightboxSrc(buildUrl(f.name))}
                    style={{ cursor: 'zoom-in' }}
                  />
                </div>
                <div className={styles.plotCardFooter}>
                  <div className={styles.plotCardActions}>
                    <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
                      PNG
                    </a>
                    {figId && (
                      <button
                        className={styles.plotCardBtnPrimary}
                        onClick={() => onFigcode(figId)}
                      >
                        在线绘图
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div className={styles.fileCardGrid}>
          {tables.map((f) => (
            <div key={f.name} className={styles.fileCard}>
              <div className={styles.fileCardIcon}>
                {f.type === 'table' ? '📋' : f.type === 'text' ? '📝' : '📦'}
              </div>
              <div className={styles.fileCardName}>{f.label || f.name}</div>
              <div className={styles.fileCardDesc}>{f.name}</div>
              <div className={styles.fileCardActions}>
                <a href={buildUrl(f.name)} download className={styles.plotCardBtn}>
                  下载
                </a>
                {f.name.endsWith('.csv') && (
                  <button className={styles.plotCardBtnPrimary} onClick={() => previewCsv(f.name)}>
                    预览
                  </button>
                )}
              </div>
            </div>
          ))}
          {tables.length === 0 && <p style={{ color: '#9ca3af', fontSize: 12 }}>暂无数据文件</p>}
        </div>
      )}

      {/* CSV Preview Modal */}
      {previewData && (
        <div className={styles.modalOverlay} onClick={() => setPreviewData(null)}>
          <div
            className={styles.modal}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: '90vw', width: 800 }}
          >
            <div className={styles.modalHeader}>
              <h2>{previewName}（前 20 行）</h2>
              <div className={styles.modalHeaderActions}>
                <a href={buildUrl(previewName)} download className={styles.demoBtn}>
                  下载完整文件
                </a>
                <button className={styles.modalClose} onClick={() => setPreviewData(null)}>
                  ×
                </button>
              </div>
            </div>
            <div style={{ padding: 16, overflow: 'auto', maxHeight: '60vh' }}>
              <table className={styles.paramsTable} style={{ fontSize: 11, whiteSpace: 'nowrap' }}>
                <tbody>
                  {previewData.map((row, i) => (
                    <tr key={i} style={i === 0 ? { fontWeight: 600, background: '#f8faf9' } : {}}>
                      {row.slice(0, 10).map((c, j) => (
                        <td key={j}>{c.length > 20 ? c.slice(0, 20) + '…' : c}</td>
                      ))}
                      {row.length > 10 && <td>…</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {lightboxSrc && <Lightbox src={lightboxSrc} onClose={() => setLightboxSrc(null)} />}
    </>
  );
}

// ---- Demo tabs (single-cell style: 数据预览 | 图表 | 数据文件 | 参数) ----
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DemoTabs({
  demoFiles,
  demoToolId,
  onFigcode,
}: {
  demoFiles: Array<{ name: string; type: string; url: string }>;
  demoToolId: string;
  onFigcode: (id: string) => void;
}) {
  const [tab, setTab] = useState<'plots' | 'files' | 'params'>('plots');
  const plots = demoFiles.filter((f) => f.type === 'plot');
  const tables = demoFiles.filter((f) => f.type === 'table' || f.type === 'file');
  const tool = (staticTools as any).find((t: any) => t.id === demoToolId);
  const apiBase = getApiPrefix(tool?.language === 'python' ? 'python' : 'r');

  return (
    <>
      <div className={styles.resultTabs}>
        <button
          className={`${styles.resultTab} ${tab === 'plots' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('plots')}
        >
          图表 ({plots.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'files' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('files')}
        >
          数据文件 ({tables.length})
        </button>
        <button
          className={`${styles.resultTab} ${tab === 'params' ? styles.resultTabActive : ''}`}
          onClick={() => setTab('params')}
        >
          参数
        </button>
      </div>

      {tab === 'plots' && (
        <div className={styles.plotCardGrid}>
          {plots.map((f) => {
            const figId = getFigcodeCardId(f.name);
            return (
              <div key={f.name} className={styles.plotCard}>
                <div className={styles.plotCardImg}>
                  <img src={`${apiBase}${f.url}`} alt={f.name} />
                </div>
                <div className={styles.plotCardFooter}>
                  <span className={styles.plotCardLabel}>{f.name.replace('.png', '')}</span>
                  <div className={styles.plotCardActions}>
                    <a href={`${apiBase}${f.url}`} download className={styles.plotCardBtn}>
                      PNG
                    </a>
                    {figId && (
                      <button
                        className={styles.plotCardBtnPrimary}
                        onClick={() => onFigcode(figId)}
                      >
                        在线绘图
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'files' && (
        <div className={styles.fileList}>
          {tables.map((f) => (
            <a key={f.name} href={`${apiBase}${f.url}`} download className={styles.fileItem}>
              <span className={styles.fileIcon}>{f.name.endsWith('.csv') ? '📋' : '📦'}</span>
              <div className={styles.fileInfo}>
                <span className={styles.fileItemName}>{f.name}</span>
                <span className={styles.fileItemDesc}>
                  {f.name.endsWith('.csv') ? '表格数据（CSV）' : '文件'}
                </span>
              </div>
            </a>
          ))}
          {tables.length === 0 && <p style={{ color: '#9ca3af', fontSize: 12 }}>暂无数据文件</p>}
        </div>
      )}

      {tab === 'params' && tool && (
        <div className={styles.paramsView}>
          <table className={styles.paramsTable}>
            <tbody>
              <tr>
                <td>工具</td>
                <td>{tool.title}</td>
              </tr>
              <tr>
                <td>语言</td>
                <td>{tool.language === 'r' ? 'R' : 'Python'}</td>
              </tr>
              <tr>
                <td>依赖包</td>
                <td>{tool.packages.join(', ')}</td>
              </tr>
              <tr>
                <td>预计耗时</td>
                <td>~{tool.estimatedMinutes} 分钟</td>
              </tr>
              {/* 桌面端已移除教程入口，"关联教程"行已删除。如需恢复取消下面注释即可。 */}
              {/* <tr>
                <td>关联教程</td>
                <td>
                  <a href={tool.tutorialUrl}>{tool.tutorialUrl}</a>
                </td>
              </tr> */}
            </tbody>
          </table>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>{tool.longDescription}</p>
        </div>
      )}
    </>
  );
}

export default function ToolsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="分析工具"
        subtitle="BioF3 本地组学分析工具"
        icon="bar-chart"
        breadcrumb={[{ label: '首页', href: '/' }, { label: '分析工具' }]}
      />
      <ToolsInner />
    </>
  );
}
