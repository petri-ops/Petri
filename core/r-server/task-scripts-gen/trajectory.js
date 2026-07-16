/**
 * task-scripts-gen/trajectory.js — R script generator for trajectory analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateTrajectoryScript(task, progressHelper) {
  const { params, ossInputUrl, containerWorkDir } = task;
  const { rootCluster = 'auto', _nDims = 20 } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeParentCachePath = sanitizeRString(task.parentCachePath);
  const safeRootCluster = sanitizeRString(rootCluster);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeRootCluster) {
    throw new Error('非法参数：含危险字符');
  }

  return `
suppressMessages({
  library(Seurat)
  library(monocle3)
  library(ggplot2)
  library(jsonlite)
  library(SeuratWrappers)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load ---
${safeParentCachePath ? `report_progress(10, "从本地缓存加载...")\nobj <- readRDS("${safeParentCachePath}")` : `report_progress(10, "下载数据...")\ninput_url <- "${safeOssInputUrl}"\ndownload.file(input_url, "input.rds", mode = "wb", quiet = TRUE)\nobj <- readRDS("input.rds")`}
if (!inherits(obj, "Seurat")) stop("轨迹分析需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞"))

# --- 2. Convert to Monocle3 ---
report_progress(30, "转换为 CellDataSet...")
cds <- as.cell_data_set(obj)
cds <- cluster_cells(cds, reduction_method = "UMAP")

report_progress(50, "学习轨迹图...")
cds <- learn_graph(cds)

# --- 3. Order cells ---
report_progress(60, "排序细胞...")
if ("${safeRootCluster}" == "auto") {
  # Use the cluster with most cells as root
  cluster_counts <- table(clusters(cds))
  root_cluster <- names(which.max(cluster_counts))
  root_cells <- colnames(cds)[clusters(cds) == root_cluster]
  cds <- order_cells(cds, root_cells = root_cells[1:min(5, length(root_cells))])
} else {
  root_cells <- colnames(cds)[clusters(cds) == "${safeRootCluster}"]
  if (length(root_cells) == 0) stop("找不到指定的 root cluster: ${safeRootCluster}")
  cds <- order_cells(cds, root_cells = root_cells[1:min(5, length(root_cells))])
}

# --- 4. Plots ---
report_progress(75, "生成图表...")

p_traj <- plot_cells(cds, color_cells_by = "cluster", label_groups_by_cluster = TRUE,
                     label_leaves = FALSE, label_branch_points = FALSE) +
  ggtitle("Trajectory (colored by cluster)")
ggsave("plot_001_trajectory_cluster.png", p_traj, width = 8, height = 6, dpi = 150)

p_pseudo <- plot_cells(cds, color_cells_by = "pseudotime", label_groups_by_cluster = FALSE,
                       label_leaves = FALSE, label_branch_points = FALSE) +
  ggtitle("Pseudotime")
ggsave("plot_002_pseudotime.png", p_pseudo, width = 8, height = 6, dpi = 150)

# Pseudotime density per cluster
pt_df <- data.frame(
  pseudotime = pseudotime(cds),
  cluster = clusters(cds)
)
pt_df <- pt_df[is.finite(pt_df$pseudotime), ]

p_density <- ggplot(pt_df, aes(x = pseudotime, fill = cluster)) +
  geom_density(alpha = 0.5) +
  labs(title = "Pseudotime Distribution by Cluster", x = "Pseudotime", y = "Density") +
  theme_classic(base_size = 11)
ggsave("plot_003_pseudotime_density.png", p_density, width = 8, height = 5, dpi = 150)

# --- 5. Save ---
report_progress(90, "保存结果...")
pt_data <- data.frame(cell = colnames(cds), pseudotime = pseudotime(cds), cluster = clusters(cds))
write.csv(pt_data, "pseudotime_results.csv", row.names = FALSE)

summary_data <- list(
  n_cells = ncol(cds),
  n_clusters = length(unique(clusters(cds))),
  pseudotime_range = c(min(pt_df$pseudotime), max(pt_df$pseudotime))
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate cell communication R script (CellChat).
 */

module.exports = { generateTrajectoryScript };
