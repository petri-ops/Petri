#!/usr/bin/env python3
# ============================================================
# pca-explorer.py — PCA 可视化插件
#
# 输入: 表达矩阵 CSV (行=样本, 列=基因) + 可选分组文件
# 输出: PCA 散点图 PNG/PDF + 方差贡献表 CSV
# ============================================================

import sys
import os
import json
import pandas as pd
import numpy as np
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

def main():
    if len(sys.argv) < 2:
        print("用法: python pca-explorer.py <work_dir>", file=sys.stderr)
        sys.exit(1)
    work_dir = sys.argv[1]
    os.chdir(work_dir)

    with open(os.path.join(work_dir, "params.json"), "r") as f:
        params = json.load(f)

    expr_path = params["expr_matrix"]
    group_path = params.get("group_file") or ""
    n_components = int(params.get("n_components") or 2)
    n_components = max(2, min(n_components, 10))

    # 读表达矩阵（行=样本，列=基因）
    expr = pd.read_csv(expr_path, index_col=0)
    if expr.shape[0] < 3:
        print("表达矩阵至少需要 3 行（样本）", file=sys.stderr)
        sys.exit(1)

    # 标准化
    X = expr.values
    if X.shape[1] > 1:
        X = StandardScaler().fit_transform(X)

    # PCA
    pca = PCA(n_components=n_components)
    components = pca.fit_transform(X)

    # 分组
    groups = None
    grouping_status = "unassigned"
    if group_path:
        if not os.path.exists(group_path):
            print("分组文件不存在，不能建立样本分组", file=sys.stderr)
            sys.exit(1)
        gdf = pd.read_csv(group_path)
        if "sample" not in gdf.columns or "group" not in gdf.columns:
            print("分组文件必须包含 sample 和 group 列，禁止按文件行顺序猜测", file=sys.stderr)
            sys.exit(1)
        sample_ids = gdf["sample"].astype(str)
        if sample_ids.duplicated().any():
            print("分组文件包含重复 sample ID", file=sys.stderr)
            sys.exit(1)
        expr_ids = expr.index.astype(str)
        if set(sample_ids) != set(expr_ids):
            print("分组文件与表达矩阵的 sample ID 不完全匹配", file=sys.stderr)
            sys.exit(1)
        groups_by_sample = dict(zip(sample_ids, gdf["group"].astype(str)))
        groups = np.array([groups_by_sample[str(sample_id)] for sample_id in expr_ids])
        grouping_status = "matched_by_sample_id"

    # 没有分组信息时保持未分组语义，绝不按样本位置伪造 A/B。
    if groups is None:
        groups = np.array(["Unassigned"] * len(expr.index))

    # 散点图 PC1 vs PC2
    fig, ax = plt.subplots(figsize=(7, 5), dpi=300)
    color_map = {"A": "#2563eb", "B": "#dc2626", "Unassigned": "#64748b"}
    for g in sorted(set(groups)):
        mask = groups == g
        ax.scatter(
            components[mask, 0], components[mask, 1],
            c=color_map.get(g, "#64748b"),
            label=str(g), s=60, alpha=0.8, edgecolors="white", linewidths=0.6
        )
    for i, s in enumerate(expr.index):
        ax.annotate(str(s), (components[i, 0], components[i, 1]),
                    fontsize=7, alpha=0.7, xytext=(4, 4), textcoords="offset points")

    ax.set_xlabel(f"PC1 ({pca.explained_variance_ratio_[0]*100:.1f}%)")
    ax.set_ylabel(f"PC2 ({pca.explained_variance_ratio_[1]*100:.1f}%)")
    ax.set_title("PCA Scatter Plot")
    if grouping_status == "matched_by_sample_id":
        ax.legend(title="Group", loc="best", frameon=True)
    else:
        ax.text(
            0.02, 0.98, "未提供分组信息（仅显示样本）",
            transform=ax.transAxes, va="top", ha="left", fontsize=8,
            color="#475569",
        )
    ax.axhline(0, color="grey", linewidth=0.4, linestyle="--")
    ax.axvline(0, color="grey", linewidth=0.4, linestyle="--")
    fig.tight_layout()
    fig.savefig("pca_plot.png", dpi=300, bbox_inches="tight", facecolor="white")
    fig.savefig("pca_plot.pdf", bbox_inches="tight")
    plt.close(fig)

    # 方差贡献表
    var_df = pd.DataFrame({
        "PC": [f"PC{i+1}" for i in range(n_components)],
        "explained_variance_ratio": pca.explained_variance_ratio_,
        "cumulative": np.cumsum(pca.explained_variance_ratio_),
    })
    var_df.to_csv("variance_table.csv", index=False)

    # manifest
    manifest = {
        "status": "done",
        "outputs": [
            {"id": "pca_plot", "filename": "pca_plot.png", "type": "plot", "label": "PCA 散点图"},
            {"id": "variance_table", "filename": "variance_table.csv", "type": "table", "label": "方差贡献表"},
        ],
        "summary": {
            "n_samples": int(expr.shape[0]),
            "n_genes": int(expr.shape[1]),
            "pc1_variance": float(pca.explained_variance_ratio_[0]),
            "pc2_variance": float(pca.explained_variance_ratio_[1]),
            "grouping": grouping_status,
        },
    }
    with open("manifest.json", "w") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)

    print("DONE")

if __name__ == "__main__":
    main()
