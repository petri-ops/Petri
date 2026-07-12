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

`%||%` <- function(a, b) if (is.null(a) || is.na(a)) b else a

# 读参数
params <- fromJSON(file.path(work_dir, "params.json"))
deg_path <- params$deg_table
fc_threshold <- as.numeric(params$fc_threshold %||% 1)
pval_threshold <- as.numeric(params$pval_threshold %||% 1.3)
top_n <- as.integer(params$top_n %||% 10)

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

summary_counts <- list(
  up = sum(deg$sig == "Up"),
  down = sum(deg$sig == "Down"),
  ns = sum(deg$sig == "NS")
)

html_escape <- function(x) {
  x <- as.character(x)
  x <- gsub("&", "&amp;", x, fixed = TRUE)
  x <- gsub("<", "&lt;", x, fixed = TRUE)
  x <- gsub(">", "&gt;", x, fixed = TRUE)
  x <- gsub('"', "&quot;", x, fixed = TRUE)
  x
}

top_rows <- head(classified[order(-abs(classified$log2FC), classified$pvalue), ], 12)
top_gene_rows_html <- paste(apply(top_rows, 1, function(row) {
  paste0(
    "<tr>",
    "<td>", html_escape(row[["gene"]]), "</td>",
    "<td>", sprintf("%.3f", as.numeric(row[["log2FC"]])), "</td>",
    "<td>", format(as.numeric(row[["pvalue"]]), scientific = TRUE, digits = 3), "</td>",
    "<td><span class=\"badge badge-", tolower(html_escape(row[["sig"]])), "\">", html_escape(row[["sig"]]), "</span></td>",
    "</tr>"
  )
}), collapse = "\n")

replace_token <- function(text, token, value) {
  gsub(paste0("{{", token, "}}"), as.character(value), text, fixed = TRUE)
}

report_generated <- FALSE
template_path <- file.path(work_dir, "report-template.html")
if (file.exists(template_path)) {
  report_html <- paste(readLines(template_path, warn = FALSE), collapse = "\n")
  replacements <- list(
    up_count = summary_counts$up,
    down_count = summary_counts$down,
    ns_count = summary_counts$ns,
    total_count = nrow(deg),
    fc_threshold = fc_threshold,
    pval_threshold = pval_threshold,
    top_n = top_n,
    top_gene_rows = top_gene_rows_html
  )
  for (name in names(replacements)) {
    report_html <- replace_token(report_html, name, replacements[[name]])
  }
  writeLines(report_html, "report.html", useBytes = TRUE)
  report_generated <- TRUE
}

# manifest
manifest <- list(
  status = "done",
  outputs = list(
    list(id = "volcano", filename = "volcano.png", type = "plot", label = "火山图"),
    list(id = "classified_table", filename = "classified_table.csv", type = "table", label = "分类结果表")
  ),
  summary = summary_counts,
  title = "Honeycomb 火山图 Demo 结果",
  files = list(
    list(name = "volcano.png", type = "plot", label = "火山图", title = "火山图", preview = TRUE, download = TRUE),
    list(name = "classified_table.csv", type = "table", label = "分类结果表", title = "分类结果表", preview = TRUE, download = TRUE),
    list(name = "deg_table.csv", type = "table", label = "输入 DEG 表", title = "输入 DEG 表", preview = TRUE, download = TRUE),
    list(name = "manifest.json", type = "text", label = "结果 Manifest", title = "结果 Manifest", preview = TRUE, download = TRUE),
    list(name = "volcano.pdf", type = "file", label = "火山图 PDF", title = "火山图 PDF", preview = FALSE, download = TRUE)
  ),
  sections = list(
    list(
      id = "report",
      label = "预览报告",
      artifactNames = list("report.html"),
      description = "汇总图表、统计和关键输出的主报告。"
    ),
    list(
      id = "figures",
      label = "图表结果",
      artifactNames = list("volcano.png", "volcano.pdf"),
      description = "火山图图片与可下载 PDF。"
    ),
    list(
      id = "tables",
      label = "结果表格",
      artifactNames = list("classified_table.csv", "deg_table.csv"),
      description = "差异分类结果与输入 DEG 表。"
    ),
    list(
      id = "records",
      label = "运行记录",
      artifactNames = list("manifest.json"),
      description = "结果 manifest 与输出结构记录。"
    )
  )
)
if (report_generated) {
  manifest$outputs <- c(
    list(list(id = "report", filename = "report.html", type = "report", label = "预览报告")),
    manifest$outputs
  )
  manifest$files <- c(
    list(list(name = "report.html", type = "report", label = "预览报告", title = "预览报告", preview = TRUE, download = TRUE)),
    manifest$files
  )
} else {
  manifest$sections <- manifest$sections[2:length(manifest$sections)]
}
write(toJSON(manifest, auto_unbox = TRUE, pretty = TRUE), "manifest.json")

cat("DONE\n")
