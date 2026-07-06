export interface FigCard {
  id: string;
  title: string;
  subtitle: string;
  category: string;
  image: string;
  description: string;
  inputFormat: string;
  biologicalQuestion: string;
  scenarios: string[];
  keyParams: string[];
  code: string;
  packages: string[];
  slogan: string;
  /** Code language: 'r' (default) or 'python' */
  language?: 'r' | 'python';
  /**
   * Layout class — content-aware sizing hint. Used by RunModal to adjust
   * default canvas / base_size / point_size when a layout theme is applied.
   *
   * - compact:  small charts (single panel, simple data) — favors larger text per pixel
   * - default:  standard scatter / bar / box plots
   * - complex:  heatmaps / dotplots / panels with many ticks (eg gene names) — needs more canvas
   * - wide:     time series / chord diagrams / long-axis layouts
   *
   * Defaults to 'default' if omitted. Per-card override only when content
   * obviously demands it (eg bubble plot of 50 pathways = 'complex').
   */
  figLayout?: 'compact' | 'default' | 'complex' | 'wide';
  tutorialUrl?: string;
  onlineToolUrl?: string;
  copilot?: {
    domain: string;
    level: 'beginner' | 'intermediate' | 'advanced';
    estimated_minutes: number;
    prerequisites?: string[];
    learning_outcomes: string[];
    hands_on: boolean;
    related_concepts?: string[];
    fits_after?: string[];
    teaches?: string[];
  };
}

export const categories = [
  '差异分析',
  '功能富集',
  '聚类可视化',
  '降维可视化',
  '分布可视化',
  '生存分析',
  '基因组',
  '网络与互作',
] as const;

/**
 * Stage = 按分析阶段组织的卡片导览（与 category 正交）
 * 一张卡片可以属于多个 stage（如 volcano 既是"差异分析"又是"探索性分析"）
 * 用于左侧第二级筛选，让用户按"我现在到哪一步"找图。
 */
export interface Stage {
  id: string;
  label: string;
  description: string;
  cardIds: string[];
}

export const stages: Stage[] = [
  {
    id: 'qc',
    label: '数据质控',
    description: '分析第一步：检查样本质量、识别异常',
    cardIds: [
      'sc-qc-violin',
      'sc-doublet',
      'library-size',
      'sample-cor',
      'combat-pca',
      'qq-plot',
      'dispersion',
      'top-genes-count',
      'expr-dist',
    ],
  },
  {
    id: 'eda',
    label: '探索性分析',
    description: '降维 + 聚类，看数据整体结构',
    cardIds: [
      'pca',
      'umap',
      'py-umap-scanpy',
      'plotly-3d',
      'heatmap',
      'py-heatmap-clustermap',
      'sample-cor',
      'spatial-cluster',
    ],
  },
  {
    id: 'de',
    label: '差异分析',
    description: '找差异基因 / 蛋白 / 代谢物',
    cardIds: [
      'volcano',
      'ma-plot',
      'lfc-scatter',
      'py-volcano-pydeseq2',
      'diffbind-ma',
      'volcano-animated',
      'upset',
    ],
  },
  {
    id: 'enrichment',
    label: '功能富集',
    description: 'GO / KEGG / GSEA / Reactome',
    cardIds: [
      'dotplot',
      'gsea-running',
      'gsea-waterfall',
      'gsea-forest',
      'go-bar',
      'kegg-bubble',
      'go-emap',
      'kegg-dotplot',
      'treemap',
      'reactome-tree',
      'ridge-gsea',
      'cnetplot',
    ],
  },
  {
    id: 'cluster-anno',
    label: '聚类与注释',
    description: 'Marker 识别、cluster 注释',
    cardIds: [
      'sc-marker-bubble',
      'sc-deg-heatmap',
      'sc-cell-cycle',
      'py-violin-stack',
      'py-rank-heatmap',
      'py-dotplot-scanpy',
      'scenic-regulon',
      'violin',
    ],
  },
  {
    id: 'sc-advanced',
    label: '单细胞高级',
    description: '轨迹、通讯、动态',
    cardIds: [
      'pseudotime',
      'trajectory-branch',
      'py-paga',
      'scvelo-stream',
      'cytotrace',
      'chord-plot',
      'cellchat-bubble',
      'cci-heatmap',
    ],
  },
  {
    id: 'spatial',
    label: '空间组学',
    description: '空间转录组分析',
    cardIds: [
      'spatial-cluster',
      'feature-spatial',
      'spatial-deconv',
      'squidpy-neighbors',
      'spatial-svg-moran',
      'spatial-deconv-c2l',
      'spatial-lr-liana',
    ],
  },
  {
    id: 'survival',
    label: '生存分析',
    description: 'KM / Cox / Nomogram 全流程',
    cardIds: [
      'km-curve',
      'time-roc',
      'forest-cox',
      'nomogram',
      'calibration',
      'decision-curve',
      'risk-triple',
      'meta-forest',
      'lasso-cv-plot',
      'lasso-coef',
    ],
  },
  {
    id: 'ml',
    label: '机器学习',
    description: '分类评估、模型解释',
    cardIds: ['roc-confusion', 'pr-curve', 'py-roc-confusion', 'shap-summary'],
  },
  {
    id: 'genomics',
    label: '基因组学',
    description: '突变、CNV、GWAS',
    cardIds: [
      'oncoplot',
      'lollipop',
      'manhattan',
      'circos',
      'mut-cooccurrence',
      'mut-signature',
      'lego-plot',
      'peak-anno',
      'cnv-heatmap',
      'cnv-expression',
    ],
  },
  {
    id: 'multi-omics',
    label: '多组学整合',
    description: '跨组学整合分析',
    cardIds: ['multi-omics-heatmap', 'mofa-factors', 'wgcna-module-trait', 'cnv-expression'],
  },
  {
    id: 'time-dynamic',
    label: '时序与动态',
    description: '随时间变化的表达 / 状态',
    cardIds: [
      'time-trajectory',
      'cluster-trajectory',
      'volcano-animated',
      'alluvial',
      'scvelo-stream',
    ],
  },
  {
    id: 'design',
    label: '实验设计',
    description: '样本量、一致性评估',
    cardIds: ['power-curve', 'bland-altman'],
  },
  {
    id: 'flow-relation',
    label: '关系与流图',
    description: 'Sankey / Chord / 网络',
    cardIds: ['sankey', 'alluvial', 'chord-plot', 'cnetplot', 'go-emap', 'ppi-network'],
  },
];

import { cards_de } from './_cards-de';
import { cards_enrichment } from './_cards-enrichment';
import { cards_cluster } from './_cards-cluster';
import { cards_dimred } from './_cards-dimred';
import { cards_distribution } from './_cards-distribution';
import { cards_survival } from './_cards-survival';
import { cards_genomics } from './_cards-genomics';
import { cards_network } from './_cards-network';

export const figCards: FigCard[] = [
  ...cards_de,
  ...cards_enrichment,
  ...cards_cluster,
  ...cards_dimred,
  ...cards_distribution,
  ...cards_survival,
  ...cards_genomics,
  ...cards_network,
];
