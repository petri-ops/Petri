/**
 * Thin, deterministic task knowledge for weak-model tool selection.
 * Packs never execute tools and never own parameter or artifact truth.
 */
export const HARNESS_TASK_PACK_VERSION = 1;

export const HARNESS_TASK_PACKS = [
  {
    id: 'differential-expression',
    title: '差异表达分析',
    toolIds: ['deseq2', 'deg'],
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
    toolIds: ['enrichment'],
    patterns: [/\bgo\b|\bkegg\b|gsea|enrichment/i, /富集|通路分析|功能注释/i],
  },
  {
    id: 'clustering',
    title: '聚类与重聚类',
    toolIds: ['recluster', 'scrna-standard'],
    patterns: [/recluster|clustering|cluster/i, /重聚类|聚类|细分亚群/i],
  },
  {
    id: 'annotation',
    title: '细胞类型注释',
    toolIds: ['annotation'],
    patterns: [/singler|cell[ -]?type annotation/i, /细胞类型注释|细胞注释|标注细胞类型/i],
  },
  {
    id: 'integration',
    title: '多样本整合',
    toolIds: ['integration'],
    patterns: [/harmony|\bcca\b|\brpca\b|integration|batch effect/i, /多样本整合|批次效应|去批次/i],
  },
  {
    id: 'trajectory',
    title: '拟时序分析',
    toolIds: ['trajectory'],
    patterns: [/monocle|pseudotime|trajectory/i, /拟时序|发育轨迹|细胞命运/i],
  },
  {
    id: 'communication',
    title: '细胞通讯',
    toolIds: ['communication'],
    patterns: [/cellchat|cell communication|ligand.?receptor/i, /细胞通讯|配体.?受体/i],
  },
  {
    id: 'cell-cycle',
    title: '细胞周期',
    toolIds: ['cell-cycle'],
    patterns: [/cell[ -]?cycle|g1.?s|g2.?m/i, /细胞周期|周期打分/i],
  },
  {
    id: 'doublet',
    title: 'Doublet 检测',
    toolIds: ['doublet'],
    patterns: [/doubletfinder|doublet|multiplet/i, /双细胞|双重细胞/i],
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
