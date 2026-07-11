// ============================================================
// Tools — 在线分析工具元数据
//
// 每个工具定义：输入参数、输出类型、关联教程、demo 数据。
// 前端根据 inputs 自动生成参数表单，后端根据 id 路由到对应脚本。
// ============================================================

export interface InputField {
  id: string;
  label: string;
  type: 'file' | 'select' | 'number' | 'text' | 'checkbox';
  required?: boolean;
  accept?: string; // file type filter
  options?: { value: string; label: string }[]; // for select
  default?: string | number | boolean;
  hint?: string;
  placeholder?: string;
}

export interface OutputDef {
  id: string;
  type: 'table' | 'plot' | 'file' | 'text';
  label: string;
}

export interface Tool {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  language: 'r' | 'python';
  description: string;
  longDescription: string;
  inputs: InputField[];
  outputs: OutputDef[];
  tutorialUrl: string;
  demoDataUrl?: string; // 内置 demo 数据（点击"使用示例数据"自动填充）
  estimatedMinutes: number;
  packages: string[];
  /** Theme color (hex) for tool icon / nav dot. Was scattered in TOOL_COLORS. */
  color: string;
  /** Static demo report URL (HTML). Was scattered in REPORT_URLS. */
  reportUrl?: string;
  /** Map output filename → FigCode card id for "在线绘图" buttons.
   * Was scattered in FIGCODE_MAP. Keys must match what the R script writes
   * (`ggsave/png` filename); values must be valid figcardId in src/pages/figcode/_data.ts. */
  figcodeMap?: Record<string, string>;
  /** True = tool not yet runnable, only shows as placeholder card.
   * Wave 1 of machine-learning column adds 7 placeholders; will flip to false as Wave 2-4 ship. */
  comingSoon?: boolean;
}

export const toolCategories = [
  'bulk RNA-seq',
  '功能富集',
  '生存分析',
  '单细胞',
  '基因组',
  '蛋白组',
  '机器学习',
  '多组学',
  '空间组学',
] as const;

export const tools: Tool[] = [
  {
    id: 'deseq2',
    title: 'DESeq2 差异分析',
    subtitle: 'Bulk RNA-seq 差异表达基因检测',
    category: 'bulk RNA-seq',
    language: 'r',
    description: '上传 count matrix + 样本信息，一键跑 DESeq2，输出差异基因表 + 火山图 + 热图。',
    longDescription: `DESeq2 是 bulk RNA-seq 差异表达分析的金标准工具。本工具自动完成：
1. 数据过滤（低表达基因去除）
2. 归一化 + 离散度估计
3. 差异检验（Wald test）
4. Log2FC shrinkage（apeglm）
5. 输出：差异基因表（含 padj、log2FC）+ 火山图 + Top50 热图 + PCA 图`,
    inputs: [
      {
        id: 'counts',
        label: 'Count Matrix',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因，列=样本。第一列为基因名/ID。',
      },
      {
        id: 'coldata',
        label: '样本信息表',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=样本（与 count matrix 列名对应），至少含一列分组信息。',
      },
      {
        id: 'design',
        label: '分组列名',
        type: 'text',
        required: true,
        placeholder: 'condition',
        hint: '样本信息表中用于分组的列名，只填列名本身，例如 condition，不要写 ~ condition',
      },
      {
        id: 'contrast_ref',
        label: '对照组',
        type: 'text',
        required: true,
        placeholder: 'Control',
        hint: '对照组的值（如 Normal、Control）',
      },
      {
        id: 'contrast_treat',
        label: '实验组',
        type: 'text',
        required: true,
        placeholder: 'Treatment',
        hint: '实验组的值（如 Tumor、Treatment）',
      },
      { id: 'padj_cutoff', label: 'padj 阈值', type: 'number', default: 0.05, hint: '显著性阈值' },
      { id: 'lfc_cutoff', label: '|log2FC| 阈值', type: 'number', default: 1, hint: '效应量阈值' },
      {
        id: 'min_count',
        label: '最低表达过滤',
        type: 'number',
        default: 10,
        hint: '至少在 N 个样本中 count >= 此值',
      },
    ],
    outputs: [
      { id: 'deg_table', type: 'table', label: '差异基因表' },
      { id: 'volcano', type: 'plot', label: '火山图' },
      { id: 'heatmap', type: 'plot', label: 'Top50 热图' },
      { id: 'pca', type: 'plot', label: 'PCA 图' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包下载' },
    ],
    tutorialUrl: '/docs/bulk-rnaseq/module02',
    demoDataUrl: '/demo-data/deseq2-demo',
    estimatedMinutes: 2,
    packages: ['DESeq2', 'ggplot2', 'ggrepel', 'pheatmap'],
    color: '#dc2626',
    reportUrl: '/exports/tools/deseq2/index.html',
    figcodeMap: {
      'volcano.png': 'volcano',
      'pca.png': 'pca',
      'heatmap.png': 'heatmap',
      'deg_table.csv': 'volcano',
      'ma_plot.png': 'ma-plot',
      'library_size.png': 'library-size',
      'dispersion.png': 'dispersion',
      'sample_distance.png': 'sample-cor',
    },
  },
  {
    id: 'go-kegg',
    title: 'GO/KEGG ORA',
    subtitle: '基因列表功能注释与通路富集',
    category: '功能富集',
    language: 'r',
    description:
      '上传差异基因列表或 DESeq2 结果表，一键跑 GO BP/MF/CC + KEGG 富集，输出气泡图、网络图、树图等 11 张图。',
    longDescription: `基于 clusterProfiler 的 ORA 富集分析，功能全面：
1. GO 三大本体（BP / MF / CC）独立分析
2. KEGG 通路富集（离线模式，无需联网）
3. 自动识别输入格式（DESeq2 结果表 / 基因列表）
4. 自动检测基因 ID 类型（Symbol / Ensembl / Entrez）
5. 上调/下调基因分开对比（compareCluster）
6. 丰富可视化：气泡图、条形图、基因网络、富集树图、热图、富集网络图
7. 所有中间数据保存，支持在线绘图调整`,
    inputs: [
      {
        id: 'genes',
        label: '基因列表 / DESeq2 结果表',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '支持两种格式：① 一列基因名（txt/csv）；② DESeq2 完整结果表（含 log2FoldChange + padj 列，自动筛选差异基因）',
      },
      {
        id: 'species',
        label: '物种',
        type: 'select',
        required: true,
        options: [
          { value: 'human', label: '人 (Homo sapiens)' },
          { value: 'mouse', label: '小鼠 (Mus musculus)' },
        ],
        default: 'human',
      },
      {
        id: 'analysis_type',
        label: '分析类型',
        type: 'select',
        options: [
          { value: 'all', label: '全部 (GO + KEGG)' },
          { value: 'GO', label: '仅 GO (BP+MF+CC)' },
          { value: 'KEGG', label: '仅 KEGG' },
          { value: 'GO-BP', label: '仅 GO-BP' },
        ],
        default: 'all',
      },
      {
        id: 'gene_id_type',
        label: '基因 ID 类型',
        type: 'select',
        options: [
          { value: 'SYMBOL', label: 'Gene Symbol (如 TP53)' },
          { value: 'ENSEMBL', label: 'Ensembl ID (如 ENSG...)' },
          { value: 'ENTREZID', label: 'Entrez ID (如 7157)' },
          { value: 'auto', label: '自动检测' },
        ],
        default: 'SYMBOL',
      },
      {
        id: 'padj_cutoff',
        label: 'DEG padj 阈值',
        type: 'number',
        default: 0.05,
        hint: '从 DESeq2 表筛选差异基因的 padj 阈值',
      },
      {
        id: 'lfc_cutoff',
        label: 'DEG |log2FC| 阈值',
        type: 'number',
        default: 1,
        hint: '从 DESeq2 表筛选差异基因的 FC 阈值',
      },
      {
        id: 'enrich_pvalue',
        label: '富集 p-value',
        type: 'number',
        default: 0.05,
        hint: '富集分析显著性阈值',
      },
      {
        id: 'enrich_qvalue',
        label: '富集 q-value',
        type: 'number',
        default: 0.2,
        hint: 'FDR 校正后阈值',
      },
      {
        id: 'top_n',
        label: '展示 Top N',
        type: 'number',
        default: 20,
        hint: '图中展示前 N 个通路',
      },
    ],
    outputs: [
      { id: 'go_bp_results', type: 'table', label: 'GO-BP 结果表' },
      { id: 'go_mf_results', type: 'table', label: 'GO-MF 结果表' },
      { id: 'go_cc_results', type: 'table', label: 'GO-CC 结果表' },
      { id: 'kegg_results', type: 'table', label: 'KEGG 结果表' },
      { id: 'go_bp_dotplot', type: 'plot', label: 'GO-BP 气泡图' },
      { id: 'go_bp_barplot', type: 'plot', label: 'GO-BP 条形图' },
      { id: 'go_bp_cnetplot', type: 'plot', label: 'GO-BP 基因网络' },
      { id: 'go_bp_treeplot', type: 'plot', label: 'GO-BP 富集树图' },
      { id: 'go_bp_heatplot', type: 'plot', label: 'GO-BP 热图' },
      { id: 'go_bp_emapplot', type: 'plot', label: 'GO-BP 富集网络' },
      { id: 'go_mf_dotplot', type: 'plot', label: 'GO-MF 气泡图' },
      { id: 'go_cc_dotplot', type: 'plot', label: 'GO-CC 气泡图' },
      { id: 'kegg_dotplot', type: 'plot', label: 'KEGG 气泡图' },
      { id: 'kegg_barplot', type: 'plot', label: 'KEGG 条形图' },
      { id: 'compare_up_down', type: 'plot', label: '上下调对比图' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    demoDataUrl: '/demo-data/go-kegg-demo',
    estimatedMinutes: 2,
    packages: ['clusterProfiler', 'org.Hs.eg.db', 'org.Mm.eg.db', 'enrichplot', 'DOSE'],
    color: '#059669',
    reportUrl: '/exports/tools/go-kegg/index.html',
    figcodeMap: {
      'go_bp_dotplot.png': 'dotplot',
      'go_bp_barplot.png': 'go-bar',
      'go_bp_cnetplot.png': 'cnetplot',
      'go_bp_treeplot.png': 'treemap',
      'go_bp_emapplot.png': 'go-emap',
      'go_bp_heatplot.png': 'heatmap',
      'go_mf_dotplot.png': 'dotplot',
      'go_cc_dotplot.png': 'dotplot',
      'kegg_dotplot.png': 'kegg-dotplot',
      'kegg_barplot.png': 'go-bar',
      'compare_up_down.png': 'dotplot',
      'go_dotplot.png': 'dotplot',
    },
  },
  {
    id: 'km-survival',
    title: 'KM 生存分析',
    subtitle: '基因表达分组 + 生存曲线',
    category: '生存分析',
    language: 'r',
    description: '上传表达 + 临床数据，按基因表达中位数分组，输出 KM 曲线 + Cox 回归 + ROC。',
    longDescription: `完整的单基因/多基因预后分析流程：
1. 按中位数或最佳截断值分高低表达组
2. Kaplan-Meier 生存曲线 + log-rank 检验
3. 单因素 + 多因素 Cox 回归
4. 时间依赖 ROC（1/3/5 年 AUC）
5. 输出：KM 图 + 森林图 + ROC 图 + 统计表`,
    inputs: [
      {
        id: 'expression',
        label: '表达矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因，列=样本',
      },
      {
        id: 'clinical',
        label: '临床信息',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '需含 OS.time、OS 列（生存时间和事件）',
      },
      {
        id: 'gene',
        label: '目标基因',
        type: 'text',
        required: true,
        placeholder: 'TP53',
        hint: '要分析的基因名（需在表达矩阵中存在）',
      },
      {
        id: 'cutoff_method',
        label: '分组方式',
        type: 'select',
        options: [
          { value: 'median', label: '中位数' },
          { value: 'optimal', label: '最佳截断值 (surv_cutpoint)' },
          { value: 'tertile', label: '三分位（上1/3 vs 下1/3）' },
        ],
        default: 'median',
      },
      { id: 'time_col', label: '生存时间列名', type: 'text', default: 'OS.time' },
      { id: 'event_col', label: '事件列名', type: 'text', default: 'OS' },
    ],
    outputs: [
      { id: 'km_plot', type: 'plot', label: 'KM 生存曲线' },
      { id: 'cox_table', type: 'table', label: 'Cox 回归结果' },
      { id: 'roc_plot', type: 'plot', label: '时间依赖 ROC' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包下载' },
    ],
    tutorialUrl: '/docs/project-practice/module05',
    demoDataUrl: '/demo-data/survival-demo.zip',
    estimatedMinutes: 1,
    packages: ['survival', 'survminer', 'timeROC', 'ggplot2'],
    color: '#2563eb',
    reportUrl: '/exports/tools/km-survival/index.html',
    figcodeMap: {
      'km_plot.png': 'km-curve',
      'km_curve.png': 'km-curve',
      'forest_plot.png': 'forest-cox',
      'roc_plot.png': 'time-roc',
      'roc_curve.png': 'time-roc',
      'expression_dist.png': 'expr-dist',
    },
  },
  {
    id: 'gsea',
    title: 'GSEA 基因集富集',
    subtitle: '全基因组排序的富集分析',
    category: '功能富集',
    language: 'r',
    description:
      '上传带 log2FC 的全基因列表，跑 GSEA，输出 NES 排序 + running score + ridge plot。',
    longDescription: `Gene Set Enrichment Analysis：不需要预先设阈值筛选差异基因，直接用全基因的排序做富集。
1. 按 log2FC 排序全基因列表
2. 对 GO / KEGG / Hallmark 基因集做 GSEA
3. 输出：NES 排序表 + running score 图 + ridge plot + waterfall 图`,
    inputs: [
      {
        id: 'ranked_list',
        label: '排序基因列表',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '两列：gene_symbol, log2FC（按 log2FC 降序排列）',
      },
      {
        id: 'organism',
        label: '物种',
        type: 'select',
        options: [
          { value: 'hsa', label: '人' },
          { value: 'mmu', label: '小鼠' },
        ],
        default: 'hsa',
      },
      {
        id: 'gene_set',
        label: '基因集',
        type: 'select',
        options: [
          { value: 'GO_BP', label: 'GO Biological Process' },
          { value: 'KEGG', label: 'KEGG Pathway' },
          { value: 'Hallmark', label: 'MSigDB Hallmark' },
        ],
        default: 'GO_BP',
      },
      { id: 'min_size', label: '最小基因集大小', type: 'number', default: 15 },
      { id: 'max_size', label: '最大基因集大小', type: 'number', default: 500 },
    ],
    outputs: [
      { id: 'gsea_table', type: 'table', label: 'GSEA 结果表' },
      { id: 'running_score', type: 'plot', label: 'Top 通路 Running Score' },
      { id: 'waterfall', type: 'plot', label: 'NES Waterfall' },
      { id: 'ridge', type: 'plot', label: 'Ridge Plot' },
      { id: 'zip', type: 'file', label: '全部结果打包下载' },
    ],
    tutorialUrl: '/docs/bulk-rnaseq/module03',
    demoDataUrl: '/demo-data/gsea-demo.txt',
    estimatedMinutes: 2,
    packages: ['clusterProfiler', 'enrichplot', 'org.Hs.eg.db', 'DOSE'],
    color: '#d97706',
    reportUrl: '/exports/tools/gsea/index.html',
    figcodeMap: {
      'gsea_dotplot.png': 'dotplot',
      'gsea_waterfall.png': 'gsea-waterfall',
      'gsea_ridge.png': 'ridge-gsea',
      'gsea_cnetplot.png': 'cnetplot',
      'gsea_emapplot.png': 'go-emap',
      'gsea_treeplot.png': 'treemap',
      'running_score_1.png': 'gsea-running',
      'running_score_2.png': 'gsea-running',
      'running_score_3.png': 'gsea-running',
      'running_score.png': 'gsea-running',
      'waterfall.png': 'gsea-waterfall',
      'ridge.png': 'ridge-gsea',
      'barplot.png': 'go-bar',
      'boxplot.png': 'violin',
    },
  },
  {
    id: 'bindea-immune',
    title: '免疫浸润评估',
    subtitle: 'CIBERSORT / TIMER / ssGSEA 免疫细胞比例',
    category: 'bulk RNA-seq',
    language: 'r',
    description: '上传 TPM 表达矩阵，用多种方法估计肿瘤免疫微环境中各免疫细胞的比例。',
    longDescription: `肿瘤免疫微环境分析：
1. 支持 CIBERSORT (LM22)、TIMER、ssGSEA (Bindea) 三种方法
2. 输出：免疫细胞比例矩阵 + 堆叠条形图 + 相关性热图
3. 可选：与分组变量做差异比较（如 Tumor vs Normal）`,
    inputs: [
      {
        id: 'tpm_matrix',
        label: 'TPM 表达矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因 Symbol，列=样本，值=TPM',
      },
      {
        id: 'method',
        label: '方法',
        type: 'select',
        options: [
          { value: 'ssgsea', label: 'ssGSEA (Bindea 28 immune cells)' },
          { value: 'timer', label: 'TIMER (6 immune cells)' },
          { value: 'cibersort', label: 'CIBERSORT (LM22, 22 immune cells)' },
        ],
        default: 'ssgsea',
      },
      {
        id: 'group_file',
        label: '分组信息（可选）',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '两列：sample, group。用于组间比较。',
      },
    ],
    outputs: [
      { id: 'fraction_table', type: 'table', label: '免疫细胞比例表' },
      { id: 'barplot', type: 'plot', label: '堆叠条形图' },
      { id: 'heatmap', type: 'plot', label: '相关性热图' },
      { id: 'boxplot', type: 'plot', label: '组间比较箱线图' },
      { id: 'zip', type: 'file', label: '全部结果打包下载' },
    ],
    tutorialUrl: '/docs/project-practice/module05',
    demoDataUrl: '/demo-data/immune-demo.csv',
    estimatedMinutes: 3,
    packages: ['GSVA', 'ggplot2', 'pheatmap', 'immunedeconv'],
    color: '#7c3aed',
    reportUrl: '/exports/tools/immune/index.html',
    figcodeMap: {
      'barplot_composition.png': 'immune-composition',
      'correlation_heatmap.png': 'immune-cor',
      'boxplot_group.png': 'immune-boxplot',
      'lollipop_scores.png': 'immune-lollipop',
    },
  },
  // ============================================================
  // 新增工具（第二批）
  // ============================================================
  {
    id: 'complexheatmap',
    title: 'ComplexHeatmap 高级热图',
    subtitle: 'z-score 标准化 + 聚类 + 多 annotation',
    category: 'bulk RNA-seq',
    language: 'r',
    description:
      'ComplexHeatmap 标准热图：z-score 标准化 → 行/列聚类 → sample annotation bar → top gene 标记。SCI 风格双格式输出（PNG + PDF，300dpi）。不含: OncoPrint / UpSet / 突变可视化（用其他工具）。',
    longDescription: `基于 ComplexHeatmap 2.24.1 的高级热图工具，跟随 [Complex Heatmap Reference](https://jokergoo.github.io/ComplexHeatmap-reference/book/) 标准用法：

1. **数据载入** — 数值矩阵 (CSV) + 可选的 sample annotation 表
2. **Z-score 标准化** — 行 z-score（可关）
3. **聚类** — 行/列 pearson 距离 + ward.D2 链接
4. **顶部 annotation** — 自动判断 categorical / numeric → 离散色 / 渐变色
5. **大矩阵优化** — 行数 > 50 时仅标记 top variable gene，避免行名挤压

**输出**: 主热图 + 未标准化版 + 行/列聚类树 + 样本相关性矩阵 (5 张图 × 双格式 = 10 文件) + 中间数据。

**SCI 风格规范**: 全图用 \`theme_biof3()\` + \`biof3_palette()\` + \`save_grid_biof3()\` 输出 300dpi PNG + 矢量 PDF，可直接发表。

**不在范围内**: OncoPrint（突变可视化用 maftools-mutation）、UpSet plot、density heatmap、interactive heatmap。`,
    inputs: [
      {
        id: 'matrix',
        label: '数值矩阵 (CSV)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因 / 特征, 列=样本; 数值型',
      },
      {
        id: 'annotation',
        label: 'Sample annotation (可选)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '行=样本（与矩阵列名对应）, 列=分组属性. 数值列自动渐变, 字符列自动离散色',
      },
      {
        id: 'z_score',
        label: 'Z-score 标准化',
        type: 'select',
        options: [
          { value: 'TRUE', label: 'Yes (推荐, 表达数据)' },
          { value: 'FALSE', label: 'No (原始值, 比例 / 概率)' },
        ],
        default: 'TRUE',
      },
      {
        id: 'cluster_rows',
        label: '行聚类',
        type: 'select',
        options: [
          { value: 'TRUE', label: 'Yes' },
          { value: 'FALSE', label: 'No' },
        ],
        default: 'TRUE',
      },
      {
        id: 'cluster_columns',
        label: '列聚类',
        type: 'select',
        options: [
          { value: 'TRUE', label: 'Yes' },
          { value: 'FALSE', label: 'No' },
        ],
        default: 'TRUE',
      },
      {
        id: 'clustering_distance',
        label: '聚类距离',
        type: 'select',
        options: [
          { value: 'pearson', label: 'Pearson correlation (推荐, 表达)' },
          { value: 'spearman', label: 'Spearman correlation' },
          { value: 'euclidean', label: 'Euclidean' },
        ],
        default: 'pearson',
      },
      {
        id: 'clustering_method',
        label: '链接方法',
        type: 'select',
        options: [
          { value: 'ward.D2', label: 'Ward.D2 (推荐)' },
          { value: 'complete', label: 'Complete' },
          { value: 'average', label: 'Average (UPGMA)' },
        ],
        default: 'ward.D2',
      },
      {
        id: 'color_scheme',
        label: '颜色方案',
        type: 'select',
        options: [
          { value: 'div', label: '蓝-白-红 (z-score)' },
          { value: 'seq', label: 'Viridis (原始值)' },
        ],
        default: 'div',
      },
      {
        id: 'top_n_label',
        label: 'Top N 基因标记',
        type: 'number',
        default: 20,
        hint: '行数 > 50 时仅标记 top N 高方差基因, 否则全部显示',
      },
    ],
    outputs: [
      { id: 'heatmap_main', type: 'plot', label: '主热图 (z-score + annotation)' },
      { id: 'heatmap_unscaled', type: 'plot', label: '未标准化热图' },
      { id: 'dendrogram_rows', type: 'plot', label: '行聚类树' },
      { id: 'dendrogram_columns', type: 'plot', label: '列聚类树' },
      { id: 'correlation_heatmap', type: 'plot', label: '样本相关性矩阵' },
      { id: 'matrix_zscore', type: 'table', label: 'Z-score 矩阵' },
      { id: 'matrix_clustered', type: 'table', label: '聚类排序后矩阵' },
      { id: 'clustering_summary', type: 'text', label: '聚类参数摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包 (含 PDF)' },
    ],
    tutorialUrl: '/docs/integration/module03',
    demoDataUrl: '/demo-data/complexheatmap-demo',
    estimatedMinutes: 1,
    packages: ['ComplexHeatmap', 'circlize', 'RColorBrewer'],
    color: '#9333ea',
    reportUrl: '/exports/tools/complexheatmap/index.html',
    figcodeMap: {},
  },
  {
    id: 'wgcna',
    title: 'WGCNA 共表达',
    subtitle: '加权基因共表达网络分析',
    category: 'bulk RNA-seq',
    language: 'r',
    description:
      'WGCNA 标准流程（Tutorial I）：QC → 软阈值 → 网络构建 → 模块识别 → 模块-性状关联 → Hub 基因。不含: 多数据集共识、模块保守性、Cytoscape 导出。最大 ~10000 基因 × ~500 样本。',
    longDescription: `加权基因共表达网络分析 (Weighted Gene Co-expression Network Analysis)，跟随 [WGCNA Tutorial I](https://horvath.genetics.ucla.edu/html/CoexpressionNetwork/Rpackages/WGCNA/Tutorials/) 7 步全流程：

1. **QC** — 检测离群基因 / 样本 (\`goodSamplesGenes\`); sample dendrogram 树检测异常
2. **Soft threshold** — \`pickSoftThreshold\` 自动选 power（找 R² ≥ 0.85 的最小 power）
3. **Network construction** — \`blockwiseModules(networkType="signed", TOMType="signed")\` 一步法
4. **Module dendrogram** — 动态合并相似模块 (mergeCutHeight=0.25)
5. **Module-trait correlation** — \`moduleEigengenes\` × \`cor()\` 计算 ME 与各性状关联
6. **Hub genes** — \`intramodularConnectivity()\` 每模块 top 10 hub 基因
7. **Gene-trait significance** — 最显著模块的 GS vs MM 散点图

**输入**: 表达矩阵 (TPM/FPKM/log2 normalized) + 临床性状表（性状必须是数值型，分类变量请预先编码为 0/1）

**输出**: 模块-性状热图 + 模块基因列表 + Hub 基因 + 完整网络 RDS

**Demo 数据**: TCGA-BRCA 218 样本 × 5000 高变基因 + 10 性状（ER/PR/HER2/Stage/Age + PAM50 5 个亚型）

**不在范围内**: SCTransform / 多数据集共识 (Tutorial III) / 模块保守性 / Cytoscape 网络导出 / GO 富集（用 BioF3 GO/KEGG 工具做下游）。`,
    inputs: [
      {
        id: 'expression',
        label: '表达矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因, 列=样本; 值为 log2(TPM+1) / log2(FPKM+1) / 标准化 log RSEM',
      },
      {
        id: 'traits',
        label: '性状矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=样本（与表达矩阵列名对应）, 列=数值型性状; 分类变量需预先编码为 0/1',
      },
      {
        id: 'min_module_size',
        label: '最小模块大小',
        type: 'number',
        default: 30,
        hint: '官方默认 30; 小数据集可降到 20',
      },
      {
        id: 'merge_cut_height',
        label: 'Merge 高度',
        type: 'number',
        default: 0.25,
        hint: '合并相似模块的高度阈值, 越小模块越多越细; 官方默认 0.25',
      },
      {
        id: 'network_type',
        label: '网络类型',
        type: 'select',
        options: [
          { value: 'signed', label: 'Signed (推荐)' },
          { value: 'unsigned', label: 'Unsigned' },
        ],
        default: 'signed',
        hint: 'Signed 区分正负相关, 生物学意义更强; 官方推荐 signed',
      },
      {
        id: 'soft_power',
        label: '软阈值 power（可选）',
        type: 'number',
        hint: '留空则自动用 pickSoftThreshold 找 R² ≥ 0.85 的最小 power',
      },
    ],
    outputs: [
      { id: 'sample_dendrogram', type: 'plot', label: '样本聚类树（QC）' },
      { id: 'soft_threshold', type: 'plot', label: '软阈值选择图' },
      { id: 'gene_dendrogram', type: 'plot', label: '基因聚类 + 模块颜色' },
      { id: 'module_eigengenes', type: 'plot', label: '模块 Eigengene' },
      { id: 'module_trait_heatmap', type: 'plot', label: '模块-性状热图' },
      { id: 'module_size_barplot', type: 'plot', label: '模块大小' },
      { id: 'gs_mm_scatter', type: 'plot', label: 'GS vs MM 散点（最显著模块）' },
      { id: 'hub_gene_table', type: 'plot', label: 'Hub 基因图' },
      { id: 'module_assignment', type: 'table', label: '基因 → 模块表' },
      { id: 'module_trait_corr', type: 'table', label: '模块-性状相关性表' },
      { id: 'hub_genes', type: 'table', label: 'Hub 基因表' },
      { id: 'sft_results', type: 'table', label: 'pickSoftThreshold 结果' },
      { id: 'gs_mm_data', type: 'table', label: 'GS / MM 数据' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/integration/module04',
    demoDataUrl: '/demo-data/wgcna-demo',
    estimatedMinutes: 2,
    packages: ['WGCNA', 'flashClust', 'ggplot2', 'pheatmap'],
    color: '#0891b2',
    reportUrl: '/exports/tools/wgcna/index.html',
    figcodeMap: {},
  },
  {
    id: 'lasso-cox',
    title: 'LASSO Cox',
    subtitle: '预后 Signature 构建',
    category: '生存分析',
    language: 'r',
    description: '上传表达 + 临床数据，用 LASSO Cox 筛选预后基因组合，输出 signature + KM + ROC。',
    longDescription: `LASSO Cox 预后模型构建全流程：
1. 单因素 Cox 筛选候选基因
2. LASSO 正则化选择最优基因组合
3. 计算 Risk Score + 分组
4. KM 验证 + 时间依赖 ROC
5. 输出：Signature 基因 + 系数 + KM 图 + ROC 图 + Risk 三联图`,
    inputs: [
      {
        id: 'expression',
        label: '表达矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因，列=样本',
      },
      {
        id: 'clinical',
        label: '临床信息',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '需含 OS.time、OS 列',
      },
      {
        id: 'candidate_genes',
        label: '候选基因列表（可选）',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '一列基因名。留空则用全部基因',
      },
      { id: 'train_ratio', label: '训练集比例', type: 'number', default: 0.7 },
      { id: 'seed', label: '随机种子', type: 'number', default: 42 },
    ],
    outputs: [
      { id: 'signature_table', type: 'table', label: 'Signature 基因 + 系数' },
      { id: 'km_plot', type: 'plot', label: 'KM 生存曲线' },
      { id: 'roc_plot', type: 'plot', label: '时间依赖 ROC' },
      { id: 'risk_triple', type: 'plot', label: 'Risk 三联图' },
      { id: 'lasso_cv', type: 'plot', label: 'LASSO CV 曲线' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/project-practice/module05',
    demoDataUrl: '/demo-data/lasso-cox-demo',
    estimatedMinutes: 3,
    packages: ['glmnet', 'survival', 'survminer', 'timeROC', 'ggplot2'],
    color: '#be185d',
    reportUrl: '/exports/tools/lasso-cox/index.html',
    figcodeMap: {
      'lasso_cv.png': 'lasso-cv-plot',
      'coef_barplot.png': 'lasso-coef',
      'risk_triple.png': 'risk-triple',
    },
  },
  {
    id: 'seurat-standard',
    title: 'Seurat 标准流程',
    subtitle: '单细胞 QC → 聚类 → Marker 识别',
    category: '单细胞',
    language: 'r',
    description:
      'Seurat v5 PBMC 3k 标准流程：QC → 归一化 → 高变基因 → PCA → 聚类 → UMAP → Marker。不含整合 / SCTransform / 空间组学 / 自动细胞类型注释。',
    longDescription: `Seurat v5 单细胞标准分析流程，跟随官方 PBMC 3k tutorial（https://satijalab.org/seurat/articles/pbmc3k_tutorial.html），9 步全流程：

1. **Load** — 读 10X 三件套或 .h5 → CreateSeuratObject (min.cells=3, min.features=200)
2. **QC** — PercentageFeatureSet 计算线粒体比例 → VlnPlot 三联图 + FeatureScatter
3. **Filter** — subset(nFeature_RNA 200-2500 & percent.mt < 5)
4. **Normalize** — LogNormalize (scale.factor=10000)
5. **HVGs** — FindVariableFeatures (vst, nfeatures=2000)
6. **Scale** — ScaleData (全基因)
7. **PCA** — RunPCA + ElbowPlot
8. **Cluster** — FindNeighbors (dims=1:10) → FindClusters (resolution=0.5)
9. **UMAP** — RunUMAP (dims=1:10) + DimPlot
10. **Markers** — FindAllMarkers (only.pos=TRUE) → DoHeatmap + VlnPlot top markers

**不在范围内**: integration（多样本整合）、SCTransform、空间组学、轨迹分析、自动细胞类型注释、doublet 检测。这些功能留给后续专门工具。

**参数默认值**: 全部跟随 Seurat 官方 PBMC 3k tutorial。注：BioF3 教程 docs/single-cell/module03 用 dims=1:20 是 dataset-specific 选择，本工具默认 dims=1:10 跟官方，可在参数中调整。`,
    inputs: [
      {
        id: 'matrix',
        label: 'Count Matrix / 10X 三件套',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt,.h5,.gz,.mtx',
        hint: '支持 .h5 (10X HDF5)、.csv/.tsv (行=基因 列=细胞)、.mtx (10X 三件套之一)',
      },
      {
        id: 'species',
        label: '物种',
        type: 'select',
        required: true,
        options: [
          { value: 'human', label: '人 (mt pattern: ^MT-)' },
          { value: 'mouse', label: '小鼠 (mt pattern: ^mt-)' },
        ],
        default: 'human',
        hint: '决定线粒体基因识别的正则模式',
      },
      {
        id: 'min_features',
        label: '最少基因数',
        type: 'number',
        default: 200,
        hint: '官方默认: CreateSeuratObject min.features=200',
      },
      {
        id: 'max_features',
        label: '最多基因数',
        type: 'number',
        default: 2500,
        hint: '官方 PBMC 3k tutorial: nFeature_RNA < 2500（过滤可能 doublet）',
      },
      {
        id: 'max_mt',
        label: '最大线粒体比例 (%)',
        type: 'number',
        default: 5,
        hint: '官方 PBMC 3k tutorial: percent.mt < 5',
      },
      {
        id: 'nfeatures',
        label: '高变基因数',
        type: 'number',
        default: 2000,
        hint: '官方默认: FindVariableFeatures nfeatures=2000',
      },
      {
        id: 'dims',
        label: 'PCA 维度',
        type: 'number',
        default: 10,
        hint: '官方默认 dims=1:10。BioF3 docs 教程用 1:20，可调',
      },
      {
        id: 'resolution',
        label: '聚类分辨率',
        type: 'number',
        default: 0.5,
        hint: '官方默认 resolution=0.5；0.4-1.2 都常见',
      },
      {
        id: 'top_n_markers',
        label: 'Top N markers per cluster',
        type: 'number',
        default: 10,
        hint: '用于 DoHeatmap 展示，官方教程 top 10',
      },
    ],
    outputs: [
      { id: 'qc_violin', type: 'plot', label: 'QC 三联小提琴图' },
      { id: 'qc_scatter', type: 'plot', label: 'QC scatter' },
      { id: 'hvg_plot', type: 'plot', label: '高变基因图' },
      { id: 'pca_dimplot', type: 'plot', label: 'PCA DimPlot' },
      { id: 'pca_dim_loadings', type: 'plot', label: 'PCA Top loadings' },
      { id: 'elbow_plot', type: 'plot', label: 'Elbow Plot' },
      { id: 'umap_clusters', type: 'plot', label: 'UMAP 聚类图' },
      { id: 'markers_heatmap', type: 'plot', label: 'Markers 热图' },
      { id: 'markers_violin', type: 'plot', label: 'Top markers 小提琴' },
      { id: 'feature_plot', type: 'plot', label: 'Top markers FeaturePlot' },
      { id: 'qc_metrics', type: 'table', label: 'QC 指标表' },
      { id: 'hvg_table', type: 'table', label: '高变基因表' },
      { id: 'umap_coords', type: 'table', label: 'UMAP 坐标 + cluster' },
      { id: 'markers_table', type: 'table', label: 'Marker 基因表' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/single-cell/module03',
    demoDataUrl: '/demo-data/seurat-demo',
    estimatedMinutes: 3,
    packages: ['Seurat', 'ggplot2', 'patchwork', 'dplyr'],
    color: '#4f46e5',
    reportUrl: '/exports/tools/seurat/index.html',
    figcodeMap: {
      'qc_violin.png': 'sc-qc-violin',
      'umap_clusters.png': 'umap',
      'pca_dimplot.png': 'pca',
      'markers_heatmap.png': 'sc-deg-heatmap',
      'markers_violin.png': 'sc-marker-bubble',
    },
  },
  {
    id: 'maftools-mutation',
    title: 'maftools 突变景观',
    subtitle: 'MAF 综合分析: Oncoplot + TiTv + Signature',
    category: '基因组',
    language: 'r',
    description:
      'maftools v2 突变景观分析: MAF 概览 → Oncoplot → TiTv → Lollipop → 互斥共现 → Mutational Signature。SCI 风格双格式输出（PNG + PDF, 300dpi）。Demo 用 maftools 官方内置 TCGA-LAML 真实数据（193 样本）。不含: TCGA cohort 对比、Drug-Gene 互作、生存分析（用 KM 工具）。',
    longDescription: `[maftools v2.24](https://bioconductor.org/packages/release/bioc/vignettes/maftools/inst/doc/maftools.html) 标准突变分析 7 步:

1. **Load** — 读 MAF 文件 + 临床表
2. **MAF 概览** — 6 panel 总览（样本变异分布 + 突变类型 + Top 10 基因）
3. **Oncoplot** — 突变景观图（Top N 基因 × 样本，临床 annotation track）
4. **TiTv** — 转换/颠换比例分析
5. **Lollipop** — Top 基因的蛋白域 + 突变位点图
6. **Somatic Interactions** — 互斥/共现矩阵 + p value
7. **Mutational Signatures** — 提取突变 signatures + COSMIC v3 比对

**输出**: 8 张图 × PNG + PDF 双格式 = 16 文件 + 7 份中间数据 + maf.rds 完整对象。**所有图 300dpi PDF 矢量, 可直接发表**。

**Demo**: maftools 官方 TCGA-LAML（193 AML 样本，含 FAB 分类）— 真实科研数据。

**不在范围内**: TCGA cohort 对比 (\`tcgaCompare\`)、Drug-Gene Interactions、PathwayAnalyzer、MAF 格式转换、生存分析（请用 BioF3 KM 工具）。`,
    inputs: [
      {
        id: 'maf_file',
        label: 'MAF 文件',
        type: 'file',
        required: true,
        accept: '.maf,.maf.gz,.txt,.gz',
        hint: 'TCGA 标准 MAF 格式 (Hugo_Symbol / Variant_Classification / Tumor_Sample_Barcode 等列)',
      },
      {
        id: 'clinical',
        label: '临床信息（可选）',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '至少含 Tumor_Sample_Barcode 列, 其他列作 oncoplot annotation',
      },
      {
        id: 'genome',
        label: '参考基因组',
        type: 'select',
        options: [
          { value: 'hg19', label: 'hg19 (TCGA-LAML demo / 旧 TCGA)' },
          { value: 'hg38', label: 'hg38 (新 TCGA / 自有数据)' },
        ],
        default: 'hg19',
        hint: '决定 mutational signature trinucleotide 上下文',
      },
      { id: 'top_n_oncoplot', label: 'Oncoplot Top N 基因', type: 'number', default: 20 },
      {
        id: 'lollipop_top_n',
        label: 'Lollipop 图基因数',
        type: 'number',
        default: 2,
        hint: '为 top N 突变基因画 lollipop',
      },
      {
        id: 'n_signatures',
        label: 'Mutational Signature 数',
        type: 'number',
        default: 3,
        hint: '小数据集用 3, 大队列可用 5-6',
      },
    ],
    outputs: [
      { id: 'maf_summary', type: 'plot', label: 'MAF 概览（6 panel）' },
      { id: 'oncoplot', type: 'plot', label: 'Oncoplot 突变景观' },
      { id: 'titv', type: 'plot', label: 'TiTv 转换/颠换' },
      { id: 'lollipop_top1', type: 'plot', label: 'Lollipop top1' },
      { id: 'lollipop_top2', type: 'plot', label: 'Lollipop top2' },
      { id: 'somatic_interactions', type: 'plot', label: '互斥/共现矩阵' },
      { id: 'mutation_signature', type: 'plot', label: 'Mutational Signature 谱' },
      { id: 'signature_cosmic_compare', type: 'plot', label: 'COSMIC v3 比对' },
      { id: 'gene_summary', type: 'table', label: '基因突变汇总' },
      { id: 'sample_summary', type: 'table', label: '样本突变汇总' },
      { id: 'interaction_matrix', type: 'table', label: '互斥共现矩阵' },
      { id: 'signature_contributions', type: 'table', label: 'Signature 贡献度' },
      { id: 'maf_rds', type: 'file', label: '完整 MAF 对象 (.rds)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包 (含 PDF)' },
    ],
    tutorialUrl: '/docs/genomics/module04',
    demoDataUrl: '/demo-data/maftools-demo',
    estimatedMinutes: 2,
    packages: ['maftools', 'BSgenome.Hsapiens.UCSC.hg19', 'BSgenome.Hsapiens.UCSC.hg38', 'NMF'],
    color: '#475569',
    reportUrl: '/exports/tools/maftools/index.html',
    figcodeMap: {},
  },
  {
    id: 'cellchat',
    title: 'CellChat 通讯',
    subtitle: '细胞-细胞通讯分析（单数据集）',
    category: '单细胞',
    language: 'r',
    description:
      'CellChat v2 单数据集分析：通讯网络图 + 显著 LR 气泡 + 信号角色分布。需要归一化表达矩阵 (CSV) + 细胞类型标注 (CSV)。不含: 多数据集对比、空间 CellChat、NMF pattern。',
    longDescription: `基于 [CellChat v2.2](https://htmlpreview.github.io/?https://github.com/jinworks/CellChat/blob/master/tutorial/CellChat-vignette.html) 标准单数据集流程：

1. **CellChat 对象创建** — 接收 normalized 表达 + cell_type 元数据
2. **预处理** — 选择 LR database (Secreted Signaling) → 识别过表达基因 / LR 对
3. **通讯概率推断** — \`computeCommunProb()\` 推断每对 cell type 间的 LR 通讯
4. **通路汇总** — 按 pathway 聚合（如 MHC-I / CD99 / MHC-II / MIF / GALECTIN）
5. **可视化** — 通讯网络（圆形 + 热图）+ LR 气泡图 + 信号角色（outgoing vs incoming）+ top pathway chord/violin

**输入要求**:
- 表达矩阵 = normalized log expression（CSV，行=基因 列=细胞）。注意 NOT raw counts
- 元数据 = 两列：cell_id（与表达矩阵列名对应）+ cell_type（细胞类型标签）

**输出**: 8 张图 × PNG + PDF 双格式 = 16 文件 + 4 份中间数据 + cellchat.rds 完整对象。SCI 风格 (theme_biof3 + 双格式 PDF)。

**Demo 数据**: PBMC 3k 9 种 cell types × 605 cells（基于 BioF3 Seurat 工具派生）。

**不在范围内**: 多数据集对比 (Tutorial Comparison)、Spatial CellChat、NMF pattern analysis、单 pathway 切片热图（用 RunModal）。`,
    inputs: [
      {
        id: 'expression',
        label: '归一化表达矩阵 (CSV)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因 / 列=细胞; 值为 log-normalized (NOT raw counts)',
      },
      {
        id: 'meta',
        label: '细胞元数据 (CSV)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '两列: cell_id (与表达矩阵列名对应) + cell_type',
      },
      {
        id: 'species',
        label: '物种',
        type: 'select',
        options: [
          { value: 'human', label: '人 (CellChatDB.human)' },
          { value: 'mouse', label: '小鼠 (CellChatDB.mouse)' },
        ],
        default: 'human',
      },
      {
        id: 'signaling_db',
        label: '信号子库',
        type: 'select',
        options: [
          { value: 'Secreted Signaling', label: 'Secreted Signaling (推荐)' },
          { value: 'Cell-Cell Contact', label: 'Cell-Cell Contact' },
          { value: 'ECM-Receptor', label: 'ECM-Receptor' },
          { value: 'all', label: '全部 (3 子库合并)' },
        ],
        default: 'Secreted Signaling',
      },
      {
        id: 'min_cells_per_group',
        label: '每组最小细胞数',
        type: 'number',
        default: 10,
        hint: 'filterCommunication 阈值, < 此值的 cell type 被滤掉',
      },
      {
        id: 'top_pathways_to_visualize',
        label: 'Top N 通路可视化',
        type: 'number',
        default: 5,
        hint: '为 top N 显著通路出 chord 图',
      },
    ],
    outputs: [
      { id: 'network_circle_count', type: 'plot', label: '通讯网络（互作数）' },
      { id: 'network_circle_weight', type: 'plot', label: '通讯网络（互作强度）' },
      { id: 'network_heatmap', type: 'plot', label: '通讯热图' },
      { id: 'bubble_top_LR', type: 'plot', label: 'Top LR 气泡图' },
      { id: 'signaling_role_scatter', type: 'plot', label: '信号角色 (outgoing vs incoming)' },
      { id: 'pathway_aggregate_top1', type: 'plot', label: '最显著 pathway chord 图' },
      { id: 'pathway_violin_top', type: 'plot', label: 'Top pathway violin' },
      { id: 'pathway_count_barplot', type: 'plot', label: '各 cell type 通路数' },
      { id: 'lr_significant', type: 'table', label: '显著 LR 对' },
      { id: 'pathway_significance', type: 'table', label: '通路显著性排序' },
      { id: 'signaling_role_data', type: 'table', label: '信号角色数据' },
      { id: 'cellchat_rds', type: 'file', label: '完整 CellChat 对象 (.rds)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包 (含 PDF)' },
    ],
    tutorialUrl: '/docs/single-cell/module07',
    demoDataUrl: '/demo-data/cellchat-demo',
    estimatedMinutes: 3,
    packages: ['CellChat', 'NMF', 'ggalluvial', 'circlize'],
    color: '#0d9488',
    reportUrl: '/exports/tools/cellchat/index.html',
    figcodeMap: {},
  },
  // ============================================================
  // 机器学习专栏 — Wave 1 占位(2026-05-26)
  // 7 个工具 ID + 元数据先就位,后端脚本与报告模板将在 Wave 2-4 完成。
  // 详细 spec: .kiro/drafts/machine-learning-spec.md
  // 后端约束: .kiro/steering/machine-learning-dev.md
  // ============================================================
  {
    id: 'ml-feature-select',
    title: 'ML 特征选择',
    subtitle: '5 种方法对比 + 韦恩图共识',
    category: '机器学习',
    language: 'r',
    description:
      '上传特征矩阵 + label,5 种方法(方差 / 单因素 / mRMR / Boruta / RFE)一键对比,输出 5 法各自排序 + 韦恩图共识 + 方法间相关性热图。仅二分类,需预先 imputed 无 NA。',
    longDescription: `特征选择 5 法对比工具(对应教程 [03 章](/docs/machine-learning/module03)):

1. **方差过滤**(filter,top variance)
2. **单因素 Wilcoxon / t-test**(filter,快速 baseline)
3. **mRMR**(filter,最大相关 / 最小冗余)
4. **Boruta**(wrapper,基于 RF)
5. **RFE**(wrapper,递归特征消除)

输出 5 法各自排序表 + 5 法韦恩图共识基因 + 推荐 top-N(用户可调)。

**已上线**(W2 阶段 B 完成于 2026-05-27)。配套教程见 [03 章](/docs/machine-learning/module03)。`,
    inputs: [
      {
        id: 'features',
        label: '特征矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征(基因 / Probe),列=样本',
      },
      {
        id: 'labels',
        label: '标签文件',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '两列:sample, label(二分类:0/1 或 Tumor/Normal)',
      },
      {
        id: 'top_n',
        label: 'Top N 推荐',
        type: 'number',
        default: 50,
        hint: '5 法投票后推荐 top N',
      },
    ],
    outputs: [
      { id: 'variance_table', type: 'table', label: '方差排序表' },
      { id: 'univariate_table', type: 'table', label: '单因素 Wilcoxon 排序表' },
      { id: 'mrmr_table', type: 'table', label: 'mRMR 排序表' },
      { id: 'boruta_table', type: 'table', label: 'Boruta 排序表' },
      { id: 'rfe_table', type: 'table', label: 'RFE 排序表' },
      { id: 'venn', type: 'plot', label: '5 法韦恩图' },
      { id: 'volcano', type: 'plot', label: '单因素火山图' },
      { id: 'consensus_top_n', type: 'table', label: '共识 Top N 基因' },
      { id: 'method_correlation', type: 'plot', label: '方法间相关性热图' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/machine-learning/module03',
    demoDataUrl: '/demo-data/ml-feature-select-demo',
    estimatedMinutes: 2,
    packages: ['caret', 'Boruta', 'mRMRe', 'glmnet', 'VennDiagram'],
    color: '#7c3aed',
    figcodeMap: {},
  },
  {
    id: 'ml-classifier',
    title: 'ML 分类器',
    subtitle: 'LR / SVM / RF / XGBoost 4 算法对比',
    category: '机器学习',
    language: 'r',
    description:
      '上传特征 + label,选 1-4 个算法对比,输出 ROC / PR / Calibration / 混淆矩阵 / 特征重要性 / 学习曲线 + bootstrap CI + 训好的 .rds 模型(可下游 SHAP)。',
    longDescription: `经典 ML 分类工具(对应教程 [04](/docs/machine-learning/module04) + [05 章](/docs/machine-learning/module05)):

支持算法:Logistic Regression / SVM(RBF kernel)/ Random Forest / XGBoost

输出全套评估:5-fold CV ROC / PR / Calibration plot / 混淆矩阵 / 特征重要性 / 学习曲线 / Bootstrap CI / DCA。

支持二分类(默认)+ 多分类(macro-AUC / per-class metrics)。模型 .rds 可在 SHAP 工具中导入做可解释性分析。`,
    inputs: [
      {
        id: 'features',
        label: '特征矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征,列=样本',
      },
      {
        id: 'labels',
        label: '标签文件',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '两列:sample, label',
      },
      {
        id: 'algorithms',
        label: '选择算法',
        type: 'select',
        options: [
          { value: 'all', label: '4 算法全部' },
          { value: 'lr', label: '仅 Logistic Regression' },
          { value: 'svm', label: '仅 SVM' },
          { value: 'rf', label: '仅 Random Forest' },
          { value: 'xgb', label: '仅 XGBoost' },
        ],
        default: 'all',
      },
      {
        id: 'task_type',
        label: '任务类型',
        type: 'select',
        options: [
          { value: 'binary', label: '二分类' },
          { value: 'multiclass', label: '多分类' },
        ],
        default: 'binary',
      },
    ],
    outputs: [
      { id: 'roc_curves', type: 'plot', label: '4 算法 ROC 重叠图' },
      { id: 'pr_curves', type: 'plot', label: 'PR 曲线' },
      { id: 'calibration', type: 'plot', label: 'Calibration plot' },
      { id: 'confusion_matrices', type: 'plot', label: '混淆矩阵' },
      { id: 'feature_importance', type: 'plot', label: '特征重要性对比' },
      { id: 'learning_curve', type: 'plot', label: '学习曲线' },
      { id: 'metrics_table', type: 'table', label: '指标汇总表' },
      { id: 'model_rds', type: 'file', label: '训好的模型 (.rds,可用于 SHAP)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/machine-learning/module04',
    estimatedMinutes: 3,
    packages: ['caret', 'glmnet', 'e1071', 'randomForest', 'xgboost', 'pROC'],
    color: '#dc2626',
    figcodeMap: {},
  },
  {
    id: 'rsf-survival',
    title: '随机生存森林(RSF)',
    subtitle: '非线性预后建模 + VIMP',
    category: '机器学习',
    language: 'r',
    description:
      '上传特征 + 临床(OS time/event),用 randomForestSRC 训 RSF,输出 C-index + 时间 ROC + VIMP + 部分依赖图 + KM 曲线 + Risk 三联图。',
    longDescription: `随机生存森林(RSF)预后建模工具(对应教程 [06 章](/docs/machine-learning/module06)):

与已有 [lasso-cox](/tools/) 形成对比:LASSO Cox = linear baseline,RSF = 非线性 + 交互。

输出:Train / OOB / Test C-index / 时间依赖 ROC(可自定义时间点)/ VIMP 排序 + 部分依赖图(top 4 features)/ Risk score 三联图(KM + scatter + heatmap)。

时间单位 auto 检测(median > 30 → days,否则 years),输入 time_points 按年填即可。`,
    inputs: [
      {
        id: 'features',
        label: '特征矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征,列=样本',
      },
      {
        id: 'clinical',
        label: '临床信息',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '需含 sample_id / OS_time(天/月/年)/ OS_event(0/1)列',
      },
      {
        id: 'ntree',
        label: '树数量',
        type: 'number',
        default: 500,
        hint: 'RSF 默认 500,可调到 200-2000',
      },
      {
        id: 'mtry',
        label: 'mtry(每分裂候选)',
        type: 'text',
        default: 'auto',
        hint: 'auto = sqrt(p),也可填整数',
      },
      { id: 'time_points', label: '时间 ROC 评估点(年,逗号分隔)', type: 'text', default: '1,3,5' },
      { id: 'top_n_features', label: 'VIMP top N', type: 'number', default: 20 },
    ],
    outputs: [
      { id: 'cindex_table', type: 'table', label: 'C-index 表' },
      { id: 'time_roc', type: 'plot', label: '时间依赖 ROC' },
      { id: 'vimp', type: 'plot', label: 'VIMP 排序' },
      { id: 'partial_dependence', type: 'plot', label: 'Top features 部分依赖图' },
      { id: 'risk_triple', type: 'plot', label: 'Risk 三联图' },
      { id: 'model_rds', type: 'file', label: 'RSF 模型 (.rds)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/machine-learning/module06',
    estimatedMinutes: 4,
    packages: ['randomForestSRC', 'survival', 'timeROC', 'pec'],
    color: '#0891b2',
    figcodeMap: {},
  },
  {
    id: 'shap-explain',
    title: 'SHAP 可解释性',
    subtitle: '全局 + 单样本 + 依赖图',
    category: '机器学习',
    language: 'r',
    description:
      '从已完成的 ml-classifier 任务导入模型,跑 SHAP 全局重要性 + beeswarm + 单样本 force plot + 依赖图。',
    longDescription: `SHAP 模型可解释性工具(对应教程 [10 章](/docs/machine-learning/module10)):

**输入**:不需要重新上传 — 直接复用已完成的 [ml-classifier](/tools/#ml-classifier) 任务的模型 + 标准化 test 数据。在工具页跑完一次 ml-classifier,从历史记录复制 jobId 粘贴到下方即可。

**SHAP 算法**:统一用 iml::Shapley(kernel SHAP)适配 LR / SVM / RF / XGB,无需对每个算法定制后端。基于上游 \`feature_importance\` 自动选 top_n 特征控制运行时长。

**输出**:5 张 SCI 双格式图(全局重要性 + beeswarm + 单样本 force + 依赖图 + 算法对比)+ 每算法 SHAP 矩阵 + summary。`,
    inputs: [
      {
        id: 'upstream_jobid',
        label: '上游 ml-classifier 任务 ID',
        type: 'text',
        required: true,
        placeholder: 'job_xxxxxxxxxxxxxxxx',
        hint: '在 [我的任务] 复制已完成的 ml-classifier jobId 粘贴在此',
      },
      {
        id: 'algorithms',
        label: '解释哪些算法',
        type: 'select',
        options: [
          { value: 'all', label: '全部上游算法' },
          { value: 'lr', label: '仅 LR' },
          { value: 'svm', label: '仅 SVM' },
          { value: 'rf', label: '仅 RF' },
          { value: 'xgb', label: '仅 XGB' },
        ],
        default: 'all',
      },
      {
        id: 'top_n',
        label: 'Top N features (SHAP 计算用)',
        type: 'number',
        default: 20,
        hint: '用上游 feature_importance 选 top N 特征做 SHAP,降维加速。范围 5-100',
      },
      {
        id: 'n_explain_samples',
        label: 'SHAP 样本数',
        type: 'number',
        default: 30,
        hint: '用多少个 test 样本算全局 SHAP。范围 5-100',
      },
      { id: 'sample_index', label: '单样本 force plot 选第 N 个', type: 'number', default: 1 },
    ],
    outputs: [
      { id: 'global_importance', type: 'plot', label: '全局 SHAP 重要性' },
      { id: 'beeswarm', type: 'plot', label: 'SHAP beeswarm' },
      { id: 'force_plot', type: 'plot', label: '单样本 force plot' },
      { id: 'dependence', type: 'plot', label: 'Top 4 依赖图' },
      { id: 'algorithm_comparison', type: 'plot', label: '算法对比' },
      { id: 'shap_global_csv', type: 'table', label: '每样本 SHAP 矩阵' },
      { id: 'shap_summary_csv', type: 'table', label: 'SHAP 全局排序' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/machine-learning/module10',
    estimatedMinutes: 4,
    packages: ['iml', 'caret', 'glmnet', 'randomForest', 'xgboost', 'e1071'],
    color: '#0891b2',
    figcodeMap: {},
  },
  {
    id: 'consensus-cluster',
    title: '一致性聚类亚型',
    subtitle: 'ConsensusClusterPlus 亚型发现',
    category: '机器学习',
    language: 'r',
    description:
      '上传特征矩阵,跑 ConsensusClusterPlus 找最优 k,输出 CDF + Δarea + 一致性矩阵 panel + Silhouette + PCA 投影 + 与已知标签的 ARI 验证。',
    longDescription: `无监督亚型发现工具(对应教程 [07 章](/docs/machine-learning/module07)):

基于 ConsensusClusterPlus(Bioconductor)做 k=2 到 max_k 的重采样投票一致性聚类。

**自动选 k**:Δ(area) 拐点法 + CDF 平稳性双指标。

**输出**:CDF / Δ(area) / 一致性矩阵 panel / Silhouette / PCA 亚型投影 / Known×Found 列联表(若提供 known_labels)。

**ARI 验证**:提供已知标签(如 PAM50、临床分组)→ 计算 Adjusted Rand Index 评估发现亚型与已知类别的一致性。`,
    inputs: [
      {
        id: 'matrix',
        label: '特征矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征,列=样本',
      },
      {
        id: 'max_k',
        label: '最大 k',
        type: 'number',
        default: 8,
        hint: 'ConsensusCluster 试 k=2 到 max_k',
      },
      { id: 'reps', label: '重采样次数', type: 'number', default: 1000, hint: '官方默认 1000' },
      {
        id: 'distance',
        label: '距离度量',
        type: 'select',
        options: [
          { value: 'pearson', label: 'Pearson(推荐)' },
          { value: 'spearman', label: 'Spearman' },
          { value: 'euclidean', label: 'Euclidean' },
        ],
        default: 'pearson',
      },
      {
        id: 'known_labels',
        label: '已知标签(可选,验证用)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '两列:sample, label。提供则计算 ARI',
      },
    ],
    outputs: [
      { id: 'cdf_plot', type: 'plot', label: 'CDF 累积分布' },
      { id: 'delta_area', type: 'plot', label: 'Δarea 最优 k' },
      { id: 'consensus_matrices', type: 'plot', label: '一致性矩阵热图' },
      { id: 'subtype_assignment', type: 'table', label: '亚型注释表' },
      { id: 'silhouette', type: 'plot', label: 'Silhouette score' },
      { id: 'ari_validation', type: 'text', label: 'ARI 验证(若提供已知标签)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
      { id: 'zip', type: 'file', label: '全部结果打包' },
    ],
    tutorialUrl: '/docs/machine-learning/module07',
    estimatedMinutes: 5,
    packages: ['ConsensusClusterPlus', 'NMF', 'cluster', 'mclust'],
    color: '#059669',
    figcodeMap: {},
  },
  {
    id: 'ml-autoencoder',
    title: 'Autoencoder 表征(深度学习)',
    subtitle: 'PyTorch 非线性降维',
    category: '机器学习',
    language: 'python',
    description:
      '上传特征矩阵(行=基因,列=样本),PyTorch 训 Autoencoder 压到指定 latent 维度,输出 latent embedding + 损失曲线 + PCA 对比 + 重构质量。',
    longDescription: `深度学习降维工具(对应教程 [08 章](/docs/machine-learning/module08)):

用 PyTorch 训一个 p → hidden → latent → hidden → p 的 vanilla Autoencoder。基于上游 [ml-feature-select](/tools/#ml-feature-select) 的 HVG 矩阵直接降维。

**输入**:特征矩阵 CSV(行=基因,列=样本;工具自动 z-score)。

**输出**:
- 训练 / 验证 MSE loss 曲线(早停诊断)
- Latent 2D PCA 散点
- PCA(原始)vs Autoencoder(latent)对比
- 重构 vs 真实表达散点(模型保真度)
- latent_embeddings.csv(可下游喂 ml-classifier)

**Python 后端**(py-server \`ml_autoencoder\` task type · 容器 PyTorch 2.12 + cu130 · 容器有 GPU 时秒级,CPU 模式 ~10s/100 epochs)。`,
    inputs: [
      {
        id: 'matrix',
        label: '特征矩阵',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=基因,列=样本(或反过来,工具自动 transpose)',
      },
      {
        id: 'latent_dim',
        label: 'Latent 维度',
        type: 'number',
        default: 16,
        hint: 'Bottleneck 大小,通常 8-32',
      },
      { id: 'hidden_dim', label: 'Hidden 维度', type: 'number', default: 256 },
      {
        id: 'epochs',
        label: 'Epochs',
        type: 'number',
        default: 100,
        hint: '默认 100 + early stopping(patience=10)',
      },
      { id: 'batch_size', label: 'Batch size', type: 'number', default: 32 },
      { id: 'lr', label: 'Learning rate', type: 'number', default: 0.001 },
      { id: 'seed', label: 'Random seed', type: 'number', default: 42 },
    ],
    outputs: [
      { id: 'loss_curve', type: 'plot', label: '训练 / 验证 loss 曲线' },
      { id: 'latent_2d', type: 'plot', label: 'Latent PCA 2D 散点' },
      { id: 'pca_vs_ae', type: 'plot', label: 'PCA vs Autoencoder 对比' },
      { id: 'reconstruction', type: 'plot', label: '重构质量散点' },
      { id: 'latent_embeddings', type: 'table', label: 'Latent embeddings (CSV)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/machine-learning/module08',
    estimatedMinutes: 2,
    packages: ['pytorch', 'scikit-learn', 'matplotlib', 'pandas'],
    color: '#7c3aed',
    figcodeMap: {},
  },
  {
    id: 'ml-scvi-annotate',
    title: 'scVI 单细胞 ML',
    subtitle: 'scVI 整合 + scANVI 自动注释',
    category: '机器学习',
    language: 'python',
    description:
      '上传 AnnData(.h5ad),scvi-tools 训 VAE + 负二项 + UMAP + Leiden 聚类。Python / py-server 后端,演示 600 cells × 2000 genes 端到端 ~50 秒。',
    longDescription: `单细胞深度学习工具(对应教程 [09 章](/docs/machine-learning/module09)):

基于 [scvi-tools](https://scvi-tools.org/),用 VAE + 负二项分布建模单细胞。

**功能**(v1):
- scVI 训练 + 16 维 latent embedding(可调)
- UMAP + Leiden 聚类
- 训练 ELBO loss 曲线

**输入**:.h5ad(行=cells,列=genes;raw counts 推荐)。

**输出**:UMAP plot + ELBO 曲线 + 整合后的 .h5ad(含 \`adata.obsm["X_scVI"]\`)。

**Python 后端**(走 py-server 的 \`scvi_annotation\` task type · 容器 PyTorch 2.12 + cu130 + scvi-tools 1.4.2)。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad',
        hint: '行=cells,列=genes;raw counts 推荐',
      },
      { id: 'nLatent', label: 'Latent 维度', type: 'number', default: 16, hint: '通常 8-32' },
      {
        id: 'max_epochs',
        label: 'Max epochs',
        type: 'number',
        default: 100,
        hint: '默认 100 + early stopping;教学可降到 20-50 加速',
      },
      {
        id: 'reference_labels',
        label: 'Reference labels 列名(可选)',
        type: 'text',
        default: 'cell_type',
        hint: 'scANVI 用作参考标签,留默认即可',
      },
    ],
    outputs: [
      { id: 'umap', type: 'plot', label: 'UMAP(scVI 整合后聚类)' },
      { id: 'elbo', type: 'plot', label: '训练 ELBO 曲线' },
      { id: 'adata_out', type: 'file', label: '整合后 AnnData(含 X_scVI)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/machine-learning/module09',
    estimatedMinutes: 3,
    packages: ['scvi-tools', 'pytorch', 'scanpy', 'anndata'],
    color: '#0d9488',
    figcodeMap: {},
  },
  // ============================================================
  // 多组学整合专栏 — 第二期补缺(2026-05-28)
  // ============================================================
  {
    id: 'mo-mofa',
    title: 'MOFA2 多组学因子分析',
    subtitle: '多层组学因子分解 + 方差解释',
    category: '多组学',
    language: 'r',
    description:
      '上传 2-4 层组学矩阵,MOFA2 提取跨组学潜因子,输出方差解释热图 + 因子权重 + 因子散点 + 数据总览 + 富集分析。',
    longDescription: `多组学因子分析工具(对应教程 [05 章](/docs/integration/module05)):

基于 [MOFA2](https://biofam.github.io/MOFA2/)(Multi-Omics Factor Analysis v2),用概率矩阵分解从多层组学数据中提取潜因子。

**核心能力**:
- 自动训练 MOFA 模型(15 因子,slow convergence)
- 方差解释热图(哪个因子在哪层有贡献)
- 因子权重 Top 特征(每个因子由哪些基因/CpG/蛋白驱动)
- 因子散点(样本在因子空间的分布,按分组着色)
- 数据总览(各层缺失模式)
- Top 因子权重做 GSEA 富集

**输入**:2-4 个 CSV 矩阵(行=特征,列=样本;列名需一致)+ 可选分组文件。

**输出**:6 张 SCI 双格式图 + 因子得分表 + 方差分解表 + HTML 报告。`,
    inputs: [
      {
        id: 'omics_layer1',
        label: '组学层 1(如 mRNA)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征,列=样本',
      },
      {
        id: 'omics_layer2',
        label: '组学层 2(如 Methylation)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=特征,列=样本;列名需与层 1 一致',
      },
      {
        id: 'omics_layer3',
        label: '组学层 3(可选)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '可选第三层数据',
      },
      {
        id: 'group_file',
        label: '分组文件(可选)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '两列:sample, group。用于因子散点着色',
      },
      {
        id: 'num_factors',
        label: '因子数',
        type: 'number',
        default: 15,
        hint: '通常 10-20,MOFA2 会自动 drop inactive',
      },
      {
        id: 'convergence_mode',
        label: '收敛模式',
        type: 'select',
        options: [
          { value: 'slow', label: 'Slow(推荐,更稳定)' },
          { value: 'medium', label: 'Medium' },
          { value: 'fast', label: 'Fast(快速预览)' },
        ],
        default: 'slow',
      },
    ],
    outputs: [
      { id: 'variance_heatmap', type: 'plot', label: '方差解释热图' },
      { id: 'variance_total', type: 'plot', label: '各层总方差' },
      { id: 'top_weights', type: 'plot', label: '因子权重 Top 特征' },
      { id: 'factor_scatter', type: 'plot', label: '因子散点(F1 vs F2)' },
      { id: 'factor_cor', type: 'plot', label: '因子相关性' },
      { id: 'data_overview', type: 'plot', label: '数据总览' },
      { id: 'factor_scores', type: 'table', label: '因子得分表' },
      { id: 'variance_table', type: 'table', label: '方差分解表' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/integration/module05',
    estimatedMinutes: 5,
    packages: ['MOFA2', 'ggplot2', 'pheatmap', 'msigdbr', 'fgsea'],
    color: '#6366f1',
    figcodeMap: {},
  },
  {
    id: 'mo-snf',
    title: 'SNF 网络融合亚型',
    subtitle: '相似性网络融合 + 谱聚类',
    category: '多组学',
    language: 'r',
    description:
      '上传 2-3 层组学矩阵,SNF 融合相似性网络后谱聚类,输出融合网络热图 + 亚型分配 + NMI/ARI 验证(若提供已知标签)。',
    longDescription: `多组学网络融合工具(对应教程 [06 章](/docs/integration/module06)):

基于 [SNFtool](https://cran.r-project.org/package/SNFtool)(Similarity Network Fusion),把每层组学数据各自构建样本相似性网络,然后迭代融合为一个统一网络,最后做谱聚类发现亚型。

**核心能力**:
- 每层独立构建 KNN 相似性网络
- 迭代融合(默认 20 轮)
- Eigen-gap 自动估计最优 k
- 谱聚类 + 亚型分配表
- 融合网络热图可视化
- 若提供已知标签:NMI + ARI 验证

**输入**:2-3 个 CSV 矩阵(行=样本,列=特征)+ 可选已知标签。

**输出**:5 张 SCI 双格式图 + 亚型分配表 + HTML 报告。`,
    inputs: [
      {
        id: 'omics_layer1',
        label: '组学层 1(如 mRNA)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=样本,列=特征',
      },
      {
        id: 'omics_layer2',
        label: '组学层 2(如 Methylation)',
        type: 'file',
        required: true,
        accept: '.csv,.tsv,.txt',
        hint: '行=样本,列=特征;行名需与层 1 一致',
      },
      {
        id: 'omics_layer3',
        label: '组学层 3(可选)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '可选第三层数据',
      },
      {
        id: 'known_labels',
        label: '已知标签(可选)',
        type: 'file',
        required: false,
        accept: '.csv,.tsv,.txt',
        hint: '两列:sample, label。提供则计算 NMI/ARI',
      },
      {
        id: 'K',
        label: 'KNN 邻居数',
        type: 'number',
        default: 20,
        hint: 'SNF 的 K 参数,通常 10-30',
      },
      {
        id: 'alpha',
        label: '超参数 alpha',
        type: 'number',
        default: 0.5,
        hint: '网络构建的 scaling 参数',
      },
      {
        id: 'T_iter',
        label: '融合迭代次数',
        type: 'number',
        default: 20,
        hint: '通常 10-30 即收敛',
      },
      {
        id: 'max_k',
        label: '最大聚类数',
        type: 'number',
        default: 8,
        hint: 'Eigen-gap 搜索范围 2 到 max_k',
      },
    ],
    outputs: [
      { id: 'fused_heatmap', type: 'plot', label: '融合网络热图' },
      { id: 'eigen_gap', type: 'plot', label: 'Eigen-gap 最优 k' },
      { id: 'cluster_heatmap', type: 'plot', label: '聚类结果热图' },
      { id: 'silhouette', type: 'plot', label: 'Silhouette score' },
      { id: 'alluvial', type: 'plot', label: '亚型 vs 已知标签(若提供)' },
      { id: 'subtype_table', type: 'table', label: '亚型分配表' },
      { id: 'nmi_ari', type: 'text', label: 'NMI/ARI 验证(若提供标签)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/integration/module06',
    estimatedMinutes: 3,
    packages: ['SNFtool', 'cluster', 'pheatmap', 'mclust', 'ggalluvial'],
    color: '#ea580c',
    figcodeMap: {},
  },
  {
    id: 'mo-multivi',
    title: 'MultiVI 单细胞多模态',
    subtitle: 'scRNA + scATAC 联合整合',
    category: '多组学',
    language: 'python',
    description:
      '上传 10x multiome AnnData(.h5ad),scvi-tools MultiVI 训练联合 VAE,输出整合 UMAP + 联合聚类 + RNA/ATAC 各自贡献。',
    longDescription: `单细胞多模态整合工具(对应教程 [09 章](/docs/integration/module09)):

基于 [scvi-tools MultiVI](https://docs.scvi-tools.org/en/stable/user_guide/models/multivi.html),用变分推断联合建模 scRNA-seq + scATAC-seq。

**核心能力**:
- MultiVI 联合 VAE 训练
- 整合后 UMAP + Leiden 聚类
- RNA / ATAC 各自的 accessibility / expression 贡献
- 训练 loss 曲线

**输入**:.h5ad(MuData 格式,含 RNA + ATAC 两层)。

**输出**:UMAP + 聚类 + 贡献图 + 整合后 .h5ad。

**Python 后端**(py-server \`mo_multivi\` task type)。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad',
        hint: 'MuData 格式,含 RNA + ATAC 两层',
      },
      { id: 'n_latent', label: 'Latent 维度', type: 'number', default: 20, hint: '通常 10-30' },
      {
        id: 'max_epochs',
        label: 'Max epochs',
        type: 'number',
        default: 100,
        hint: '默认 100 + early stopping',
      },
    ],
    outputs: [
      { id: 'umap', type: 'plot', label: 'UMAP(MultiVI 整合)' },
      { id: 'loss_curve', type: 'plot', label: '训练 loss 曲线' },
      { id: 'accessibility', type: 'plot', label: 'ATAC accessibility' },
      { id: 'adata_out', type: 'file', label: '整合后 AnnData' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/integration/module09',
    estimatedMinutes: 5,
    packages: ['scvi-tools', 'pytorch', 'scanpy', 'muon'],
    color: '#8b5cf6',
    figcodeMap: {},
    comingSoon: true,
  },
  {
    id: 'mo-citeseq',
    title: 'CITE-seq WNN 整合',
    subtitle: 'scRNA + ADT 加权最近邻',
    category: '多组学',
    language: 'python',
    description:
      '上传含 ADT 层的 AnnData(.h5ad),用 WNN 加权最近邻整合 RNA + 蛋白,输出联合 UMAP + ADT 分布 + 模态权重。',
    longDescription: `CITE-seq 多模态整合工具(对应教程 [10 章](/docs/integration/module10)):

基于 WNN(Weighted Nearest Neighbor)方法,联合 scRNA-seq 和 ADT(抗体衍生标签)蛋白数据。

**核心能力**:
- RNA + ADT 各自降维
- WNN 加权融合
- 联合 UMAP + Leiden 聚类
- ADT marker 分布图
- 每个细胞的 RNA/ADT 模态权重

**输入**:.h5ad(含 \`adata.obsm["protein"]\` 或 \`adata.uns["protein"]\` ADT 层)。

**输出**:WNN UMAP + ADT 分布 + 模态权重图 + 整合后 .h5ad。

**Python 后端**(py-server \`mo_citeseq\` task type)。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad',
        hint: '含 ADT 层的 AnnData',
      },
      {
        id: 'n_neighbors',
        label: 'KNN 邻居数',
        type: 'number',
        default: 20,
        hint: 'WNN 的 k 参数',
      },
      {
        id: 'resolution',
        label: 'Leiden resolution',
        type: 'number',
        default: 1.0,
        hint: '聚类分辨率',
      },
    ],
    outputs: [
      { id: 'wnn_umap', type: 'plot', label: 'WNN UMAP' },
      { id: 'adt_distribution', type: 'plot', label: 'ADT marker 分布' },
      { id: 'modality_weights', type: 'plot', label: '模态权重' },
      { id: 'adata_out', type: 'file', label: '整合后 AnnData' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/integration/module10',
    estimatedMinutes: 3,
    packages: ['scanpy', 'muon', 'anndata', 'matplotlib'],
    color: '#d946ef',
    figcodeMap: {},
    comingSoon: true,
  },
  // ============================================================
  // 空间组学专栏 — Wave 2 (2026-05-28)
  // 详细 spec: .kiro/drafts/spatial-spec.md
  // ============================================================
  {
    id: 'spatial-standard',
    title: '空间转录组标准分析',
    subtitle: 'Visium / Stereo-seq / MERFISH 一键流程',
    category: '空间组学',
    language: 'python',
    description:
      "上传空间转录组 AnnData (.h5ad)，自动跑 QC + 标准化 + 聚类 + UMAP + 邻域富集 + 空间高变基因检测（Moran's I）。后端走 py-server (scanpy + Squidpy)。",
    longDescription: `空间转录组标准分析（对应 [module10](/docs/single-cell/module10)）:

基于 [scanpy](https://scanpy.readthedocs.io/) + [Squidpy](https://squidpy.readthedocs.io/) 完整流程:

**核心能力**:
- 标准化 + log1p + HVG 选择 (top 2000)
- PCA → KNN → Leiden 聚类 → UMAP
- **空间聚类图**: 在组织切片坐标上展示聚类（自动叠加 H&E 底图，如果 \`adata.uns['spatial']\` 含 hires image）
- **邻域富集**: Squidpy \`nhood_enrichment\` z-score 热图（哪些 cluster 在空间上挨着）
- **空间高变基因 (SVG)**: Moran's I 排名 + top-4 SVG 空间分布拼图

**输入**: \`.h5ad\` 含 \`obsm['spatial']\`（必需，n_spots × 2 坐标）。推荐含 \`uns['spatial'][...]['images']['hires']\`（10x Visium 标准格式）以叠加组织底图。raw counts 推荐。

**输出**:
- 4 张 SCI 图（空间聚类 / UMAP / 邻域富集 / Top SVGs）
- \`top_svgs.csv\` (Moran's I 排名 + p-value)
- \`result_spatial.h5ad\` (含 leiden/umap/spatial_neighbors)
- \`summary.json\` (n_spots, n_clusters, n_significant_svgs, top SVG 列表)

**Python 后端**: py-server \`spatial_standard\` task type，容器 biof3_python_1（scanpy 1.11.5 + squidpy 1.8.1 + spatialdata 0.7.3）。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad,.h5',
        hint: '空间转录组 AnnData，需含 obsm["spatial"] 坐标',
      },
      {
        id: 'nPCs',
        label: 'PC 数',
        type: 'number',
        default: 30,
        hint: '通常 20-50；Visium 30 即可',
      },
      {
        id: 'resolution',
        label: 'Leiden resolution',
        type: 'number',
        default: 0.5,
        hint: '聚类粒度。组织复杂时调大（0.8-1.2）',
      },
      {
        id: 'coordType',
        label: '坐标类型',
        type: 'select',
        default: 'generic',
        options: [
          { value: 'generic', label: 'generic (Stereo-seq / MERFISH 等非网格)' },
          { value: 'grid', label: 'grid (10x Visium 六角网格)' },
        ],
        hint: 'Squidpy spatial_neighbors 用',
      },
      {
        id: 'nNeighbors',
        label: '邻居数',
        type: 'number',
        default: 6,
        hint: 'Visium 六角网格 = 6',
      },
      {
        id: 'topSVGs',
        label: 'Top SVGs 数量',
        type: 'number',
        default: 50,
        hint: "Moran's I 排序后保留前 N",
      },
    ],
    outputs: [
      { id: 'spatial_clusters', type: 'plot', label: '空间聚类（组织底图 + spot 着色）' },
      { id: 'umap', type: 'plot', label: 'UMAP' },
      { id: 'nhood_enrichment', type: 'plot', label: '邻域富集 z-score 热图' },
      { id: 'top_svgs_plot', type: 'plot', label: 'Top SVGs 空间分布' },
      { id: 'top_svgs_csv', type: 'table', label: "Top SVGs (Moran's I)" },
      { id: 'adata_out', type: 'file', label: '处理后 AnnData (.h5ad)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/single-cell/module09',
    estimatedMinutes: 5,
    packages: ['scanpy', 'squidpy', 'spatialdata', 'anndata', 'matplotlib'],
    color: '#7c2d12', // 与 single-cell ANALYSIS_TYPES.spatial 的颜色一致
    figcodeMap: {
      'plot_001_spatial_clusters.png': 'spatial-cluster',
      'plot_004_top_svgs.png': 'feature-spatial',
      'plot_003_nhood_enrichment.png': 'squidpy-neighbors',
    },
    // W2 (2026-05-28): demo 已上线，公开 demo 可看
  },
  // ============================================================
  // 空间组学 Wave 4-B 三件套（2026-05-29）
  // ============================================================
  {
    id: 'spatial-svg',
    title: '空间高变基因 (SVG)',
    subtitle: "Moran's I + Geary's C + Sepal 三方法",
    category: '空间组学',
    language: 'python',
    description:
      "上传空间转录组 AnnData，三种方法（Moran's I + Geary's C + Sepal）并行检测空间高变基因，输出三方法韦恩图共识 + score 相关性。后端走 py-server (Squidpy)。",
    longDescription: `空间高变基因（Spatially Variable Genes, SVGs）检测工具：

**为什么要 3 种方法？** 单一方法（如 Moran\'s I）容易受数据噪声影响。本工具同时跑：
- **[Moran\'s I](https://squidpy.readthedocs.io/en/stable/api/squidpy.gr.spatial_autocorr.html)** — 经典空间自相关，对全局聚集敏感
- **Geary\'s C** — 局部空间不相似度，对边界 / 渐变敏感
- **[Sepal](https://squidpy.readthedocs.io/en/stable/api/squidpy.gr.sepal.html)** — 基于扩散时间，favors patterned over noisy

**Robust SVGs** = 至少在 ≥ 2 种方法的 top-N 中都被检测到（默认 ≥ 2，可调）。这种交集筛选大幅降低假阳性。

**输入**：\`.h5ad\` 含 \`obsm['spatial']\`。如果上传的是 spatial-standard 输出的 \`result_spatial.h5ad\`（已含 leiden / HVG / log1p / spatial_neighbors），脚本直接复用；否则自动补 normalize_total + log1p + HVG。

**输出**：
- \`plot_001_spatial_clusters.png\` — 父分析 cluster 上下文
- \`plot_002_top_robust_svgs.png\` — Top 4 robust SVGs 空间分布
- \`plot_003_method_venn.png\` — 三方法 top-N Venn 图
- \`plot_004_score_corr.png\` — Moran I × Sepal score 散点
- \`top_svgs.csv\` — per-gene 三方法分数 + rank + robust 标注
- \`result_spatial.h5ad\` — 父 AnnData + \`uns['svg_results']\`
- \`metadata.csv\` / \`features.csv\`

**Python 后端**: py-server \`spatial_svg\` task type（Squidpy 1.8 + matplotlib_venn 1.1）。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad,.h5',
        hint: '空间转录组 AnnData，需含 obsm["spatial"] 坐标',
      },
      {
        id: 'topN',
        label: 'Per-method top-N',
        type: 'number',
        default: 50,
        hint: '每种方法保留 top-N 基因，再做交集',
      },
      {
        id: 'minMethods',
        label: 'Robust 阈值',
        type: 'number',
        default: 2,
        hint: 'Robust SVG = 在 ≥ 此值方法中均被 top-N 检出。范围 1-3',
      },
      {
        id: 'nPerms',
        label: 'Permutations',
        type: 'number',
        default: 100,
        hint: 'Moran/Geary 显著性置换次数',
      },
      {
        id: 'nGenesTest',
        label: '测试基因数上限',
        type: 'number',
        default: 1000,
        hint: '从 HVG 选 top-N 跑三方法，控制运行时长',
      },
    ],
    outputs: [
      { id: 'spatial_clusters', type: 'plot', label: '父分析 cluster 上下文' },
      { id: 'top_robust_svgs', type: 'plot', label: 'Top robust SVGs 空间分布' },
      { id: 'method_venn', type: 'plot', label: '三方法 top-N Venn' },
      { id: 'score_corr', type: 'plot', label: '方法间 score 相关性' },
      { id: 'top_svgs_csv', type: 'table', label: 'Top SVGs（三方法合并）' },
      { id: 'result_h5ad', type: 'file', label: '结果 AnnData (.h5ad)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/single-cell/module09',
    estimatedMinutes: 4,
    packages: ['squidpy', 'scanpy', 'matplotlib_venn', 'anndata'],
    color: '#9a3412',
    figcodeMap: {
      'plot_001_spatial_clusters.png': 'spatial-cluster',
      'plot_002_top_robust_svgs.png': 'feature-spatial',
    },
  },
  {
    id: 'spatial-deconv',
    title: '空间细胞解卷积',
    subtitle: 'Tangram 单细胞参考映射 → 每 spot 细胞类型',
    category: '空间组学',
    language: 'python',
    description:
      '上传空间转录组 AnnData，用 Tangram 把单细胞参考图谱（默认 sq.datasets.sc_mouse_cortex 21k 细胞）映射到 spot，输出每 spot 主要细胞类型 + 丰度矩阵 + 共定位关系。',
    longDescription: `空间转录组细胞解卷积工具：

**为什么需要解卷积？** Visium 等空间平台的每个 spot 含 1-10 个细胞（细胞混合体），不像 scRNA-seq 是单细胞。要回答"哪类细胞在哪？"，需要把单细胞参考图谱映射回空间。

**算法**：[Tangram](https://github.com/broadinstitute/Tangram)（Biancalani et al. 2021, Nat Methods）— 学习 sc → spot 的映射矩阵，再把 sc 的细胞类型注释 project 到 spot。CPU 模式（默认 300 epochs，约 2-3 分钟跑完 visium_hne 数据）。

**默认参考**：\`sq.datasets.sc_mouse_cortex()\`（Tasic 2018, ~21k cells × 22k genes，含 \`cell_subclass\` 标注：L5 IT / Vip / Pvalb / Sst / L6 IT / Astro 等）。
> 当前版本仅支持小鼠脑数据（Visium HE brain demo 适配）。其他物种 / 组织自定义参考请走 [/spatial 平台](/spatial)。

**输出**：
- \`plot_001_dominant_celltype.png\` — 每 spot 主要细胞类型（组织底图叠加）
- \`plot_002_top_celltypes_grid.png\` — Top-4 细胞类型空间丰度（2×2）
- \`plot_003_celltype_proportion.png\` — 整体细胞类型组成
- \`plot_004_colocalization.png\` — 细胞类型 × 细胞类型共定位 Pearson 相关
- \`cell_type_abundance.csv\` — Spot × 细胞类型丰度矩阵
- \`result_spatial.h5ad\` — AnnData + \`obsm['tangram_ct_pred']\` + \`obs['dominant_celltype']\`

**Python 后端**: py-server \`spatial_deconv\` task type（Tangram 1.0 + Squidpy 1.8）。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad,.h5',
        hint: '空间转录组 AnnData，需含 obsm["spatial"] 坐标。当前版本仅支持小鼠脑',
      },
      {
        id: 'nTrainingGenes',
        label: 'Training 基因数',
        type: 'number',
        default: 1000,
        hint: 'Tangram 用 top-N 共有基因训练映射，越多越准但越慢',
      },
      {
        id: 'refLabelKey',
        label: '参考标签列',
        type: 'text',
        default: 'cell_subclass',
        hint: 'sc_mouse_cortex 的细胞标注列。可选: cell_subclass / cell_class',
      },
      {
        id: 'minSpotsPerCellType',
        label: '最小 spot 数',
        type: 'number',
        default: 10,
        hint: '共定位 heatmap 过滤 < 此值的细胞类型',
      },
    ],
    outputs: [
      { id: 'dominant_celltype', type: 'plot', label: '每 spot 主要细胞类型' },
      { id: 'top_celltypes_grid', type: 'plot', label: 'Top 细胞类型空间丰度' },
      { id: 'celltype_proportion', type: 'plot', label: '整体细胞类型组成' },
      { id: 'colocalization', type: 'plot', label: '细胞类型共定位' },
      { id: 'cell_type_abundance', type: 'table', label: 'Spot × 细胞类型丰度' },
      { id: 'result_h5ad', type: 'file', label: '结果 AnnData (.h5ad)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/single-cell/module09',
    estimatedMinutes: 6,
    packages: ['tangram-sc', 'squidpy', 'scanpy', 'torch'],
    color: '#a16207',
    figcodeMap: {
      'plot_001_dominant_celltype.png': 'spatial-deconv',
      'plot_002_top_celltypes_grid.png': 'spatial-deconv',
    },
  },
  {
    id: 'spatial-lr',
    title: '空间配体-受体',
    subtitle: 'LIANA bivariate 空间感知 LR 分析',
    category: '空间组学',
    language: 'python',
    description:
      '上传空间转录组 AnnData，用 LIANA bivariate（cosine 相似度）在邻居 spot 上算配体-受体共现，无需预先注释细胞类型，输出 Top LR pairs 显著性 + 空间分布。',
    longDescription: `空间配体-受体（Ligand-Receptor）分析工具：

**为什么 bivariate 而不是 cluster-level？** 传统的 cellchat / cellphonedb 在 cluster 之间算 LR，需要预先把 spot 注释为细胞类型。但 Visium 每 spot 是细胞混合体，cluster 注释意义有限。bivariate 方法直接在**物理邻居 spot** 上算 ligand × receptor 的 cosine 共现 — 更适合空间数据。

**算法**：[LIANA-py bivariate](https://liana-py.readthedocs.io/en/latest/notebooks/bivariate.html)（Dimitrov et al. 2022）。本工具默认走 \`mouseconsensus\` LR 资源（小鼠脑 demo 适配）；其他资源（\`consensus\` 人 / \`cellphonedbv5\` 等）可调。

**输出**：
- \`plot_001_top_lr_significance.png\` — Top-15 LR pairs mean score 排名
- \`plot_002_top_lr_spatial.png\` — Top-1 LR pair 空间分布（组织底图叠加）
- \`plot_003_lr_score_distribution.png\` — Top-N LR 分数 boxplot
- \`plot_004_top_lr_pairs_grid.png\` — Top-4 LR pairs 空间分布（2×2）
- \`top_lr_pairs.csv\` — per-LR-pair: ligand / receptor / mean_score / frac_active
- \`lr_score_per_spot.csv\` — Spot × Top-N LR 分数（可下游做 cluster-level 分析）
- \`result_spatial.h5ad\` — AnnData + \`uns['lr_results']\`

**Python 后端**: py-server \`spatial_lr\` task type（LIANA 1.4 + Squidpy 1.8）。`,
    inputs: [
      {
        id: 'adata',
        label: 'AnnData (.h5ad)',
        type: 'file',
        required: true,
        accept: '.h5ad,.h5',
        hint: '空间转录组 AnnData，需含 obsm["spatial"] 坐标',
      },
      {
        id: 'resourceName',
        label: 'LR 资源',
        type: 'select',
        default: 'mouseconsensus',
        options: [
          { value: 'mouseconsensus', label: 'mouseconsensus (小鼠)' },
          { value: 'consensus', label: 'consensus (人)' },
          { value: 'cellphonedbv5', label: 'cellphonedb v5 (人)' },
        ],
        hint: 'LR pair 数据库',
      },
      {
        id: 'localName',
        label: 'Bivariate 度量',
        type: 'select',
        default: 'cosine',
        options: [
          { value: 'cosine', label: 'Cosine（推荐）' },
          { value: 'jaccard', label: 'Jaccard' },
          { value: 'pearson', label: 'Pearson' },
        ],
        hint: 'LIANA bivariate 局部相似度计算方法',
      },
      {
        id: 'topN',
        label: 'Top-N LR pairs',
        type: 'number',
        default: 20,
        hint: '保留前 N 个最显著 LR pair 供下游使用',
      },
      { id: 'nPerms', label: 'Permutations', type: 'number', default: 100, hint: '显著性置换次数' },
      {
        id: 'nzProp',
        label: '非零比例阈值',
        type: 'number',
        default: 0.05,
        hint: 'L 或 R 的非零 spot 比例下限',
      },
    ],
    outputs: [
      { id: 'top_lr_significance', type: 'plot', label: 'Top LR pairs 显著性' },
      { id: 'top_lr_spatial', type: 'plot', label: 'Top-1 LR 空间分布' },
      { id: 'lr_score_distribution', type: 'plot', label: 'Top-N LR 分数 boxplot' },
      { id: 'top_lr_pairs_grid', type: 'plot', label: 'Top-4 LR pairs 空间分布' },
      { id: 'top_lr_pairs', type: 'table', label: 'Per-LR-pair 统计' },
      { id: 'lr_score_per_spot', type: 'table', label: 'Spot × Top-N LR 分数' },
      { id: 'result_h5ad', type: 'file', label: '结果 AnnData (.h5ad)' },
      { id: 'summary', type: 'text', label: '分析摘要' },
    ],
    tutorialUrl: '/docs/single-cell/module09',
    estimatedMinutes: 5,
    packages: ['liana', 'squidpy', 'scanpy', 'anndata'],
    color: '#0891b2',
    figcodeMap: {
      'plot_002_top_lr_spatial.png': 'feature-spatial',
      'plot_004_top_lr_pairs_grid.png': 'feature-spatial',
    },
  },
];
