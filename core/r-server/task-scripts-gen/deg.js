/**
 * task-scripts-gen/deg.js — R script generator for deg analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateDEGScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    method = 'DESeq2',        // DESeq2 | wilcox | t-test
    groupCol = 'condition',   // column name for grouping
    group1 = 'treatment',     // treatment group
    group2 = 'control',       // control group
    pCutoff = 0.05,
    fcCutoff = 1.0,
    topN = 20,
  } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入必须转义，防 R 代码注入
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeGroupCol = sanitizeRString(groupCol);
  const safeGroup1 = sanitizeRString(group1);
  const safeGroup2 = sanitizeRString(group2);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeGroupCol || !safeGroup1 || !safeGroup2) {
    throw new Error('非法参数：含危险字符（引号/换行/反斜杠）');
  }

  return `
suppressMessages({
  library(ggplot2)
  library(jsonlite)
  library(dplyr)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load data ---
report_progress(10, "下载数据...")
input_url <- "${safeOssInputUrl}"
ext <- tolower(tools::file_ext(input_url))

if (ext == "rds") {
  download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
  obj <- readRDS("input.rds")
} else if (ext %in% c("csv", "tsv", "txt")) {
  download.file(input_url, "input.csv", mode = "wb", quiet = TRUE)
  obj <- read.csv("input.csv", row.names = 1, check.names = FALSE)
} else {
  stop(paste0("不支持的文件格式: ", ext))
}

report_progress(20, "数据加载完成")

# --- 2. Determine analysis mode ---
is_seurat <- inherits(obj, "Seurat")

if (is_seurat) {
  # Single-cell mode: use Seurat FindMarkers
  suppressMessages(library(Seurat))
  report_progress(30, "单细胞模式: FindMarkers...")

  # Check if group column exists
  if (!"${safeGroupCol}" %in% colnames(obj@meta.data)) {
    # Try using Idents
    if (length(unique(Idents(obj))) >= 2) {
      obj$deg_group <- Idents(obj)
    } else {
      stop(paste0("找不到分组列: ${safeGroupCol}"))
    }
  } else {
    Idents(obj) <- "${safeGroupCol}"
  }

  report_progress(40, "计算差异表达...")
  markers <- FindMarkers(obj, ident.1 = "${safeGroup1}", ident.2 = "${safeGroup2}",
                         test.use = "${method === 'DESeq2' ? 'wilcox' : method}",
                         min.pct = 0.1, logfc.threshold = 0)
  markers$gene <- rownames(markers)
  colnames(markers)[colnames(markers) == "p_val_adj"] <- "padj"
  colnames(markers)[colnames(markers) == "avg_log2FC"] <- "log2FoldChange"

} else {
  # Bulk mode: use DESeq2
  suppressMessages(library(DESeq2))
  report_progress(30, "Bulk 模式: DESeq2...")

  # obj should be a count matrix (genes x samples)
  # Need a coldata with group info
  # Try to infer from column names or expect a metadata row
  counts <- as.matrix(obj)
  storage.mode(counts) <- "integer"

  # Simple grouping: columns containing group names
  sample_names <- colnames(counts)
  group_vec <- ifelse(grepl("${safeGroup1}", sample_names, ignore.case = TRUE), "${safeGroup1}",
               ifelse(grepl("${safeGroup2}", sample_names, ignore.case = TRUE), "${safeGroup2}", NA))

  if (all(is.na(group_vec))) {
    # Fallback: first half vs second half
    n <- ncol(counts)
    group_vec <- c(rep("${safeGroup1}", floor(n/2)), rep("${safeGroup2}", ceiling(n/2)))
  }

  valid <- !is.na(group_vec)
  counts <- counts[, valid]
  group_vec <- group_vec[valid]

  coldata <- data.frame(condition = factor(group_vec, levels = c("${safeGroup2}", "${safeGroup1}")), row.names = colnames(counts))

  report_progress(40, "运行 DESeq2...")
  dds <- DESeqDataSetFromMatrix(countData = counts, colData = coldata, design = ~ condition)
  dds <- dds[rowSums(counts(dds)) >= 10, ]
  dds <- DESeq(dds)

  report_progress(60, "提取结果...")
  res <- results(dds, contrast = c("condition", "${safeGroup1}", "${safeGroup2}"))
  markers <- as.data.frame(res)
  markers$gene <- rownames(markers)
}

report_progress(70, "生成图表...")

# --- 3. Volcano plot ---
markers$sig <- "ns"
markers$sig[markers$padj < ${pCutoff} & markers$log2FoldChange > ${fcCutoff}] <- "up"
markers$sig[markers$padj < ${pCutoff} & markers$log2FoldChange < -${fcCutoff}] <- "down"

n_up <- sum(markers$sig == "up", na.rm = TRUE)
n_down <- sum(markers$sig == "down", na.rm = TRUE)

p_volcano <- ggplot(markers, aes(x = log2FoldChange, y = -log10(padj), color = sig)) +
  geom_point(size = 0.8, alpha = 0.6) +
  scale_color_manual(values = c("up" = "#dc2626", "down" = "#2563eb", "ns" = "#94a3b8")) +
  geom_vline(xintercept = c(-${fcCutoff}, ${fcCutoff}), linetype = "dashed", color = "#9ca3af", linewidth = 0.3) +
  geom_hline(yintercept = -log10(${pCutoff}), linetype = "dashed", color = "#9ca3af", linewidth = 0.3) +
  labs(title = paste0("Volcano (up: ", n_up, " | down: ", n_down, ")"),
       x = "log2 Fold Change", y = "-log10(padj)") +
  theme_classic(base_size = 11) +
  theme(legend.position = "none")
ggsave("plot_001_volcano.png", p_volcano, width = 7, height = 5, dpi = 150)

# --- 4. Top genes bar plot ---
report_progress(80, "Top 差异基因...")
top_up <- markers %>% filter(sig == "up") %>% arrange(padj) %>% head(${topN})
top_down <- markers %>% filter(sig == "down") %>% arrange(padj) %>% head(${topN})
top_genes <- bind_rows(top_up, top_down)

if (nrow(top_genes) > 0) {
  top_genes$gene <- factor(top_genes$gene, levels = top_genes$gene[order(top_genes$log2FoldChange)])
  p_bar <- ggplot(top_genes, aes(x = gene, y = log2FoldChange, fill = sig)) +
    geom_col() +
    scale_fill_manual(values = c("up" = "#dc2626", "down" = "#2563eb")) +
    coord_flip() +
    labs(title = paste0("Top ", ${topN}, " DEGs"), x = "", y = "log2FC") +
    theme_classic(base_size = 10) +
    theme(legend.position = "none")
  ggsave("plot_002_top_genes.png", p_bar, width = 7, height = 6, dpi = 150)
}

# --- 5. MA plot ---
if ("baseMean" %in% colnames(markers)) {
  p_ma <- ggplot(markers, aes(x = log10(baseMean + 1), y = log2FoldChange, color = sig)) +
    geom_point(size = 0.6, alpha = 0.5) +
    scale_color_manual(values = c("up" = "#dc2626", "down" = "#2563eb", "ns" = "#94a3b8")) +
    labs(title = "MA Plot", x = "log10(baseMean)", y = "log2FC") +
    theme_classic(base_size = 11) +
    theme(legend.position = "none")
  ggsave("plot_003_ma.png", p_ma, width = 7, height = 5, dpi = 150)
}

# --- 6. Save results ---
report_progress(90, "保存结果...")
write.csv(markers, "deg_results.csv", row.names = FALSE)
write.csv(top_genes, "deg_top_genes.csv", row.names = FALSE)

summary_data <- list(
  n_total = nrow(markers),
  n_up = n_up,
  n_down = n_down,
  p_cutoff = ${pCutoff},
  fc_cutoff = ${fcCutoff},
  method = "${method}",
  group1 = "${safeGroup1}",
  group2 = "${safeGroup2}"
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate Enrichment Analysis (GO/KEGG) R script.
 */

module.exports = { generateDEGScript };
