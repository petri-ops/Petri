#!/usr/bin/env Rscript
# ============================================================
# gene-correlation.R — 基因相关性热图插件
#
# 输入: 表达矩阵 CSV (行=基因, 列=样本)
# 输出: 相关性热图 PNG/PDF + 相关系数矩阵 CSV
# ============================================================

suppressMessages({
  library(pheatmap)
  library(jsonlite)
})

`%||%` <- function(a, b) if (is.null(a) || is.na(a)) b else a

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 1) stop("用法: Rscript gene-correlation.R <work_dir>")
work_dir <- args[1]
setwd(work_dir)

params <- fromJSON(file.path(work_dir, "params.json"))
expr_path <- params$expr_matrix
top_n <- as.integer(params$top_n %||% 30)
method <- params$method %||% "pearson"

# 读表达矩阵（行=基因，列=样本）
expr <- read.csv(expr_path, row.names = 1, check.names = FALSE)
expr <- as.matrix(expr)
if (ncol(expr) < 2) stop("表达矩阵至少需要 2 列（样本）")
if (nrow(expr) < 2) stop("表达矩阵至少需要 2 行（基因）")

# 按方差取 top N
gene_var <- apply(expr, 1, var, na.rm = TRUE)
top_idx <- order(gene_var, decreasing = TRUE)[1:min(top_n, nrow(expr))]
expr_top <- expr[top_idx, , drop = FALSE]

# 相关系数矩阵
corr_mat <- cor(t(expr_top), method = method, use = "pairwise.complete.obs")

# 保存矩阵
write.csv(as.data.frame(corr_mat), "corr_matrix.csv")

# 热图
png("heatmap.png", width = 7, height = 6, units = "in", res = 300, bg = "white")
pheatmap(
  corr_mat,
  color = colorRampPalette(c("#2563eb", "white", "#dc2626"))(100),
  border_color = NA,
  fontsize_row = 8,
  fontsize_col = 8,
  main = paste0("Gene Correlation (", method, ")"),
  cluster_rows = TRUE,
  cluster_cols = TRUE
)
dev.off()

pdf("heatmap.pdf", width = 7, height = 6)
pheatmap(
  corr_mat,
  color = colorRampPalette(c("#2563eb", "white", "#dc2626"))(100),
  border_color = NA,
  fontsize_row = 8,
  fontsize_col = 8,
  main = paste0("Gene Correlation (", method, ")"),
  cluster_rows = TRUE,
  cluster_cols = TRUE
)
dev.off()

# manifest
manifest <- list(
  status = "done",
  outputs = list(
    list(id = "heatmap", filename = "heatmap.png", type = "plot", label = "相关性热图"),
    list(id = "corr_matrix", filename = "corr_matrix.csv", type = "table", label = "相关系数矩阵")
  ),
  summary = list(
    genes = nrow(expr_top),
    method = method
  )
)
write(toJSON(manifest, auto_unbox = TRUE, pretty = TRUE), "manifest.json")

cat("DONE\n")
