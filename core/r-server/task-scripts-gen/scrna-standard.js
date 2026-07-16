/**
 * task-scripts-gen/scrna-standard.js — R script generator for scrna-standard analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateScRNAScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    species = 'human',
    minCells = 3,
    minFeatures = 200,
    maxFeatures = 5000,
    maxMtPercent = 20,
    nPCs = 20,
    resolution = 0.5,
    normMethod = 'LogNormalize',
  } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeSpecies = sanitizeRString(species);
  const safeNormMethod = sanitizeRString(normMethod);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeSpecies || !safeNormMethod) {
    throw new Error('非法参数：含危险字符');
  }

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
report_progress(10, "正在下载数据...")
input_url <- "${safeOssInputUrl}"

# Determine input format and load
ext <- tolower(tools::file_ext(input_url))
if (ext == "rds") {
  download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
  obj <- readRDS("input.rds")
  if (!inherits(obj, "Seurat")) {
    # Assume it's a count matrix
    obj <- CreateSeuratObject(counts = obj, min.cells = ${minCells}, min.features = ${minFeatures})
  }
} else if (ext %in% c("h5", "hdf5")) {
  download.file(input_url, "input.h5", mode = "wb", quiet = TRUE)
  counts <- Read10X_h5("input.h5")
  obj <- CreateSeuratObject(counts = counts, min.cells = ${minCells}, min.features = ${minFeatures})
} else {
  # Detect separator from extension and read matrix (genes x cells)
  download.file(input_url, "input_matrix", mode = "wb", quiet = TRUE)
  first_line <- readLines("input_matrix", n = 1)
  if (grepl("\\t", first_line)) {
    counts <- read.delim("input_matrix", row.names = 1, check.names = FALSE, sep = "\\t")
  } else {
    counts <- read.csv("input_matrix", row.names = 1, check.names = FALSE)
  }
  obj <- CreateSeuratObject(counts = counts, min.cells = ${minCells}, min.features = ${minFeatures})
}

report_progress(20, paste0("数据加载完成: ", ncol(obj), " 细胞, ", nrow(obj), " 基因"))

# --- 2. QC ---
report_progress(25, "质控分析...")
mt_pattern <- ifelse("${safeSpecies}" == "human", "^MT-", "^mt-")
obj[["percent.mt"]] <- PercentageFeatureSet(obj, pattern = mt_pattern)

# QC violin plot
p_qc <- VlnPlot(obj, features = c("nFeature_RNA", "nCount_RNA", "percent.mt"), ncol = 3, pt.size = 0)
ggsave("plot_001_qc_violin.png", p_qc, width = 10, height = 4, dpi = 150)

# Filter
obj <- subset(obj, subset = nFeature_RNA > ${minFeatures} & nFeature_RNA < ${maxFeatures} & percent.mt < ${maxMtPercent})
report_progress(35, paste0("质控后: ", ncol(obj), " 细胞"))

# --- 3. Normalize ---
report_progress(40, "标准化...")
obj <- NormalizeData(obj, normalization.method = "${safeNormMethod}")

# --- 4. Find variable features ---
report_progress(45, "寻找高变基因...")
obj <- FindVariableFeatures(obj, selection.method = "vst", nfeatures = 2000)
p_hvg <- VariableFeaturePlot(obj)
ggsave("plot_002_hvg.png", p_hvg, width = 8, height = 5, dpi = 150)

# --- 5. Scale & PCA ---
report_progress(50, "PCA降维...")
obj <- ScaleData(obj)
obj <- RunPCA(obj, npcs = ${nPCs})

p_elbow <- ElbowPlot(obj, ndims = ${nPCs})
ggsave("plot_003_elbow.png", p_elbow, width = 6, height = 4, dpi = 150)

p_pca <- DimPlot(obj, reduction = "pca")
ggsave("plot_004_pca.png", p_pca, width = 7, height = 5, dpi = 150)

# --- 6. Clustering ---
report_progress(65, "聚类分析...")
obj <- FindNeighbors(obj, dims = 1:${nPCs})
obj <- FindClusters(obj, resolution = ${resolution})

# --- 7. UMAP ---
report_progress(75, "UMAP降维...")
obj <- RunUMAP(obj, dims = 1:${nPCs})

p_umap <- DimPlot(obj, reduction = "umap", label = TRUE, label.size = 4) +
  ggtitle(paste0("UMAP (", ncol(obj), " cells, ", length(unique(Idents(obj))), " clusters)"))
ggsave("plot_005_umap.png", p_umap, width = 8, height = 6, dpi = 150)

# --- 8. Find markers (top 5 per cluster) ---
report_progress(85, "寻找标记基因...")
markers <- FindAllMarkers(obj, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.25)
top_markers <- markers %>% group_by(cluster) %>% slice_max(n = 5, order_by = avg_log2FC)
write.csv(top_markers, "markers_top5.csv", row.names = FALSE)

# Heatmap of top markers
top3 <- markers %>% group_by(cluster) %>% slice_max(n = 3, order_by = avg_log2FC) %>% pull(gene) %>% unique()
if (length(top3) > 0 && length(top3) <= 60) {
  p_heat <- DoHeatmap(obj, features = top3) + NoLegend()
  ggsave("plot_006_heatmap.png", p_heat, width = 12, height = 8, dpi = 150)
}

# --- 9. Save processed object ---
report_progress(95, "保存结果...")
saveRDS(obj, "result.rds")

# Summary stats
summary_data <- list(
  n_cells = ncol(obj),
  n_genes = nrow(obj),
  n_clusters = length(unique(Idents(obj))),
  n_pcs_used = ${nPCs},
  resolution = ${resolution},
  species = "${safeSpecies}"
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate DEG (Differential Expression) R script.
 * Supports: DESeq2 (bulk) or Seurat FindMarkers (single-cell)
 */

/**
 * Generate recluster R script.
 * Loads existing Seurat object from cache, applies cell subset if specified,
 * then re-runs PCA → clustering → UMAP → markers. Skips QC entirely.
 */

module.exports = { generateScRNAScript };
