#!/usr/bin/env Rscript
# sample-metrics.R — BLOCK-83 中性夹具插件：分组汇总（无领域语义）
# 输入：samples CSV（含 sample_id、数值列与 group_col 指定列）；输出：汇总表 + 报告占位

args <- commandArgs(trailingOnly = TRUE)
if (length(args) < 3) {
  stop("usage: sample-metrics.R <input.csv> <outdir> <params.json>", call. = FALSE)
}
input_path <- args[[1]]
out_dir <- args[[2]]
params_path <- args[[3]]

data <- read.csv(input_path, stringsAsFactors = FALSE, check.names = FALSE)
params <- jsonlite::fromJSON(params_path)
group_col <- if (is.null(params$group_col)) "group" else params$group_col
value_floor <- if (is.null(params$value_floor)) 0 else as.numeric(params$value_floor)

value_col <- setdiff(names(data), c("sample_id", group_col))[[1]]
data[["value_normalized"]] <- ifelse(
  data[[value_col]] >= value_floor,
  data[[value_col]] - value_floor,
  NA_real_
)

summary_table <- aggregate(
  data[[value_col]],
  by = list(group = data[[group_col]]),
  FUN = function(x) round(mean(x, na.rm = TRUE), 4)
)
names(summary_table) <- c("group", "mean_value")
write.csv(summary_table, file.path(out_dir, "summary_table.csv"), row.names = FALSE)

dir.create(file.path(out_dir, "plots"), showWarnings = FALSE, recursive = TRUE)
png(file.path(out_dir, "plots", "scatter.png"), width = 480, height = 360)
plot(data[[value_col]], main = "sample metrics", xlab = "index", ylab = value_col)
dev.off()
file.copy(file.path(out_dir, "plots", "scatter.png"), file.path(out_dir, "scatter.png"), overwrite = TRUE)
unlink(file.path(out_dir, "plots"), recursive = TRUE)

report_lines <- c(
  "<html><body><h1>sample-metrics report</h1>",
  paste0("<p>rows: ", nrow(data), "</p>"),
  paste0("<p>groups: ", nrow(summary_table), "</p>"),
  "</body></html>"
)
writeLines(report_lines, file.path(out_dir, "report.html"))

cat("sample-metrics: done\n")
