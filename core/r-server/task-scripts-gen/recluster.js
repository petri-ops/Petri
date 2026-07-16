/**
 * task-scripts-gen/recluster.js — R script generator for recluster analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateReclusterScript(task, progressHelper) {
  const {params, containerWorkDir, parentCachePath, ossInputUrl} = task;
  const {
    nPCs = 20,
    resolution = 0.5,
  } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeParentCachePath = sanitizeRString(parentCachePath);
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  if (!safeContainerWorkDir || !safeOssInputUrl) {
    throw new Error('非法参数：含危险字符');
  }

  // Must have parentCachePath (loaded from existing analysis)
  const loadCode = safeParentCachePath
    ? `report_progress(10, "从缓存加载数据...")
obj <- readRDS("${safeParentCachePath}")`
    : `report_progress(10, "下载数据...")
download.file("${safeOssInputUrl}", "input.rds", mode = "wb", quiet = TRUE)
obj <- readRDS("input.rds")`;

  return `
suppressMessages({
  library(Seurat)
  library(ggplot2)
  library(jsonlite)
  library(dplyr)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load data ---
${loadCode}

# --- 2. Cell subset filtering ---
cell_ids_file <- "${safeContainerWorkDir}/cell_ids.txt"
if (file.exists(cell_ids_file)) {
  cell_ids <- readLines(cell_ids_file, warn = FALSE)
  cell_ids <- cell_ids[cell_ids != ""]
  if (length(cell_ids) > 0) {
    valid_cells <- intersect(cell_ids, colnames(obj))
    if (length(valid_cells) > 0) {
      report_progress(15, paste0("Subsetting to ", length(valid_cells), " / ", ncol(obj), " cells..."))
      obj <- subset(obj, cells = valid_cells)
    }
  }
}
report_progress(20, paste0("数据就绪: ", ncol(obj), " 细胞"))

# --- 3. Normalize (in case subset changed composition) ---
report_progress(30, "归一化...")
obj <- NormalizeData(obj, verbose = FALSE)
obj <- FindVariableFeatures(obj, selection.method = "vst", nfeatures = 2000, verbose = FALSE)

# --- 4. Scale + PCA ---
report_progress(40, "PCA 降维...")
obj <- ScaleData(obj, verbose = FALSE)
obj <- RunPCA(obj, npcs = ${nPCs}, verbose = FALSE)

p_elbow <- ElbowPlot(obj, ndims = ${nPCs})
ggsave("plot_001_elbow.png", p_elbow, width = 6, height = 4, dpi = 150)

# --- 5. Clustering ---
report_progress(60, "聚类分析...")
obj <- FindNeighbors(obj, dims = 1:${nPCs}, verbose = FALSE)
obj <- FindClusters(obj, resolution = ${resolution}, verbose = FALSE)

# --- 6. UMAP ---
report_progress(70, "UMAP 降维...")
obj <- RunUMAP(obj, dims = 1:${nPCs}, verbose = FALSE)

p_umap <- DimPlot(obj, reduction = "umap", label = TRUE, label.size = 4) +
  ggtitle(paste0("UMAP (", ncol(obj), " cells, ", length(unique(Idents(obj))), " clusters)"))
ggsave("plot_002_umap.png", p_umap, width = 8, height = 6, dpi = 150)

# --- 7. Find markers ---
report_progress(80, "寻找标记基因...")
markers <- FindAllMarkers(obj, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.25, verbose = FALSE)
top_markers <- markers %>% group_by(cluster) %>% slice_max(n = 5, order_by = avg_log2FC)
write.csv(top_markers, "markers_top5.csv", row.names = FALSE)

# Heatmap
top3 <- markers %>% group_by(cluster) %>% slice_max(n = 3, order_by = avg_log2FC) %>% pull(gene) %>% unique()
if (length(top3) > 0 && length(top3) <= 60) {
  p_heat <- DoHeatmap(obj, features = top3) + NoLegend()
  ggsave("plot_003_heatmap.png", p_heat, width = 12, height = 8, dpi = 150)
}

# --- 8. Save ---
report_progress(90, "保存结果...")
saveRDS(obj, "result.rds")

# Export metadata and features for data preview
meta_df <- obj@meta.data
meta_df$cell_id <- rownames(meta_df)
meta_df <- meta_df[, c("cell_id", setdiff(names(meta_df), "cell_id"))]
write.csv(meta_df, "metadata.csv", row.names = FALSE)

feat_df <- data.frame(
  gene_symbol = rownames(obj),
  total_counts = Matrix::rowSums(GetAssayData(obj, layer = "counts")),
  n_cells = Matrix::rowSums(GetAssayData(obj, layer = "counts") > 0)
)
feat_df$pct_cells <- round(100 * feat_df$n_cells / ncol(obj), 2)
feat_df <- feat_df[order(-feat_df$total_counts), ]
write.csv(feat_df, "features.csv", row.names = FALSE)

# Summary
summary_data <- list(
  n_cells = ncol(obj),
  n_genes = nrow(obj),
  n_clusters = length(unique(Idents(obj))),
  n_pcs_used = ${nPCs},
  resolution = ${resolution},
  mode = "recluster"
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "降维聚类完成!")
cat("TASK_COMPLETE\n")
`;
}


module.exports = { generateReclusterScript };
