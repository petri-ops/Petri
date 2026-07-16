/**
 * Thin, deterministic task knowledge for weak-model tool selection.
 * Packs never execute tools and never own parameter or artifact truth.
 */
export const HARNESS_TASK_PACK_VERSION = 1;

export const HARNESS_TASK_PACKS = [
  {
    id: 'differential-expression',
    title: '差异表达分析',
    toolIds: ['deseq2'],
    patterns: [/\bdeseq2?\b/i, /\bdeg\b/i, /差异表达|差异分析|differential expression/i],
  },
  {
    id: 'volcano-plot',
    title: '火山图',
    toolIds: ['volcano-plot'],
    priority: 20,
    patterns: [/volcano/i, /火山图?/i],
  },
  {
    id: 'pca',
    title: 'PCA 降维',
    toolIds: ['pca-explorer'],
    patterns: [/\bpca\b/i, /主成分|降维散点/i],
  },
  {
    id: 'gene-correlation',
    title: '基因相关性',
    toolIds: ['gene-correlation'],
    patterns: [/correlation|coexpression|co-expression/i, /相关性?|共表达|相关.*热图/i],
  },
  {
    id: 'enrichment',
    title: '功能富集',
    toolIds: ['go-kegg', 'gsea'],
    patterns: [/\bgo\b|\bkegg\b|gsea|enrichment/i, /富集|通路分析|功能注释/i],
  },
  {
    id: 'clustering',
    title: '单细胞标准聚类',
    toolIds: ['seurat-standard'],
    patterns: [/seurat|clustering|cluster/i, /单细胞.*聚类|标准聚类/i],
  },
  {
    id: 'annotation',
    title: 'scVI 细胞类型注释',
    toolIds: ['ml-scvi-annotate'],
    patterns: [/scvi|cell[ -]?type annotation/i, /细胞类型注释|细胞注释|标注细胞类型/i],
  },
  {
    id: 'integration',
    title: '多组学整合',
    toolIds: ['mo-mofa', 'mo-snf'],
    patterns: [/\bmofa\b|\bsnf\b|multi.?omics integration/i, /多组学整合|多模态整合/i],
  },
  {
    id: 'survival',
    title: '生存分析',
    toolIds: ['km-survival', 'rsf-survival', 'lasso-cox'],
    patterns: [/kaplan.?meier|random survival forest|cox|survival/i, /生存分析|生存曲线|预后模型/i],
  },
  {
    id: 'communication',
    title: '细胞通讯',
    toolIds: ['cellchat'],
    patterns: [/cellchat|cell communication|ligand.?receptor/i, /细胞通讯|配体.?受体/i],
  },
  {
    id: 'mutation',
    title: '突变景观分析',
    toolIds: ['maftools-mutation'],
    patterns: [/maftools|oncoplot|mutation landscape/i, /突变景观|体细胞突变|瀑布图/i],
  },
  {
    id: 'spatial',
    title: '空间转录组标准分析',
    toolIds: ['spatial-standard'],
    patterns: [/spatial transcriptomics|visium|spatial standard/i, /空间转录组|空间标准分析/i],
  },
];

export function rankHarnessTaskPacks(requestText) {
  const text = String(requestText || '');
  return HARNESS_TASK_PACKS.map((pack) => {
    const matches = pack.patterns.filter((pattern) => pattern.test(text));
    return {
      id: pack.id,
      title: pack.title,
      toolIds: [...pack.toolIds],
      score: matches.length * 100 + (pack.priority || 0),
      matched: matches.map((pattern) => pattern.source),
    };
  })
    .filter((item) => item.matched.length > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function selectHarnessTaskPack(requestText) {
  return rankHarnessTaskPacks(requestText)[0] || null;
}
