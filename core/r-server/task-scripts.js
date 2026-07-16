/**
 * Task Scripts — R script generators for each analysis type.
 *
 * Extracted from task-manager.js for reuse by the new task-queue system.
 * Each function returns a complete R script string ready for execution.
 */

const _config = require('./config');

/**
 * Generate R script based on task type.
 */
function generateRScript({ type, params, ossInputUrl, containerWorkDir }) {
  const progressHelper = `
# Progress reporting helper
report_progress <- function(pct, msg) {
  jsonlite::write_json(
    list(progress = pct, message = msg),
    file.path("${containerWorkDir}", "progress.json"),
    auto_unbox = TRUE
  )
}
report_progress(5, "初始化环境...")
`;

  switch (type) {
    case 'scrna_standard':
      return generateScRNAScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'deg':
      return generateDEGScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'enrichment':
      return generateEnrichmentScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'cell_annotation':
      return generateAnnotationScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'scrna_integration':
      return generateIntegrationScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'trajectory':
      return generateTrajectoryScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    case 'communication':
      return generateCommunicationScript({ params, ossInputUrl, containerWorkDir }, progressHelper);
    default:
      return `${progressHelper}\nstop("未知任务类型: ${type}")`;
  }
}

// ============================================================
// Script Generators
// ============================================================

function generateScRNAScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const {
    species = 'human',
    minCells = 3,
    minFeatures = 200,
    maxFeatures = 5000,
    maxMtPercent = 20,
    nPCs = 20,
    resolution = 0.5,
    normMethod = 'LogNormalize',
  } = params || {};

  return `
suppressMessages({ library(Seurat); library(ggplot2); library(jsonlite); library(dplyr) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "正在下载数据...")
input_url <- "${ossInputUrl}"
ext <- tolower(tools::file_ext(input_url))
if (ext == "rds") {
  download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
  obj <- readRDS("input.rds")
  if (!inherits(obj, "Seurat")) obj <- CreateSeuratObject(counts = obj, min.cells = ${minCells}, min.features = ${minFeatures})
} else if (ext %in% c("h5", "hdf5")) {
  download.file(input_url, "input.h5", mode = "wb", quiet = TRUE)
  counts <- Read10X_h5("input.h5")
  obj <- CreateSeuratObject(counts = counts, min.cells = ${minCells}, min.features = ${minFeatures})
} else {
  download.file(input_url, "input.csv", mode = "wb", quiet = TRUE)
  counts <- read.csv("input.csv", row.names = 1, check.names = FALSE)
  obj <- CreateSeuratObject(counts = counts, min.cells = ${minCells}, min.features = ${minFeatures})
}
report_progress(20, paste0("数据加载完成: ", ncol(obj), " 细胞, ", nrow(obj), " 基因"))

report_progress(25, "质控分析...")
mt_pattern <- ifelse("${species}" == "human", "^MT-", "^mt-")
obj[["percent.mt"]] <- PercentageFeatureSet(obj, pattern = mt_pattern)
p_qc <- VlnPlot(obj, features = c("nFeature_RNA", "nCount_RNA", "percent.mt"), ncol = 3, pt.size = 0)
ggsave("plot_001_qc_violin.png", p_qc, width = 10, height = 4, dpi = 150)
obj <- subset(obj, subset = nFeature_RNA > ${minFeatures} & nFeature_RNA < ${maxFeatures} & percent.mt < ${maxMtPercent})
report_progress(35, paste0("质控后: ", ncol(obj), " 细胞"))

report_progress(40, "标准化...")
obj <- NormalizeData(obj, normalization.method = "${normMethod}")
report_progress(45, "寻找高变基因...")
obj <- FindVariableFeatures(obj, selection.method = "vst", nfeatures = 2000)
p_hvg <- VariableFeaturePlot(obj)
ggsave("plot_002_hvg.png", p_hvg, width = 8, height = 5, dpi = 150)

report_progress(50, "PCA降维...")
obj <- ScaleData(obj)
obj <- RunPCA(obj, npcs = ${nPCs})
p_elbow <- ElbowPlot(obj, ndims = ${nPCs})
ggsave("plot_003_elbow.png", p_elbow, width = 6, height = 4, dpi = 150)

report_progress(65, "聚类分析...")
obj <- FindNeighbors(obj, dims = 1:${nPCs})
obj <- FindClusters(obj, resolution = ${resolution})

report_progress(75, "UMAP降维...")
obj <- RunUMAP(obj, dims = 1:${nPCs})
p_umap <- DimPlot(obj, reduction = "umap", label = TRUE, label.size = 4) +
  ggtitle(paste0("UMAP (", ncol(obj), " cells, ", length(unique(Idents(obj))), " clusters)"))
ggsave("plot_005_umap.png", p_umap, width = 8, height = 6, dpi = 150)

report_progress(85, "寻找标记基因...")
markers <- FindAllMarkers(obj, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.25)
top_markers <- markers %>% group_by(cluster) %>% slice_max(n = 5, order_by = avg_log2FC)
write.csv(top_markers, "markers_top5.csv", row.names = FALSE)
top3 <- markers %>% group_by(cluster) %>% slice_max(n = 3, order_by = avg_log2FC) %>% pull(gene) %>% unique()
if (length(top3) > 0 && length(top3) <= 60) {
  p_heat <- DoHeatmap(obj, features = top3) + NoLegend()
  ggsave("plot_006_heatmap.png", p_heat, width = 12, height = 8, dpi = 150)
}

report_progress(95, "保存结果...")
saveRDS(obj, "result.rds")
summary_data <- list(n_cells=ncol(obj), n_genes=nrow(obj), n_clusters=length(unique(Idents(obj))), n_pcs_used=${nPCs}, resolution=${resolution}, species="${species}")
write_json(summary_data, "summary.json", auto_unbox = TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

module.exports = { generateRScript };

function generateDEGScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const {
    method = 'DESeq2',
    groupCol = 'condition',
    group1 = 'treatment',
    group2 = 'control',
    pCutoff = 0.05,
    fcCutoff = 1.0,
    topN = 20,
  } = params || {};

  const testUse = method === 'DESeq2' ? 'wilcox' : method;

  return `
suppressMessages({ library(ggplot2); library(jsonlite); library(dplyr) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "下载数据...")
input_url <- "${ossInputUrl}"
ext <- tolower(tools::file_ext(input_url))
if (ext == "rds") {
  download.file(input_url, "input.rds", mode = "wb", quiet = TRUE)
  obj <- readRDS("input.rds")
} else {
  download.file(input_url, "input.csv", mode = "wb", quiet = TRUE)
  obj <- read.csv("input.csv", row.names = 1, check.names = FALSE)
}
report_progress(20, "数据加载完成")

is_seurat <- inherits(obj, "Seurat")
if (is_seurat) {
  suppressMessages(library(Seurat))
  report_progress(30, "单细胞模式: FindMarkers...")
  if (!"${groupCol}" %in% colnames(obj@meta.data)) {
    if (length(unique(Idents(obj))) >= 2) obj$deg_group <- Idents(obj)
    else stop(paste0("找不到分组列: ${groupCol}"))
  } else { Idents(obj) <- "${groupCol}" }
  report_progress(40, "计算差异表达...")
  markers <- FindMarkers(obj, ident.1="${group1}", ident.2="${group2}", test.use="${testUse}", min.pct=0.1, logfc.threshold=0)
  markers$gene <- rownames(markers)
  colnames(markers)[colnames(markers)=="p_val_adj"] <- "padj"
  colnames(markers)[colnames(markers)=="avg_log2FC"] <- "log2FoldChange"
} else {
  suppressMessages(library(DESeq2))
  report_progress(30, "Bulk 模式: DESeq2...")
  counts <- as.matrix(obj); storage.mode(counts) <- "integer"
  sample_names <- colnames(counts)
  group_vec <- ifelse(grepl("${group1}", sample_names, ignore.case=TRUE), "${group1}",
               ifelse(grepl("${group2}", sample_names, ignore.case=TRUE), "${group2}", NA))
  if (all(is.na(group_vec))) { n <- ncol(counts); group_vec <- c(rep("${group1}", floor(n/2)), rep("${group2}", ceiling(n/2))) }
  valid <- !is.na(group_vec); counts <- counts[,valid]; group_vec <- group_vec[valid]
  coldata <- data.frame(condition=factor(group_vec, levels=c("${group2}","${group1}")), row.names=colnames(counts))
  report_progress(40, "运行 DESeq2...")
  dds <- DESeqDataSetFromMatrix(countData=counts, colData=coldata, design=~condition)
  dds <- dds[rowSums(counts(dds))>=10,]; dds <- DESeq(dds)
  report_progress(60, "提取结果...")
  res <- results(dds, contrast=c("condition","${group1}","${group2}"))
  markers <- as.data.frame(res); markers$gene <- rownames(markers)
}

report_progress(70, "生成图表...")
markers$sig <- "ns"
markers$sig[markers$padj < ${pCutoff} & markers$log2FoldChange > ${fcCutoff}] <- "up"
markers$sig[markers$padj < ${pCutoff} & markers$log2FoldChange < -${fcCutoff}] <- "down"
n_up <- sum(markers$sig=="up", na.rm=TRUE); n_down <- sum(markers$sig=="down", na.rm=TRUE)

p_volcano <- ggplot(markers, aes(x=log2FoldChange, y=-log10(padj), color=sig)) +
  geom_point(size=0.8, alpha=0.6) +
  scale_color_manual(values=c("up"="#dc2626","down"="#2563eb","ns"="#94a3b8")) +
  geom_vline(xintercept=c(-${fcCutoff},${fcCutoff}), linetype="dashed", color="#9ca3af") +
  geom_hline(yintercept=-log10(${pCutoff}), linetype="dashed", color="#9ca3af") +
  labs(title=paste0("Volcano (up:",n_up," | down:",n_down,")"), x="log2FC", y="-log10(padj)") +
  theme_classic() + theme(legend.position="none")
ggsave("plot_001_volcano.png", p_volcano, width=7, height=5, dpi=150)

report_progress(80, "Top 差异基因...")
top_up <- markers %>% filter(sig=="up") %>% arrange(padj) %>% head(${topN})
top_down <- markers %>% filter(sig=="down") %>% arrange(padj) %>% head(${topN})
top_genes <- bind_rows(top_up, top_down)
if (nrow(top_genes) > 0) {
  top_genes$gene <- factor(top_genes$gene, levels=top_genes$gene[order(top_genes$log2FoldChange)])
  p_bar <- ggplot(top_genes, aes(x=gene, y=log2FoldChange, fill=sig)) + geom_col() +
    scale_fill_manual(values=c("up"="#dc2626","down"="#2563eb")) + coord_flip() +
    labs(title=paste0("Top ",${topN}," DEGs"), x="", y="log2FC") + theme_classic() + theme(legend.position="none")
  ggsave("plot_002_top_genes.png", p_bar, width=7, height=6, dpi=150)
}

report_progress(90, "保存结果...")
write.csv(markers, "deg_results.csv", row.names=FALSE)
write.csv(top_genes, "deg_top_genes.csv", row.names=FALSE)
summary_data <- list(n_total=nrow(markers), n_up=n_up, n_down=n_down, p_cutoff=${pCutoff}, fc_cutoff=${fcCutoff}, method="${method}", group1="${group1}", group2="${group2}")
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

function generateEnrichmentScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const {
    organism = 'human',
    geneListType = 'symbol',
    enrichType = 'GO',
    pvalueCutoff = 0.05,
    topTerms = 15,
  } = params || {};
  const orgDb = organism === 'human' ? 'org.Hs.eg.db' : 'org.Mm.eg.db';
  const keggOrg = organism === 'human' ? 'hsa' : 'mmu';

  return `
suppressMessages({ library(clusterProfiler); library(${orgDb}); library(ggplot2); library(jsonlite); library(enrichplot) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "加载基因列表...")
download.file("${ossInputUrl}", "input.csv", mode="wb", quiet=TRUE)
df <- read.csv("input.csv", stringsAsFactors=FALSE)
genes <- df[[1]]; has_fc <- ncol(df) >= 2
if (has_fc) { fc_vec <- setNames(as.numeric(df[[2]]), genes); fc_vec <- sort(fc_vec, decreasing=TRUE) }
report_progress(20, paste0("加载 ", length(genes), " 个基因"))

if ("${geneListType}" == "symbol") {
  gene_map <- bitr(genes, fromType="SYMBOL", toType="ENTREZID", OrgDb=${orgDb})
  entrez_ids <- gene_map$ENTREZID
} else { entrez_ids <- genes }
report_progress(30, "开始富集分析...")
results_list <- list()

if ("${enrichType}" %in% c("GO","both")) {
  report_progress(40, "GO 富集分析...")
  ego <- enrichGO(gene=entrez_ids, OrgDb=${orgDb}, ont="BP", pAdjustMethod="BH", pvalueCutoff=${pvalueCutoff}, readable=TRUE)
  if (nrow(as.data.frame(ego)) > 0) {
    ggsave("plot_001_go_dotplot.png", dotplot(ego, showCategory=${topTerms})+ggtitle("GO BP"), width=9, height=7, dpi=150)
    ggsave("plot_002_go_barplot.png", barplot(ego, showCategory=${topTerms})+ggtitle("GO BP - Top"), width=9, height=6, dpi=150)
    write.csv(as.data.frame(ego), "go_results.csv", row.names=FALSE)
    results_list$go_terms <- nrow(as.data.frame(ego))
  }
}
if ("${enrichType}" %in% c("KEGG","both")) {
  report_progress(60, "KEGG 富集分析...")
  ekegg <- enrichKEGG(gene=entrez_ids, organism="${keggOrg}", pvalueCutoff=${pvalueCutoff})
  if (nrow(as.data.frame(ekegg)) > 0) {
    ggsave("plot_003_kegg_dotplot.png", dotplot(ekegg, showCategory=${topTerms})+ggtitle("KEGG"), width=9, height=7, dpi=150)
    write.csv(as.data.frame(ekegg), "kegg_results.csv", row.names=FALSE)
    results_list$kegg_terms <- nrow(as.data.frame(ekegg))
  }
}
if (has_fc && "${geneListType}" == "symbol") {
  report_progress(75, "GSEA 分析...")
  tryCatch({
    gene_map_fc <- bitr(names(fc_vec), fromType="SYMBOL", toType="ENTREZID", OrgDb=${orgDb})
    gsea_list <- fc_vec[gene_map_fc$SYMBOL]; names(gsea_list) <- gene_map_fc$ENTREZID
    gsea_list <- sort(gsea_list, decreasing=TRUE)
    gsea_res <- gseGO(geneList=gsea_list, OrgDb=${orgDb}, ont="BP", pvalueCutoff=${pvalueCutoff})
    if (nrow(as.data.frame(gsea_res)) > 0) {
      ggsave("plot_004_gsea.png", dotplot(gsea_res, showCategory=${topTerms})+ggtitle("GSEA - GO BP"), width=9, height=7, dpi=150)
      write.csv(as.data.frame(gsea_res), "gsea_results.csv", row.names=FALSE)
      results_list$gsea_terms <- nrow(as.data.frame(gsea_res))
    }
  }, error = function(e) { cat("GSEA skipped:", e$message, "\\n") })
}

report_progress(90, "保存结果...")
summary_data <- list(n_genes=length(genes), organism="${organism}", enrich_type="${enrichType}", p_cutoff=${pvalueCutoff}, go_terms=results_list$go_terms %||% 0, kegg_terms=results_list$kegg_terms %||% 0, gsea_terms=results_list$gsea_terms %||% 0)
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

function generateAnnotationScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const { reference = 'HumanPrimaryCellAtlas', labelLevel = 'main' } = params || {};
  return `
suppressMessages({ library(Seurat); library(SingleR); library(celldex); library(ggplot2); library(jsonlite); library(pheatmap) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "加载数据...")
download.file("${ossInputUrl}", "input.rds", mode="wb", quiet=TRUE)
obj <- readRDS("input.rds")
if (!inherits(obj, "Seurat")) stop("细胞注释需要 Seurat 对象 (.rds)")
report_progress(20, paste0("加载完成: ", ncol(obj), " 细胞"))

report_progress(30, "加载参考数据集: ${reference}...")
ref <- switch("${reference}", "HumanPrimaryCellAtlas"=HumanPrimaryCellAtlasData(), "MouseRNAseq"=MouseRNAseqData(), "ImmGen"=ImmGenData(), "BlueprintEncode"=BlueprintEncodeData(), HumanPrimaryCellAtlasData())

report_progress(50, "运行 SingleR 注释...")
sce <- as.SingleCellExperiment(obj)
label_col <- ifelse("${labelLevel}"=="fine", "label.fine", "label.main")
pred <- SingleR(test=sce, ref=ref, labels=ref[[label_col]])
obj$singler_labels <- pred$labels

report_progress(70, "生成图表...")
if ("umap" %in% Reductions(obj)) {
  p_umap <- DimPlot(obj, reduction="umap", group.by="singler_labels", label=TRUE, label.size=3, repel=TRUE) + ggtitle("Cell Type Annotation (SingleR)")
  ggsave("plot_001_annotated_umap.png", p_umap, width=10, height=7, dpi=150)
}
comp <- as.data.frame(table(obj$singler_labels)); colnames(comp) <- c("CellType","Count")
comp <- comp[order(-comp$Count),]; comp$CellType <- factor(comp$CellType, levels=comp$CellType)
p_comp <- ggplot(comp, aes(x=CellType, y=Count, fill=CellType)) + geom_col() + coord_flip() + labs(title="Cell Type Composition") + theme_classic() + theme(legend.position="none")
ggsave("plot_002_composition.png", p_comp, width=8, height=6, dpi=150)

report_progress(90, "保存结果...")
write.csv(data.frame(cell=colnames(obj), label=obj$singler_labels), "annotation_results.csv", row.names=FALSE)
saveRDS(obj, "result_annotated.rds")
cell_types <- sort(table(obj$singler_labels), decreasing=TRUE)
summary_data <- list(n_cells=ncol(obj), n_types=length(unique(obj$singler_labels)), reference="${reference}", label_level="${labelLevel}", top_types=head(names(cell_types),5))
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

function generateIntegrationScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const { method = 'harmony', batchCol = 'orig.ident', nPCs = 20, resolution = 0.5 } = params || {};
  const reductionMethod = method === 'cca' ? 'cca' : 'rpca';

  return `
suppressMessages({ library(Seurat); library(harmony); library(ggplot2); library(jsonlite) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "加载数据...")
download.file("${ossInputUrl}", "input.rds", mode="wb", quiet=TRUE)
obj <- readRDS("input.rds")
if (!inherits(obj, "Seurat")) stop("多样本整合需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞, batch: ${batchCol}"))

report_progress(25, "标准化...")
obj <- NormalizeData(obj); obj <- FindVariableFeatures(obj, nfeatures=2000)
obj <- ScaleData(obj); obj <- RunPCA(obj, npcs=${nPCs})

obj <- RunUMAP(obj, dims=1:${nPCs}, reduction.name="umap_before")
ggsave("plot_001_before_integration.png", DimPlot(obj, reduction="umap_before", group.by="${batchCol}")+ggtitle("Before Integration"), width=8, height=6, dpi=150)

report_progress(40, "运行 ${method} 整合...")
if ("${method}" == "harmony") {
  obj <- RunHarmony(obj, group.by.vars="${batchCol}", dims.use=1:${nPCs})
  reduction_use <- "harmony"
} else {
  obj_list <- SplitObject(obj, split.by="${batchCol}")
  obj_list <- lapply(obj_list, function(x) { x <- NormalizeData(x); FindVariableFeatures(x, nfeatures=2000) })
  features <- SelectIntegrationFeatures(object.list=obj_list, nfeatures=2000)
  anchors <- FindIntegrationAnchors(object.list=obj_list, anchor.features=features, reduction="${reductionMethod}")
  obj <- IntegrateData(anchorset=anchors); DefaultAssay(obj) <- "integrated"
  obj <- ScaleData(obj); obj <- RunPCA(obj, npcs=${nPCs})
  reduction_use <- "pca"
}

report_progress(60, "聚类...")
obj <- FindNeighbors(obj, dims=1:${nPCs}, reduction=reduction_use)
obj <- FindClusters(obj, resolution=${resolution})
report_progress(70, "UMAP...")
obj <- RunUMAP(obj, dims=1:${nPCs}, reduction=reduction_use)

report_progress(80, "生成图表...")
ggsave("plot_002_after_integration.png", DimPlot(obj, reduction="umap", group.by="${batchCol}")+ggtitle("After Integration (${method})"), width=8, height=6, dpi=150)
ggsave("plot_003_clusters.png", DimPlot(obj, reduction="umap", label=TRUE)+ggtitle(paste0(length(unique(Idents(obj)))," Clusters")), width=8, height=6, dpi=150)
ggsave("plot_004_split_batch.png", DimPlot(obj, reduction="umap", split.by="${batchCol}")+ggtitle("Split by Batch"), width=12, height=5, dpi=150)

report_progress(90, "保存结果...")
saveRDS(obj, "result_integrated.rds")
summary_data <- list(n_cells=ncol(obj), n_clusters=length(unique(Idents(obj))), n_batches=length(unique(obj@meta.data[["${batchCol}"]])), method="${method}", batch_col="${batchCol}")
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

function generateTrajectoryScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const { rootCluster = 'auto', _nDims = 20 } = params || {};

  return `
suppressMessages({ library(Seurat); library(monocle3); library(ggplot2); library(jsonlite); library(SeuratWrappers) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "加载数据...")
download.file("${ossInputUrl}", "input.rds", mode="wb", quiet=TRUE)
obj <- readRDS("input.rds")
if (!inherits(obj, "Seurat")) stop("轨迹分析需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞"))

report_progress(30, "转换为 CellDataSet...")
cds <- as.cell_data_set(obj)
cds <- cluster_cells(cds, reduction_method="UMAP")
report_progress(50, "学习轨迹图...")
cds <- learn_graph(cds)

report_progress(60, "排序细胞...")
if ("${rootCluster}" == "auto") {
  cluster_counts <- table(clusters(cds))
  root_cluster <- names(which.max(cluster_counts))
  root_cells <- colnames(cds)[clusters(cds)==root_cluster]
  cds <- order_cells(cds, root_cells=root_cells[1:min(5, length(root_cells))])
} else {
  root_cells <- colnames(cds)[clusters(cds)=="${rootCluster}"]
  if (length(root_cells)==0) stop("找不到指定的 root cluster: ${rootCluster}")
  cds <- order_cells(cds, root_cells=root_cells[1:min(5, length(root_cells))])
}

report_progress(75, "生成图表...")
p_traj <- plot_cells(cds, color_cells_by="cluster", label_groups_by_cluster=TRUE, label_leaves=FALSE, label_branch_points=FALSE) + ggtitle("Trajectory")
ggsave("plot_001_trajectory_cluster.png", p_traj, width=8, height=6, dpi=150)
p_pseudo <- plot_cells(cds, color_cells_by="pseudotime", label_groups_by_cluster=FALSE, label_leaves=FALSE, label_branch_points=FALSE) + ggtitle("Pseudotime")
ggsave("plot_002_pseudotime.png", p_pseudo, width=8, height=6, dpi=150)

pt_df <- data.frame(pseudotime=pseudotime(cds), cluster=clusters(cds))
pt_df <- pt_df[is.finite(pt_df$pseudotime),]
p_density <- ggplot(pt_df, aes(x=pseudotime, fill=cluster)) + geom_density(alpha=0.5) + labs(title="Pseudotime by Cluster") + theme_classic()
ggsave("plot_003_pseudotime_density.png", p_density, width=8, height=5, dpi=150)

report_progress(90, "保存结果...")
write.csv(data.frame(cell=colnames(cds), pseudotime=pseudotime(cds), cluster=clusters(cds)), "pseudotime_results.csv", row.names=FALSE)
summary_data <- list(n_cells=ncol(cds), n_clusters=length(unique(clusters(cds))), pseudotime_range=c(min(pt_df$pseudotime), max(pt_df$pseudotime)))
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}

function generateCommunicationScript({ params, ossInputUrl, containerWorkDir }, progressHelper) {
  const { organism = 'human', minCells = 10, _topPathways = 20 } = params || {};
  const dbName = organism === 'human' ? 'CellChatDB.human' : 'CellChatDB.mouse';

  return `
suppressMessages({ library(Seurat); library(CellChat); library(ggplot2); library(jsonlite); library(patchwork) })
${progressHelper}
setwd("${containerWorkDir}")

report_progress(10, "加载数据...")
download.file("${ossInputUrl}", "input.rds", mode="wb", quiet=TRUE)
obj <- readRDS("input.rds")
if (!inherits(obj, "Seurat")) stop("细胞通讯分析需要 Seurat 对象")
report_progress(20, paste0(ncol(obj), " 细胞"))

report_progress(25, "创建 CellChat 对象...")
data_input <- GetAssayData(obj, slot="data")
meta <- obj@meta.data; meta$labels <- Idents(obj)
cellchat <- createCellChat(object=data_input, meta=meta, group.by="labels")

report_progress(30, "加载配体-受体数据库...")
cellchat@DB <- ${dbName}

report_progress(35, "预处理...")
cellchat <- subsetData(cellchat)
cellchat <- identifyOverExpressedGenes(cellchat)
cellchat <- identifyOverExpressedInteractions(cellchat)

report_progress(45, "推断通讯网络...")
cellchat <- computeCommunProb(cellchat, type="triMean")
cellchat <- filterCommunication(cellchat, min.cells=${minCells})
report_progress(60, "计算通路水平通讯...")
cellchat <- computeCommunProbPathway(cellchat)
cellchat <- aggregateNet(cellchat)

report_progress(75, "生成图表...")
png("plot_001_interaction_count.png", width=800, height=600, res=150)
netVisual_heatmap(cellchat, measure="count", title="Number of Interactions")
dev.off()
png("plot_002_interaction_weight.png", width=800, height=600, res=150)
netVisual_heatmap(cellchat, measure="weight", title="Interaction Strength")
dev.off()

tryCatch({
  p_bubble <- netVisual_bubble(cellchat, sources.use=1:min(5, length(levels(cellchat@idents))), targets.use=1:min(5, length(levels(cellchat@idents))), remove.isolate=TRUE)
  ggsave("plot_003_bubble.png", p_bubble, width=10, height=8, dpi=150)
}, error=function(e) { cat("Bubble plot skipped\\n") })

report_progress(90, "保存结果...")
saveRDS(cellchat, "result_cellchat.rds")
df_net <- subsetCommunication(cellchat)
write.csv(df_net, "communication_results.csv", row.names=FALSE)
pathways <- cellchat@netP$pathways
summary_data <- list(n_cells=ncol(obj), n_cell_types=length(levels(cellchat@idents)), n_interactions=nrow(df_net), n_pathways=length(pathways), top_pathways=head(pathways,5), organism="${organism}")
write_json(summary_data, "summary.json", auto_unbox=TRUE)
report_progress(100, "分析完成!")
cat("TASK_COMPLETE\\n")
`;
}
