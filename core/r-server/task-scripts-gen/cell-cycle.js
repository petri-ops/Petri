/**
 * task-scripts-gen/cell-cycle.js — R script generator for cell-cycle analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateCellCycleScript(task) {
  const {containerWorkDir, parentCachePath, ossInputUrl} = task;
  const species = task.params?.species || 'human';

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
cat("=== Cell Cycle Scoring ===\n")

# Load data
${safeParentCachePath ? `obj <- readRDS("${safeParentCachePath}")` : `
download.file("${safeOssInputUrl}", "input.rds", mode = "wb", quiet = TRUE)
obj <- readRDS("input.rds")
`}

# Get cell cycle genes
${species === 'human' ? `
s.genes <- cc.genes.updated.2019$s.genes
g2m.genes <- cc.genes.updated.2019$g2m.genes
` : `
# Convert human genes to mouse (capitalize first letter)
s.genes <- stringr::str_to_title(cc.genes.updated.2019$s.genes)
g2m.genes <- stringr::str_to_title(cc.genes.updated.2019$g2m.genes)
`}

# Score cell cycle
obj <- CellCycleScoring(obj, s.features = s.genes, g2m.features = g2m.genes)

# Plot 1: UMAP colored by phase
png("plot_001_cellcycle_umap.png", width = 800, height = 600, res = 150)
print(DimPlot(obj, group.by = "Phase", cols = c("G1" = "#2563eb", "S" = "#dc2626", "G2M" = "#16a34a")) + ggtitle("Cell Cycle Phase"))
dev.off()

# Plot 2: Phase proportions
phase_counts <- table(obj$Phase)
png("plot_002_phase_bar.png", width = 600, height = 400, res = 150)
barplot(phase_counts, col = c("#2563eb", "#dc2626", "#16a34a"), main = "Cell Cycle Phase Distribution", ylab = "Number of cells")
dev.off()

# Save results
saveRDS(obj, "result.rds")
write.csv(data.frame(cell_id = colnames(obj), Phase = obj$Phase, S.Score = obj$S.Score, G2M.Score = obj$G2M.Score), "cellcycle_scores.csv", row.names = FALSE)

# Summary
cat("Done\n")
summary_json <- jsonlite::toJSON(list(
  n_cells = ncol(obj),
  G1 = as.integer(phase_counts["G1"]),
  S = as.integer(phase_counts["S"]),
  G2M = as.integer(phase_counts["G2M"])
), auto_unbox = TRUE)
writeLines(summary_json, "summary.json")
`;
}


module.exports = { generateCellCycleScript };
