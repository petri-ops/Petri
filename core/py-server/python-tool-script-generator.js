/**
 * Task Scripts — Python script generators for bioinformatics analyses.
 *
 * Covers the Python-native workflows that R doesn't do well:
 *   - Scanpy single-cell analysis
 *   - scVI / deep learning-based methods
 *   - Spatial transcriptomics (Squidpy)
 *   - Machine learning classifiers
 *   - AnnData manipulation
 */


function generatePythonToolScript({ type, params, ossInputUrl, outputDir, parentCachePath }) {
  const progressHelper = `
import json, os

def report_progress(pct, msg):
    with open(os.path.join("${outputDir}", "progress.json"), "w") as f:
        json.dump({"progress": pct, "message": msg}, f)

report_progress(5, "初始化环境...")
`;

  switch (type) {
    case 'scanpy_standard':
      return generateScanpyScript({ params, ossInputUrl, outputDir }, progressHelper);
    case 'scanpy_integration':
      return generateScanpyIntegrationScript(
        { params, ossInputUrl, outputDir },
        progressHelper
      );
    // W1-9: 'spatial' 是 'spatial_standard' 的旧别名（向后兼容），共用 generator
    case 'spatial':
    case 'spatial_standard':
      return generateSpatialStandardScript(
        { params, ossInputUrl, outputDir },
        progressHelper
      );
    // W4-A (2026-05-28): spatial_recluster — sub-cluster a chosen leiden cluster from parent's result_spatial.h5ad
    case 'spatial_recluster':
      return generateSpatialReclusterScript(
        { params, ossInputUrl, outputDir, parentCachePath },
        progressHelper
      );
    // W4-A (2026-05-28): spatial_svg — multi-method spatially variable genes (Moran's I + Geary's C + Sepal)
    case 'spatial_svg':
      return generateSpatialSvgScript(
        { params, ossInputUrl, outputDir, parentCachePath },
        progressHelper
      );
    // W4-A (2026-05-28): spatial_deconv — Tangram-based cell type deconvolution per spot
    case 'spatial_deconv':
      return generateSpatialDeconvScript(
        { params, ossInputUrl, outputDir, parentCachePath },
        progressHelper
      );
    // W4-A (2026-05-29): spatial_lr — LIANA spatial-aware ligand-receptor analysis
    case 'spatial_lr':
      return generateSpatialLrScript(
        { params, ossInputUrl, outputDir, parentCachePath },
        progressHelper
      );
    case 'scvi_annotation':
      return generateScVIScript({ params, ossInputUrl, outputDir }, progressHelper);
    case 'ml_classifier':
      return generateMLScript({ params, ossInputUrl, outputDir }, progressHelper);
    case 'cellrank':
      return generateCellRankScript({ params, ossInputUrl, outputDir }, progressHelper);
    default:
      return `${progressHelper}\nraise ValueError("未知任务类型: ${type}")`;
  }
}

// ============================================================
// Scanpy Standard Pipeline
// ============================================================

function generateScanpyScript({ params, ossInputUrl, outputDir }, progressHelper) {
  const {
    minGenes = 200,
    maxGenes = 5000,
    maxMtPct = 20,
    nPCs = 30,
    resolution = 0.5,
    nTopGenes = 2000,
  } = params || {};

  return `
import scanpy as sc
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import json, os, urllib.request

${progressHelper}
os.chdir("${outputDir}")
sc.settings.figdir = "${outputDir}"
sc.settings.set_figure_params(dpi=150, frameon=False)

# --- 1. Load data ---
report_progress(10, "下载数据...")
input_url = "${ossInputUrl}"
ext = os.path.splitext(input_url)[1].lower()

if ext == ".h5ad":
    urllib.request.urlretrieve(input_url, "input.h5ad")
    adata = sc.read_h5ad("input.h5ad")
elif ext == ".h5":
    urllib.request.urlretrieve(input_url, "input.h5")
    adata = sc.read_10x_h5("input.h5")
elif ext in (".csv", ".tsv", ".txt"):
    urllib.request.urlretrieve(input_url, "input.csv")
    adata = sc.read_csv("input.csv").T  # genes x cells → cells x genes
else:
    urllib.request.urlretrieve(input_url, "input" + ext)
    adata = sc.read("input" + ext)

report_progress(20, f"加载完成: {adata.n_obs} 细胞, {adata.n_vars} 基因")

# --- 2. QC ---
report_progress(25, "质控分析...")
adata.var_names_make_unique()
sc.pp.filter_cells(adata, min_genes=${minGenes})
sc.pp.filter_genes(adata, min_cells=3)

adata.var["mt"] = adata.var_names.str.startswith(("MT-", "mt-"))
sc.pp.calculate_qc_metrics(adata, qc_vars=["mt"], inplace=True)

fig, axes = plt.subplots(1, 3, figsize=(12, 4))
sc.pl.violin(adata, ["n_genes_by_counts"], ax=axes[0], show=False)
sc.pl.violin(adata, ["total_counts"], ax=axes[1], show=False)
sc.pl.violin(adata, ["pct_counts_mt"], ax=axes[2], show=False)
plt.tight_layout()
plt.savefig("plot_001_qc_violin.png", dpi=150, bbox_inches="tight")
plt.close()

adata = adata[adata.obs.n_genes_by_counts < ${maxGenes}, :]
adata = adata[adata.obs.pct_counts_mt < ${maxMtPct}, :]
report_progress(35, f"质控后: {adata.n_obs} 细胞")

# --- 3. Normalize & HVG ---
report_progress(40, "标准化 + 高变基因...")
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=${nTopGenes})

sc.pl.highly_variable_genes(adata, show=False)
plt.savefig("plot_002_hvg.png", dpi=150, bbox_inches="tight")
plt.close()

# --- 4. PCA ---
report_progress(50, "PCA...")
adata.raw = adata
adata = adata[:, adata.var.highly_variable]
sc.pp.scale(adata, max_value=10)
sc.pp.pca(adata, n_comps=${nPCs})

sc.pl.pca_variance_ratio(adata, n_pcs=${nPCs}, show=False)
plt.savefig("plot_003_pca_variance.png", dpi=150, bbox_inches="tight")
plt.close()

# --- 5. Neighbors + Clustering ---
report_progress(65, "聚类分析...")
sc.pp.neighbors(adata, n_pcs=${nPCs})
sc.tl.leiden(adata, resolution=${resolution})

# --- 6. UMAP ---
report_progress(75, "UMAP...")
sc.tl.umap(adata)

sc.pl.umap(adata, color=["leiden"], legend_loc="on data", show=False)
plt.savefig("plot_004_umap_clusters.png", dpi=150, bbox_inches="tight")
plt.close()

# --- 7. Marker genes ---
report_progress(85, "寻找标记基因...")
sc.tl.rank_genes_groups(adata, "leiden", method="wilcoxon")

sc.pl.rank_genes_groups(adata, n_genes=5, show=False)
plt.savefig("plot_005_markers.png", dpi=150, bbox_inches="tight")
plt.close()

# Save top markers
markers_df = sc.get.rank_genes_groups_df(adata, group=None)
markers_df.head(100).to_csv("markers_top.csv", index=False)

# --- 8. Save ---
report_progress(95, "保存结果...")
adata.write("result.h5ad")

summary = {
    "n_cells": int(adata.n_obs),
    "n_genes": int(adata.n_vars),
    "n_clusters": int(adata.obs["leiden"].nunique()),
    "n_pcs": ${nPCs},
    "resolution": ${resolution},
}
with open("summary.json", "w") as f:
    json.dump(summary, f)

report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Scanpy Integration (Harmony / scanorama / bbknn)
// ============================================================

function generateScanpyIntegrationScript(
  { params, ossInputUrl, outputDir },
  progressHelper
) {
  const { method = 'harmony', batchKey = 'batch', nPCs = 30, resolution = 0.5 } = params || {};

  return `
import scanpy as sc
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import json, os, urllib.request

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False)

report_progress(10, "下载数据...")
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
report_progress(20, f"{adata.n_obs} 细胞, batch: ${batchKey}")

report_progress(30, "预处理...")
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=2000, batch_key="${batchKey}")
adata = adata[:, adata.var.highly_variable]
sc.pp.scale(adata, max_value=10)
sc.pp.pca(adata, n_comps=${nPCs})

# Before integration
sc.pp.neighbors(adata, n_pcs=${nPCs})
sc.tl.umap(adata)
sc.pl.umap(adata, color=["${batchKey}"], show=False)
plt.savefig("plot_001_before_integration.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(50, "运行 ${method} 整合...")
if "${method}" == "harmony":
    import scanpy.external as sce
    sce.pp.harmony_integrate(adata, "${batchKey}")
    sc.pp.neighbors(adata, use_rep="X_pca_harmony", n_pcs=${nPCs})
elif "${method}" == "bbknn":
    import bbknn
    bbknn.bbknn(adata, batch_key="${batchKey}")
elif "${method}" == "scanorama":
    import scanorama
    sce.pp.scanorama_integrate(adata, "${batchKey}")
    sc.pp.neighbors(adata, use_rep="X_scanorama", n_pcs=${nPCs})

report_progress(70, "聚类 + UMAP...")
sc.tl.leiden(adata, resolution=${resolution})
sc.tl.umap(adata)

sc.pl.umap(adata, color=["${batchKey}"], show=False)
plt.savefig("plot_002_after_integration.png", dpi=150, bbox_inches="tight")
plt.close()

sc.pl.umap(adata, color=["leiden"], legend_loc="on data", show=False)
plt.savefig("plot_003_clusters.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(90, "保存结果...")
adata.write("result_integrated.h5ad")
summary = {"n_cells": int(adata.n_obs), "n_clusters": int(adata.obs["leiden"].nunique()), "method": "${method}", "batch_key": "${batchKey}"}
with open("summary.json", "w") as f: json.dump(summary, f)
report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Spatial Transcriptomics (Squidpy)
// ============================================================

function generateSpatialStandardScript({ params, ossInputUrl, outputDir }, progressHelper) {
  const {
    nPCs = 30,
    resolution = 0.5,
    coordType = 'generic', // 'grid' | 'generic'
    nNeighbors = 6,
    topSVGs = 50,
    nHVGs = 2000,
  } = params || {};

  // 双输入模式：
  // - ossInputUrl 提供 → 走 OSS 下载（单细胞平台 / 内部任务调用）
  // - 否则 → 期望 input.h5ad 已在 outputDir（/tools 页面 base64 上传 + 后端解码）
  // 注意：/tools 页面的文件按 input id 命名（如 'adata'），无扩展名 — 与 r-server 行为一致
  const inputBlock = ossInputUrl
    ? `report_progress(10, "下载数据...")
import urllib.request
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")`
    : `report_progress(10, "查找已上传的 .h5ad 文件...")
# /tools 页面：前端 base64 上传后已写到 jobDir 根目录
# 文件名是 input id（如 'adata'，无扩展名）。优先按 input id 找，再按 *.h5ad/*.h5 兜底
import shutil
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))  # jobDir
candidates = []
for name in ["adata", "input.h5ad", "input.h5"]:
    p = os.path.join(parent_dir, name)
    if os.path.isfile(p) and os.path.getsize(p) > 1000:
        candidates.append(p)
if not candidates:
    import glob
    candidates = sorted(glob.glob(os.path.join(parent_dir, "*.h5ad")) + glob.glob(os.path.join(parent_dir, "*.h5")))
if not candidates:
    raise FileNotFoundError(f"未在 {parent_dir} 找到 h5ad 输入。期望: input id 'adata' 或文件后缀 .h5ad/.h5")
src = candidates[0]
dst = os.path.join("${outputDir}", "input.h5ad")
if src != dst:
    shutil.copy(src, dst)
print(f"  使用输入文件: {src} ({os.path.getsize(src)/1024/1024:.1f} MB)")`;

  return `
import scanpy as sc
import squidpy as sq
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import json, os
import anndata as ad

# anndata 0.12+ 默认拒绝写 ArrowStringArray，开关打开兼容旧/新数据
try:
    ad.settings.allow_write_nullable_strings = True
except Exception:
    pass

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False, facecolor="white")

${inputBlock}
adata = sc.read_h5ad("input.h5ad")
n_obs_in = adata.n_obs
n_var_in = adata.n_vars
report_progress(20, f"{n_obs_in} spots × {n_var_in} genes")

# 平台推断（用于 summary）
platform = "Visium" if "spatial" in adata.uns and len(adata.uns["spatial"]) > 0 else (
    "Visium-like" if "spatial" in adata.obsm else "Unknown")
has_image = "spatial" in adata.uns and any("images" in v for v in adata.uns["spatial"].values())

report_progress(30, "QC + 标准化...")
# Compute QC if missing
if "n_counts" not in adata.obs:
    adata.obs["n_counts"] = np.array(adata.X.sum(axis=1)).flatten()
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
sc.pp.highly_variable_genes(adata, n_top_genes=${nHVGs}, flavor="seurat")
adata.raw = adata
adata = adata[:, adata.var["highly_variable"]].copy()
sc.pp.scale(adata, max_value=10)
sc.pp.pca(adata, n_comps=${nPCs})

report_progress(45, "聚类 + UMAP...")
sc.pp.neighbors(adata, n_pcs=${nPCs})
sc.tl.leiden(adata, resolution=${resolution})
sc.tl.umap(adata)
n_clusters = int(adata.obs["leiden"].nunique())

report_progress(55, "Plot 1/4: 空间聚类（组织底图 + spot 着色）...")
if "spatial" in adata.obsm:
    try:
        # 优先用 sc.pl.spatial（自动叠加 H&E 切片图，如果有）
        sc.pl.spatial(adata, color="leiden", spot_size=1.5 if not has_image else None,
                      img_key="hires" if has_image else None, show=False, legend_loc="right margin")
        plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    except Exception as e:
        # Fallback: pure scatter on obsm['spatial'] coords
        coords = adata.obsm["spatial"]
        import matplotlib.pyplot as plt2
        fig, ax = plt2.subplots(figsize=(7, 7))
        for c in sorted(adata.obs["leiden"].unique(), key=lambda x: int(x)):
            mask = adata.obs["leiden"] == c
            ax.scatter(coords[mask, 0], coords[mask, 1], s=8, label=f"C{c}", alpha=0.8)
        ax.set_aspect("equal")
        ax.invert_yaxis()
        ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=8)
        ax.set_title("Spatial clusters")
        plt2.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt2.close("all")
else:
    # 没有空间坐标 → 占位图
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, "obsm['spatial'] missing\\n(not a spatial dataset)", ha="center", va="center")
    ax.axis("off")
    plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
    plt.close("all")

report_progress(65, "Plot 2/4: UMAP...")
sc.pl.umap(adata, color=["leiden"], legend_loc="on data", show=False, title=f"UMAP — {n_clusters} clusters")
plt.savefig("plot_002_umap.png", dpi=150, bbox_inches="tight")
plt.close("all")

report_progress(75, "邻域富集 (z-score)...")
try:
    sq.gr.spatial_neighbors(adata, coord_type="${coordType}", n_neighs=${nNeighbors})
    sq.gr.nhood_enrichment(adata, cluster_key="leiden", n_perms=1000)
    sq.pl.nhood_enrichment(adata, cluster_key="leiden", method="ward",
                            cmap="RdBu_r", show=False)
    plt.savefig("plot_003_nhood_enrichment.png", dpi=150, bbox_inches="tight")
    plt.close("all")
    nhood_ok = True
except Exception as e:
    nhood_ok = False
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"邻域富集失败:\\n{str(e)[:120]}", ha="center", va="center", fontsize=8)
    ax.axis("off")
    plt.savefig("plot_003_nhood_enrichment.png", dpi=150, bbox_inches="tight")
    plt.close("all")

report_progress(85, "空间高变基因 (Moran's I)...")
# 选 top-N HVG 跑 Moran's I（全基因太慢）
hvg_genes = adata.var.index[:min(${topSVGs} * 4, adata.n_vars)].tolist()
try:
    sq.gr.spatial_autocorr(adata, genes=hvg_genes, mode="moran", n_perms=100, n_jobs=4)
    moran_df = adata.uns["moranI"].copy()
    moran_df = moran_df.sort_values("I", ascending=False).head(${topSVGs})
    moran_df.to_csv("top_svgs.csv")
    n_sig = int((moran_df["pval_norm"] < 0.05).sum()) if "pval_norm" in moran_df else 0
    top_svg_names = moran_df.index.tolist()
except Exception as e:
    moran_df = pd.DataFrame()
    n_sig = 0
    top_svg_names = hvg_genes[:${topSVGs}]
    pd.DataFrame({"gene": top_svg_names}).to_csv("top_svgs.csv", index=False)

report_progress(92, "Plot 4/4: Top SVGs 空间分布 (2×2 拼图)...")
if "spatial" in adata.obsm:
    plot_genes = top_svg_names[:4] if len(top_svg_names) >= 4 else top_svg_names
    if len(plot_genes) > 0:
        try:
            sc.pl.spatial(adata, color=plot_genes, img_key="hires" if has_image else None,
                           spot_size=1.5 if not has_image else None,
                           ncols=2, show=False, cmap="viridis")
            plt.savefig("plot_004_top_svgs.png", dpi=150, bbox_inches="tight")
            plt.close("all")
        except Exception as e:
            fig, ax = plt.subplots(figsize=(6, 4))
            ax.text(0.5, 0.5, f"Top SVG 绘图失败:\\n{str(e)[:120]}", ha="center", va="center", fontsize=8)
            ax.axis("off")
            plt.savefig("plot_004_top_svgs.png", dpi=150, bbox_inches="tight")
            plt.close("all")
    else:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, "无 top SVG 可绘", ha="center", va="center")
        ax.axis("off")
        plt.savefig("plot_004_top_svgs.png", dpi=150, bbox_inches="tight")
        plt.close("all")

report_progress(96, "保存 .h5ad 结果 + summary.json...")
# Restore raw + write
adata_out = adata.raw.to_adata() if adata.raw is not None else adata
adata_out.obs["leiden"] = adata.obs["leiden"].values
adata_out.obsm = adata.obsm
adata_out.uns["moranI"] = moran_df.to_dict("index") if not moran_df.empty else {}
adata_out.write("result_spatial.h5ad")

# ============================================================
# W3-D (2026-05-28): 导出 metadata.csv + features.csv，与 r-server 标准分析对齐。
# 让 /spatial 数据预览页用同一个 CsvTable 组件渲染（spot 元数据 / 基因列表）。
#   - metadata.csv: 每个 spot 一行，列含 cell_id / leiden / 空间坐标 / 其他 obs 字段
#     注：spatial 也用 cell_id 作为主键名（前端 CsvTable 默认 rowKey="cell_id"），保持
#         与单细胞契约一致；空间语义上等同 spot_id。
#   - features.csv: 每个基因一行，列含 gene_symbol / mean_expression / pct_spots
# ============================================================
report_progress(97, "导出 obs/var 表（metadata.csv + features.csv）...")
try:
    import scipy.sparse as sp
    # ---- metadata.csv (obs table) ----
    obs = adata_out.obs.copy()
    obs.insert(0, "cell_id", obs.index.astype(str))
    if "spatial" in adata_out.obsm:
        coords = adata_out.obsm["spatial"]
        try:
            obs["spatial_x"] = coords[:, 0]
            obs["spatial_y"] = coords[:, 1]
        except Exception:
            pass
    # 数值类型四舍五入便于显示，object dtype 转 str 兜底
    for col in obs.columns:
        if obs[col].dtype.kind == "f":
            obs[col] = obs[col].round(3)
    obs.to_csv("metadata.csv", index=False)

    # ---- features.csv (var table) ----
    X = adata_out.X
    if sp.issparse(X):
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    else:
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    var = adata_out.var.copy()
    var.insert(0, "gene_symbol", var.index.astype(str))
    var["mean_expression"] = np.round(mean_expr, 4)
    var["pct_spots"] = np.round(pct_expr, 2)
    # 按平均表达从高到低排序，便于浏览
    var = var.sort_values("mean_expression", ascending=False)
    var.to_csv("features.csv", index=False)
    print(f"  ✓ metadata.csv: {len(obs)} spots × {len(obs.columns)} cols")
    print(f"  ✓ features.csv: {len(var)} genes × {len(var.columns)} cols")
except Exception as _e:
    print(f"[meta-export] WARN: {_e}")

summary = {
    "n_spots": int(n_obs_in),
    "n_genes": int(n_var_in),
    "n_clusters": int(n_clusters),
    "n_significant_svgs": int(n_sig),
    "platform": platform,
    "has_image": bool(has_image),
    "resolution": ${resolution},
    "topSVGs": top_svg_names[:10],
}
with open("summary.json", "w") as f:
    json.dump(summary, f, indent=2)

# ============================================================
# 报告 HTML 生成（W2, 2026-05-28）
# 模板路径优先：jobDir/report-template.html (r-server 流程会 cp 进去)
#   fallback: /opt/biof3-r-server/tool-scripts/spatial-standard-report-template.html
# 图替换：{{plot_xxx.png}} → data:image/png;base64,...
# 占位符替换：{{n_spots}} 等
# 微信 QR：从 cellchat 模板里 grep 复用，避免每个工具都内嵌 35KB
# ============================================================
report_progress(98, "生成 HTML 报告...")
import base64

# 找模板 — jobDir 优先（用户上传/r-server 复制），否则全局位置
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))
template_candidates = [
    os.path.join(parent_dir, "report-template.html"),
    "/app/data/biof3-tool-jobs/_templates/spatial-standard-report-template.html",  # py 容器内备选
    "/app/data/biof3-py-tmp/_templates/spatial-standard-report-template.html",
]
template_path = None
for p in template_candidates:
    if os.path.isfile(p):
        template_path = p
        break

if template_path:
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()

        # 1) 把 PNG 图替换成 base64 内嵌
        for fname in ["plot_001_spatial_clusters.png", "plot_002_umap.png",
                       "plot_003_nhood_enrichment.png", "plot_004_top_svgs.png"]:
            fpath = fname  # 当前 cwd 就是 outputDir
            if os.path.isfile(fpath):
                with open(fpath, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode("ascii")
                data_uri = f"data:image/png;base64,{b64}"
                html = html.replace("{{" + fname + "}}", data_uri)

        # 2) 微信 QR — 尝试从 cellchat 模板拿；找不到就保留 placeholder（图标会损坏但不影响 layout，因 CSS fix 56x56）
        wechat_qr = ""
        for qr_src in [
            "/app/data/biof3-tool-jobs/_templates/wechat-qr.b64",
            "/app/data/biof3-py-tmp/_templates/wechat-qr.b64",
        ]:
            if os.path.isfile(qr_src):
                with open(qr_src, "r") as f:
                    wechat_qr = f.read().strip()
                break
        if wechat_qr:
            html = html.replace("{{WECHAT_QR_BASE64}}", wechat_qr)
        else:
            # 留空占位 → src="" 会让浏览器显示 broken icon，但 CSS 限定 56x56 不破坏布局
            html = html.replace("{{WECHAT_QR_BASE64}}", "")

        # 3) 文本占位符替换
        replacements = {
            "{{n_spots}}": str(n_obs_in),
            "{{n_genes}}": str(n_var_in),
            "{{n_clusters}}": str(n_clusters),
            "{{n_significant_svgs}}": str(n_sig),
            "{{platform}}": platform,
            "{{has_image_label}}": "✓ 含" if has_image else "✗ 无",
            "{{nPCs}}": str(${nPCs}),
            "{{resolution}}": str(${resolution}),
            "{{coordType}}": "${coordType}",
            "{{nNeighbors}}": str(${nNeighbors}),
            "{{topSVGs}}": str(${topSVGs}),
            "{{n_genes_used}}": str(adata.n_vars),
            "{{top_svgs_list}}": ", ".join(top_svg_names[:10]) if top_svg_names else "—",
        }
        for k, v in replacements.items():
            html = html.replace(k, v)

        with open("report.html", "w", encoding="utf-8") as f:
            f.write(html)
        report_html_size = os.path.getsize("report.html")
        print(f"  报告 HTML 写入成功: {report_html_size/1024:.1f} KB")
    except Exception as e:
        print(f"  ⚠️ 报告生成失败（不影响主流程）: {e}")
else:
    print(f"  ⚠️ 未找到报告模板（候选路径: {template_candidates}），跳过 report.html")

# manifest.json — 给 r-server / py-server tools-router 自动渲染前端
manifest = {
    "files": [
        {"name": "plot_001_spatial_clusters.png", "type": "plot", "label": "空间聚类"},
        {"name": "plot_002_umap.png",             "type": "plot", "label": "UMAP"},
        {"name": "plot_003_nhood_enrichment.png", "type": "plot", "label": "邻域富集 z-score"},
        {"name": "plot_004_top_svgs.png",         "type": "plot", "label": "Top SVGs 空间分布"},
        {"name": "top_svgs.csv",                  "type": "table", "label": "Top SVGs (Moran's I)"},
        {"name": "result_spatial.h5ad",           "type": "file", "label": "处理后 AnnData"},
        {"name": "summary.json",                  "type": "file", "label": "分析摘要"},
        {"name": "report.html",                   "type": "file", "label": "解读报告 HTML"},
    ],
    "summary": summary,
}
# 报告生成失败时从清单里移除 report.html 以免前端 404
if not os.path.isfile("report.html"):
    manifest["files"] = [f for f in manifest["files"] if f["name"] != "report.html"]
with open("manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Spatial Recluster (W4-A, 2026-05-28)
//
// Sub-cluster a chosen leiden cluster from parent's result_spatial.h5ad.
// Loads from parentCachePath (no re-download / no re-QC) when available,
// falls back to ossInputUrl (parent's full result h5ad URL).
//
// Output shape (mirrors spatial_standard so frontend renders identically):
//   - plot_001_spatial_clusters.png  (subset spots colored by sub-cluster, on tissue if available)
//   - plot_002_umap.png              (sub-clustered UMAP — re-computed on the subset)
//   - plot_003_top_markers.png       (top-3 marker per sub-cluster, dotplot)
//   - plot_004_subset_in_context.png (full slide with subset highlighted, others gray)
//   - result_spatial.h5ad            (subset AnnData with new sub-cluster labels written
//                                     back as obs['leiden_sub'] AND obs['leiden'] = old + sub combo)
//   - top_markers.csv                (sub-cluster markers ranked by score)
//   - metadata.csv / features.csv    (obs/var of the subset)
//   - summary.json                   ({n_spots, n_subclusters, parent_cluster, ...})
// ============================================================

function generateSpatialReclusterScript(
  { params, ossInputUrl, outputDir, parentCachePath },
  progressHelper
) {
  const {
    parentCluster = '0', // which leiden cluster from parent to sub-cluster
    nPCs = 20,
    subResolution = 0.5,
    nNeighbors = 15,
    topNMarkers = 5,
  } = params || {};

  // Load: prefer cache, fall back to OSS download
  const loadBlock = parentCachePath
    ? `report_progress(10, "从父分析缓存加载 result_spatial.h5ad ...")
adata_parent = sc.read_h5ad("${parentCachePath}")
print(f"  parent: {adata_parent.n_obs} spots × {adata_parent.n_vars} genes")`
    : `report_progress(10, "下载父分析结果...")
import urllib.request
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata_parent = sc.read_h5ad("input.h5ad")
print(f"  parent: {adata_parent.n_obs} spots × {adata_parent.n_vars} genes")`;

  return `
import scanpy as sc
import squidpy as sq
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import json, os
import anndata as ad

try:
    ad.settings.allow_write_nullable_strings = True
except Exception:
    pass

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False, facecolor="white")

${loadBlock}

# Sanity check leiden column
if "leiden" not in adata_parent.obs:
    raise ValueError("父分析结果缺少 obs['leiden'] — 请确认它是 spatial_standard 的输出")

parent_cluster_str = "${String(parentCluster)}"
mask = adata_parent.obs["leiden"].astype(str) == parent_cluster_str
n_subset = int(mask.sum())
print(f"  parent cluster '{parent_cluster_str}': {n_subset} spots selected")

if n_subset < 20:
    raise ValueError(f"父 cluster '{parent_cluster_str}' 只有 {n_subset} 个 spots，太少（< 20），无法做有效子聚类")

report_progress(25, f"提取 cluster {parent_cluster_str} 子集 ({n_subset} spots) ...")
adata = adata_parent[mask, :].copy()

# Reset highly_variable on the subset (subset's HVGs may differ from parent's)
report_progress(35, "子集重新选 HVG + PCA ...")
# 子集已经是 log-normalized（继承自父的 raw -> normalize -> log1p -> HVG -> scale 流程）。
# 我们先恢复完整 raw（如果有），再重做 normalize / HVG 让子集独立；这样下游 marker 计算更准。
if adata.raw is not None:
    adata = adata.raw.to_adata()  # restore counts/log-normalized full gene set
sc.pp.normalize_total(adata, target_sum=1e4)
sc.pp.log1p(adata)
n_top = min(2000, max(500, adata.n_vars // 4))
sc.pp.highly_variable_genes(adata, n_top_genes=n_top, flavor="seurat")
adata.raw = adata
adata = adata[:, adata.var["highly_variable"]].copy()
sc.pp.scale(adata, max_value=10)

n_pcs_use = min(${nPCs}, adata.n_obs - 1, adata.n_vars - 1)
sc.pp.pca(adata, n_comps=n_pcs_use)

report_progress(50, "子集 UMAP + Leiden 子聚类 ...")
sc.pp.neighbors(adata, n_pcs=n_pcs_use, n_neighbors=min(${nNeighbors}, adata.n_obs - 1))
sc.tl.leiden(adata, resolution=${subResolution}, key_added="leiden_sub")
sc.tl.umap(adata)
n_subclusters = int(adata.obs["leiden_sub"].nunique())
print(f"  found {n_subclusters} sub-clusters")

# Compose hierarchical label: "parent.sub" e.g. "3.0", "3.1"
adata.obs["leiden"] = (parent_cluster_str + "." + adata.obs["leiden_sub"].astype(str))

# Bring back original obsm['spatial'] (preserved from parent slice)
if "spatial" in adata_parent.obsm:
    parent_coords = adata_parent.obsm["spatial"]
    parent_idx = np.where(mask)[0]
    adata.obsm["spatial"] = parent_coords[parent_idx]
# Bring back original uns['spatial'] (image data) if present
if "spatial" in adata_parent.uns:
    adata.uns["spatial"] = adata_parent.uns["spatial"]

has_image = "spatial" in adata.uns and any("images" in v for v in adata.uns["spatial"].values())

# ------------------------------------------------------------
# Plot 1: subset spots colored by sub-cluster (on tissue)
# ------------------------------------------------------------
report_progress(60, "Plot 1/4: 子聚类空间分布 ...")
if "spatial" in adata.obsm:
    try:
        sc.pl.spatial(adata, color="leiden_sub", spot_size=1.5 if not has_image else None,
                      img_key="hires" if has_image else None, show=False, legend_loc="right margin",
                      title=f"Sub-clusters of parent cluster {parent_cluster_str}")
        plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    except Exception as e:
        coords = adata.obsm["spatial"]
        fig, ax = plt.subplots(figsize=(7, 7))
        for c in sorted(adata.obs["leiden_sub"].unique(), key=str):
            m = adata.obs["leiden_sub"] == c
            ax.scatter(coords[m, 0], coords[m, 1], s=8, label=f"sub-{c}", alpha=0.85)
        ax.set_aspect("equal"); ax.invert_yaxis()
        ax.legend(bbox_to_anchor=(1.02, 1), loc="upper left", fontsize=8)
        ax.set_title(f"Sub-clusters of parent cluster {parent_cluster_str}")
        plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt.close("all")
else:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, "obsm['spatial'] missing", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ------------------------------------------------------------
# Plot 2: UMAP
# ------------------------------------------------------------
report_progress(70, "Plot 2/4: 子集 UMAP ...")
sc.pl.umap(adata, color="leiden_sub", legend_loc="on data", show=False,
           title=f"UMAP — {n_subclusters} sub-clusters")
plt.savefig("plot_002_umap.png", dpi=150, bbox_inches="tight")
plt.close("all")

# ------------------------------------------------------------
# Plot 3: top markers dotplot
# ------------------------------------------------------------
report_progress(80, "Plot 3/4: Marker 基因 dotplot + CSV ...")
markers_df = None
try:
    sc.tl.rank_genes_groups(adata, "leiden_sub", method="wilcoxon", n_genes=200)
    # Build top-N markers per sub-cluster table
    rgg = adata.uns["rank_genes_groups"]
    rows = []
    for grp in rgg["names"].dtype.names:
        for i in range(min(${topNMarkers}, len(rgg["names"][grp]))):
            rows.append({
                "sub_cluster": grp,
                "rank": i + 1,
                "gene": rgg["names"][grp][i],
                "score": float(rgg["scores"][grp][i]),
                "logfc": float(rgg["logfoldchanges"][grp][i]) if "logfoldchanges" in rgg else None,
                "pval_adj": float(rgg["pvals_adj"][grp][i]) if "pvals_adj" in rgg else None,
            })
    markers_df = pd.DataFrame(rows)
    markers_df.to_csv("top_markers.csv", index=False)

    # dotplot top-3 per group (smaller subset for plotting)
    sc.pl.rank_genes_groups_dotplot(adata, n_genes=3, show=False)
    plt.savefig("plot_003_top_markers.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"Marker 计算失败:\\n{str(e)[:120]}", ha="center", va="center", fontsize=8)
    ax.axis("off")
    plt.savefig("plot_003_top_markers.png", dpi=150, bbox_inches="tight")
    plt.close("all")
    markers_df = pd.DataFrame()

# ------------------------------------------------------------
# Plot 4: subset highlighted in full slide context
# ------------------------------------------------------------
report_progress(88, "Plot 4/4: 子集在完整切片中的位置 ...")
if "spatial" in adata_parent.obsm:
    try:
        coords_full = adata_parent.obsm["spatial"]
        fig, ax = plt.subplots(figsize=(7, 7))
        # gray background for non-subset spots
        ax.scatter(coords_full[~mask, 0], coords_full[~mask, 1], s=4, color="#d1d5db", alpha=0.5, label="other")
        ax.scatter(coords_full[mask, 0], coords_full[mask, 1], s=8, color="#dc2626", alpha=0.85, label=f"cluster {parent_cluster_str}")
        ax.set_aspect("equal"); ax.invert_yaxis()
        ax.legend(loc="upper right", fontsize=9)
        ax.set_title(f"Selected subset highlighted (parent cluster {parent_cluster_str})")
        plt.savefig("plot_004_subset_in_context.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    except Exception as e:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, "context plot fail", ha="center", va="center"); ax.axis("off")
        plt.savefig("plot_004_subset_in_context.png", dpi=150, bbox_inches="tight")
        plt.close("all")
else:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, "no spatial coords in parent", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_004_subset_in_context.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ------------------------------------------------------------
# Save .h5ad result + obs/var tables (mirrors spatial_standard)
# ------------------------------------------------------------
report_progress(94, "保存 .h5ad + summary.json ...")
adata_out = adata.raw.to_adata() if adata.raw is not None else adata
adata_out.obs["leiden_sub"] = adata.obs["leiden_sub"].values
adata_out.obs["leiden"] = adata.obs["leiden"].values  # composite "parent.sub"
adata_out.obsm = adata.obsm
if "spatial" in adata.uns:
    adata_out.uns["spatial"] = adata.uns["spatial"]
adata_out.write("result_spatial.h5ad")

# obs/var tables for /spatial 数据预览 tab
report_progress(96, "导出 obs/var 表 ...")
try:
    import scipy.sparse as sp
    obs = adata_out.obs.copy()
    obs.insert(0, "cell_id", obs.index.astype(str))
    if "spatial" in adata_out.obsm:
        coords = adata_out.obsm["spatial"]
        obs["spatial_x"] = coords[:, 0]
        obs["spatial_y"] = coords[:, 1]
    for col in obs.columns:
        if obs[col].dtype.kind == "f":
            obs[col] = obs[col].round(3)
    obs.to_csv("metadata.csv", index=False)

    X = adata_out.X
    mean_expr = np.asarray(X.mean(axis=0)).flatten() if not sp.issparse(X) else np.asarray(X.mean(axis=0)).flatten()
    pct_expr = (np.asarray((X > 0).mean(axis=0)).flatten() if not sp.issparse(X) else np.asarray((X > 0).mean(axis=0)).flatten()) * 100
    var = adata_out.var.copy()
    var.insert(0, "gene_symbol", var.index.astype(str))
    var["mean_expression"] = np.round(mean_expr, 4)
    var["pct_spots"] = np.round(pct_expr, 2)
    var = var.sort_values("mean_expression", ascending=False)
    var.to_csv("features.csv", index=False)
    print(f"  ✓ metadata.csv: {len(obs)} spots, features.csv: {len(var)} genes")
except Exception as _e:
    print(f"[meta-export] WARN: {_e}")

summary = {
    "n_spots": int(n_subset),
    "n_genes": int(adata_parent.n_vars),
    "parent_cluster": parent_cluster_str,
    "n_subclusters": int(n_subclusters),
    "n_significant_markers": int(len(markers_df)) if markers_df is not None else 0,
    "sub_resolution": ${subResolution},
}
with open("summary.json", "w") as f:
    json.dump(summary, f, indent=2)

report_progress(100, "重聚类完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Spatial SVG (W4-A, 2026-05-28)
//
// Multi-method spatially variable gene detection on parent spatial_standard's
// result_spatial.h5ad. Goes deeper than spatial_standard's single-method Moran's I:
//
//   - Moran's I (sq.gr.spatial_autocorr, mode='moran') — strong spatial autocorrelation
//   - Geary's C (sq.gr.spatial_autocorr, mode='geary') — local spatial dissimilarity
//   - Sepal (sq.gr.sepal) — diffusion-time based; favors patterned vs noisy
//
// Cross-method intersection gives "robust SVGs" — gene found by ≥2 methods.
//
// Output (mirrors spatial_standard contract):
//   - plot_001_spatial_clusters.png  (parent's cluster overlay — context for SVG interpretation)
//   - plot_002_top_robust_svgs.png   (top-4 robust SVGs, 2×2 spatial scatter)
//   - plot_003_method_venn.png       (3-way Venn of top-N from each method)
//   - plot_004_score_corr.png        (Moran I vs Sepal score scatter, colored by overlap count)
//   - top_svgs.csv                   (per-gene: moran_I, moran_pval, geary_C, geary_pval, sepal_score, n_methods_significant, robust)
//   - result_spatial.h5ad            (parent's AnnData augmented with uns['svg_results'])
//   - metadata.csv / features.csv    (obs/var of parent — same shape)
//   - summary.json                   ({n_genes_tested, n_moran, n_geary, n_sepal, n_robust, top_robust})
// ============================================================

function generateSpatialSvgScript(
  { params, ossInputUrl, outputDir, parentCachePath },
  progressHelper
) {
  const {
    topN = 50, // per-method top-N to compute overlap
    nPerms = 100, // Moran/Geary permutations
    _moranPCutoff = 0.05, // significance threshold
    minMethods = 2, // robust SVG = significant in ≥ this many methods
    nGenesTest = 1000, // limit testing to top-N HVG to keep runtime manageable
  } = params || {};

  // 3 入口模式：父分析缓存（/spatial 链） / OSS 下载（内部任务） / jobDir 上传（/tools 单次任务）
  const loadBlock = parentCachePath
    ? `report_progress(10, "从父分析缓存加载 result_spatial.h5ad ...")
adata = sc.read_h5ad("${parentCachePath}")
print(f"  loaded from cache: {adata.n_obs} spots × {adata.n_vars} genes")`
    : ossInputUrl
      ? `report_progress(10, "下载父分析结果...")
import urllib.request
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
print(f"  loaded from OSS: {adata.n_obs} spots × {adata.n_vars} genes")`
      : `report_progress(10, "查找 /tools 上传的 .h5ad 文件 ...")
import shutil, glob
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))  # jobDir
candidates = []
for name in ["adata", "input.h5ad", "input.h5"]:
    p = os.path.join(parent_dir, name)
    if os.path.isfile(p) and os.path.getsize(p) > 1000:
        candidates.append(p)
if not candidates:
    candidates = sorted(glob.glob(os.path.join(parent_dir, "*.h5ad")) + glob.glob(os.path.join(parent_dir, "*.h5")))
if not candidates:
    raise FileNotFoundError(f"未在 {parent_dir} 找到 h5ad 输入。期望 input id 'adata' 或文件后缀 .h5ad/.h5")
src = candidates[0]
dst = os.path.join("${outputDir}", "input.h5ad")
if src != dst:
    shutil.copy(src, dst)
adata = sc.read_h5ad(dst)
print(f"  loaded from /tools upload: {src} → {adata.n_obs} spots × {adata.n_vars} genes")`;

  return `
import scanpy as sc
import squidpy as sq
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import json, os
import anndata as ad

try:
    ad.settings.allow_write_nullable_strings = True
except Exception:
    pass

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False, facecolor="white")

${loadBlock}

# Sanity checks
if "spatial" not in adata.obsm:
    raise ValueError("缺少 obsm['spatial'] — 输入需含空间坐标。请使用 sq.datasets.visium_hne_adata() / 10x Visium .h5ad 等带空间坐标的数据")

# /tools 上传的原始数据可能未做标准化 + 缺 HVG（spatial-standard 输出会有这两步的产物）。
# 检测：log1p in uns => 已 log-normalize 过；highly_variable in var => 已挑过 HVG。
if "log1p" not in adata.uns:
    report_progress(15, "检测到原始 counts，自动做标准化（normalize_total + log1p）...")
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)
if "highly_variable" not in adata.var.columns:
    report_progress(17, "未检测到 HVG 列，自动挑 top 2000 HVG（用于子集化测试基因）...")
    sc.pp.highly_variable_genes(adata, n_top_genes=min(2000, adata.n_vars), flavor="seurat")

# Re-build spatial neighbors if not present (sepal needs them)
if "spatial_connectivities" not in adata.obsp:
    report_progress(20, "重建空间邻居图 ...")
    sq.gr.spatial_neighbors(adata, coord_type="generic", n_neighs=6)

n_spots = adata.n_obs
n_genes_total = adata.n_vars
has_image = "spatial" in adata.uns and any("images" in v for v in adata.uns["spatial"].values())

# Pick gene set to test — limit by n_genes_test for runtime control
n_test = min(${nGenesTest}, n_genes_total)
if "highly_variable_rank" in adata.var.columns:
    # Sort by HVG rank if available
    order = adata.var.sort_values("highly_variable_rank", na_position="last").index[:n_test]
elif "means" in adata.var.columns:
    order = adata.var.sort_values("means", ascending=False).index[:n_test]
else:
    order = adata.var.index[:n_test]
test_genes = list(order)
print(f"  testing {len(test_genes)} genes (top by HVG rank or expression)")

# ============================================================
# Method 1: Moran's I (squidpy.gr.spatial_autocorr)
# ============================================================
report_progress(30, f"Method 1/3: Moran's I ({len(test_genes)} genes, {${nPerms}} perms) ...")
moran_df = None
try:
    sq.gr.spatial_autocorr(adata, mode="moran", genes=test_genes, n_perms=${nPerms}, n_jobs=4)
    moran_df = adata.uns["moranI"].copy()
    moran_df = moran_df.rename(columns={"I": "moran_I", "pval_norm": "moran_pval", "pval_norm_fdr_bh": "moran_pval_adj"})
    print(f"  ✓ Moran computed: {len(moran_df)} genes")
except Exception as e:
    print(f"  ✗ Moran failed: {e}")
    moran_df = pd.DataFrame()

# ============================================================
# Method 2: Geary's C (same API, different mode)
# ============================================================
report_progress(50, f"Method 2/3: Geary's C ...")
geary_df = None
try:
    sq.gr.spatial_autocorr(adata, mode="geary", genes=test_genes, n_perms=${nPerms}, n_jobs=4)
    geary_df = adata.uns["gearyC"].copy()
    # Rename to disambiguate from Moran (squidpy stores them in different uns keys but same column names)
    geary_df = geary_df.rename(columns={"C": "geary_C", "pval_norm": "geary_pval", "pval_norm_fdr_bh": "geary_pval_adj"})
    print(f"  ✓ Geary computed: {len(geary_df)} genes")
except Exception as e:
    print(f"  ✗ Geary failed: {e}")
    geary_df = pd.DataFrame()

# ============================================================
# Method 3: Sepal (diffusion-time based)
# ============================================================
report_progress(70, f"Method 3/3: Sepal ...")
sepal_df = None
try:
    # Sepal requires grid-style spatial neighbors (it walks discrete neighbors).
    # If parent built generic neighbors (e.g. spatial_standard默认 generic),
    # rebuild them as grid here. This overwrites obsp keys but doesn't affect
    # downstream usage in this script (Moran/Geary already done).
    print("  rebuilding spatial_neighbors with coord_type='grid' for Sepal ...")
    sq.gr.spatial_neighbors(adata, coord_type="grid", n_neighs=6)
    # Sepal is slower than autocorr — limit to ${nGenesTest} genes
    sq.gr.sepal(adata, max_neighs=6, genes=test_genes, n_jobs=4)
    sepal_df = adata.uns["sepal_score"].copy()
    if "sepal_score" not in sepal_df.columns and len(sepal_df.columns) >= 1:
        # Fallback: first numeric column is the score
        sepal_df.columns = ["sepal_score"]
    print(f"  ✓ Sepal computed: {len(sepal_df)} genes")
except Exception as e:
    import traceback
    print(f"  ✗ Sepal failed: {e}")
    traceback.print_exc()
    sepal_df = pd.DataFrame()

# ============================================================
# Combine: per-gene table with all 3 methods + overlap counts
# ============================================================
report_progress(85, "合并 + 计算 robust SVGs ...")

combined = pd.DataFrame(index=test_genes)
combined.index.name = "gene"

if moran_df is not None and len(moran_df) > 0:
    combined["moran_I"] = moran_df["moran_I"].reindex(combined.index)
    combined["moran_pval"] = moran_df["moran_pval"].reindex(combined.index) if "moran_pval" in moran_df.columns else np.nan
    # 用 Int64 nullable; rank 返回 float, 先 fillna(-1) 再转 int 兼容性更好
    combined["moran_rank"] = combined["moran_I"].rank(ascending=False, na_option="bottom").fillna(-1).astype(int)
if geary_df is not None and len(geary_df) > 0:
    combined["geary_C"] = geary_df["geary_C"].reindex(combined.index)
    combined["geary_pval"] = geary_df["geary_pval"].reindex(combined.index) if "geary_pval" in geary_df.columns else np.nan
    # Geary's C: lower = more spatial structure → ascending rank
    combined["geary_rank"] = combined["geary_C"].rank(ascending=True, na_option="bottom").fillna(-1).astype(int)
if sepal_df is not None and len(sepal_df) > 0:
    combined["sepal_score"] = sepal_df["sepal_score"].reindex(combined.index)
    combined["sepal_rank"] = combined["sepal_score"].rank(ascending=False, na_option="bottom").fillna(-1).astype(int)

# Per-method top-N membership (boolean cols)
def _top_n_set(rank_col, n):
    if rank_col not in combined.columns: return set()
    return set(combined[combined[rank_col].fillna(99999) <= n].index)

moran_top = _top_n_set("moran_rank", ${topN})
geary_top = _top_n_set("geary_rank", ${topN})
sepal_top = _top_n_set("sepal_rank", ${topN})

combined["in_moran_top"] = combined.index.isin(moran_top)
combined["in_geary_top"] = combined.index.isin(geary_top)
combined["in_sepal_top"] = combined.index.isin(sepal_top)
combined["n_methods_top"] = combined[["in_moran_top", "in_geary_top", "in_sepal_top"]].sum(axis=1)
combined["robust"] = combined["n_methods_top"] >= ${minMethods}

# Sort by n_methods_top desc, then by moran_I desc as tiebreaker
sort_cols = ["n_methods_top"]
if "moran_I" in combined.columns: sort_cols.append("moran_I")
combined = combined.sort_values(sort_cols, ascending=[False] + [False] * (len(sort_cols) - 1))

# Round numeric cols for display
for col in ["moran_I", "moran_pval", "geary_C", "geary_pval", "sepal_score"]:
    if col in combined.columns:
        combined[col] = combined[col].round(4)
combined.reset_index().to_csv("top_svgs.csv", index=False)

n_moran = len(moran_top)
n_geary = len(geary_top)
n_sepal = len(sepal_top)
n_robust = int(combined["robust"].sum())
top_robust = combined[combined["robust"]].head(10).index.tolist()
print(f"  Moran top-{${topN}}: {n_moran}, Geary top-{${topN}}: {n_geary}, Sepal top-{${topN}}: {n_sepal}")
print(f"  robust (≥${minMethods} methods): {n_robust}, top-10: {top_robust}")

# ============================================================
# Plot 1: parent's cluster overlay (context)
# ============================================================
report_progress(88, "Plot 1/4: 父分析 cluster 上下文 ...")
try:
    if "leiden" in adata.obs:
        sc.pl.spatial(adata, color="leiden", spot_size=1.5 if not has_image else None,
                      img_key="hires" if has_image else None, show=False, legend_loc="right margin",
                      title="Parent clusters (context)")
        plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    else:
        coords = adata.obsm["spatial"]
        fig, ax = plt.subplots(figsize=(6, 6))
        ax.scatter(coords[:, 0], coords[:, 1], s=4, c="#9ca3af")
        ax.set_aspect("equal"); ax.invert_yaxis()
        ax.set_title("Spatial layout"); ax.axis("off")
        plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
        plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"context plot fail:\\n{str(e)[:80]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_001_spatial_clusters.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 2: Top robust SVGs (2x2 spatial expression)
# ============================================================
report_progress(91, "Plot 2/4: Top robust SVGs 空间分布 ...")
plot_genes = top_robust[:4] if len(top_robust) >= 4 else (
    list(moran_top)[:4] if len(moran_top) >= 4 else combined.head(4).index.tolist()
)
if len(plot_genes) > 0:
    try:
        sc.pl.spatial(adata, color=plot_genes, img_key="hires" if has_image else None,
                      spot_size=1.5 if not has_image else None,
                      ncols=2, show=False, cmap="viridis")
        plt.savefig("plot_002_top_robust_svgs.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    except Exception as e:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, f"plot top SVGs fail:\\n{str(e)[:80]}", ha="center", va="center"); ax.axis("off")
        plt.savefig("plot_002_top_robust_svgs.png", dpi=150, bbox_inches="tight")
        plt.close("all")
else:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, "no robust SVGs found", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_002_top_robust_svgs.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 3: 3-way Venn diagram of top-N from each method
# ============================================================
report_progress(93, "Plot 3/4: 三方法 top-N 重叠 Venn ...")
try:
    from matplotlib_venn import venn3
    fig, ax = plt.subplots(figsize=(7, 6))
    venn3([moran_top, geary_top, sepal_top],
          set_labels=("Moran's I", "Geary's C", "Sepal"),
          ax=ax)
    ax.set_title(f"Top-${topN} overlap (n_robust={n_robust} ≥${minMethods} methods)")
    plt.savefig("plot_003_method_venn.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except ImportError:
    # matplotlib_venn not installed — fallback: 3-bar plot of method sizes
    fig, ax = plt.subplots(figsize=(7, 4))
    methods = ["Moran's I", "Geary's C", "Sepal"]
    counts = [n_moran, n_geary, n_sepal]
    ax.bar(methods, counts, color=["#dc2626", "#2563eb", "#16a34a"])
    ax.set_ylabel(f"Top-${topN} genes detected")
    ax.set_title("SVG method comparison")
    for i, c in enumerate(counts):
        ax.text(i, c + 0.5, str(c), ha="center")
    plt.savefig("plot_003_method_venn.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"venn fail:\\n{str(e)[:80]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_003_method_venn.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 4: Score correlation (Moran I vs Sepal score, colored by n_methods_top)
# ============================================================
report_progress(95, "Plot 4/4: 方法 score 相关性散点 ...")
try:
    fig, ax = plt.subplots(figsize=(7, 6))
    if "moran_I" in combined.columns and "sepal_score" in combined.columns:
        valid = combined.dropna(subset=["moran_I", "sepal_score"])
        sc_plot = ax.scatter(valid["moran_I"], valid["sepal_score"], c=valid["n_methods_top"],
                              cmap="viridis", s=12, alpha=0.6)
        plt.colorbar(sc_plot, ax=ax, label="# methods top-${topN}")
        # Label top-5 robust
        for g in top_robust[:5]:
            if g in valid.index:
                row = valid.loc[g]
                ax.annotate(g, (row["moran_I"], row["sepal_score"]), fontsize=8, alpha=0.8)
        ax.set_xlabel("Moran's I (higher = more spatial structure)")
        ax.set_ylabel("Sepal score (higher = more patterned)")
        ax.set_title("Method score correlation")
    elif "moran_I" in combined.columns and "geary_C" in combined.columns:
        valid = combined.dropna(subset=["moran_I", "geary_C"])
        sc_plot = ax.scatter(valid["moran_I"], valid["geary_C"], c=valid["n_methods_top"],
                              cmap="viridis", s=12, alpha=0.6)
        plt.colorbar(sc_plot, ax=ax, label="# methods top-${topN}")
        ax.set_xlabel("Moran's I")
        ax.set_ylabel("Geary's C (lower = more spatial)")
        ax.set_title("Moran vs Geary")
    else:
        ax.text(0.5, 0.5, "Insufficient method results for scatter", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_004_score_corr.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"corr plot fail:\\n{str(e)[:80]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_004_score_corr.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Save .h5ad + obs/var tables (mirrors spatial_standard contract)
# ============================================================
report_progress(97, "保存 .h5ad + summary.json ...")
adata.uns["svg_results"] = {
    "moran_top": list(moran_top),
    "geary_top": list(geary_top),
    "sepal_top": list(sepal_top),
    "robust": [g for g in combined[combined["robust"]].index],
    "n_genes_tested": len(test_genes),
    "params": {"topN": ${topN}, "minMethods": ${minMethods}, "nPerms": ${nPerms}},
}
adata.write("result_spatial.h5ad")

# obs/var tables for /spatial 数据预览 tab (frontend uses CsvTable)
try:
    import scipy.sparse as sp
    obs = adata.obs.copy()
    obs.insert(0, "cell_id", obs.index.astype(str))
    if "spatial" in adata.obsm:
        coords = adata.obsm["spatial"]
        obs["spatial_x"] = coords[:, 0]
        obs["spatial_y"] = coords[:, 1]
    for col in obs.columns:
        if obs[col].dtype.kind == "f":
            obs[col] = obs[col].round(3)
    obs.to_csv("metadata.csv", index=False)

    X = adata.X
    if sp.issparse(X):
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    else:
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    var = adata.var.copy()
    var.insert(0, "gene_symbol", var.index.astype(str))
    var["mean_expression"] = np.round(mean_expr, 4)
    var["pct_spots"] = np.round(pct_expr, 2)
    # Annotate var with method ranks for cross-ref convenience
    if "moran_rank" in combined.columns:
        var["moran_rank"] = combined["moran_rank"].reindex(var.index).fillna(-1).astype(int)
    if "geary_rank" in combined.columns:
        var["geary_rank"] = combined["geary_rank"].reindex(var.index).fillna(-1).astype(int)
    if "sepal_rank" in combined.columns:
        var["sepal_rank"] = combined["sepal_rank"].reindex(var.index).fillna(-1).astype(int)
    if "n_methods_top" in combined.columns:
        var["n_methods_top"] = combined["n_methods_top"].reindex(var.index).fillna(0).astype(int)
    var = var.sort_values("mean_expression", ascending=False)
    var.to_csv("features.csv", index=False)
    print(f"  ✓ metadata.csv: {len(obs)} spots, features.csv: {len(var)} genes")
except Exception as _e:
    print(f"[meta-export] WARN: {_e}")

summary = {
    "n_spots": int(n_spots),
    "n_genes": int(n_genes_total),
    "n_genes_tested": int(len(test_genes)),
    "n_moran_top": int(n_moran),
    "n_geary_top": int(n_geary),
    "n_sepal_top": int(n_sepal),
    "n_robust": int(n_robust),
    "min_methods": ${minMethods},
    "top_robust": top_robust,
}
with open("summary.json", "w") as f:
    json.dump(summary, f, indent=2)

# ============================================================
# 报告 HTML + manifest.json (W4-B, 2026-05-29)
# ============================================================
report_progress(98, "生成 HTML 报告 + manifest.json ...")
import base64
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))
template_candidates = [
    os.path.join(parent_dir, "report-template.html"),
    "/app/data/biof3-tool-jobs/_templates/spatial-svg-report-template.html",
    "/app/data/biof3-py-tmp/_templates/spatial-svg-report-template.html",
]
template_path = None
for p in template_candidates:
    if os.path.isfile(p):
        template_path = p
        break
if template_path:
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()
        for fname in ["plot_001_spatial_clusters.png", "plot_002_top_robust_svgs.png",
                       "plot_003_method_venn.png", "plot_004_score_corr.png"]:
            if os.path.isfile(fname):
                with open(fname, "rb") as fp:
                    b64 = base64.b64encode(fp.read()).decode("ascii")
                html = html.replace("{{" + fname + "}}", f"data:image/png;base64,{b64}")
        wechat_qr = ""
        for qr_src in [
            "/app/data/biof3-tool-jobs/_templates/wechat-qr.b64",
            "/app/data/biof3-py-tmp/_templates/wechat-qr.b64",
        ]:
            if os.path.isfile(qr_src):
                with open(qr_src) as fp:
                    wechat_qr = fp.read().strip()
                break
        html = html.replace("{{WECHAT_QR_BASE64}}", wechat_qr)
        replacements = {
            "{{n_spots}}": str(n_spots),
            "{{n_genes}}": str(n_genes_total),
            "{{n_genes_tested}}": str(len(test_genes)),
            "{{n_moran_top}}": str(n_moran),
            "{{n_geary_top}}": str(n_geary),
            "{{n_sepal_top}}": str(n_sepal),
            "{{n_robust}}": str(n_robust),
            "{{min_methods}}": str(${minMethods}),
            "{{topN}}": str(${topN}),
            "{{nPerms}}": str(${nPerms}),
            "{{top_robust_list}}": ", ".join(top_robust[:10]) if top_robust else "—",
        }
        for k, v in replacements.items():
            html = html.replace(k, v)
        with open("report.html", "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  报告 HTML 写入成功: {os.path.getsize('report.html')/1024:.1f} KB")
    except Exception as e:
        print(f"  ⚠️ 报告生成失败: {e}")
else:
    print(f"  ⚠️ 未找到报告模板: {template_candidates}")

manifest = {
    "files": [
        {"name": "plot_001_spatial_clusters.png", "type": "plot",  "label": "父分析 cluster 上下文"},
        {"name": "plot_002_top_robust_svgs.png",  "type": "plot",  "label": "Top robust SVGs 空间分布"},
        {"name": "plot_003_method_venn.png",      "type": "plot",  "label": "三方法 top-N Venn"},
        {"name": "plot_004_score_corr.png",       "type": "plot",  "label": "方法间 score 相关性"},
        {"name": "top_svgs.csv",                  "type": "table", "label": "Top SVGs (3 法合并)"},
        {"name": "metadata.csv",                  "type": "table", "label": "Spot 元数据"},
        {"name": "features.csv",                  "type": "table", "label": "基因特征 + 方法 rank"},
        {"name": "result_spatial.h5ad",           "type": "file",  "label": "结果 AnnData"},
        {"name": "summary.json",                  "type": "file",  "label": "分析摘要"},
        {"name": "report.html",                   "type": "file",  "label": "解读报告 HTML"},
    ],
    "summary": summary,
}
if not os.path.isfile("report.html"):
    manifest["files"] = [f for f in manifest["files"] if f["name"] != "report.html"]
with open("manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

report_progress(100, "SVG 分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Spatial Deconvolution (W4-A, 2026-05-28)
//
// Tangram-based cell type deconvolution per spot.
// Uses sq.datasets.sc_mouse_cortex() (Tasic 2018, 21k cells × 22k genes,
// pre-annotated with cell_subclass: L5 IT / Vip / Pvalb / Sst / L6 IT / Astro / ...)
// as the default reference. Future param: allow user to specify ossRefUrl.
//
// Algorithm:
//   1. Load parent spatial AnnData (from cache → no re-QC)
//   2. Load reference sc dataset
//   3. Find shared genes; pick training genes (top-N by mean expression in sc)
//   4. tg.pp_adatas → tg.map_cells_to_space (CPU mode, ~few minutes for ~2700 spots)
//   5. tg.project_cell_annotations → spot × cell_type abundance
//   6. Output: per-spot dominant cell type + abundance matrix + 4 plots
//
// Output (mirrors spatial_standard contract):
//   - plot_001_dominant_celltype.png    (per spot: top cell type colored, on tissue)
//   - plot_002_top_celltypes_grid.png   (top-4 cell types' abundance heatmap, 2×2 spatial)
//   - plot_003_celltype_proportion.png  (overall cell type composition stacked bar)
//   - plot_004_colocalization.png       (cell-type × cell-type co-localization heatmap)
//   - cell_type_abundance.csv           (spots × cell_types abundance)
//   - result_spatial.h5ad               (parent AnnData augmented with obsm['tangram_ct_pred'])
//   - metadata.csv / features.csv
//   - summary.json                      ({n_spots, n_celltypes, n_training_genes, top_celltypes, ...})
// ============================================================

function generateSpatialDeconvScript(
  { params, ossInputUrl, outputDir, parentCachePath },
  progressHelper
) {
  const {
    nTrainingGenes = 1000, // shared HVG used for Tangram training
    refLabelKey = 'cell_subclass', // sc_mouse_cortex has cell_subclass
    minSpotsPerCellType = 10, // skip cell types that map to too few spots in plotting
    maxRefCells = 8000, // W4-B: 下采样参考集上限，防 Tangram CPU 训练 OOM（8g 容器）
  } = params || {};

  // 3 入口模式：父分析缓存（/spatial 链） / OSS 下载（内部任务） / jobDir 上传（/tools 单次任务）
  const loadBlock = parentCachePath
    ? `report_progress(10, "从父分析缓存加载 result_spatial.h5ad ...")
adata_st = sc.read_h5ad("${parentCachePath}")
print(f"  spatial: {adata_st.n_obs} spots × {adata_st.n_vars} genes")`
    : ossInputUrl
      ? `report_progress(10, "下载父分析结果...")
import urllib.request
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata_st = sc.read_h5ad("input.h5ad")
print(f"  spatial: {adata_st.n_obs} spots × {adata_st.n_vars} genes")`
      : `report_progress(10, "查找 /tools 上传的 .h5ad 文件 ...")
import shutil, glob
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))  # jobDir
candidates = []
for name in ["adata", "input.h5ad", "input.h5"]:
    p = os.path.join(parent_dir, name)
    if os.path.isfile(p) and os.path.getsize(p) > 1000:
        candidates.append(p)
if not candidates:
    candidates = sorted(glob.glob(os.path.join(parent_dir, "*.h5ad")) + glob.glob(os.path.join(parent_dir, "*.h5")))
if not candidates:
    raise FileNotFoundError(f"未在 {parent_dir} 找到 h5ad 输入。期望 input id 'adata' 或文件后缀 .h5ad/.h5")
src = candidates[0]
dst = os.path.join("${outputDir}", "input.h5ad")
if src != dst:
    shutil.copy(src, dst)
adata_st = sc.read_h5ad(dst)
print(f"  loaded from /tools upload: {src} → {adata_st.n_obs} spots × {adata_st.n_vars} genes")`;

  return `
import scanpy as sc
import squidpy as sq
import tangram as tg
import numpy as np
import pandas as pd
import torch
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import json, os
import anndata as ad

try:
    ad.settings.allow_write_nullable_strings = True
except Exception:
    pass

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False, facecolor="white")

${loadBlock}

# Sanity checks
if "spatial" not in adata_st.obsm:
    raise ValueError("缺少 obsm['spatial'] — 输入需含空间坐标")

# /tools 上传可能是原始 counts；Tangram 需要 normalized 表达矩阵
if "log1p" not in adata_st.uns:
    report_progress(15, "检测到原始 counts，自动 normalize_total + log1p ...")
    sc.pp.normalize_total(adata_st, target_sum=1e4)
    sc.pp.log1p(adata_st)

has_image = "spatial" in adata_st.uns and any("images" in v for v in adata_st.uns["spatial"].values())

# ============================================================
# Load reference single-cell dataset
# ============================================================
report_progress(20, "加载单细胞参考数据集 (sc_mouse_cortex, ~21k cells)...")
# W4-B (2026-05-29): 把 squidpy/scanpy 数据集缓存到共享目录，避免每个 job 重下 3.25GB。
# biof3-py-tmp 已 mount 进容器（持久 + 跨 job 共享）。
import scanpy as _sc_cfg
try:
    _shared_ds = "/app/data/biof3-py-tmp/_datasets"
    os.makedirs(_shared_ds, exist_ok=True)
    _sc_cfg.settings.datasetdir = _shared_ds
except Exception as _e:
    print(f"  [datasetdir] WARN: {_e}")
adata_sc = sq.datasets.sc_mouse_cortex()
print(f"  reference: {adata_sc.n_obs} cells × {adata_sc.n_vars} genes")

label_key = "${refLabelKey}"
if label_key not in adata_sc.obs:
    # Fallback to cell_class if cell_subclass missing
    label_key = "cell_class" if "cell_class" in adata_sc.obs else adata_sc.obs.columns[0]
    print(f"  WARN: requested label '${refLabelKey}' missing, using '{label_key}' instead")

cell_types_ref = adata_sc.obs[label_key].value_counts()
print(f"  cell types in reference ({len(cell_types_ref)}): {list(cell_types_ref.head(10).index)}")

# ============================================================
# W4-B (2026-05-29): 下采样参考集，防 Tangram CPU 训练 OOM。
# 21k cells × 1000 genes 在 cells 模式下构建 dense 映射张量，8g 容器会 OOM
# （实测 total-vm 飙到 25GB 被 kernel OOM-killed）。按 cell type 分层下采样到
# maxRefCells，保留所有细胞类型代表性，对解卷积质量影响小（Tangram 官方教程
# 也常用 ~数千 cells 参考）。
# ============================================================
if adata_sc.n_obs > ${maxRefCells}:
    report_progress(24, f"参考集下采样 {adata_sc.n_obs} → {${maxRefCells}} cells（防 OOM）...")
    import numpy as _np
    rng = _np.random.default_rng(0)
    frac = ${maxRefCells} / adata_sc.n_obs
    keep_idx = []
    for ct, grp in adata_sc.obs.groupby(label_key, observed=True):
        idx = grp.index.to_numpy()
        n_keep = max(1, int(round(len(idx) * frac)))
        n_keep = min(n_keep, len(idx))
        keep_idx.extend(rng.choice(idx, size=n_keep, replace=False).tolist())
    adata_sc = adata_sc[keep_idx, :].copy()
    print(f"  reference subsampled → {adata_sc.n_obs} cells ({adata_sc.obs[label_key].nunique()} types kept)")

# ============================================================
# Pick training genes — shared between sc reference and spatial
# ============================================================
report_progress(28, "挑选 training genes (shared HVG) ...")
# Lowercase gene names for case-insensitive matching (mouse genes are typically Title-case in both,
# but be defensive)
sc_genes = set(adata_sc.var.index.astype(str))
st_genes = set(adata_st.var.index.astype(str))
shared = sc_genes & st_genes
print(f"  shared genes: {len(shared)}")
if len(shared) < 200:
    raise ValueError(f"Spatial 与 sc reference 仅 {len(shared)} 个共有基因，太少（< 200）。请确认两者物种一致。")

# Pick top-N by sc reference mean expression among shared genes
sc_mean = pd.Series(np.asarray(adata_sc.X.mean(axis=0)).flatten(), index=adata_sc.var.index)
shared_genes_sorted = sc_mean.loc[list(shared)].sort_values(ascending=False).index.tolist()
training_genes = shared_genes_sorted[:${nTrainingGenes}]
print(f"  training genes: {len(training_genes)} (top-{${nTrainingGenes}} by sc mean expression)")

# ============================================================
# Tangram pre-processing + mapping
# ============================================================
report_progress(38, "Tangram pp_adatas + map_cells_to_space ...")
# Subset both to training genes for faster mapping
ad_sc_sub = adata_sc[:, training_genes].copy()
ad_st_sub = adata_st[:, training_genes].copy()
# Tangram needs raw / normalized X; sc_mouse_cortex is already log-normalized.
# Spatial is also log-normalized after spatial_standard.

tg.pp_adatas(ad_sc_sub, ad_st_sub, genes=training_genes)
# Map: cells mode (each spatial spot is a "voxel" / target).
# Tangram 1.0.4 + pandas 2.x has a 已知 bug: tg.pp_adatas writes
# obs["uniform_density"] / obs["rna_count_based_density"] as pandas Series, then
# Tangram passes them to torch.tensor(d, ...) which fails with
# "could not determine the shape of object type 'Series'".
# (奇怪的是单独 torch.tensor(Series) 测试能跑过，但在 Tangram 流程里就炸；
#  推测 anndata Series 走特殊数组接口跟 torch 的 __array__ 协议冲突。)
#
# Workaround: monkey-patch torch.tensor 检测 pandas Series 自动 .to_numpy()。
# 限定在本任务内（直接在 globals 替换），不影响其他任务。
_orig_torch_tensor = torch.tensor
def _torch_tensor_safe(data, *args, **kwargs):
    if isinstance(data, pd.Series):
        data = data.to_numpy()
    return _orig_torch_tensor(data, *args, **kwargs)
torch.tensor = _torch_tensor_safe

ad_map = tg.map_cells_to_space(
    ad_sc_sub, ad_st_sub,
    mode="cells",
    density_prior="uniform",
    num_epochs=300,
    device="cpu",
)
torch.tensor = _orig_torch_tensor  # restore to be polite
print(f"  mapping done: {ad_map.shape}")  # cells × spots

# ============================================================
# Project cell annotations → per-spot cell type abundance
# ============================================================
report_progress(70, "Project cell annotations → 每 spot 细胞类型丰度 ...")
tg.project_cell_annotations(ad_map, adata_st, annotation=label_key)
# After this, adata_st.obsm["tangram_ct_pred"] is a (n_spots × n_celltypes) DataFrame
ct_pred = adata_st.obsm["tangram_ct_pred"]
if isinstance(ct_pred, np.ndarray):
    # Some versions return ndarray; rebuild DataFrame
    ct_pred = pd.DataFrame(ct_pred, index=adata_st.obs.index, columns=sorted(adata_sc.obs[label_key].unique()))
    adata_st.obsm["tangram_ct_pred"] = ct_pred

# Normalize to proportions per spot (sum=1)
ct_norm = ct_pred.div(ct_pred.sum(axis=1).replace(0, np.nan), axis=0).fillna(0)
n_celltypes = ct_norm.shape[1]
print(f"  cell types predicted: {n_celltypes}")

# Dominant cell type per spot
dominant = ct_norm.idxmax(axis=1)
adata_st.obs["dominant_celltype"] = pd.Categorical(dominant.values)
ct_counts = pd.Series(dominant.values).value_counts()
top_celltypes = ct_counts.head(8).index.tolist()
print(f"  top dominant cell types: {top_celltypes[:5]}")

# Save abundance table
abundance_df = ct_norm.copy()
abundance_df.insert(0, "cell_id", abundance_df.index.astype(str))
abundance_df.to_csv("cell_type_abundance.csv", index=False)

# ============================================================
# Plot 1: dominant cell type per spot (on tissue)
# ============================================================
report_progress(82, "Plot 1/4: 每 spot 主要细胞类型 ...")
try:
    sc.pl.spatial(adata_st, color="dominant_celltype", img_key="hires" if has_image else None,
                  spot_size=1.5 if not has_image else None,
                  show=False, legend_loc="right margin",
                  title="Dominant cell type per spot (Tangram)")
    plt.savefig("plot_001_dominant_celltype.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_001_dominant_celltype.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 2: Top-4 cell types' abundance heatmap (2x2 spatial)
# ============================================================
report_progress(88, "Plot 2/4: Top 细胞类型空间丰度 ...")
plot_cts = top_celltypes[:4] if len(top_celltypes) >= 4 else top_celltypes
if len(plot_cts) > 0:
    # Add abundance columns to obs for sc.pl.spatial to color by
    for ct in plot_cts:
        col_name = f"abund_{ct}".replace(" ", "_").replace("/", "_")
        adata_st.obs[col_name] = ct_norm[ct].values
    cols_to_plot = [f"abund_{ct}".replace(" ", "_").replace("/", "_") for ct in plot_cts]
    try:
        sc.pl.spatial(adata_st, color=cols_to_plot, img_key="hires" if has_image else None,
                      spot_size=1.5 if not has_image else None,
                      ncols=2, show=False, cmap="Reds")
        plt.savefig("plot_002_top_celltypes_grid.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    except Exception as e:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
        plt.savefig("plot_002_top_celltypes_grid.png", dpi=150, bbox_inches="tight")
        plt.close("all")
else:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, "no cell types found", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_002_top_celltypes_grid.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 3: Cell type composition (stacked bar / pie)
# ============================================================
report_progress(91, "Plot 3/4: 整体细胞类型组成 ...")
try:
    fig, ax = plt.subplots(figsize=(8, 5))
    # Top 10 + "其他"
    top_n = 10
    if len(ct_counts) > top_n:
        top_part = ct_counts.head(top_n)
        other_count = ct_counts.iloc[top_n:].sum()
        plot_data = pd.concat([top_part, pd.Series([other_count], index=["其他"])])
    else:
        plot_data = ct_counts
    colors = plt.cm.tab20.colors[:len(plot_data)]
    bars = ax.barh(plot_data.index[::-1], plot_data.values[::-1], color=colors[::-1])
    ax.set_xlabel("# spots (dominant)")
    ax.set_title(f"Cell type composition ({len(ct_norm)} spots)")
    for bar, v in zip(bars, plot_data.values[::-1]):
        ax.text(v + 5, bar.get_y() + bar.get_height() / 2, f"{int(v)} ({v / len(ct_norm) * 100:.1f}%)",
                va="center", fontsize=8)
    plt.tight_layout()
    plt.savefig("plot_003_celltype_proportion.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_003_celltype_proportion.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 4: Cell-type × cell-type co-localization (correlation of abundances across spots)
# ============================================================
report_progress(94, "Plot 4/4: 细胞类型共定位 heatmap ...")
try:
    # Filter to cell types with non-trivial presence
    ct_keep = [c for c in ct_norm.columns if (ct_norm[c] > 0.05).sum() >= ${minSpotsPerCellType}]
    if len(ct_keep) < 2:
        ct_keep = list(ct_norm.columns)[:8]
    coloc_corr = ct_norm[ct_keep].corr()

    fig, ax = plt.subplots(figsize=(max(7, len(ct_keep) * 0.5), max(6, len(ct_keep) * 0.45)))
    im = ax.imshow(coloc_corr.values, cmap="RdBu_r", vmin=-1, vmax=1, aspect="auto")
    ax.set_xticks(range(len(ct_keep)))
    ax.set_yticks(range(len(ct_keep)))
    ax.set_xticklabels(ct_keep, rotation=60, ha="right", fontsize=8)
    ax.set_yticklabels(ct_keep, fontsize=8)
    plt.colorbar(im, ax=ax, label="Pearson r (across spots)")
    ax.set_title("Cell-type co-localization correlation")
    plt.tight_layout()
    plt.savefig("plot_004_colocalization.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"coloc plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_004_colocalization.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Save .h5ad + obs/var tables
# ============================================================
report_progress(96, "保存 .h5ad + summary.json ...")
# Drop the abundance columns we added to obs (clutters the obs table)
# but keep dominant_celltype
abund_cols = [c for c in adata_st.obs.columns if c.startswith("abund_")]
adata_st.obs.drop(columns=abund_cols, inplace=True, errors="ignore")
adata_st.uns["tangram_deconv"] = {
    "label_key": label_key,
    "n_celltypes": int(n_celltypes),
    "n_training_genes": int(len(training_genes)),
    "top_dominant": top_celltypes[:10],
}
adata_st.write("result_spatial.h5ad")

# obs/var tables for /spatial 数据预览 tab
try:
    import scipy.sparse as sp
    obs = adata_st.obs.copy()
    obs.insert(0, "cell_id", obs.index.astype(str))
    if "spatial" in adata_st.obsm:
        coords = adata_st.obsm["spatial"]
        obs["spatial_x"] = coords[:, 0]
        obs["spatial_y"] = coords[:, 1]
    for col in obs.columns:
        if obs[col].dtype.kind == "f":
            obs[col] = obs[col].round(3)
    obs.to_csv("metadata.csv", index=False)

    X = adata_st.X
    if sp.issparse(X):
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    else:
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    var = adata_st.var.copy()
    var.insert(0, "gene_symbol", var.index.astype(str))
    var["mean_expression"] = np.round(mean_expr, 4)
    var["pct_spots"] = np.round(pct_expr, 2)
    var = var.sort_values("mean_expression", ascending=False)
    var.to_csv("features.csv", index=False)
    print(f"  ✓ metadata.csv: {len(obs)} spots, features.csv: {len(var)} genes")
except Exception as _e:
    print(f"[meta-export] WARN: {_e}")

summary = {
    "n_spots": int(adata_st.n_obs),
    "n_genes": int(adata_st.n_vars),
    "n_celltypes": int(n_celltypes),
    "n_training_genes": int(len(training_genes)),
    "label_key": label_key,
    "top_celltypes": top_celltypes[:10],
    "method": "tangram",
}
with open("summary.json", "w") as f:
    json.dump(summary, f, indent=2)

# ============================================================
# 报告 HTML + manifest.json (W4-B, 2026-05-29)
# ============================================================
report_progress(98, "生成 HTML 报告 + manifest.json ...")
import base64
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))
template_candidates = [
    os.path.join(parent_dir, "report-template.html"),
    "/app/data/biof3-tool-jobs/_templates/spatial-deconv-report-template.html",
    "/app/data/biof3-py-tmp/_templates/spatial-deconv-report-template.html",
]
template_path = None
for p in template_candidates:
    if os.path.isfile(p):
        template_path = p
        break
if template_path:
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()
        for fname in ["plot_001_dominant_celltype.png", "plot_002_top_celltypes_grid.png",
                       "plot_003_celltype_proportion.png", "plot_004_colocalization.png"]:
            if os.path.isfile(fname):
                with open(fname, "rb") as fp:
                    b64 = base64.b64encode(fp.read()).decode("ascii")
                html = html.replace("{{" + fname + "}}", f"data:image/png;base64,{b64}")
        wechat_qr = ""
        for qr_src in [
            "/app/data/biof3-tool-jobs/_templates/wechat-qr.b64",
            "/app/data/biof3-py-tmp/_templates/wechat-qr.b64",
        ]:
            if os.path.isfile(qr_src):
                with open(qr_src) as fp:
                    wechat_qr = fp.read().strip()
                break
        html = html.replace("{{WECHAT_QR_BASE64}}", wechat_qr)
        replacements = {
            "{{n_spots}}": str(adata_st.n_obs),
            "{{n_genes}}": str(adata_st.n_vars),
            "{{n_celltypes}}": str(n_celltypes),
            "{{n_training_genes}}": str(len(training_genes)),
            "{{label_key}}": label_key,
            "{{top_celltypes_list}}": ", ".join(top_celltypes[:10]) if top_celltypes else "—",
        }
        for k, v in replacements.items():
            html = html.replace(k, v)
        with open("report.html", "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  报告 HTML 写入成功: {os.path.getsize('report.html')/1024:.1f} KB")
    except Exception as e:
        print(f"  ⚠️ 报告生成失败: {e}")
else:
    print(f"  ⚠️ 未找到报告模板: {template_candidates}")

manifest = {
    "files": [
        {"name": "plot_001_dominant_celltype.png",   "type": "plot",  "label": "每 spot 主要细胞类型"},
        {"name": "plot_002_top_celltypes_grid.png",  "type": "plot",  "label": "Top 4 细胞类型空间丰度"},
        {"name": "plot_003_celltype_proportion.png", "type": "plot",  "label": "整体细胞类型组成"},
        {"name": "plot_004_colocalization.png",      "type": "plot",  "label": "细胞类型共定位"},
        {"name": "cell_type_abundance.csv",          "type": "table", "label": "Spot × 细胞类型丰度"},
        {"name": "metadata.csv",                     "type": "table", "label": "Spot 元数据 + 主要细胞类型"},
        {"name": "features.csv",                     "type": "table", "label": "基因表达统计"},
        {"name": "result_spatial.h5ad",              "type": "file",  "label": "结果 AnnData"},
        {"name": "summary.json",                     "type": "file",  "label": "分析摘要"},
        {"name": "report.html",                      "type": "file",  "label": "解读报告 HTML"},
    ],
    "summary": summary,
}
if not os.path.isfile("report.html"):
    manifest["files"] = [f for f in manifest["files"] if f["name"] != "report.html"]
with open("manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

report_progress(100, "解卷积分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// Spatial Ligand-Receptor (W4-A, 2026-05-29)
//
// LIANA spatial-aware bivariate LR analysis on parent's result_spatial.h5ad.
// 相比传统的 cluster-level cellchat / cellphonedb，bivariate 方法直接在 spot 物理
// 邻居上算 LR pair 的 cosine 共现，不需要预先注释细胞类型 → 更适合 Visium 这类
// "每 spot 是细胞混合体" 的场景。
//
// Output (mirrors spatial_standard contract):
//   - plot_001_top_lr_significance.png  (top-15 LR pairs ranked by mean local score)
//   - plot_002_top_lr_spatial.png       (top-1 LR pair's per-spot score on tissue)
//   - plot_003_lr_score_distribution.png (boxplot of top-N LR scores)
//   - plot_004_top_lr_pairs_grid.png    (top-4 LR pairs as 2×2 spatial scatter)
//   - top_lr_pairs.csv                  (per-LR-pair: ligand, receptor, mean_score,
//                                        n_spots_above_threshold, ligand_props, receptor_props)
//   - lr_score_per_spot.csv             (spot × top-20 LR pair scores; for downstream)
//   - result_spatial.h5ad               (parent AnnData with uns['lr_results'] meta)
//   - metadata.csv / features.csv
//   - summary.json                      ({n_spots, n_lr_pairs_tested, n_significant, top_lr})
// ============================================================

function generateSpatialLrScript(
  { params, ossInputUrl, outputDir, parentCachePath },
  progressHelper
) {
  const {
    resourceName = 'mouseconsensus', // 'consensus' for human, 'mouseconsensus' for mouse
    localName = 'cosine', // bivariate similarity metric
    nPerms = 100, // permutations for significance
    topN = 20, // top-N LR pairs to extract / plot
    nzProp = 0.05, // min non-zero proportion of L or R
  } = params || {};

  // 3 入口模式：父分析缓存（/spatial 链） / OSS 下载（内部任务） / jobDir 上传（/tools 单次任务）
  const loadBlock = parentCachePath
    ? `report_progress(10, "从父分析缓存加载 result_spatial.h5ad ...")
adata = sc.read_h5ad("${parentCachePath}")
print(f"  loaded from cache: {adata.n_obs} spots × {adata.n_vars} genes")`
    : ossInputUrl
      ? `report_progress(10, "下载父分析结果...")
import urllib.request
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
print(f"  loaded from OSS: {adata.n_obs} spots × {adata.n_vars} genes")`
      : `report_progress(10, "查找 /tools 上传的 .h5ad 文件 ...")
import shutil, glob
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))  # jobDir
candidates = []
for name in ["adata", "input.h5ad", "input.h5"]:
    p = os.path.join(parent_dir, name)
    if os.path.isfile(p) and os.path.getsize(p) > 1000:
        candidates.append(p)
if not candidates:
    candidates = sorted(glob.glob(os.path.join(parent_dir, "*.h5ad")) + glob.glob(os.path.join(parent_dir, "*.h5")))
if not candidates:
    raise FileNotFoundError(f"未在 {parent_dir} 找到 h5ad 输入。期望 input id 'adata' 或文件后缀 .h5ad/.h5")
src = candidates[0]
dst = os.path.join("${outputDir}", "input.h5ad")
if src != dst:
    shutil.copy(src, dst)
adata = sc.read_h5ad(dst)
print(f"  loaded from /tools upload: {src} → {adata.n_obs} spots × {adata.n_vars} genes")
# /tools 上传的可能是原始 counts，下面会按 'log1p' in uns 自动判断是否需要标准化`;

  return `
import scanpy as sc
import squidpy as sq
import liana as li
import numpy as np
import pandas as pd
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import json, os
import anndata as ad

try:
    ad.settings.allow_write_nullable_strings = True
except Exception:
    pass

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False, facecolor="white")

${loadBlock}

# Sanity checks
if "spatial" not in adata.obsm:
    raise ValueError("缺少 obsm['spatial'] — 输入需含空间坐标")

# /tools 上传可能是原始 counts；LIANA bivariate 需要 normalized 表达
if "log1p" not in adata.uns:
    report_progress(15, "检测到原始 counts，自动 normalize_total + log1p ...")
    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)

# spatial_connectivities is required for bivariate; rebuild if missing
if "spatial_connectivities" not in adata.obsp:
    report_progress(20, "重建空间邻居图 (LIANA bivariate 需要 spatial_connectivities) ...")
    sq.gr.spatial_neighbors(adata, coord_type="generic", n_neighs=6)

n_spots = adata.n_obs
n_genes = adata.n_vars
has_image = "spatial" in adata.uns and any("images" in v for v in adata.uns["spatial"].values())

# ============================================================
# Run LIANA bivariate (returns AnnData of n_spots × n_lr_pairs)
# ============================================================
report_progress(30, f"LIANA bivariate ({${nPerms}} perms, resource={'${resourceName}'}) ...")
lr_result = li.mt.bivariate(
    adata,
    resource_name="${resourceName}",
    local_name="${localName}",
    n_perms=${nPerms},
    use_raw=False,
    nz_prop=${nzProp},
    verbose=False,
)
n_lr_pairs = lr_result.n_vars
print(f"  bivariate done: {n_lr_pairs} LR pairs scored across {lr_result.n_obs} spots")

# ============================================================
# Aggregate to per-LR-pair stats
# ============================================================
report_progress(60, "聚合 per-LR-pair 统计 ...")
import scipy.sparse as sp
X = lr_result.X
if sp.issparse(X):
    mean_scores = np.asarray(X.mean(axis=0)).flatten()
    # frac of spots where score > 0.5 (loose threshold for "active" LR)
    frac_active = np.asarray((X > 0.5).mean(axis=0)).flatten()
else:
    mean_scores = X.mean(axis=0)
    frac_active = (X > 0.5).mean(axis=0)

per_lr = lr_result.var.copy()
per_lr["mean_score"] = mean_scores
per_lr["frac_active"] = frac_active
# composite rank: spots where mean_score is high
per_lr = per_lr.sort_values("mean_score", ascending=False)
per_lr.reset_index().to_csv("top_lr_pairs.csv", index=False)
n_significant = int((per_lr["mean_score"] > 0.3).sum())
top_lr = per_lr.head(${topN})
print(f"  top-${topN} LR pairs: {list(top_lr.index[:5])}")

# Save spot × top-N LR scores for downstream
top_idx = [list(lr_result.var.index).index(i) for i in top_lr.index]
spot_lr_top = X[:, top_idx]
if sp.issparse(spot_lr_top):
    spot_lr_top = spot_lr_top.toarray()
spot_lr_df = pd.DataFrame(spot_lr_top, index=lr_result.obs.index, columns=top_lr.index)
spot_lr_df.insert(0, "cell_id", spot_lr_df.index.astype(str))
spot_lr_df.to_csv("lr_score_per_spot.csv", index=False)

# ============================================================
# Plot 1: Top-15 LR pairs significance bar (mean score)
# ============================================================
report_progress(75, "Plot 1/4: Top LR pairs significance ...")
try:
    top15 = per_lr.head(15)
    fig, ax = plt.subplots(figsize=(8, 6))
    bars = ax.barh(top15.index[::-1], top15["mean_score"][::-1].values,
                    color=plt.cm.viridis(np.linspace(0.2, 0.9, len(top15))[::-1]))
    ax.set_xlabel("Mean local LR score (across spots)")
    ax.set_title(f"Top-15 LR pairs (LIANA bivariate {'${localName}'} on {'${resourceName}'})")
    plt.tight_layout()
    plt.savefig("plot_001_top_lr_significance.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_001_top_lr_significance.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 2: Top-1 LR pair's per-spot score on tissue
# ============================================================
report_progress(82, "Plot 2/4: Top-1 LR pair 空间分布 ...")
top1_lr = top_lr.index[0]
try:
    # Inject score as obs column for plotting
    score_col = f"lr_{top1_lr.replace('^', '__')}".replace(" ", "_")
    adata.obs[score_col] = spot_lr_df[top1_lr].values
    sc.pl.spatial(adata, color=score_col, img_key="hires" if has_image else None,
                  spot_size=1.5 if not has_image else None,
                  show=False, cmap="Reds",
                  title=f"LR score: {top1_lr}")
    plt.savefig("plot_002_top_lr_spatial.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_002_top_lr_spatial.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 3: LR score distribution (boxplot) — see pair variance
# ============================================================
report_progress(88, "Plot 3/4: Top-${topN} LR scores 分布 boxplot ...")
try:
    fig, ax = plt.subplots(figsize=(max(8, ${topN} * 0.4), 5))
    data_to_plot = [spot_lr_df[lr].values for lr in top_lr.index]
    bp = ax.boxplot(data_to_plot, labels=top_lr.index, showfliers=False, patch_artist=True)
    for patch in bp["boxes"]:
        patch.set_facecolor("#0891b2")
        patch.set_alpha(0.6)
    ax.set_ylabel("Local LR score per spot")
    ax.set_title(f"Top-${topN} LR pair score distribution across {n_spots} spots")
    plt.xticks(rotation=60, ha="right", fontsize=8)
    plt.tight_layout()
    plt.savefig("plot_003_lr_score_distribution.png", dpi=150, bbox_inches="tight")
    plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_003_lr_score_distribution.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Plot 4: Top-4 LR pairs as 2×2 spatial scatter
# ============================================================
report_progress(93, "Plot 4/4: Top-4 LR pairs 空间分布 2×2 ...")
try:
    plot_lrs = top_lr.index[:4].tolist() if len(top_lr) >= 4 else top_lr.index.tolist()
    score_cols = []
    for lr in plot_lrs:
        col = f"lr_{lr.replace('^', '__')}".replace(" ", "_")
        adata.obs[col] = spot_lr_df[lr].values
        score_cols.append(col)
    if len(score_cols) > 0:
        sc.pl.spatial(adata, color=score_cols, img_key="hires" if has_image else None,
                      spot_size=1.5 if not has_image else None,
                      ncols=2, show=False, cmap="Reds")
        plt.savefig("plot_004_top_lr_pairs_grid.png", dpi=150, bbox_inches="tight")
        plt.close("all")
    else:
        fig, ax = plt.subplots(figsize=(6, 4))
        ax.text(0.5, 0.5, "no LR pairs to plot", ha="center", va="center"); ax.axis("off")
        plt.savefig("plot_004_top_lr_pairs_grid.png", dpi=150, bbox_inches="tight")
        plt.close("all")
except Exception as e:
    fig, ax = plt.subplots(figsize=(6, 4))
    ax.text(0.5, 0.5, f"plot fail:\\n{str(e)[:100]}", ha="center", va="center"); ax.axis("off")
    plt.savefig("plot_004_top_lr_pairs_grid.png", dpi=150, bbox_inches="tight")
    plt.close("all")

# ============================================================
# Save .h5ad + obs/var tables
# ============================================================
report_progress(96, "保存 .h5ad + summary.json ...")
# Drop obs columns we added for plotting (clutters table)
lr_obs_cols = [c for c in adata.obs.columns if c.startswith("lr_")]
adata.obs.drop(columns=lr_obs_cols, inplace=True, errors="ignore")
adata.uns["lr_results"] = {
    "method": "liana.bivariate",
    "resource": "${resourceName}",
    "local_name": "${localName}",
    "n_lr_pairs_tested": int(n_lr_pairs),
    "n_significant": int(n_significant),
    "top_lr_pairs": list(top_lr.index[:10]),
    "params": {"nPerms": ${nPerms}, "topN": ${topN}, "nzProp": ${nzProp}},
}
adata.write("result_spatial.h5ad")

# obs/var tables for /spatial 数据预览 tab
try:
    obs = adata.obs.copy()
    obs.insert(0, "cell_id", obs.index.astype(str))
    if "spatial" in adata.obsm:
        coords = adata.obsm["spatial"]
        obs["spatial_x"] = coords[:, 0]
        obs["spatial_y"] = coords[:, 1]
    for col in obs.columns:
        if obs[col].dtype.kind == "f":
            obs[col] = obs[col].round(3)
    obs.to_csv("metadata.csv", index=False)

    X = adata.X
    if sp.issparse(X):
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    else:
        mean_expr = np.asarray(X.mean(axis=0)).flatten()
        pct_expr = np.asarray((X > 0).mean(axis=0)).flatten() * 100
    var = adata.var.copy()
    var.insert(0, "gene_symbol", var.index.astype(str))
    var["mean_expression"] = np.round(mean_expr, 4)
    var["pct_spots"] = np.round(pct_expr, 2)
    var = var.sort_values("mean_expression", ascending=False)
    var.to_csv("features.csv", index=False)
    print(f"  ✓ metadata.csv: {len(obs)} spots, features.csv: {len(var)} genes")
except Exception as _e:
    print(f"[meta-export] WARN: {_e}")

summary = {
    "n_spots": int(n_spots),
    "n_genes": int(n_genes),
    "n_lr_pairs_tested": int(n_lr_pairs),
    "n_significant": int(n_significant),
    "method": "liana.bivariate",
    "resource": "${resourceName}",
    "local_name": "${localName}",
    "top_lr_pairs": list(top_lr.index[:10]),
}
with open("summary.json", "w") as f:
    json.dump(summary, f, indent=2)

# ============================================================
# 报告 HTML + manifest.json (W4-B, 2026-05-29)
# ============================================================
report_progress(98, "生成 HTML 报告 + manifest.json ...")
import base64
parent_dir = os.path.dirname("${outputDir}".rstrip("/"))
template_candidates = [
    os.path.join(parent_dir, "report-template.html"),
    "/app/data/biof3-tool-jobs/_templates/spatial-lr-report-template.html",
    "/app/data/biof3-py-tmp/_templates/spatial-lr-report-template.html",
]
template_path = None
for p in template_candidates:
    if os.path.isfile(p):
        template_path = p
        break
if template_path:
    try:
        with open(template_path, "r", encoding="utf-8") as f:
            html = f.read()
        for fname in ["plot_001_top_lr_significance.png", "plot_002_top_lr_spatial.png",
                       "plot_003_lr_score_distribution.png", "plot_004_top_lr_pairs_grid.png"]:
            if os.path.isfile(fname):
                with open(fname, "rb") as fp:
                    b64 = base64.b64encode(fp.read()).decode("ascii")
                html = html.replace("{{" + fname + "}}", f"data:image/png;base64,{b64}")
        wechat_qr = ""
        for qr_src in [
            "/app/data/biof3-tool-jobs/_templates/wechat-qr.b64",
            "/app/data/biof3-py-tmp/_templates/wechat-qr.b64",
        ]:
            if os.path.isfile(qr_src):
                with open(qr_src) as fp:
                    wechat_qr = fp.read().strip()
                break
        html = html.replace("{{WECHAT_QR_BASE64}}", wechat_qr)
        replacements = {
            "{{n_spots}}": str(n_spots),
            "{{n_genes}}": str(n_genes),
            "{{n_lr_pairs_tested}}": str(n_lr_pairs),
            "{{n_significant}}": str(n_significant),
            "{{resource}}": "${resourceName}",
            "{{local_name}}": "${localName}",
            "{{nPerms}}": str(${nPerms}),
            "{{topN}}": str(${topN}),
            "{{top_lr_pairs_list}}": ", ".join(list(top_lr.index[:10])) if len(top_lr) > 0 else "—",
        }
        for k, v in replacements.items():
            html = html.replace(k, v)
        with open("report.html", "w", encoding="utf-8") as f:
            f.write(html)
        print(f"  报告 HTML 写入成功: {os.path.getsize('report.html')/1024:.1f} KB")
    except Exception as e:
        print(f"  ⚠️ 报告生成失败: {e}")
else:
    print(f"  ⚠️ 未找到报告模板: {template_candidates}")

manifest = {
    "files": [
        {"name": "plot_001_top_lr_significance.png",   "type": "plot",  "label": "Top LR pairs 显著性"},
        {"name": "plot_002_top_lr_spatial.png",        "type": "plot",  "label": "Top-1 LR 空间分布"},
        {"name": "plot_003_lr_score_distribution.png", "type": "plot",  "label": "Top LR 分布 boxplot"},
        {"name": "plot_004_top_lr_pairs_grid.png",     "type": "plot",  "label": "Top 4 LR 空间分布"},
        {"name": "top_lr_pairs.csv",                   "type": "table", "label": "Per-LR-pair 统计"},
        {"name": "lr_score_per_spot.csv",              "type": "table", "label": "Spot × Top-N LR 分数"},
        {"name": "metadata.csv",                       "type": "table", "label": "Spot 元数据"},
        {"name": "features.csv",                       "type": "table", "label": "基因表达统计"},
        {"name": "result_spatial.h5ad",                "type": "file",  "label": "结果 AnnData"},
        {"name": "summary.json",                       "type": "file",  "label": "分析摘要"},
        {"name": "report.html",                        "type": "file",  "label": "解读报告 HTML"},
    ],
    "summary": summary,
}
if not os.path.isfile("report.html"):
    manifest["files"] = [f for f in manifest["files"] if f["name"] != "report.html"]
with open("manifest.json", "w") as f:
    json.dump(manifest, f, indent=2)

report_progress(100, "LR 分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// scVI Annotation
// ============================================================

function generateScVIScript({ params, ossInputUrl, outputDir }, progressHelper) {
  const { nLatent = 10, nEpochs = 100, _referenceLabels = 'cell_type' } = params || {};

  return `
import scanpy as sc
import scvi
import numpy as np
import matplotlib.pyplot as plt
import json, os, urllib.request

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False)

report_progress(10, "下载数据...")
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
report_progress(20, f"{adata.n_obs} 细胞")

report_progress(30, "准备 scVI 模型...")
sc.pp.highly_variable_genes(adata, n_top_genes=2000, subset=True)
scvi.model.SCVI.setup_anndata(adata)

report_progress(40, "训练 scVI...")
model = scvi.model.SCVI(adata, n_latent=${nLatent})
model.train(max_epochs=${nEpochs}, early_stopping=True)

report_progress(60, "提取 latent space...")
adata.obsm["X_scVI"] = model.get_latent_representation()
sc.pp.neighbors(adata, use_rep="X_scVI")
sc.tl.leiden(adata)
sc.tl.umap(adata)

sc.pl.umap(adata, color=["leiden"], show=False)
plt.savefig("plot_001_scvi_umap.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(75, "训练历史...")
train_elbo = model.history["elbo_train"]
plt.figure(figsize=(6, 4))
plt.plot(train_elbo.index, train_elbo.values)
plt.xlabel("Epoch"); plt.ylabel("ELBO"); plt.title("scVI Training")
plt.savefig("plot_002_training.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(90, "保存结果...")
adata.write("result_scvi.h5ad")
model.save("scvi_model")
summary = {"n_cells": int(adata.n_obs), "n_clusters": int(adata.obs["leiden"].nunique()), "n_latent": ${nLatent}, "n_epochs": ${nEpochs}}
with open("summary.json", "w") as f: json.dump(summary, f)

report_progress(95, "生成 manifest + 报告...")
# Manifest
manifest = {
    "files": [
        {"name": "plot_001_scvi_umap.png", "type": "plot", "label": "scVI UMAP 聚类"},
        {"name": "plot_002_training.png", "type": "plot", "label": "训练 ELBO 曲线"},
        {"name": "result_scvi.h5ad", "type": "file", "label": "处理后的 AnnData"},
        {"name": "summary.json", "type": "text", "label": "分析摘要"},
        {"name": "report.html", "type": "file", "label": "解读报告(HTML)"},
    ],
    "summary": summary
}
with open("manifest.json", "w") as f: json.dump(manifest, f, ensure_ascii=False, indent=2)

# Report
import base64
report_html = ""
template_dirs = [os.environ.get("BIOF3_TOOL_SCRIPTS", ""), "/opt/biof3-r-server/tool-scripts", "/app/data/biof3-tool-jobs/_templates"]
template_path = None
for d in template_dirs:
    p = os.path.join(d, "ml-scvi-annotate-report-template.html")
    if os.path.exists(p): template_path = p; break
if template_path:
    with open(template_path, "r") as f: report_html = f.read()
    for img_name in ["plot_001_scvi_umap.png", "plot_002_training.png"]:
        if os.path.exists(img_name):
            b64 = base64.b64encode(open(img_name, "rb").read()).decode()
            report_html = report_html.replace("{{" + img_name + "}}", "data:image/png;base64," + b64)
    report_html = report_html.replace("{{n_cells}}", str(adata.n_obs))
    report_html = report_html.replace("{{n_clusters}}", str(adata.obs["leiden"].nunique()))
    report_html = report_html.replace("{{n_latent}}", str(${nLatent}))
    report_html = report_html.replace("{{n_epochs}}", str(${nEpochs}))
    with open("report.html", "w") as f: f.write(report_html)
else:
    print("Template not found, skipping report.")

report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// ML Classifier (marker-based cell type prediction)
// ============================================================

function generateMLScript({ params, ossInputUrl, outputDir }, progressHelper) {
  const { model = 'random_forest', targetCol = 'cell_type', testSize = 0.2 } = params || {};

  return `
import scanpy as sc
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.svm import SVC
import matplotlib.pyplot as plt
import seaborn as sns
import json, os, urllib.request

${progressHelper}
os.chdir("${outputDir}")

report_progress(10, "下载数据...")
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
report_progress(20, f"{adata.n_obs} 细胞, 标签列: ${targetCol}")

if "${targetCol}" not in adata.obs.columns:
    raise ValueError(f"找不到标签列 '${targetCol}'，可用列: {list(adata.obs.columns)}")

report_progress(30, "特征准备...")
sc.pp.highly_variable_genes(adata, n_top_genes=2000)
X = adata[:, adata.var.highly_variable].X
if hasattr(X, "toarray"): X = X.toarray()
y = adata.obs["${targetCol}"].values

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=${testSize}, random_state=42, stratify=y)
report_progress(40, f"训练集: {len(y_train)}, 测试集: {len(y_test)}")

report_progress(50, "训练 ${model}...")
if "${model}" == "random_forest":
    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)
elif "${model}" == "gradient_boosting":
    clf = GradientBoostingClassifier(n_estimators=100, random_state=42)
elif "${model}" == "svm":
    clf = SVC(kernel="rbf", random_state=42)
else:
    clf = RandomForestClassifier(n_estimators=100, random_state=42, n_jobs=-1)

clf.fit(X_train, y_train)
report_progress(70, "评估模型...")

y_pred = clf.predict(X_test)
report = classification_report(y_test, y_pred, output_dict=True)
accuracy = report["accuracy"]

# Confusion matrix
cm = confusion_matrix(y_test, y_pred, labels=sorted(set(y)))
plt.figure(figsize=(10, 8))
sns.heatmap(cm, annot=True, fmt="d", cmap="Blues", xticklabels=sorted(set(y)), yticklabels=sorted(set(y)))
plt.xlabel("Predicted"); plt.ylabel("True"); plt.title(f"Confusion Matrix (Accuracy: {accuracy:.3f})")
plt.tight_layout()
plt.savefig("plot_001_confusion_matrix.png", dpi=150, bbox_inches="tight")
plt.close()

# Feature importance (for tree-based models)
if hasattr(clf, "feature_importances_"):
    fi = pd.DataFrame({"gene": adata.var_names[adata.var.highly_variable], "importance": clf.feature_importances_})
    fi = fi.sort_values("importance", ascending=False).head(20)
    plt.figure(figsize=(8, 6))
    plt.barh(fi["gene"], fi["importance"])
    plt.xlabel("Importance"); plt.title("Top 20 Feature Importance")
    plt.tight_layout()
    plt.savefig("plot_002_feature_importance.png", dpi=150, bbox_inches="tight")
    plt.close()
    fi.to_csv("feature_importance.csv", index=False)

report_progress(90, "保存结果...")
pd.DataFrame(report).T.to_csv("classification_report.csv")
summary = {"n_cells": int(adata.n_obs), "n_classes": len(set(y)), "model": "${model}", "accuracy": round(accuracy, 4), "test_size": ${testSize}}
with open("summary.json", "w") as f: json.dump(summary, f)
report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

// ============================================================
// CellRank (fate mapping)
// ============================================================

function generateCellRankScript({ params, ossInputUrl, outputDir }, progressHelper) {
  const { nStates = 3, clusterKey = 'leiden' } = params || {};

  return `
import scanpy as sc
import cellrank as cr
import numpy as np
import matplotlib.pyplot as plt
import json, os, urllib.request

${progressHelper}
os.chdir("${outputDir}")
sc.settings.set_figure_params(dpi=150, frameon=False)

report_progress(10, "下载数据...")
urllib.request.urlretrieve("${ossInputUrl}", "input.h5ad")
adata = sc.read_h5ad("input.h5ad")
report_progress(20, f"{adata.n_obs} 细胞")

report_progress(30, "RNA velocity...")
# Compute velocity kernel
from cellrank.kernels import VelocityKernel, ConnectivityKernel
vk = VelocityKernel(adata).compute_transition_matrix()
ck = ConnectivityKernel(adata).compute_transition_matrix()
combined_kernel = 0.8 * vk + 0.2 * ck

report_progress(50, "估计终末状态...")
from cellrank.estimators import GPCCA
estimator = GPCCA(combined_kernel)
estimator.compute_schur(n_components=20)
estimator.compute_macrostates(n_states=${nStates}, cluster_key="${clusterKey}")

estimator.plot_macrostates(which="all", show=False)
plt.savefig("plot_001_macrostates.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(70, "计算命运概率...")
estimator.set_terminal_states_from_macrostates()
estimator.compute_fate_probabilities()

estimator.plot_fate_probabilities(show=False)
plt.savefig("plot_002_fate_probabilities.png", dpi=150, bbox_inches="tight")
plt.close()

report_progress(85, "驱动基因...")
drivers = estimator.compute_lineage_drivers(lineages=estimator.terminal_states.cat.categories.tolist()[:3])
if drivers is not None:
    drivers.head(20).to_csv("lineage_drivers.csv")

report_progress(95, "保存结果...")
adata.write("result_cellrank.h5ad")
summary = {"n_cells": int(adata.n_obs), "n_macrostates": ${nStates}, "terminal_states": estimator.terminal_states.cat.categories.tolist()}
with open("summary.json", "w") as f: json.dump(summary, f)
report_progress(100, "分析完成!")
print("TASK_COMPLETE")
`;
}

module.exports = { generatePythonToolScript };
