/**
 * task-scripts-gen/annotation.js — R script generator for annotation analysis
 */
const {sanitizeRString} = require('../sanitizer');

function generateAnnotationScript(task, progressHelper) {
  const {params, ossInputUrl, containerWorkDir} = task;
  const {
    reference = 'HumanPrimaryCellAtlas',  // HumanPrimaryCellAtlas | MouseRNAseq | ImmGen | BlueprintEncode
    labelLevel = 'main',  // main | fine
  } = params;

  // M1-3 (H2)：插值进 R "..." 的用户输入转义
  const safeOssInputUrl = sanitizeRString(ossInputUrl);
  const safeContainerWorkDir = sanitizeRString(containerWorkDir);
  const safeReference = sanitizeRString(reference);
  const safeLabelLevel = sanitizeRString(labelLevel);
  const safeParentCachePath = sanitizeRString(task.parentCachePath);
  if (!safeOssInputUrl || !safeContainerWorkDir || !safeReference || !safeLabelLevel) {
    throw new Error('非法参数：含危险字符');
  }

  return `
suppressMessages({
  library(Seurat)
  library(SingleR)
  library(celldex)
  library(ggplot2)
  library(jsonlite)
  library(pheatmap)
})

${progressHelper}

setwd("${safeContainerWorkDir}")

# --- 1. Load Seurat object ---
${safeParentCachePath ? `report_progress(10, "从本地缓存加载...")\nobj <- readRDS("${safeParentCachePath}")` : `report_progress(10, "下载数据...")\ninput_url <- "${safeOssInputUrl}"\ndownload.file(input_url, "input.rds", mode = "wb", quiet = TRUE)\nobj <- readRDS("input.rds")`}

if (!inherits(obj, "Seurat")) stop("细胞注释需要 Seurat 对象 (.rds)")
report_progress(20, paste0("加载完成: ", ncol(obj), " 细胞"))

# --- 2. Get reference ---
report_progress(30, "加载参考数据集: ${safeReference}...")
ref <- switch("${safeReference}",
  "HumanPrimaryCellAtlas" = HumanPrimaryCellAtlasData(),
  "MouseRNAseq" = MouseRNAseqData(),
  "ImmGen" = ImmGenData(),
  "BlueprintEncode" = BlueprintEncodeData(),
  HumanPrimaryCellAtlasData()
)

# --- 3. Run SingleR ---
report_progress(50, "运行 SingleR 注释...")
sce <- as.SingleCellExperiment(obj)
label_col <- ifelse("${safeLabelLevel}" == "fine", "label.fine", "label.main")
pred <- SingleR(test = sce, ref = ref, labels = ref[[label_col]])

# Add to Seurat
obj$singler_labels <- pred$labels
obj$singler_pruned <- pred$pruned.labels

report_progress(70, "生成图表...")

# --- 4. UMAP with annotations ---
if ("umap" %in% Reductions(obj)) {
  p_umap <- DimPlot(obj, reduction = "umap", group.by = "singler_labels", label = TRUE, label.size = 3, repel = TRUE) +
    ggtitle("Cell Type Annotation (SingleR)") +
    theme(legend.position = "right", legend.text = element_text(size = 7))
  ggsave("plot_001_annotated_umap.png", p_umap, width = 10, height = 7, dpi = 150)
}

# --- 5. Composition bar plot ---
comp <- as.data.frame(table(obj$singler_labels))
colnames(comp) <- c("CellType", "Count")
comp <- comp[order(-comp$Count), ]
comp$CellType <- factor(comp$CellType, levels = comp$CellType)

p_comp <- ggplot(comp, aes(x = CellType, y = Count, fill = CellType)) +
  geom_col() +
  coord_flip() +
  labs(title = "Cell Type Composition", x = "", y = "Number of Cells") +
  theme_classic(base_size = 10) +
  theme(legend.position = "none")
ggsave("plot_002_composition.png", p_comp, width = 8, height = 6, dpi = 150)

# --- 6. Score heatmap ---
report_progress(80, "注释得分热图...")
tryCatch({
  png("plot_003_score_heatmap.png", width = 900, height = 600, res = 150)
  plotScoreHeatmap(pred, max.labels = 20)
  dev.off()
}, error = function(e) { try(dev.off(), silent = TRUE) })

# --- 7. Save ---
report_progress(90, "保存结果...")
write.csv(data.frame(cell = colnames(obj), label = obj$singler_labels), "annotation_results.csv", row.names = FALSE)
saveRDS(obj, "result_annotated.rds")

cell_types <- sort(table(obj$singler_labels), decreasing = TRUE)
summary_data <- list(
  n_cells = ncol(obj),
  n_types = length(unique(obj$singler_labels)),
  reference = "${safeReference}",
  label_level = "${safeLabelLevel}",
  top_types = head(names(cell_types), 5)
)
write_json(summary_data, "summary.json", auto_unbox = TRUE)

report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

/**
 * Generate multi-sample integration R script (Harmony).
 */

module.exports = { generateAnnotationScript };
