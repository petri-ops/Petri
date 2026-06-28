#!/usr/bin/env Rscript
# ============================================================
# volcano-plot.R — 火山图绘制插件
#
# 输入: CSV (gene, log2FC, pvalue)
# 输出: 火山图 PNG/PDF + 分类结果表 CSV
# ============================================================

suppressMessages({
  library(ggplot2)
  library(ggrepel)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("用法: Rscript volcano-plot.R <work_dir>")
work_dir <- args[1]
setwd(work_dir)

# 读参数
params <- fromJSON(file.path(work_dir, "params.json"))
deg_path <- params$deg_table
fc_threshold <- as.numeric(params$fc_threshold %||% 1)
pval_threshold <- as.numeric(params$pval_threshold %||% 1.3)
top_n <- as.integer(params$top_n %||% 10)

`%||%` <- function(a, b) if (is.null(a) || is.na(a)) b else a

# 读数据
deg <- read.csv(deg_path, stringsAsFactors = FALSE)
if (!all(c("gene", "log2FC", "pvalue") %in% names(deg))) {
  stop("CSV 必须包含列: gene, log2FC, pvalue")
}

deg$neg_log10_p <- -log10(deg$pvalue + 1e-300)
deg$sig <- "NS"
deg$sig[deg$log2FC > fc_threshold & deg$neg_log10_p > pval_threshold] <- "Up"
deg$sig[deg$log2FC < -fc_threshold & deg$neg_log10_p > pval_threshold] <- "Down"
deg$sig <- factor(deg$sig, levels = c("Up", "NS", "Down"))

# top N 标注
deg$rank_score <- abs(deg$log2FC) * deg$neg_log10_p
deg$label <- ""
top_idx <- order(deg$rank_score, decreasing = TRUE)[1:min(top_n, nrow(deg))]
deg$label[top_idx] <- deg$gene[top_idx]

# 配色
colors <- c(Up = "#dc2626", NS = "#94a3b8", Down = "#2563eb")

# 绘图
p <- ggplot(deg, aes(x = log2FC, y = neg_log10_p, color = sig)) +
  geom_point(alpha = 0.6, size = 1.8) +
  geom_text_repel(
    aes(label = label),
    data = subset(deg, label != ""),
    size = 3, max.overlaps = 20,
    box.padding = 0.4, segment.color = "grey50"
  ) +
  scale_color_manual(values = colors, name = "") +
  geom_vline(xintercept = c(-fc_threshold, fc_threshold), linetype = "dashed", color = "grey60", linewidth = 0.4) +
  geom_hline(yintercept = pval_threshold, linetype = "dashed", color = "grey60", linewidth = 0.4) +
  labs(
    x = expression(log[2](Fold~Change)),
    y = expression(-log[10](italic(p))),
    title = "Volcano Plot"
  ) +
  theme_minimal(base_size = 12) +
  theme(
    panel.border = element_rect(color = "black", fill = NA, linewidth = 0.6),
    axis.line = element_blank(),
    legend.position = "right"
  )

# 保存
ggsave("volcano.png", p, width = 7, height = 5, dpi = 300, bg = "white")
ggsave("volcano.pdf", p, width = 7, height = 5)

# 分类表
classified <- deg[, c("gene", "log2FC", "pvalue", "sig")]
write.csv(classified, "classified_table.csv", row.names = FALSE)

# manifest
manifest <- list(
  status = "done",
  outputs = list(
    list(id = "volcano", filename = "volcano.png", type = "plot", label = "火山图"),
    list(id = "classified_table", filename = "classified_table.csv", type = "table", label = "分类结果表")
  ),
  summary = list(
    up = sum(deg$sig == "Up"),
    down = sum(deg$sig == "Down"),
    ns = sum(deg$sig == "NS")
  )
)
write(toJSON(manifest, auto_unbox = TRUE, pretty = TRUE), "manifest.json")

cat("DONE\n")
