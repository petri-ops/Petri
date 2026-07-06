// ============================================================
// Result file metadata — describes data file purpose,
// column structure, downstream usage. Used by right info panel.
// ============================================================

export interface FileMeta {
  match: string; // filename pattern (case-insensitive includes)
  category: string;
  title: string;
  subtitle: string;
  biologicalQuestion: string;
  scenarios: string[];
  inputFormat: string; // what's inside the file
  keyParams: string[]; // important columns or fields
  packages: string[];
}

export const FILE_META: FileMeta[] = [
  {
    match: 'result.rds',
    category: 'Seurat 对象',
    title: '完整分析对象',
    subtitle: 'Processed Seurat Object',
    biologicalQuestion:
      '存储所有标准分析中间结果（QC、归一化、PCA、UMAP、聚类、Markers），可用于继续下游分析。',
    scenarios: [
      '本地继续分析（差异表达、轨迹、注释等）',
      '导入 R/Bioconductor 流程',
      '论文 supplementary data 提交',
      '与他人协作分享分析对象',
    ],
    inputFormat: 'R 序列化对象（.rds），用 readRDS() 加载。',
    keyParams: [
      'obj@assays$RNA：表达矩阵（counts / data / scale.data）',
      'obj@reductions：PCA / UMAP / TSNE 降维结果',
      'obj@meta.data：cluster / 样本标签等',
      'Idents(obj)：当前活跃的细胞分组',
    ],
    packages: ['Seurat', 'SeuratObject'],
  },
  {
    match: 'result_annotated.rds',
    category: '细胞注释',
    title: '已注释的 Seurat 对象',
    subtitle: 'Annotated Seurat Object',
    biologicalQuestion: '在标准分析基础上，添加了 SingleR 自动注释的细胞类型标签。',
    scenarios: ['已知细胞类型的下游分析', '细胞类型间差异表达比较', '论文 Figure 制作'],
    inputFormat: 'R 序列化对象（.rds）。',
    keyParams: [
      'obj$singler_labels：SingleR 主标签',
      'obj$singler_pruned：去除低置信度的标签',
      '其他同 Seurat 标准对象',
    ],
    packages: ['Seurat', 'SingleR', 'celldex'],
  },
  {
    match: 'result_integrated.rds',
    category: '多样本整合',
    title: '整合后 Seurat 对象',
    subtitle: 'Integrated Seurat Object',
    biologicalQuestion: '消除批次效应后的多样本数据集，可用于跨样本比较分析。',
    scenarios: ['跨样本/批次的细胞类型对齐', '比较不同条件下细胞比例', '差异表达（条件间）'],
    inputFormat: 'R 序列化对象（.rds）。',
    keyParams: [
      'obj$orig.ident：批次/样本标签',
      'obj@reductions$harmony 或 integrated assay',
      'obj@reductions$umap_before：整合前 UMAP（对照）',
    ],
    packages: ['Seurat', 'harmony'],
  },
  {
    match: 'result_cellchat.rds',
    category: '细胞通讯',
    title: 'CellChat 对象',
    subtitle: 'CellChat Communication Object',
    biologicalQuestion: '存储所有配体-受体推断结果，用于深度可视化和通路分析。',
    scenarios: ['提取特定通路的互作网络', '比较不同条件下的通讯变化', '与 NicheNet 等工具整合'],
    inputFormat: 'CellChat S4 对象。',
    keyParams: [
      'cellchat@net：互作网络（count, weight）',
      'cellchat@netP$pathways：通路列表',
      'cellchat@idents：细胞类型分组',
    ],
    packages: ['CellChat'],
  },
  {
    match: 'markers_top5.csv',
    category: '标记基因',
    title: 'Top 5 Markers 表',
    subtitle: 'Top 5 Markers per Cluster',
    biologicalQuestion: '每个 cluster 最具特异性的 5 个基因，用于细胞类型注释和论文展示。',
    scenarios: ['快速浏览 cluster 标签', '细胞类型注释依据', '论文表格 supplementary table'],
    inputFormat: 'CSV 文件（每行一个 marker 基因）。',
    keyParams: [
      'cluster：所属 cluster',
      'gene：基因名',
      'avg_log2FC：log2 fold change',
      'p_val_adj：调整后 p 值',
      'pct.1 / pct.2：表达比例（cluster 内 / 其他）',
    ],
    packages: ['Seurat (FindAllMarkers)'],
  },
  {
    match: 'deg_results.csv',
    category: '差异表达',
    title: '差异表达完整结果',
    subtitle: 'Full DEG Table',
    biologicalQuestion: '所有基因的差异分析统计结果，可自定义阈值筛选。',
    scenarios: [
      '自定义阈值筛选 DEGs',
      '富集分析输入',
      '机制通路深度挖掘',
      '论文 supplementary table',
    ],
    inputFormat: 'CSV 文件（按 padj 排序）。',
    keyParams: [
      'gene：基因名',
      'log2FoldChange：log2 倍数变化',
      'padj：BH 校正后 p 值',
      'baseMean / pvalue：DESeq2 输出',
      'pct.1 / pct.2：表达比例（仅 sc 模式）',
    ],
    packages: ['DESeq2 / Seurat'],
  },
  {
    match: 'deg_top_genes.csv',
    category: '差异表达',
    title: 'Top DEGs 简表',
    subtitle: 'Top DEGs (Filtered)',
    biologicalQuestion: '已过滤的差异基因列表（按显著性排序），可直接用于功能富集。',
    scenarios: ['富集分析直接输入', '快速浏览关键基因', 'PPT 展示'],
    inputFormat: 'CSV 文件（含上下调标签）。',
    keyParams: ['gene：基因名', 'log2FoldChange', 'padj', 'sig：up / down 标签'],
    packages: [],
  },
  {
    match: 'go_results.csv',
    category: '富集分析',
    title: 'GO 富集结果表',
    subtitle: 'GO Biological Process Enrichment',
    biologicalQuestion: '所有显著富集的 GO 生物学过程，按 p.adjust 排序。',
    scenarios: ['机制推断', '后续 GSEA / Cytoscape 网络分析', '论文 supplementary table'],
    inputFormat: 'CSV 文件（clusterProfiler 标准输出）。',
    keyParams: [
      'ID：GO term ID',
      'Description：术语描述',
      'GeneRatio / BgRatio：比例',
      'pvalue / p.adjust / qvalue：统计值',
      'geneID：富集到的基因（/ 分隔）',
      'Count：基因数',
    ],
    packages: ['clusterProfiler'],
  },
  {
    match: 'kegg_results.csv',
    category: '富集分析',
    title: 'KEGG 通路富集表',
    subtitle: 'KEGG Pathway Enrichment',
    biologicalQuestion: '富集到的 KEGG 信号通路，识别关键的生物过程。',
    scenarios: ['信号通路机制', '药物靶点筛选', '疾病机制推断'],
    inputFormat: 'CSV 文件。',
    keyParams: [
      'ID：KEGG pathway ID（如 hsa04010）',
      'Description：通路名',
      'p.adjust',
      'Count：通路内基因数',
    ],
    packages: ['clusterProfiler', 'KEGGREST'],
  },
  {
    match: 'gsea_results.csv',
    category: '富集分析',
    title: 'GSEA 结果表',
    subtitle: 'Gene Set Enrichment Results',
    biologicalQuestion: '基于全基因排序的富集分析结果，包含 NES 和 leading edge。',
    scenarios: ['识别小幅度但一致变化的通路', 'leading edge 基因深度分析'],
    inputFormat: 'CSV 文件。',
    keyParams: [
      'NES：归一化富集得分',
      'pvalue / p.adjust',
      'core_enrichment：核心富集基因',
      'setSize：基因集大小',
    ],
    packages: ['clusterProfiler'],
  },
  {
    match: 'annotation_results.csv',
    category: '细胞注释',
    title: '细胞注释结果',
    subtitle: 'Cell Annotation Table',
    biologicalQuestion: '每个细胞的 SingleR 预测细胞类型标签。',
    scenarios: ['导出注释结果到 Python / 其他工具', '与人工注释对比验证', '提供给共享平台'],
    inputFormat: 'CSV 文件（一行一个细胞）。',
    keyParams: ['cell：细胞 barcode', 'label：SingleR 预测细胞类型'],
    packages: ['SingleR'],
  },
  {
    match: 'pseudotime_results.csv',
    category: '轨迹分析',
    title: 'Pseudotime 数据表',
    subtitle: 'Pseudotime Values',
    biologicalQuestion: '每个细胞的伪时间值和所属 cluster，用于自定义可视化。',
    scenarios: ['自定义轨迹图', '与表达矩阵关联分析基因动态', '统计分析'],
    inputFormat: 'CSV 文件（一行一个细胞）。',
    keyParams: ['cell：细胞 barcode', 'pseudotime：伪时间数值', 'cluster：所属 cluster'],
    packages: ['monocle3'],
  },
  {
    match: 'communication_results.csv',
    category: '细胞通讯',
    title: '细胞通讯互作表',
    subtitle: 'Ligand-Receptor Interactions',
    biologicalQuestion: '所有显著的配体-受体互作，包含发送方/接收方细胞类型和通路。',
    scenarios: ['锁定特定细胞类型间的通讯', 'top 互作论文展示', '靶向通路验证'],
    inputFormat: 'CSV 文件。',
    keyParams: [
      'source / target：发送/接收细胞类型',
      'ligand / receptor：配体-受体',
      'pathway_name：所属通路',
      'prob：互作概率',
      'pval：显著性',
    ],
    packages: ['CellChat'],
  },
];

export function getFileMeta(filename: string): FileMeta | null {
  const lower = filename.toLowerCase();
  for (const m of FILE_META) {
    if (lower.includes(m.match.toLowerCase())) return m;
  }
  return null;
}
