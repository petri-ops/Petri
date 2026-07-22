#!/usr/bin/env Rscript
# Harness prototype: one independently verifiable scientific analysis module.
# The executor supplies R_LIBS_USER; this script never installs packages or downloads data.

suppressPackageStartupMessages({
  library(clusterProfiler)
  library(org.Hs.eg.db)
  library(enrichplot)
  library(ggplot2)
})

args <- commandArgs(trailingOnly = TRUE)
job_dir <- if (length(args) >= 1) args[[1]] else getwd()
output_dir <- file.path(job_dir, "output")
dir.create(output_dir, recursive = TRUE, showWarnings = FALSE)

`%||%` <- function(left, right) {
  if (is.null(left) || length(left) == 0 || is.na(left[[1]])) right else left
}

params_path <- file.path(job_dir, "params.json")
params <- if (file.exists(params_path)) fromJSON(params_path) else list()
min_size <- as.integer(params$min_size %||% 10)
max_size <- as.integer(params$max_size %||% 500)

input_candidates <- list.files(job_dir, pattern = "^ranked_genes\\.(csv|tsv)$", full.names = TRUE)
if (length(input_candidates) == 0) {
  cat("ranked_genes.csv not found\n", file = stderr())
  quit(status = 2)
}
input_path <- input_candidates[[1]]
ranked <- if (grepl("\\.tsv$", input_path, ignore.case = TRUE)) {
  read.delim(input_path, stringsAsFactors = FALSE, check.names = FALSE)
} else {
  read.csv(input_path, stringsAsFactors = FALSE, check.names = FALSE)
}

required <- c("gene", "score")
if (!all(required %in% names(ranked))) {
  cat("required columns: gene, score\n", file = stderr())
  quit(status = 3)
}
ranked$gene <- trimws(as.character(ranked$gene))
ranked$score <- suppressWarnings(as.numeric(ranked$score))
ranked <- ranked[!is.na(ranked$score) & nzchar(ranked$gene), required]
ranked <- ranked[!duplicated(ranked$gene), ]
if (nrow(ranked) < 10) {
  cat("fewer than 10 valid ranked genes\n", file = stderr())
  quit(status = 4)
}
ranked <- ranked[order(ranked$score, decreasing = TRUE), ]

mapped <- bitr(ranked$gene, fromType = "SYMBOL", toType = "ENTREZID", OrgDb = org.Hs.eg.db)
mapping_rate <- nrow(mapped) / nrow(ranked)
if (nrow(mapped) == 0 || mapping_rate < 0.2) {
  cat(sprintf("gene ID mapping rate below 0.2 (%.3f)\n", mapping_rate), file = stderr())
  quit(status = 5)
}
ranked <- merge(ranked, mapped, by.x = "gene", by.y = "SYMBOL")

ego <- enrichGO(
  gene = unique(ranked$ENTREZID),
  OrgDb = org.Hs.eg.db,
  keyType = "ENTREZID",
  ont = "BP",
  pAdjustMethod = "BH",
  minGSSize = min_size,
  maxGSSize = max_size,
  readable = TRUE
)

result_path <- file.path(output_dir, "go_bp_results.csv")
write.csv(as.data.frame(ego), result_path, row.names = FALSE)

plot_path <- file.path(output_dir, "go_bp_dotplot.png")
if (nrow(as.data.frame(ego)) > 0) {
  png(plot_path, width = 1800, height = 1400, res = 240)
  print(dotplot(ego, showCategory = min(15, nrow(as.data.frame(ego)))) +
    ggtitle("GO Biological Process Enrichment"))
  dev.off()
} else {
  png(plot_path, width = 1800, height = 1400, res = 240)
  plot.new()
  text(0.5, 0.5, "No enriched GO-BP terms at current settings")
  dev.off()
}

report_path <- file.path(output_dir, "report.html")
report_status <- if (nrow(as.data.frame(ego)) > 0) "enriched_terms_found" else "no_enriched_terms"
writeLines(c(
  "<!doctype html><meta charset='utf-8'><title>GO-BP enrichment</title>",
  "<h1>GO-BP enrichment</h1>",
  sprintf("<p>Input genes: %d; mapped: %d (%.1f%%).</p>", nrow(ranked), nrow(mapped), mapping_rate * 100),
  sprintf("<p>Result status: <code>%s</code>. Empty enrichment is a valid scientific result.</p>", report_status),
  "<p>See <code>go_bp_results.csv</code> and <code>go_bp_dotplot.png</code> for the machine-readable evidence.</p>"
), report_path)

# Harness 在进程成功退出后依据实际 run-script、params、输入和输出统一生成
# artifact-manifest.json / provenance.json；插件脚本不维护第二份证据事实。
cat(sprintf("[ranked-go-enrichment] mapped %d/%d genes; %d terms\n", nrow(mapped), nrow(ranked), nrow(as.data.frame(ego))))
