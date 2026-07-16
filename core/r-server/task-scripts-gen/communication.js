/**
 * task-scripts-gen/communication.js — R script generator for communication analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateCommunicationScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    organism = 'human',  // human | mouse
    minCells = 10,
    topPathways = 20,
  } = params;

  const dbName = organism === 'human' ? 'CellChatDB.human' : 'CellChatDB.mouse';

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeParentCachePath = sanitizeRString(task.parentCachePath);
  const safeOrganism = sanitizeRString(organism);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeOrganism) {
    throw new Error('非法参数：含危险字符');
  }

  return `
suppressMessages({
  library(Seurat)
  library(CellChat)
  library(ggplot2)
  library(jsonlite)
  library(patchwork)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load ---
${safeParentCachePath ? `report_progress(10, "从本地缓存加载...")\nobj <- readRDS("${safeParentCachePath}")` : `report_progress(10, "下载数据...")\ninput_url <- "${safeOssInputUrl}"\ndownload.file(input_url, "input.rds", mode = "wb", quiet = TRUE)\nobj <- readRDS("input.rds")`}
if (!inherits(obj, "Seurat")) stop("细胞通讯分析需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞"))

# --- 2. Create CellChat object ---
report_progress(25, "创建 CellChat 对象...")
data_input <- GetAssayData(obj, slot = "data")
meta <- obj@meta.data
# Use Idents as cell labels
meta$labels <- Idents(obj)

cellchat <- createCellChat(object = data_input, meta = meta, group.by = "labels")

# --- 3. Set DB ---
report_progress(30, "加载配体-受体数据库...")
CellChatDB <- ${dbName}
cellchat@DB <- CellChatDB

# --- 4. Preprocessing ---
report_progress(35, "预处理...")
cellchat <- subsetData(cellchat)
cellchat <- identifyOverExpressedGenes(cellchat)
cellchat <- identifyOverExpressedInteractions(cellchat)

# --- 5. Inference ---
report_progress(45, "推断通讯网络...")
cellchat <- computeCommunProb(cellchat, type = "triMean")
cellchat <- filterCommunication(cellchat, min.cells = ${minCells})

report_progress(60, "计算通路水平通讯...")
cellchat <- computeCommunProbPathway(cellchat)
cellchat <- aggregateNet(cellchat)

# --- 6. Plots ---
report_progress(75, "生成图表...")

# Interaction count heatmap
png("plot_001_interaction_count.png", width = 800, height = 600, res = 150)
netVisual_heatmap(cellchat, measure = "count", title = "Number of Interactions")
dev.off()

# Interaction weight heatmap
png("plot_002_interaction_weight.png", width = 800, height = 600, res = 150)
netVisual_heatmap(cellchat, measure = "weight", title = "Interaction Strength")
dev.off()

# Top pathways
report_progress(85, "Top 通路...")
pathways <- cellchat@netP$pathways
n_show <- min(${topPathways}, length(pathways))

if (n_show > 0) {
  # Bubble plot for top pathway
  tryCatch({
    p_bubble <- netVisual_bubble(cellchat, sources.use = 1:min(5, length(levels(cellchat@idents))),
                                  targets.use = 1:min(5, length(levels(cellchat@idents))),
                                  remove.isolate = TRUE)
    ggsave("plot_003_bubble.png", p_bubble, width = 10, height = 8, dpi = 150)
  }, error = function(e) { cat("Bubble plot skipped\\n") })
}

# --- 7. Save ---
report_progress(90, "保存结果...")
saveRDS(cellchat, "result_cellchat.rds")

# Export interaction table
df_net <- subsetCommunication(cellchat)
write.csv(df_net, "communication_results.csv", row.names = FALSE)

summary_data <- list(
  n_cells = ncol(obj),
  n_cell_types = length(levels(cellchat@idents)),
  n_interactions = nrow(df_net),
  n_pathways = length(pathways),
  top_pathways = head(pathways, 5),
  organism = "${safeOrganism}"
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Collect result files and upload to OSS.
 */

module.exports = { generateCommunicationScript };
