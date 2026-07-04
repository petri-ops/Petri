---
title: 单细胞入门
sidebar_position: 1
---

# 单细胞入门（content-plugin 试点）

> 本页来自一个 **content-plugin**（`single-cell-tutorial`），证明 M2-9 教程插件链路打通：
> plugin-manager 加载 → `globalThis._biof3ContentPlugins` 注册 → docs.tsx IPC 拉取 → react-markdown 渲染。

## 背景

单细胞 RNA-seq（scRNA-seq）在单细胞分辨率下量化基因表达，是 BioF3 最早支持
的组学场景之一。本教程以最小可跑流程为目标，带你走通从读数到聚类的关键步骤。

## 典型流程

1. **读入表达矩阵**（10x Matrix / h5ad / SingleCellExperiment）
2. **质控**（线粒体比例、双重细胞过滤）
3. **归一化与高变基因**（SCTransform / log-normalize）
4. **降维**（PCA → UMAP/t-SNE）
5. **聚类与注释**（Leiden / marker 基因）

## 示例

| 步骤 | 工具 | 输入 | 输出 |
| --- | --- | --- | --- |
| 质控 | `Seurat::PercentageFeatureSet` | 表达矩阵 | 每细胞 MT% |
| 降维 | `scanpy.tl.umap` | PCA 矩阵 | 2D embedding |
| 聚类 | `leidenalg` | KNN 图 | 细胞 label |

> 注：本试点仅含一篇 md，真实教程插件会把多篇文章打成 zip 内 `docs/` 子树。

下一步：安装 `single-cell-tutorial` 插件后，本篇会自动出现在左侧 sidebar 的
"单细胞教程（试点插件）"分类下。
