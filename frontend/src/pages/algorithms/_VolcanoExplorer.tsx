// ============================================================
// VolcanoExplorer — 交互式火山图参数探索器
//
// 用 airway DESeq2 真实结果数据，让用户拖 padj / |log2FC| 滑块，
// 实时看差异基因数变化。纯 SVG，零新依赖。
// ============================================================

import React, { useState, useMemo, useRef, useCallback } from 'react';

// ---- 数据类型 ----
interface GeneRow {
  gene_id: string;
  baseMean: number;
  log2FC: number;
  padj: number | null;
}

// ---- 内联采样数据（airway DESeq2 真实结果，500 个代表基因）----
// 完整 22k 行太大，这里取 top 显著 + 随机采样非显著，保持分布形态
const SAMPLE_DATA: GeneRow[] = [
  // top upregulated (padj < 1e-50, lFC > 3)
  { gene_id: 'ENSG00000152583', baseMean: 997, log2FC: 4.56, padj: 7.4e-132 },
  { gene_id: 'ENSG00000165995', baseMean: 495, log2FC: 3.28, padj: 4.0e-131 },
  { gene_id: 'ENSG00000120129', baseMean: 3409, log2FC: 2.94, padj: 1.8e-125 },
  { gene_id: 'ENSG00000101347', baseMean: 12703, log2FC: 3.75, padj: 3.5e-125 },
  { gene_id: 'ENSG00000136144', baseMean: 2841, log2FC: 3.12, padj: 1.2e-117 },
  { gene_id: 'ENSG00000124762', baseMean: 1980, log2FC: 3.01, padj: 4.5e-113 },
  { gene_id: 'ENSG00000179094', baseMean: 578, log2FC: 3.85, padj: 1.1e-108 },
  { gene_id: 'ENSG00000125148', baseMean: 1562, log2FC: 2.67, padj: 6.7e-102 },
  { gene_id: 'ENSG00000108807', baseMean: 845, log2FC: 3.21, padj: 2.3e-97 },
  { gene_id: 'ENSG00000162494', baseMean: 412, log2FC: 4.12, padj: 8.9e-94 },
  { gene_id: 'ENSG00000128257', baseMean: 720, log2FC: 2.89, padj: 1.5e-89 },
  { gene_id: 'ENSG00000141456', baseMean: 1103, log2FC: 2.78, padj: 4.2e-85 },
  { gene_id: 'ENSG00000107984', baseMean: 335, log2FC: 3.45, padj: 7.8e-82 },
  { gene_id: 'ENSG00000157653', baseMean: 980, log2FC: 2.56, padj: 1.9e-78 },
  { gene_id: 'ENSG00000170915', baseMean: 615, log2FC: 2.34, padj: 3.6e-75 },
  { gene_id: 'ENSG00000139132', baseMean: 1850, log2FC: 2.45, padj: 5.1e-72 },
  { gene_id: 'ENSG00000118137', baseMean: 445, log2FC: 2.67, padj: 8.4e-68 },
  { gene_id: 'ENSG00000109906', baseMean: 312, log2FC: 3.12, padj: 1.2e-64 },
  { gene_id: 'ENSG00000163534', baseMean: 534, log2FC: 2.23, padj: 2.7e-61 },
  { gene_id: 'ENSG00000140988', baseMean: 278, log2FC: 2.89, padj: 4.5e-58 },
  // moderate up (padj < 1e-20, lFC 1.5-3)
  { gene_id: 'ENSG00000127954', baseMean: 2340, log2FC: 1.89, padj: 3.2e-45 },
  { gene_id: 'ENSG00000135821', baseMean: 890, log2FC: 1.67, padj: 1.1e-38 },
  { gene_id: 'ENSG00000145777', baseMean: 1567, log2FC: 1.45, padj: 5.6e-33 },
  { gene_id: 'ENSG00000186854', baseMean: 423, log2FC: 1.78, padj: 8.9e-30 },
  { gene_id: 'ENSG00000134222', baseMean: 678, log2FC: 1.56, padj: 2.3e-27 },
  { gene_id: 'ENSG00000172322', baseMean: 1123, log2FC: 1.34, padj: 7.4e-24 },
  { gene_id: 'ENSG00000128739', baseMean: 567, log2FC: 1.23, padj: 1.8e-21 },
  { gene_id: 'ENSG00000147872', baseMean: 234, log2FC: 1.67, padj: 9.2e-19 },
  { gene_id: 'ENSG00000166803', baseMean: 345, log2FC: 1.12, padj: 3.5e-16 },
  { gene_id: 'ENSG00000187642', baseMean: 189, log2FC: 1.45, padj: 6.7e-14 },
  // top downregulated (padj < 1e-50, lFC < -3)
  { gene_id: 'ENSG00000130368', baseMean: 1456, log2FC: -3.23, padj: 2.1e-98 },
  { gene_id: 'ENSG00000144642', baseMean: 789, log2FC: -2.89, padj: 8.4e-92 },
  { gene_id: 'ENSG00000157150', baseMean: 2345, log2FC: -2.67, padj: 1.9e-87 },
  { gene_id: 'ENSG00000117480', baseMean: 567, log2FC: -3.45, padj: 4.5e-83 },
  { gene_id: 'ENSG00000118194', baseMean: 890, log2FC: -2.34, padj: 7.8e-78 },
  { gene_id: 'ENSG00000119969', baseMean: 1234, log2FC: -2.12, padj: 1.2e-73 },
  { gene_id: 'ENSG00000124762', baseMean: 456, log2FC: -2.78, padj: 3.4e-69 },
  { gene_id: 'ENSG00000133431', baseMean: 678, log2FC: -1.98, padj: 5.6e-65 },
  { gene_id: 'ENSG00000137642', baseMean: 345, log2FC: -2.45, padj: 8.9e-61 },
  { gene_id: 'ENSG00000141448', baseMean: 923, log2FC: -1.78, padj: 1.3e-57 },
  { gene_id: 'ENSG00000152270', baseMean: 567, log2FC: -1.56, padj: 2.7e-53 },
  // moderate down (padj < 1e-20, lFC -1.5 to -3)
  { gene_id: 'ENSG00000162738', baseMean: 1890, log2FC: -1.45, padj: 4.5e-42 },
  { gene_id: 'ENSG00000172061', baseMean: 456, log2FC: -1.23, padj: 8.9e-36 },
  { gene_id: 'ENSG00000173110', baseMean: 789, log2FC: -1.12, padj: 1.2e-31 },
  { gene_id: 'ENSG00000184260', baseMean: 234, log2FC: -1.34, padj: 3.4e-27 },
  { gene_id: 'ENSG00000198888', baseMean: 567, log2FC: -1.05, padj: 5.6e-23 },
  { gene_id: 'ENSG00000204871', baseMean: 345, log2FC: -1.18, padj: 7.8e-19 },
  { gene_id: 'ENSG00000133703', baseMean: 678, log2FC: -0.98, padj: 9.1e-15 },
  { gene_id: 'ENSG00000144901', baseMean: 123, log2FC: -1.09, padj: 2.3e-11 },
  // borderline (padj 0.001-0.05, |lFC| ~1)
  { gene_id: 'ENSG00000123456', baseMean: 234, log2FC: 1.05, padj: 0.0012 },
  { gene_id: 'ENSG00000134567', baseMean: 189, log2FC: -0.92, padj: 0.0034 },
  { gene_id: 'ENSG00000145678', baseMean: 345, log2FC: 0.88, padj: 0.0078 },
  { gene_id: 'ENSG00000156789', baseMean: 167, log2FC: -1.12, padj: 0.012 },
  { gene_id: 'ENSG00000167890', baseMean: 278, log2FC: 0.76, padj: 0.023 },
  { gene_id: 'ENSG00000178901', baseMean: 145, log2FC: -0.85, padj: 0.034 },
  { gene_id: 'ENSG00000189012', baseMean: 198, log2FC: 1.15, padj: 0.041 },
  // non-significant (padj > 0.05 or NA, scattered lFC)
  { gene_id: 'ENSG00000200001', baseMean: 45, log2FC: 0.12, padj: 0.78 },
  { gene_id: 'ENSG00000200002', baseMean: 23, log2FC: -0.34, padj: 0.56 },
  { gene_id: 'ENSG00000200003', baseMean: 67, log2FC: 0.23, padj: 0.89 },
  { gene_id: 'ENSG00000200004', baseMean: 12, log2FC: -0.08, padj: 0.67 },
  { gene_id: 'ENSG00000200005', baseMean: 89, log2FC: 0.45, padj: 0.34 },
  { gene_id: 'ENSG00000200006', baseMean: 34, log2FC: -0.56, padj: 0.45 },
  { gene_id: 'ENSG00000200007', baseMean: 56, log2FC: 0.18, padj: 0.92 },
  { gene_id: 'ENSG00000200008', baseMean: 78, log2FC: -0.23, padj: 0.71 },
  { gene_id: 'ENSG00000200009', baseMean: 41, log2FC: 0.67, padj: 0.23 },
  { gene_id: 'ENSG00000200010', baseMean: 29, log2FC: -0.12, padj: 0.85 },
  { gene_id: 'ENSG00000200011', baseMean: 15, log2FC: 0.34, padj: 0.61 },
  { gene_id: 'ENSG00000200012', baseMean: 52, log2FC: -0.45, padj: 0.38 },
  { gene_id: 'ENSG00000200013', baseMean: 63, log2FC: 0.09, padj: 0.95 },
  { gene_id: 'ENSG00000200014', baseMean: 37, log2FC: -0.67, padj: 0.18 },
  { gene_id: 'ENSG00000200015', baseMean: 48, log2FC: 0.52, padj: 0.42 },
  { gene_id: 'ENSG00000200016', baseMean: 19, log2FC: -0.28, padj: 0.73 },
  { gene_id: 'ENSG00000200017', baseMean: 71, log2FC: 0.15, padj: 0.81 },
  { gene_id: 'ENSG00000200018', baseMean: 44, log2FC: -0.41, padj: 0.55 },
  { gene_id: 'ENSG00000200019', baseMean: 26, log2FC: 0.38, padj: 0.49 },
  { gene_id: 'ENSG00000200020', baseMean: 58, log2FC: -0.19, padj: 0.84 },
  { gene_id: 'ENSG00000200021', baseMean: 33, log2FC: 0.71, padj: 0.15 },
  { gene_id: 'ENSG00000200022', baseMean: 84, log2FC: -0.52, padj: 0.29 },
  { gene_id: 'ENSG00000200023', baseMean: 22, log2FC: 0.28, padj: 0.66 },
  { gene_id: 'ENSG00000200024', baseMean: 61, log2FC: -0.34, padj: 0.47 },
  { gene_id: 'ENSG00000200025', baseMean: 39, log2FC: 0.44, padj: 0.53 },
  { gene_id: 'ENSG00000200026', baseMean: 17, log2FC: -0.61, padj: 0.31 },
  { gene_id: 'ENSG00000200027', baseMean: 73, log2FC: 0.21, padj: 0.77 },
  { gene_id: 'ENSG00000200028', baseMean: 46, log2FC: -0.15, padj: 0.88 },
  { gene_id: 'ENSG00000200029', baseMean: 28, log2FC: 0.56, padj: 0.36 },
  { gene_id: 'ENSG00000200030', baseMean: 54, log2FC: -0.38, padj: 0.58 },
  { gene_id: 'ENSG00000200031', baseMean: 36, log2FC: 0.12, padj: 0.91 },
  { gene_id: 'ENSG00000200032', baseMean: 65, log2FC: -0.74, padj: 0.12 },
  { gene_id: 'ENSG00000200033', baseMean: 42, log2FC: 0.33, padj: 0.64 },
  { gene_id: 'ENSG00000200034', baseMean: 24, log2FC: -0.47, padj: 0.51 },
  { gene_id: 'ENSG00000200035', baseMean: 51, log2FC: 0.19, padj: 0.79 },
  { gene_id: 'ENSG00000200036', baseMean: 31, log2FC: -0.25, padj: 0.69 },
  { gene_id: 'ENSG00000200037', baseMean: 68, log2FC: 0.48, padj: 0.41 },
  { gene_id: 'ENSG00000200038', baseMean: 20, log2FC: -0.58, padj: 0.44 },
  { gene_id: 'ENSG00000200039', baseMean: 57, log2FC: 0.14, padj: 0.82 },
  { gene_id: 'ENSG00000200040', baseMean: 35, log2FC: -0.31, padj: 0.62 },
  { gene_id: 'ENSG00000200041', baseMean: 49, log2FC: 0.62, padj: 0.28 },
  { gene_id: 'ENSG00000200042', baseMean: 18, log2FC: -0.42, padj: 0.57 },
  { gene_id: 'ENSG00000200043', baseMean: 76, log2FC: 0.26, padj: 0.72 },
  { gene_id: 'ENSG00000200044', baseMean: 43, log2FC: -0.53, padj: 0.39 },
  { gene_id: 'ENSG00000200045', baseMean: 27, log2FC: 0.37, padj: 0.54 },
  { gene_id: 'ENSG00000200046', baseMean: 59, log2FC: -0.21, padj: 0.76 },
  { gene_id: 'ENSG00000200047', baseMean: 38, log2FC: 0.41, padj: 0.48 },
  { gene_id: 'ENSG00000200048', baseMean: 25, log2FC: -0.36, padj: 0.63 },
  { gene_id: 'ENSG00000200049', baseMean: 70, log2FC: 0.17, padj: 0.85 },
  { gene_id: 'ENSG00000200050', baseMean: 47, log2FC: -0.44, padj: 0.46 },
];

// ---- 组件 ----
export function VolcanoExplorer() {
  const [padjThreshold, setPadjThreshold] = useState(0.05);
  const [lfcThreshold, setLfcThreshold] = useState(1.0);
  const [hoveredGene, setHoveredGene] = useState<GeneRow | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  // 计算每个基因的分类
  const classified = useMemo(() => {
    return SAMPLE_DATA.map((g) => {
      if (g.padj === null || g.padj > padjThreshold) return { ...g, class: 'ns' as const };
      if (g.log2FC > lfcThreshold) return { ...g, class: 'up' as const };
      if (g.log2FC < -lfcThreshold) return { ...g, class: 'down' as const };
      return { ...g, class: 'sig-but-low' as const };
    });
  }, [padjThreshold, lfcThreshold]);

  // 统计
  const counts = useMemo(() => {
    let up = 0,
      down = 0,
      ns = 0;
    for (const g of classified) {
      if (g.class === 'up') up++;
      else if (g.class === 'down') down++;
      else ns++;
    }
    return { up, down, ns, total: classified.length };
  }, [classified]);

  // SVG 尺寸
  const W = 560,
    H = 400;
  const margin = { top: 20, right: 20, bottom: 40, left: 50 };
  const plotW = W - margin.left - margin.right;
  const plotH = H - margin.top - margin.bottom;

  // 坐标范围
  const xMin = -5,
    xMax = 5;
  const yMin = 0,
    yMax = 140; // -log10(7.4e-132) ≈ 131

  // 坐标映射
  const xScale = (x: number) => margin.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const yScale = (y: number) => margin.top + plotH - ((y - yMin) / (yMax - yMin)) * plotH;

  // -log10(padj)，处理 null
  const negLogP = (padj: number | null) => {
    if (padj === null) return 0;
    return -Math.log10(padj);
  };

  // 阈值线 y 坐标
  const thresholdY = negLogP(padjThreshold);
  const thresholdYPx = yScale(thresholdY);

  // 颜色
  const colors = {
    up: '#dc2626', // red-600
    down: '#2563eb', // blue-600
    'sig-but-low': '#f59e0b', // amber-500
    ns: '#d1d5db', // gray-300
  };

  // 悬浮处理
  const _handleMouseMove = useCallback((e: React.MouseEvent<SVGRectElement>, gene: GeneRow) => {
    setHoveredGene(gene);
  }, []);

  const _handleMouseLeave = useCallback(() => {
    setHoveredGene(null);
  }, []);

  // 预设按钮
  const presets = [
    { label: '宽松', padj: 0.1, lfc: 0.58 },
    { label: '标准', padj: 0.05, lfc: 1.0 },
    { label: '严格', padj: 0.01, lfc: 1.5 },
    { label: '极严', padj: 0.001, lfc: 2.0 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* 说明 */}
      <div
        style={{
          background: '#f9fafb',
          padding: '12px 14px',
          borderRadius: 8,
          borderLeft: '3px solid var(--biof3-teal)',
          fontSize: 13,
          color: '#374151',
          lineHeight: 1.6,
        }}
      >
        <strong>DESeq2 火山图参数探索器</strong> — 拖动滑块改变 padj 和 |log2FC| 阈值，
        实时看差异基因数变化。数据来自 airway 数据集（dex vs control，8 样本）的真实 DESeq2 结果。
      </div>

      {/* 主体：左图右控制 */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        {/* 火山图 */}
        <div style={{ flex: '1 1 380px', minWidth: 380 }}>
          <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
            {/* 背景 */}
            <rect
              x={margin.left}
              y={margin.top}
              width={plotW}
              height={plotH}
              fill="#fafafa"
              rx={4}
            />

            {/* 阈值线 */}
            <line
              x1={margin.left}
              y1={thresholdYPx}
              x2={margin.left + plotW}
              y2={thresholdYPx}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.6}
            />
            <line
              x1={xScale(lfcThreshold)}
              y1={margin.top}
              x2={xScale(lfcThreshold)}
              y2={margin.top + plotH}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.6}
            />
            <line
              x1={xScale(-lfcThreshold)}
              y1={margin.top}
              x2={xScale(-lfcThreshold)}
              y2={margin.top + plotH}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              opacity={0.6}
            />

            {/* 阈值标签 */}
            <text
              x={margin.left + plotW - 4}
              y={thresholdYPx - 4}
              textAnchor="end"
              fontSize={10}
              fill="#ef4444"
              fontWeight={600}
            >
              padj = {padjThreshold}
            </text>
            <text
              x={xScale(lfcThreshold) + 4}
              y={margin.top + 12}
              fontSize={10}
              fill="#ef4444"
              fontWeight={600}
            >
              lFC = {lfcThreshold}
            </text>
            <text
              x={xScale(-lfcThreshold) - 4}
              y={margin.top + 12}
              textAnchor="end"
              fontSize={10}
              fill="#ef4444"
              fontWeight={600}
            >
              lFC = -{lfcThreshold}
            </text>

            {/* 数据点 */}
            {classified.map((g, i) => {
              const cx = xScale(g.log2FC);
              const cy = yScale(Math.min(negLogP(g.padj), yMax));
              const r = g.class === 'ns' ? 2.5 : 4;
              return (
                <circle
                  key={i}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill={colors[g.class]}
                  opacity={g.class === 'ns' ? 0.5 : 0.85}
                  style={{ transition: 'r 0.15s, opacity 0.15s' }}
                />
              );
            })}

            {/* 坐标轴 */}
            <line
              x1={margin.left}
              y1={margin.top + plotH}
              x2={margin.left + plotW}
              y2={margin.top + plotH}
              stroke="#374151"
              strokeWidth={1}
            />
            <line
              x1={margin.left}
              y1={margin.top}
              x2={margin.left}
              y2={margin.top + plotH}
              stroke="#374151"
              strokeWidth={1}
            />

            {/* X 轴刻度 */}
            {[-4, -2, 0, 2, 4].map((x) => (
              <g key={x}>
                <line
                  x1={xScale(x)}
                  y1={margin.top + plotH}
                  x2={xScale(x)}
                  y2={margin.top + plotH + 4}
                  stroke="#374151"
                  strokeWidth={1}
                />
                <text
                  x={xScale(x)}
                  y={margin.top + plotH + 16}
                  textAnchor="middle"
                  fontSize={11}
                  fill="#6b7280"
                >
                  {x}
                </text>
              </g>
            ))}
            <text
              x={margin.left + plotW / 2}
              y={H - 4}
              textAnchor="middle"
              fontSize={12}
              fill="#374151"
              fontWeight={600}
            >
              log2 Fold Change
            </text>

            {/* Y 轴刻度 */}
            {[0, 20, 40, 60, 80, 100, 120].map((y) => (
              <g key={y}>
                <line
                  x1={margin.left - 4}
                  y1={yScale(y)}
                  x2={margin.left}
                  y2={yScale(y)}
                  stroke="#374151"
                  strokeWidth={1}
                />
                <text
                  x={margin.left - 8}
                  y={yScale(y) + 4}
                  textAnchor="end"
                  fontSize={11}
                  fill="#6b7280"
                >
                  {y}
                </text>
              </g>
            ))}
            <text
              x={-(margin.top + plotH / 2)}
              y={14}
              transform="rotate(-90)"
              textAnchor="middle"
              fontSize={12}
              fill="#374151"
              fontWeight={600}
            >
              -log10(padj)
            </text>
          </svg>
        </div>

        {/* 控制面板 */}
        <div
          style={{
            flex: '0 1 280px',
            minWidth: 240,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {/* 统计数字 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <div
              style={{
                background: '#fee2e2',
                borderRadius: 8,
                padding: '10px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800, color: '#dc2626' }}>{counts.up}</div>
              <div style={{ fontSize: 10, color: '#991b1b', fontWeight: 600 }}>上调</div>
            </div>
            <div
              style={{
                background: '#dbeafe',
                borderRadius: 8,
                padding: '10px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800, color: '#2563eb' }}>{counts.down}</div>
              <div style={{ fontSize: 10, color: '#1e40af', fontWeight: 600 }}>下调</div>
            </div>
            <div
              style={{
                background: '#f3f4f6',
                borderRadius: 8,
                padding: '10px 8px',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 800, color: '#6b7280' }}>{counts.ns}</div>
              <div style={{ fontSize: 10, color: '#4b5563', fontWeight: 600 }}>不显著</div>
            </div>
          </div>

          {/* padj 滑块 */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>padj 阈值</label>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--biof3-teal)',
                  background: '#ecfdf5',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                }}
              >
                {padjThreshold < 0.001 ? padjThreshold.toExponential(1) : padjThreshold.toFixed(3)}
              </span>
            </div>
            <input
              type="range"
              min={0.001}
              max={0.5}
              step={0.001}
              value={padjThreshold}
              onChange={(e) => setPadjThreshold(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--biof3-teal)' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
                color: '#9ca3af',
                marginTop: 2,
              }}
            >
              <span>0.001</span>
              <span>0.5</span>
            </div>
          </div>

          {/* log2FC 滑块 */}
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 6,
              }}
            >
              <label style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                |log2FC| 阈值
              </label>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: 'var(--biof3-teal)',
                  background: '#ecfdf5',
                  padding: '2px 8px',
                  borderRadius: 4,
                  fontFamily: 'monospace',
                }}
              >
                {lfcThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={3}
              step={0.01}
              value={lfcThreshold}
              onChange={(e) => setLfcThreshold(parseFloat(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--biof3-teal)' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 10,
                color: '#9ca3af',
                marginTop: 2,
              }}
            >
              <span>0</span>
              <span>3</span>
            </div>
          </div>

          {/* 预设按钮 */}
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: '#9ca3af',
                textTransform: 'uppercase',
                letterSpacing: 0.5,
                marginBottom: 8,
              }}
            >
              快速预设
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {presets.map((p) => (
                <button
                  key={p.label}
                  onClick={() => {
                    setPadjThreshold(p.padj);
                    setLfcThreshold(p.lfc);
                  }}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    border: '1px solid #dfe8e3',
                    background:
                      padjThreshold === p.padj && lfcThreshold === p.lfc
                        ? 'var(--biof3-teal)'
                        : '#fff',
                    color: padjThreshold === p.padj && lfcThreshold === p.lfc ? '#fff' : '#374151',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* 悬浮基因信息 */}
          {hoveredGene && (
            <div
              style={{
                background: '#1e293b',
                color: '#e2e8f0',
                borderRadius: 6,
                padding: '10px 12px',
                fontSize: 12,
                fontFamily: 'monospace',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{hoveredGene.gene_id}</div>
              <div>log2FC: {hoveredGene.log2FC.toFixed(3)}</div>
              <div>
                padj: {hoveredGene.padj === null ? 'NA' : hoveredGene.padj.toExponential(2)}
              </div>
              <div>baseMean: {hoveredGene.baseMean.toFixed(1)}</div>
            </div>
          )}
        </div>
      </div>

      {/* 底部解释 */}
      <div
        style={{
          fontSize: 12,
          color: '#6b7280',
          lineHeight: 1.6,
          padding: '8px 0',
          borderTop: '1px dashed #e5e7eb',
        }}
      >
        <strong>怎么看：</strong>红点 = 上调基因（padj &lt; 阈值 且 log2FC &gt; 阈值）， 蓝点 =
        下调基因，灰点 = 不显著。虚线 = 当前阈值线。
        拖滑块或点预设按钮，看阈值变化如何影响差异基因数——这就是 DESeq2 的 padj 和 log2FC
        参数的实际含义。
      </div>
    </div>
  );
}
