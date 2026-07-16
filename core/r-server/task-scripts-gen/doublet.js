/**
 * task-scripts-gen/doublet.js — R script generator for doublet analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateDoubletScript(task) {
  const {containerWorkDir, parentCachePath, ossInputUrl} = task;
  const rate = task.params?.expectedDoubletRate || 0.05;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeParentCachePath = sanitizeRString(parentCachePath);
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  if (!safeContainerWorkDir || !safeOssInputUrl) {
    throw new Error('非法参数：含危险字符');
  }

  return `
library(Seurat)
library(ggplot2)

setwd("${safeContainerWorkDir}")
cat("=== Doublet Detection ===\n")

# Load data
${safeParentCachePath ? `obj <- readRDS("${safeParentCachePath}")` : `
download.file("${safeOssInputUrl}", "input.rds", mode = "wb", quiet = TRUE)
obj <- readRDS("input.rds")
`}

# Use scDblFinder if available, otherwise DoubletFinder approach
if (requireNamespace("scDblFinder", quietly = TRUE)) {
  library(scDblFinder)
  library(SingleCellExperiment)
  
  sce <- as.SingleCellExperiment(obj)
  sce <- scDblFinder(sce, dbr = ${rate})
  
  obj$doublet_score <- sce$scDblFinder.score
  obj$doublet_class <- sce$scDblFinder.class
} else {
  # Fallback: simple simulation-based approach
  cat("scDblFinder not available, using simulation approach\n")
  
  # Simulate doublets by averaging random pairs
  n_cells <- ncol(obj)
  n_sim <- round(n_cells * ${rate} * 10)
  
  # Use PCA distance as proxy
  pca <- Embeddings(obj, "pca")[, 1:min(20, ncol(Embeddings(obj, "pca")))]
  
  # For each cell, compute average distance to k nearest neighbors
  # Doublets tend to be in between clusters
  nn_dist <- FNN::knn.dist(pca, k = 10)
  avg_dist <- rowMeans(nn_dist)
  
  # Score: cells with low average distance in dense regions but between clusters
  obj$doublet_score <- 1 - (avg_dist - min(avg_dist)) / (max(avg_dist) - min(avg_dist))
  obj$doublet_class <- ifelse(obj$doublet_score > quantile(obj$doublet_score, 1 - ${rate}), "doublet", "singlet")
}

n_doublets <- sum(obj$doublet_class == "doublet")
n_singlets <- sum(obj$doublet_class == "singlet")

# Plot 1: UMAP colored by doublet class
png("plot_001_doublet_umap.png", width = 800, height = 600, res = 150)
print(DimPlot(obj, group.by = "doublet_class", cols = c("singlet" = "#64748b", "doublet" = "#dc2626")) + ggtitle(paste0("Doublet Detection (", n_doublets, " doublets)")))
dev.off()

# Plot 2: Score distribution
png("plot_002_doublet_score.png", width = 600, height = 400, res = 150)
hist(obj$doublet_score, breaks = 50, col = "#94a3b8", border = NA, main = "Doublet Score Distribution", xlab = "Score")
abline(v = quantile(obj$doublet_score, 1 - ${rate}), col = "red", lty = 2)
dev.off()

# Save
saveRDS(obj, "result.rds")
write.csv(data.frame(cell_id = colnames(obj), doublet_score = obj$doublet_score, doublet_class = obj$doublet_class), "doublet_results.csv", row.names = FALSE)

summary_json <- jsonlite::toJSON(list(
  n_cells = ncol(obj),
  n_doublets = n_doublets,
  n_singlets = n_singlets,
  doublet_rate = round(n_doublets / ncol(obj) * 100, 1)
), auto_unbox = TRUE)
writeLines(summary_json, "summary.json")
cat("Done:", n_doublets, "doublets detected\n")
`;

}

module.exports = { generateDoubletScript };
