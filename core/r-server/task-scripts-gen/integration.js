/**
 * task-scripts-gen/integration.js — R script generator for integration analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateIntegrationScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    method = 'harmony',  // harmony | cca | rpca
    batchCol = 'orig.ident',
    nPCs = 20,
    resolution = 0.5,
  } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeBatchCol = sanitizeRString(batchCol);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeBatchCol) {
    throw new Error('非法参数：含危险字符');
  }

  return `
suppressMessages({
  library(Seurat)
  library(harmony)
  library(ggplot2)
  library(jsonlite)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load ---
report_progress(10, "加载数据...")
input_url <- "${safeOssInputUrl}"
download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
obj <- readRDS("input.rds")
if (!inherits(obj, "Seurat")) stop("多样本整合需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞, batch: ${safeBatchCol}"))

# --- 2. Standard preprocessing ---
report_progress(25, "标准化...")
obj <- NormalizeData(obj)
obj <- FindVariableFeatures(obj, nfeatures = 2000)
obj <- ScaleData(obj)
obj <- RunPCA(obj, npcs = ${nPCs})

# Before integration UMAP
obj <- RunUMAP(obj, dims = 1:${nPCs}, reduction.name = "umap_before")
p_before <- DimPlot(obj, reduction = "umap_before", group.by = "${safeBatchCol}") +
  ggtitle("Before Integration")
ggsave("plot_001_before_integration.png", p_before, width = 8, height = 6, dpi = 150)

# --- 3. Integration ---
report_progress(40, "运行 ${method} 整合...")
if ("${method}" == "harmony") {
  obj <- RunHarmony(obj, group.by.vars = "${safeBatchCol}", dims.use = 1:${nPCs})
  reduction_use <- "harmony"
} else {
  # CCA/RPCA: split and integrate
  obj_list <- SplitObject(obj, split.by = "${safeBatchCol}")
  obj_list <- lapply(obj_list, function(x) {
    x <- NormalizeData(x)
    x <- FindVariableFeatures(x, nfeatures = 2000)
    x
  })
  features <- SelectIntegrationFeatures(object.list = obj_list, nfeatures = 2000)
  anchors <- FindIntegrationAnchors(object.list = obj_list, anchor.features = features,
                                     reduction = "${method === 'cca' ? 'cca' : 'rpca'}")
  obj <- IntegrateData(anchorset = anchors)
  DefaultAssay(obj) <- "integrated"
  obj <- ScaleData(obj)
  obj <- RunPCA(obj, npcs = ${nPCs})
  reduction_use <- "pca"
}

# --- 4. Post-integration clustering ---
report_progress(60, "聚类...")
obj <- FindNeighbors(obj, dims = 1:${nPCs}, reduction = reduction_use)
obj <- FindClusters(obj, resolution = ${resolution})

report_progress(70, "UMAP...")
obj <- RunUMAP(obj, dims = 1:${nPCs}, reduction = reduction_use)

# --- 5. Plots ---
report_progress(80, "生成图表...")
p_after <- DimPlot(obj, reduction = "umap", group.by = "${safeBatchCol}") +
  ggtitle("After Integration (${method})")
ggsave("plot_002_after_integration.png", p_after, width = 8, height = 6, dpi = 150)

p_clusters <- DimPlot(obj, reduction = "umap", label = TRUE) +
  ggtitle(paste0(length(unique(Idents(obj))), " Clusters"))
ggsave("plot_003_clusters.png", p_clusters, width = 8, height = 6, dpi = 150)

# Split by batch
p_split <- DimPlot(obj, reduction = "umap", split.by = "${safeBatchCol}") +
  ggtitle("Split by Batch")
ggsave("plot_004_split_batch.png", p_split, width = 12, height = 5, dpi = 150)

# --- 6. Save ---
report_progress(90, "保存结果...")
saveRDS(obj, "result_integrated.rds")

batches <- unique(obj@meta.data[["${safeBatchCol}"]])
summary_data <- list(
  n_cells = ncol(obj),
  n_clusters = length(unique(Idents(obj))),
  n_batches = length(batches),
  method = "${method}",
  batch_col = "${safeBatchCol}"
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate trajectory analysis R script (Monocle3).
 */

module.exports = { generateIntegrationScript };
