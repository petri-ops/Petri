// TryOnline — 桌面版 MDX 组件（去 @docusaurus/Link，用 react-router-dom）
//
// 用法（MDX 内）:
//   import TryOnline from '@site/src/components/TryOnline';
//   <TryOnline analysis="standard" desc="一键跑 PBMC3K 标准分析" />
//   <TryOnline tool="deseq2" />

import React from 'react';
import { Link } from 'react-router-dom';

type AnalysisType =
  | 'standard'
  | 'deg'
  | 'enrichment'
  | 'annotation'
  | 'trajectory'
  | 'communication'
  | 'browse';

const META: Record<AnalysisType, { label: string; defaultDesc: string; icon: string }> = {
  standard: { label: '标准分析', defaultDesc: 'QC · 降维 · 聚类 · Marker', icon: 'S' },
  deg: { label: '差异表达', defaultDesc: 'DESeq2 / Wilcoxon', icon: 'D' },
  enrichment: { label: '富集分析', defaultDesc: 'GO / KEGG / GSEA', icon: 'E' },
  annotation: { label: '细胞注释', defaultDesc: 'SingleR 自动识别细胞类型', icon: 'A' },
  trajectory: { label: '轨迹分析', defaultDesc: 'Monocle3 拟时序', icon: 'T' },
  communication: { label: '细胞通讯', defaultDesc: 'CellChat 配体-受体', icon: 'C' },
  browse: { label: '云平台', defaultDesc: '在线跑单细胞分析', icon: '☁' },
};

type ToolId =
  | 'deseq2'
  | 'go-kegg'
  | 'gsea'
  | 'km-survival'
  | 'lasso-cox'
  | 'bindea-immune'
  | 'seurat-standard'
  | 'wgcna'
  | 'complexheatmap'
  | 'cellchat'
  | 'maftools-mutation';

const TOOL_META: Record<ToolId, { label: string; defaultDesc: string; icon: string }> = {
  deseq2: {
    label: 'DESeq2 差异分析',
    defaultDesc: '上传 count matrix + coldata，一键跑差异表达 + 火山图 + 热图',
    icon: '🔬',
  },
  'go-kegg': {
    label: 'GO/KEGG 富集分析',
    defaultDesc: '基因列表 → GO/KEGG ORA + cnetplot + treeplot',
    icon: '🌐',
  },
  gsea: {
    label: 'GSEA 基因集富集',
    defaultDesc: 'Ranked list → GSEA + running score + waterfall',
    icon: '📊',
  },
  'km-survival': {
    label: 'KM 生存分析',
    defaultDesc: '单基因预后探索 + ROC + forest plot',
    icon: '⏱️',
  },
  'lasso-cox': {
    label: 'LASSO Cox 多基因 Signature',
    defaultDesc: '基因筛选 + 风险评分 + Risk 三联图',
    icon: '📈',
  },
  'bindea-immune': {
    label: '免疫浸润评估',
    defaultDesc: 'ssGSEA 28 种免疫细胞 + 相关性热图',
    icon: '🛡️',
  },
  'seurat-standard': {
    label: 'Seurat 标准流程',
    defaultDesc: 'PBMC 风格全流程 QC → 聚类 → 标记基因',
    icon: '🧬',
  },
  wgcna: {
    label: 'WGCNA 共表达网络',
    defaultDesc: '软阈值 + 模块识别 + Hub 基因 + 性状关联',
    icon: '🕸️',
  },
  complexheatmap: {
    label: 'ComplexHeatmap 高级热图',
    defaultDesc: '多组学整合 + 行/列注释 + 自定义聚类',
    icon: '🔥',
  },
  cellchat: {
    label: 'CellChat 通讯分析',
    defaultDesc: 'PBMC 全流程细胞间配体-受体通讯',
    icon: '💬',
  },
  'maftools-mutation': {
    label: 'maftools 突变分析',
    defaultDesc: 'TCGA MAF → oncoplot + signatures + lollipop',
    icon: '🧬',
  },
};

interface Props {
  analysis?: AnalysisType;
  tool?: ToolId;
  desc?: string;
  href?: string;
}

export default function TryOnline({ analysis, tool, desc, href }: Props) {
  if (tool) {
    const meta = TOOL_META[tool];
    if (!meta) return null;
    const target = href || `/tools?tool=${tool}`;
    return (
      <Link to={target} className="try-online-card">
        <div className="try-online-icon">{meta.icon}</div>
        <div className="try-online-body">
          <div className="try-online-title">在 BioF3 上跑 · {meta.label}</div>
          <div className="try-online-desc">{desc || meta.defaultDesc}</div>
        </div>
        <div className="try-online-arrow">→</div>
      </Link>
    );
  }

  const a = analysis || 'browse';
  const meta = META[a];
  const target = href || '/single-cell';
  return (
    <Link to={target} className="try-online-card">
      <div className="try-online-icon">{meta.icon}</div>
      <div className="try-online-body">
        <div className="try-online-title">在云平台试跑 · {meta.label}</div>
        <div className="try-online-desc">{desc || meta.defaultDesc}</div>
      </div>
      <div className="try-online-arrow">→</div>
    </Link>
  );
}
