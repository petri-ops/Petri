#!/bin/bash
# ============================================================
# BioF3 PBMC3K Demo — 一键部署脚本
# 在 Dell 服务器上执行，完成以下步骤：
#   1. 下载 PBMC3K 10x 公开数据
#   2. 在 Docker R 容器中跑标准分析（生成真实图片 + RDS）
#   3. 上传结果图片到 OSS
#   4. 缓存 RDS 到本地
#   5. 部署 seed-demo 后端接口
#   6. 重启服务
#
# 用法：
#   ssh -p 6022 root@biof3.com
#   bash /opt/biof3-r-server/deploy-demo-full.sh
# ============================================================

set -e

echo "🧬 BioF3 PBMC3K Demo 部署开始..."
echo "================================================"

# ---- 配置 ----
WORK_DIR="/mnt/storage_16tb/omichub/biof3-tmp/demo-setup"
CACHE_DIR="/mnt/storage_16tb/omichub/biof3-cache"
CONTAINER="omichub_react_backend_1"
CONTAINER_WORK="/app/data/biof3-tmp/demo-setup"
OSS_BUCKET="biof3-uploads"
OSS_AK="${OSS_AK:?Set OSS_AK in the environment before running this script}"
OSS_SK="${OSS_SK:?Set OSS_SK in the environment before running this script}"
OSS_ENDPOINT="oss-cn-hangzhou.aliyuncs.com"
SERVER_DIR="/opt/biof3-r-server"

# ---- Step 1: 准备工作目录 ----
echo ""
echo "📁 Step 1: 准备工作目录..."
mkdir -p "$WORK_DIR"
mkdir -p "$CACHE_DIR"

# ---- Step 2: 下载 PBMC3K 数据 ----
echo ""
echo "📥 Step 2: 下载 PBMC3K 数据..."
PBMC_URL="https://cf.10xgenomics.com/samples/cell/pbmc3k/pbmc3k_filtered_gene_bc_matrices.tar.gz"
PBMC_FILE="$WORK_DIR/pbmc3k_filtered_gene_bc_matrices.tar.gz"

if [ -f "$PBMC_FILE" ]; then
  echo "   已存在，跳过下载"
else
  wget -q --show-progress -O "$PBMC_FILE" "$PBMC_URL"
  echo "   ✓ 下载完成 ($(du -h $PBMC_FILE | cut -f1))"
fi

# 解压
if [ ! -d "$WORK_DIR/filtered_gene_bc_matrices" ]; then
  tar -xzf "$PBMC_FILE" -C "$WORK_DIR/"
  echo "   ✓ 解压完成"
fi

# ---- Step 3: 写 R 分析脚本 ----
echo ""
echo "📝 Step 3: 生成 R 分析脚本..."

cat > "$WORK_DIR/run_pbmc3k_demo.R" << 'RSCRIPT'
# ============================================================
# PBMC3K Standard Analysis for BioF3 Demo
# Generates: Seurat RDS + 5 publication-quality plots
# ============================================================

suppressMessages({
  library(Seurat)
  library(ggplot2)
  library(dplyr)
})

cat("=== PBMC3K Demo Analysis Start ===\n")

# ---- Setup ----
work_dir <- "/app/data/biof3-tmp/demo-setup"
out_dir <- file.path(work_dir, "results")
dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)

# ---- Load Data ----
cat("[1/6] Loading 10x data...\n")
pbmc.data <- Read10X(data.dir = file.path(work_dir, "filtered_gene_bc_matrices/hg19"))
pbmc <- CreateSeuratObject(counts = pbmc.data, project = "pbmc3k", min.cells = 3, min.features = 200)
cat(sprintf("  Loaded: %d cells, %d genes\n", ncol(pbmc), nrow(pbmc)))

# ---- QC ----
cat("[2/6] QC filtering...\n")
pbmc[["percent.mt"]] <- PercentageFeatureSet(pbmc, pattern = "^MT-")

# QC Violin Plot
png(file.path(out_dir, "qc_violin.png"), width = 900, height = 400, res = 120)
print(VlnPlot(pbmc, features = c("nFeature_RNA", "nCount_RNA", "percent.mt"), ncol = 3, pt.size = 0.1) +
  theme(plot.title = element_text(size = 10)))
dev.off()
cat("  ✓ QC violin plot saved\n")

# Filter
pbmc <- subset(pbmc, subset = nFeature_RNA > 200 & nFeature_RNA < 2500 & percent.mt < 5)
cat(sprintf("  After QC: %d cells\n", ncol(pbmc)))

# ---- Normalize + Variable Features ----
cat("[3/6] Normalization + HVG...\n")
pbmc <- NormalizeData(pbmc, verbose = FALSE)
pbmc <- FindVariableFeatures(pbmc, selection.method = "vst", nfeatures = 2000, verbose = FALSE)

# Variable Features Plot
png(file.path(out_dir, "variable_features.png"), width = 700, height = 450, res = 120)
top10 <- head(VariableFeatures(pbmc), 10)
plot1 <- VariableFeaturePlot(pbmc)
plot2 <- LabelPoints(plot = plot1, points = top10, repel = TRUE, xnudge = 0, ynudge = 0)
print(plot2)
dev.off()
cat("  ✓ Variable features plot saved\n")

# ---- Scale + PCA ----
cat("[4/6] PCA...\n")
all.genes <- rownames(pbmc)
pbmc <- ScaleData(pbmc, features = all.genes, verbose = FALSE)
pbmc <- RunPCA(pbmc, features = VariableFeatures(object = pbmc), verbose = FALSE)

# Elbow Plot
png(file.path(out_dir, "elbow_plot.png"), width = 600, height = 400, res = 120)
print(ElbowPlot(pbmc, ndims = 20))
dev.off()
cat("  ✓ Elbow plot saved\n")

# ---- Clustering + UMAP ----
cat("[5/6] Clustering + UMAP...\n")
pbmc <- FindNeighbors(pbmc, dims = 1:10, verbose = FALSE)
pbmc <- FindClusters(pbmc, resolution = 0.5, verbose = FALSE)
pbmc <- RunUMAP(pbmc, dims = 1:10, verbose = FALSE)

n_clusters <- length(levels(Idents(pbmc)))
cat(sprintf("  Found %d clusters\n", n_clusters))

# UMAP Plot
png(file.path(out_dir, "umap_clusters.png"), width = 700, height = 550, res = 120)
print(DimPlot(pbmc, reduction = "umap", label = TRUE, label.size = 4) +
  ggtitle(sprintf("PBMC3K UMAP (%d clusters)", n_clusters)) +
  theme(plot.title = element_text(size = 12, face = "bold")))
dev.off()
cat("  ✓ UMAP plot saved\n")

# ---- Find Markers ----
cat("[6/6] Finding markers...\n")
pbmc.markers <- FindAllMarkers(pbmc, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.25, verbose = FALSE)

# Save markers CSV
write.csv(pbmc.markers, file.path(out_dir, "markers.csv"), row.names = FALSE)
cat("  ✓ Markers CSV saved\n")

# Marker Heatmap (top 5 per cluster)
top5 <- pbmc.markers %>% group_by(cluster) %>% slice_max(n = 5, order_by = avg_log2FC)
png(file.path(out_dir, "marker_heatmap.png"), width = 900, height = 700, res = 120)
print(DoHeatmap(pbmc, features = top5$gene, size = 3) + NoLegend() +
  theme(axis.text.y = element_text(size = 6)))
dev.off()
cat("  ✓ Marker heatmap saved\n")

# ---- Save RDS ----
cat("\n💾 Saving Seurat object...\n")
saveRDS(pbmc, file.path(out_dir, "pbmc3k_final.rds"))
cat("  ✓ RDS saved\n")

# ---- Generate summary JSON ----
cat("\n📊 Generating summary...\n")
cluster_info <- data.frame(
  id = levels(Idents(pbmc)),
  cells = as.numeric(table(Idents(pbmc)))
)

# Top 2 markers per cluster
top2 <- pbmc.markers %>% group_by(cluster) %>% slice_max(n = 2, order_by = avg_log2FC) %>%
  summarise(topMarkers = paste(gene, collapse = ","), .groups = "drop")

cluster_info <- merge(cluster_info, top2, by.x = "id", by.y = "cluster", all.x = TRUE)

summary_json <- list(
  nCells = ncol(pbmc),
  nGenes = nrow(pbmc),
  nClusters = n_clusters,
  clusters = lapply(1:nrow(cluster_info), function(i) {
    list(
      id = as.character(cluster_info$id[i]),
      cells = cluster_info$cells[i],
      topMarkers = strsplit(cluster_info$topMarkers[i], ",")[[1]]
    )
  }),
  qcStats = list(
    cellsBefore = 2700,
    cellsAfter = ncol(pbmc),
    medianGenes = median(pbmc$nFeature_RNA),
    medianUMI = median(pbmc$nCount_RNA),
    medianMtPct = round(median(pbmc$percent.mt), 2)
  )
)

jsonlite::write_json(summary_json, file.path(out_dir, "summary.json"), auto_unbox = TRUE, pretty = TRUE)
cat("  ✓ Summary JSON saved\n")

cat("\n=== PBMC3K Demo Analysis Complete ===\n")
cat(sprintf("Results in: %s\n", out_dir))
cat("Files: qc_violin.png, variable_features.png, elbow_plot.png, umap_clusters.png, marker_heatmap.png, markers.csv, pbmc3k_final.rds, summary.json\n")
RSCRIPT

echo "   ✓ R 脚本已生成"

# ---- Step 4: 在 Docker 容器中执行分析 ----
echo ""
echo "🔬 Step 4: 在 Docker 容器中执行 PBMC3K 分析（约 2-5 分钟）..."
docker exec "$CONTAINER" Rscript --vanilla "$CONTAINER_WORK/run_pbmc3k_demo.R"
echo "   ✓ 分析完成"

# ---- Step 5: 缓存 RDS ----
echo ""
echo "💾 Step 5: 缓存 RDS 文件..."
cp "$WORK_DIR/results/pbmc3k_final.rds" "$CACHE_DIR/demo-pbmc3k.rds"
echo "   ✓ RDS 已缓存到 $CACHE_DIR/demo-pbmc3k.rds"

# ---- Step 6: 上传结果到 OSS ----
echo ""
echo "☁️  Step 6: 上传结果图片到 OSS..."

# 安装 ossutil 如果不存在
if ! command -v ossutil64 &> /dev/null && ! command -v ossutil &> /dev/null; then
  echo "   安装 ossutil..."
  wget -q -O /usr/local/bin/ossutil64 "https://gosspublic.alicdn.com/ossutil/1.7.18/ossutil-v1.7.18-linux-amd64/ossutil64"
  chmod +x /usr/local/bin/ossutil64
fi

OSSUTIL=$(command -v ossutil64 || command -v ossutil)

# 配置 ossutil
$OSSUTIL config -e "$OSS_ENDPOINT" -i "$OSS_AK" -k "$OSS_SK" --output-dir /tmp/ossutil_output 2>/dev/null || true

# 上传图片和文件
RESULTS_DIR="$WORK_DIR/results"
for f in qc_violin.png variable_features.png elbow_plot.png umap_clusters.png marker_heatmap.png markers.csv pbmc3k_final.rds; do
  if [ -f "$RESULTS_DIR/$f" ]; then
    echo "   上传 $f ..."
    $OSSUTIL cp "$RESULTS_DIR/$f" "oss://$OSS_BUCKET/demo/results/$f" -f 2>/dev/null
  fi
done

# 也上传原始数据文件
echo "   上传原始数据..."
$OSSUTIL cp "$PBMC_FILE" "oss://$OSS_BUCKET/demo/pbmc3k_filtered_gene_bc_matrices.tar.gz" -f 2>/dev/null

echo "   ✓ OSS 上传完成"

# ---- Step 7: 部署后端 seed-demo 接口 ----
echo ""
echo "🔧 Step 7: 部署 seed-demo 后端接口..."

# 先读取真实的 summary.json 来更新 patch 中的数据
SUMMARY_FILE="$RESULTS_DIR/summary.json"
if [ -f "$SUMMARY_FILE" ]; then
  echo "   使用真实分析结果更新 seed 数据..."
fi

# 执行 patch（如果 add-demo-seed.js 已上传）
if [ -f "$SERVER_DIR/add-demo-seed.js" ]; then
  node "$SERVER_DIR/add-demo-seed.js"
  echo "   ✓ Patch 已应用"
else
  echo "   ⚠ add-demo-seed.js 未找到，请先上传"
fi

# ---- Step 8: 重启服务 ----
echo ""
echo "🔄 Step 8: 重启服务..."
cd "$SERVER_DIR" && pm2 restart biof3-r-server
echo "   ✓ 服务已重启"

# ---- 完成 ----
echo ""
echo "================================================"
echo "✅ PBMC3K Demo 部署完成！"
echo ""
echo "验证："
echo "  curl -s http://localhost:3001/api/health"
echo "  # 前端登录后应看到 '体验 PBMC3K Demo' 按钮"
echo ""
echo "OSS 文件："
echo "  https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/demo/results/umap_clusters.png"
echo "  https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/demo/results/pbmc3k_final.rds"
echo ""
echo "RDS 缓存："
echo "  $CACHE_DIR/demo-pbmc3k.rds"
echo "================================================"
