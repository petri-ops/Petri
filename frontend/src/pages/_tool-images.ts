/**
 * Tool cover images — maps tool ID to a representative preview image.
 *
 * Priority for image selection:
 *   1. Reuse a representative plot image when available
 *   2. Reuse a related analysis image when available
 *   3. Reuse a tutorial screenshot
 *   4. Omit from this map → UI falls back to first-letter circle
 *
 * Images live under static/img/ and are referenced with absolute paths.
 * Add new entries here when new tools land or images become available.
 */

export const TOOL_IMAGES: Record<string, string> = {
  // bulk RNA-seq
  deseq2: '/img/tutorial/bulk-rnaseq/bulk04/01-volcano.png',
  'go-kegg': '/img/tutorial/bulk-rnaseq/bulk03/01-go-bp-dotplot.png',
  gsea: '/img/tutorial/bulk-rnaseq/bulk03/05-gsea-waterfall.png',

  // 生存分析
  'km-survival': '/img/figcode/km-curve-example.png',
  'lasso-cox': '/img/figcode/lasso-cv-plot.png',

  // 免疫 / 热图
  'bindea-immune': '/img/figcode/immune-composition.png',
  complexheatmap: '/img/figcode/sc-deg-heatmap.png',

  // 单细胞
  'seurat-standard': '/img/figcode/sc-qc-violin.png',
  cellchat: '/img/figcode/cellchat-bubble.png',

  // 基因组
  'maftools-mutation': '/img/figcode/mut-signature.png',

  // 机器学习 — 部分有可复用图，其余 fallback 首字母
  'ml-classifier': '/img/figcode/calibration.png',
  'rsf-survival': '/img/figcode/forest-cox.png',
  'ml-scvi-annotate': '/img/figcode/py-umap-scanpy.png',

  // 多组学
  'mo-mofa': '/img/figcode/mofa-factors.png',
  'mo-snf': '/img/figcode/multi-omics-heatmap.png',
  'mo-citeseq': '/img/tutorial/single-cell/module08/01-umap-rna-adt-wnn.png',

  // 空间组学
  'spatial-standard': '/img/tutorial/single-cell/module10/03-clusters-spatial.png',
  'spatial-svg': '/img/tutorial/single-cell/module10/03-clusters-spatial.png',
  'spatial-deconv': '/img/figcode/spatial-deconv.png',
  'spatial-lr': '/img/tutorial/single-cell/module10/04-anatomy-markers.png',
};
