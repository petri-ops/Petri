// ============================================================
// /spatial — Analysis Result view
//
// 与 /single-cell `_ResultView.tsx` 完全同构（同套 sc-* class）：
//   - sc-page > sc-layout sc-layout-3col：左 Sidebar + 中主区 + 右 RightInfoPanel
//   - sc-header（icon + 名称 + status tag + 操作按钮）
//   - 进行中：sc-running 进度条
//   - 失败：sc-error-box
//   - 完成：sc-result-tabs (preview / plots / data / params)
//     - preview tab: sc-data-tools-layout（W3 spatial 暂为占位 + 工具卡）
//     - plots tab: sc-plots-grid 卡片网格
//     - data tab: sc-plots-grid 文件卡片
//     - params tab: JSON
//
// W3-B 范围：spatial_standard 端到端可用。Replot / FigCode 串接 / Methods 等留 W4。
// ============================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Analysis, Dataset, Project } from './_types';
import { ANALYSIS_TYPES, STATUS_LABELS, type SpatialAnalysisType } from './_types';
import { getAnalysis, getDataset, getProject, updateAnalysis, deleteAnalysis } from './_store';
import { getSpatialTaskStatus, formatTime, formatDuration } from './_api';
import type { Route } from './_router';
import { Sidebar } from './_Sidebar';
import { NewAnalysisModal } from './_NewAnalysisModal';
import { useSidebarCollapse } from '../single-cell/_useSidebarCollapse';
import { useMobileDrawer } from '../single-cell/_useMobileDrawer';
import { requireWrite, getStoredUser } from '../single-cell/_auth';
import { translateError } from '../single-cell/_errorTranslate';
import { CsvTable } from '../single-cell/_CsvTable';
import { TablePreviewModal } from '../single-cell/_TablePreviewModal';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';

type Tab = 'preview' | 'plots' | 'data' | 'params';

interface PlotItem {
  name: string;
  url: string;
  filename: string;
}
interface FileItem {
  name: string;
  url: string;
  description?: string;
}

// 4 张图的中文/英文 metadata（与 plot_meta 同结构，但 spatial 专属，简化版）
const SPATIAL_PLOT_META: Record<
  string,
  {
    title: string;
    subtitle: string;
    category: string;
    biologicalQuestion: string;
    scenarios: string[];
    inputFormat: string;
    keyParams: string[];
    packages: string[];
  }
> = {
  'plot_001_spatial_clusters.png': {
    title: '空间聚类',
    subtitle: 'Spatial Clusters (tissue + spot)',
    category: '空间结构',
    biologicalQuestion: '组织切片上不同区域是否对应不同的转录组特征？聚类边界是否吻合解剖结构？',
    scenarios: [
      'Visium 标准 QC + 聚类后概览',
      '判断切片质量',
      '识别已知解剖区（皮层 / 海马 / 白质 ...）',
    ],
    inputFormat: 'AnnData (.h5ad), obsm["spatial"]=spot 坐标, optionally uns["spatial"]=组织 H&E',
    keyParams: ['resolution: Leiden 分辨率', 'nPCs: PCA 主成分数', 'spot_size: 圆点大小'],
    packages: ['scanpy', 'squidpy', 'matplotlib'],
  },
  'plot_002_umap.png': {
    title: 'UMAP 降维',
    subtitle: 'UMAP Embedding',
    category: '细胞嵌入',
    biologicalQuestion:
      '聚类在细胞表征空间是否分离清晰？是否有过度分群（resolution 过高）或欠分群？',
    scenarios: ['评估聚类质量', '与空间分布对比看转录差异 vs 空间差异'],
    inputFormat: 'AnnData (.h5ad), obsm["X_umap"]',
    keyParams: ['n_neighbors: UMAP 局部连通数', 'min_dist: UMAP 距离压缩', 'spread'],
    packages: ['scanpy', 'umap-learn'],
  },
  'plot_003_nhood_enrichment.png': {
    title: '邻域富集',
    subtitle: 'Neighborhood Enrichment (z-score)',
    category: '空间相互作用',
    biologicalQuestion: '哪些聚类在物理上相邻？这暗示了什么细胞类型间的接触关系？',
    scenarios: ['识别细胞通讯候选', '判断聚类是否对应空间相连组织带'],
    inputFormat: 'AnnData with obsp["spatial_connectivities"] (built by sq.gr.spatial_neighbors)',
    keyParams: [
      'n_neighs: 空间邻居数（generic 默认 6）',
      'coord_type: grid 或 generic',
      'n_perms: 置换次数',
    ],
    packages: ['squidpy.gr.nhood_enrichment'],
  },
  'plot_004_top_svgs.png': {
    title: 'Top 空间高变基因',
    subtitle: "Top Spatially Variable Genes (Moran's I)",
    category: '空间高变基因',
    biologicalQuestion: '哪些基因的空间表达不是随机的？它们暗示了什么生物学过程或细胞类型？',
    scenarios: ['筛选 marker 候选', '指引下游解卷积或 LR 分析'],
    inputFormat: 'AnnData with uns["moranI"] (built by sq.gr.spatial_autocorr)',
    keyParams: ['topSVGs: 显示数量', 'mode: moran / geary / sepal', 'n_perms'],
    packages: ['squidpy.gr.spatial_autocorr'],
  },
  // ---- spatial_svg 输出（W4-A）— Note: 'plot_001_spatial_clusters.png' shared above is reused as context.
  'plot_002_top_robust_svgs.png': {
    title: 'Top robust SVGs',
    subtitle: 'Top Robust SVGs (intersection of methods)',
    category: '空间高变基因',
    biologicalQuestion: '哪些基因被多种空间统计方法同时识别为高变？这些是最可靠的 SVG 候选。',
    scenarios: ['挑论文 marker', '导给富集工具做下游 GO/KEGG'],
    inputFormat: 'AnnData with uns["svg_results"][robust]',
    keyParams: ['minMethods: 多少方法 top-N 才算 robust（推荐 ≥2）', 'topN: 每方法 top-N 大小'],
    packages: ['squidpy.gr.spatial_autocorr', 'squidpy.gr.sepal'],
  },
  'plot_003_method_venn.png': {
    title: '三方法重叠 Venn',
    subtitle: '3-Way Method Overlap Venn',
    category: '方法对比',
    biologicalQuestion:
      "Moran's I / Geary's C / Sepal 三种方法挑出的 top-N SVG 重叠多少？方法之间是否互补？",
    scenarios: ['评估方法稳健性', '判断是否需要调高 minMethods 门槛'],
    inputFormat: '三方法各自的 top-N 基因集合',
    keyParams: ['top-N 大小', '基因总数'],
    packages: ['matplotlib-venn'],
  },
  'plot_004_score_corr.png': {
    title: '方法 score 相关性',
    subtitle: 'Method Score Correlation',
    category: '方法对比',
    biologicalQuestion: '不同方法的得分是否一致？哪些基因得分极端值得关注？',
    scenarios: ['排查异常基因', '论文 supplementary 用'],
    inputFormat: 'top_svgs.csv 中的 moran_I / geary_C / sepal_score',
    keyParams: ['n_methods_top: 颜色映射（多少方法挑中）'],
    packages: ['matplotlib'],
  },
  // ---- spatial_recluster 输出（W4-A）— Note: plot_001/plot_002 share entries with spatial_standard ----
  'plot_003_top_markers.png': {
    title: '子簇 Marker 基因',
    subtitle: 'Top Markers per Sub-cluster',
    category: '子聚类标记',
    biologicalQuestion: '每个子簇有哪些独有/富集的基因？这些基因暗示了什么细胞身份或状态？',
    scenarios: ['判断子簇异质性来源', '挑选验证用 marker'],
    inputFormat: 'AnnData with uns["rank_genes_groups"]（Wilcoxon 计算）',
    keyParams: ['topNMarkers: 每簇展示数量', 'method: wilcoxon / t-test'],
    packages: ['scanpy.tl.rank_genes_groups'],
  },
  'plot_004_subset_in_context.png': {
    title: '子集在切片中位置',
    subtitle: 'Selected Subset in Full Slide Context',
    category: '上下文定位',
    biologicalQuestion: '本次重聚类的 spots 在完整组织切片的什么位置？覆盖哪些解剖区？',
    scenarios: ['报告时呈现选区位置', '判断子集是否跨越多个解剖区'],
    inputFormat: '父分析的 obsm["spatial"] + 子集 mask',
    keyParams: ['mask: leiden==parentCluster 的 spots'],
    packages: ['matplotlib'],
  },
  // ---- spatial_deconv 输出（W4-A）----
  'plot_001_dominant_celltype.png': {
    title: '每 spot 主要细胞类型',
    subtitle: 'Dominant Cell Type per Spot',
    category: '细胞解卷积',
    biologicalQuestion: '每个 spot 主要由哪种细胞类型构成？空间分布是否对应已知解剖区？',
    scenarios: ['判断切片包含哪些解剖结构', '挑感兴趣区域做下游 LR / 富集'],
    inputFormat: 'Tangram 推断的 obsm["tangram_ct_pred"] (spots × cell_types) → argmax',
    keyParams: ['label_key: cell_subclass / cell_class', 'training genes 数量'],
    packages: ['tangram-sc', 'squidpy.datasets.sc_mouse_cortex'],
  },
  'plot_002_top_celltypes_grid.png': {
    title: 'Top 细胞类型空间丰度',
    subtitle: 'Top Cell Types Abundance (2×2)',
    category: '细胞解卷积',
    biologicalQuestion:
      '主要细胞类型各自在切片上的连续分布是怎样的？颜色越深表示该类型在 spot 中占比越高。',
    scenarios: ['对比皮层 vs 海马 vs 白质的细胞构成', '验证已知 marker 与解卷积一致性'],
    inputFormat: 'obsm["tangram_ct_pred"] 各 cell type 的 spot abundance',
    keyParams: ['top-N 大小（默认 4）', 'cmap'],
    packages: ['scanpy.pl.spatial'],
  },
  'plot_003_celltype_proportion.png': {
    title: '整体细胞类型组成',
    subtitle: 'Cell Type Composition Bar',
    category: '细胞解卷积',
    biologicalQuestion: '整张切片的细胞类型构成比例如何？是否符合预期组织来源？',
    scenarios: ['做 cohort 比较', '快速 QC 判断切片质量'],
    inputFormat: 'dominant_celltype 计数',
    keyParams: ['top-10 + 其他'],
    packages: ['matplotlib'],
  },
  'plot_004_colocalization.png': {
    title: '细胞类型共定位',
    subtitle: 'Cell-type Co-localization Correlation',
    category: '细胞解卷积',
    biologicalQuestion: '哪些细胞类型在物理上倾向共占同一 spot（正相关）？哪些彼此排斥（负相关）？',
    scenarios: ['推断细胞通讯候选对', '识别功能性解剖单元'],
    inputFormat: 'spots × cell_types abundance 矩阵的 Pearson 相关',
    keyParams: ['min spots 过滤稀疏 cell type'],
    packages: ['matplotlib'],
  },
  // ---- spatial_lr 输出（W4-A）— Note: plot_001 collides only by prefix, full name unique
  'plot_001_top_lr_significance.png': {
    title: 'Top LR pairs 显著性',
    subtitle: 'Top-15 LR Pairs Significance Bar',
    category: '配体-受体',
    biologicalQuestion:
      '在所有空间邻居 spot 上，哪些 LR pair 共表达最显著？这些可能是切片中最活跃的通讯通路。',
    scenarios: ['挑通讯候选 pair 做下游富集', '论文 supplementary 用'],
    inputFormat: 'LIANA bivariate 输出的 mean local score',
    keyParams: ['mean_score: 跨 spot 的平均 LR 共现得分', 'frac_active: 得分 > 0.5 的 spot 比例'],
    packages: ['liana.mt.bivariate'],
  },
  'plot_002_top_lr_spatial.png': {
    title: 'Top-1 LR 空间分布',
    subtitle: 'Top LR Pair Spatial Score',
    category: '配体-受体',
    biologicalQuestion: '最显著的 LR pair 在切片上哪些区域得分最高？是否对应已知解剖区？',
    scenarios: ['判断通讯热点区域', '与解卷积细胞类型分布对比'],
    inputFormat: 'spots × top-1 LR pair 的 cosine 共现 score',
    keyParams: ['cmap=Reds（颜色越深得分越高）'],
    packages: ['scanpy.pl.spatial'],
  },
  'plot_003_lr_score_distribution.png': {
    title: 'Top-N LR 分布',
    subtitle: 'Top-N LR Score Distribution Boxplot',
    category: '配体-受体',
    biologicalQuestion: '不同 LR pair 在 spot 间的得分变化如何？是均匀活跃还是局部极强？',
    scenarios: ['评估 LR pair 空间一致性', '挑空间分布更稳的 pair 做验证'],
    inputFormat: 'spots × top-N LR scores',
    keyParams: ['top-N 大小'],
    packages: ['matplotlib.boxplot'],
  },
  'plot_004_top_lr_pairs_grid.png': {
    title: 'Top-4 LR pairs 空间分布',
    subtitle: 'Top-4 LR Pairs Spatial Grid (2×2)',
    category: '配体-受体',
    biologicalQuestion: 'top-4 LR pair 各自的空间模式是否相似？是否聚在同一区域？',
    scenarios: ['看通讯通路是否共定位', '挑互补的 LR pair 做下游分析'],
    inputFormat: 'spots × 4 LR pair scores',
    keyParams: ['默认 top-4 by mean_score'],
    packages: ['scanpy.pl.spatial'],
  },
};

const SPATIAL_FILE_META: Record<
  string,
  {
    title: string;
    subtitle: string;
    category: string;
    biologicalQuestion: string;
    scenarios: string[];
    inputFormat: string;
    keyParams: string[];
    packages: string[];
  }
> = {
  'top_svgs.csv': {
    title: 'Top SVGs 表',
    subtitle: 'top_svgs.csv',
    category: '数据表',
    biologicalQuestion: "每个基因的 Moran's I 值与显著性，导出供下游使用。",
    scenarios: ['挑 top-N 基因做空间共表达模块', '导给富集工具做 GO/KEGG'],
    inputFormat: 'CSV: gene, I, pval_norm',
    keyParams: ['gene: 基因 symbol', "I: Moran's I（[-1, 1]）", 'pval_norm: 渐进 p 值'],
    packages: [],
  },
  'top_markers.csv': {
    title: '子簇 Marker 表',
    subtitle: 'top_markers.csv',
    category: '数据表',
    biologicalQuestion: '每个子簇的 top-N marker 基因（按 Wilcoxon 评分），导出供论文/下游使用。',
    scenarios: ['挑代表 marker 做 FISH 验证', '导给富集工具做 GO/KEGG'],
    inputFormat: 'CSV: sub_cluster, rank, gene, score, logfc, pval_adj',
    keyParams: [
      'sub_cluster: 子簇 ID',
      'score: Wilcoxon z-score',
      'logfc: log2 倍数变化',
      'pval_adj: BH-adjusted p',
    ],
    packages: [],
  },
  'cell_type_abundance.csv': {
    title: '细胞类型丰度矩阵',
    subtitle: 'cell_type_abundance.csv',
    category: '数据表',
    biologicalQuestion: '每个 spot 各细胞类型的归一化丰度（行和=1），可做下游统计 / 可视化。',
    scenarios: ['挑感兴趣区域 spots 做 cohort 对比', '导入 R / Python 自行重绘'],
    inputFormat: 'CSV: cell_id, <cell_type_1>, <cell_type_2>, ...',
    keyParams: ['行：spot ID', '列：cell type（来自 sc reference 的 label_key）'],
    packages: [],
  },
  'top_lr_pairs.csv': {
    title: 'Top LR pairs 表',
    subtitle: 'top_lr_pairs.csv',
    category: '数据表',
    biologicalQuestion:
      '所有 LR pair 的统计：mean_score / frac_active / ligand_props / receptor_props，按 mean_score 降序排好。',
    scenarios: ['挑 top-N pair 做下游通路分析', '论文 supplementary'],
    inputFormat:
      'CSV: interaction, ligand, receptor, ligand_props, receptor_props, mean, std, mean_score, frac_active',
    keyParams: ['mean_score: 跨 spot 平均 LR cosine 共现', 'frac_active: score > 0.5 的 spot 比例'],
    packages: [],
  },
  'lr_score_per_spot.csv': {
    title: '每 spot LR 得分矩阵',
    subtitle: 'lr_score_per_spot.csv',
    category: '数据表',
    biologicalQuestion: '每个 spot 的 top-N LR pair 得分，可做 spot-level 通讯热力图 / 聚类。',
    scenarios: ['提取局部热点区域的 LR profile', '导入 Seurat / scanpy 自行可视化'],
    inputFormat: 'CSV: cell_id, <LR_pair_1>, ..., <LR_pair_N>',
    keyParams: ['行：spot ID', '列：top-N LR pair 名（如 App^Aplp1）'],
    packages: [],
  },
  'result_spatial.h5ad': {
    title: '完整 spatial AnnData',
    subtitle: 'result_spatial.h5ad',
    category: 'R/Python 对象',
    biologicalQuestion: "所有中间结果（聚类、UMAP、空间邻居、Moran's I）打包好，离线可继续分析。",
    scenarios: ['本地继续做解卷积 / LR 分析', '导给下游 Python 工具'],
    inputFormat: 'AnnData (HDF5 .h5ad)',
    keyParams: [
      'adata.obs["leiden"]: 聚类标签',
      'adata.obsm["X_umap"]: UMAP 坐标',
      'adata.uns["moranI"]: SVG 表',
    ],
    packages: ['anndata', 'scanpy'],
  },
};

export function ResultView({
  analysisId,
  navigate,
}: {
  analysisId: string;
  navigate: (r: Route) => void;
}) {
  const [sidebarCollapsed, toggleSidebar, sidebarWidth, startResize] = useSidebarCollapse();
  const [mobileOpen, openMobile, closeMobile] = useMobileDrawer();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [taskData, setTaskData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('plots'); // Will be overridden to 'preview' once analysis loads
  const [dataView, setDataView] = useState<'meta' | 'features'>('meta');
  const [selectedPlot, setSelectedPlot] = useState<PlotItem | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [showContinueModal, setShowContinueModal] = useState<SpatialAnalysisType | null>(null);
  const [tablePreview, setTablePreview] = useState<{ name: string; url: string } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state on analysisId change
  useEffect(() => {
    setAnalysis(null);
    setDataset(null);
    setProject(null);
    setTaskData(null);
    setTab('plots');
    setSelectedPlot(null);
    setSelectedFile(null);
  }, [analysisId]);

  const reload = useCallback(async () => {
    try {
      const a = await getAnalysis(analysisId);
      setAnalysis(a);
      if (a) {
        const ds = await getDataset(a.datasetId);
        setDataset(ds);
        if (ds) {
          const proj = await getProject(ds.projectId);
          setProject(proj);
        }
      }
    } catch (e: any) {
      console.error('加载分析失败', e);
    }
  }, [analysisId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // W3-C: publish Copilot context with full spatial result info
  // Note: the previous cleanup-only-half-fields effect relied on the
  // singleton's spread semantics. With useSetCopilotContext, every dep
  // change resets first then re-applies the new patch — so per-analysis
  // transitions get a clean context instead of merging old fields.
  useSetCopilotContext(
    analysis
      ? (() => {
          const summary =
            analysis.results?.summary ||
            taskData?.results?.summary ||
            analysis.summary;
          return {
            page: 'spatial-result',
            currentModule: 'spatial',
            projectId: project?.id,
            datasetId: dataset?.id,
            datasetName: dataset?.name,
            analysisId: analysis.id,
            analysisName: analysis.name,
            analysisType: analysis.type,
            summary,
          };
        })()
      : {},
    [
      analysis?.id,
      analysis?.name,
      analysis?.type,
      dataset?.id,
      dataset?.name,
      project?.id,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      JSON.stringify(analysis?.summary || taskData?.results?.summary),
    ]
  );

  // Poll task — pull from py-server, persist to r-server analyses on change
  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;

    if ((analysis.status === 'done' || analysis.status === 'failed') && analysis.results) {
      setTaskData({ status: analysis.status, results: analysis.results, error: analysis.error });
      return;
    }

    const fetchOnce = async () => {
      try {
        const task = await getSpatialTaskStatus(analysis.taskId);
        if (cancelled) return;
        setTaskData(task);
        if (task.status !== analysis.status) {
          await updateAnalysis(analysis.id, {
            status: task.status,
            summary: task.results?.summary,
            error: task.error,
            finishedAt: task.finishedAt,
          });
          reload();
        }
      } catch (err: any) {
        if (analysis.status === 'done' && analysis.summary) {
          setTaskData({
            status: 'done',
            results: { summary: analysis.summary, plots: [], files: [] },
          });
        }
      }
    };

    fetchOnce();
    if (
      analysis.status === 'running' ||
      analysis.status === 'pending' ||
      analysis.status === 'queued'
    ) {
      pollRef.current = setInterval(fetchOnce, 2500);
    }
    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.taskId, analysis?.status]);

  // Auto-pick main plot once results are available (prefer plot_001 = spatial clusters)
  useEffect(() => {
    const plots: PlotItem[] = taskData?.results?.plots || [];
    if (plots.length === 0) return;
    if (selectedPlot && plots.some((p) => p.url === selectedPlot.url)) return;
    const main = plots.find((p) => p.filename?.startsWith('plot_001')) || plots[0];
    setSelectedPlot(main);
  }, [taskData?.results?.plots, selectedPlot]);

  // Mirror single-cell: default to 'preview' tab for completed standard analyses (shows the tool card on the right)
  useEffect(() => {
    if (analysis && (analysis.type as string) === 'spatial_standard' && analysis.status === 'done') {
      setTab('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.id, analysis?.type, analysis?.status]);

  // Auto-pick first file
  useEffect(() => {
    const files: FileItem[] = taskData?.results?.files || [];
    if (files.length === 0) return;
    if (selectedFile && files.some((f) => f.name === selectedFile.name)) return;
    setSelectedFile(files[0]);
  }, [taskData?.results?.files, selectedFile]);

  const handleDelete = useCallback(
    async (e?: React.MouseEvent) => {
      if (!analysis || !dataset) return;
      if (!requireWrite('删除分析', e)) return;
      if (confirm(`删除「${analysis.name}」？`)) {
        try {
          await deleteAnalysis(analysis.id);
          navigate({ name: 'dataset', datasetId: dataset.id });
        } catch (err: any) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [analysis, dataset, navigate]
  );

  const handleRename = useCallback(async () => {
    if (!analysis || !renameValue.trim() || renameValue.trim() === analysis.name) {
      setRenaming(false);
      return;
    }
    if (!requireWrite('重命名')) {
      setRenaming(false);
      return;
    }
    try {
      await updateAnalysis(analysis.id, { name: renameValue.trim() });
      setRenaming(false);
      reload();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
    }
  }, [analysis, renameValue, reload]);

  const handleContinueCreated = useCallback(
    (newAnalysis: Analysis) => {
      setShowContinueModal(null);
      navigate({ name: 'result', analysisId: newAnalysis.id });
    },
    [navigate]
  );

  const isPublicReadOnly = project?.isPublic && getStoredUser()?.role !== 'admin';

  const handleToolClick = useCallback(
    (type: SpatialAnalysisType) => {
      if (isPublicReadOnly) {
        alert('此为公开示例（只读）。请返回项目列表，点击「查看 Demo」后再发起分析。');
        return;
      }
      if (!ANALYSIS_TYPES[type]?.available) {
        alert(`${ANALYSIS_TYPES[type]?.name || type} 待 Wave 4 上线。`);
        return;
      }
      setShowContinueModal(type);
    },
    [isPublicReadOnly]
  );

  if (!analysis || !dataset || !project) {
    return (
      <main className="sc-page">
        <div className="sc-main">
          <div className="sc-empty">
            <div className="sc-empty-desc">加载中...</div>
          </div>
        </div>
      </main>
    );
  }

  const meta = ANALYSIS_TYPES[analysis.type as SpatialAnalysisType] || {
    name: analysis.type,
    color: '#64748b',
    icon: '?',
    shortName: analysis.type,
    desc: '',
    intro: '',
    input: '',
    output: '',
    packages: [],
  };
  const statusInfo = STATUS_LABELS[analysis.status] || { label: analysis.status, color: '#64748b' };
  const isRunning =
    analysis.status === 'running' || analysis.status === 'pending' || analysis.status === 'queued';
  const isDone = analysis.status === 'done';
  const results = taskData?.results;
  const elapsed = analysis.finishedAt
    ? (new Date(analysis.finishedAt).getTime() - new Date(analysis.createdAt).getTime()) / 1000
    : 0;

  // Right info panel target
  const activePanelTarget: PanelTarget = (() => {
    if (tab === 'data' && selectedFile) {
      const fm = SPATIAL_FILE_META[selectedFile.name];
      return { kind: 'file' as const, meta: (fm || null) as any, plot: null, file: selectedFile };
    }
    if (tab === 'plots' && selectedPlot) {
      const pm = SPATIAL_PLOT_META[selectedPlot.filename] || SPATIAL_PLOT_META[selectedPlot.name];
      return { kind: 'plot' as const, meta: (pm || null) as any, plot: selectedPlot, file: null };
    }
    return { kind: 'none' as const, meta: null, plot: null, file: null };
  })();

  return (
    <main className="sc-page">
      <section
        className={`sc-layout ${tab !== 'preview' ? 'sc-layout-3col' : ''} ${sidebarCollapsed ? 'sc-layout-collapsed' : ''}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* ===== Left Sidebar ===== */}
        <div
          className={`sc-sidebar-col ${sidebarCollapsed ? 'sc-sidebar-col-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
        >
          <Sidebar
            navigate={(r) => {
              closeMobile();
              navigate(r);
            }}
            activeProjectId={project.id}
            activeDatasetId={dataset.id}
            activeAnalysisId={analysisId}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            width={sidebarWidth}
            onResizeStart={startResize}
            mobileOpen={mobileOpen}
          />
        </div>
        {mobileOpen && <div className="sc-mobile-backdrop" onClick={closeMobile} />}

        {/* ===== Center Content ===== */}
        <div className="sc-main">
          <button className="sc-mobile-menu-btn" onClick={openMobile} aria-label="打开导航">
            <span className="sc-mobile-menu-btn-icon">
              <span />
            </span>
            导航
          </button>

          <div className="sc-header">
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 6,
                  flexWrap: 'wrap',
                }}
              >
                <span
                  className="sc-analysis-badge"
                  style={{ width: 28, height: 28, fontSize: 12, background: meta.color }}
                >
                  {meta.icon}
                </span>
                <h1 className="sc-header-title" style={{ margin: 0 }}>
                  {renaming ? (
                    <input
                      className="sc-form-input"
                      style={{ fontSize: 16, fontWeight: 700, padding: '2px 6px', width: 260 }}
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onBlur={handleRename}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename();
                        if (e.key === 'Escape') setRenaming(false);
                      }}
                      autoFocus
                    />
                  ) : (
                    <span
                      onDoubleClick={() => {
                        setRenameValue(analysis.name);
                        setRenaming(true);
                      }}
                      title="双击重命名"
                      style={{ cursor: 'text' }}
                    >
                      {analysis.name}
                      <span
                        style={{ fontSize: 10, color: '#9ca3af', marginLeft: 6, fontWeight: 400 }}
                      >
                        ✎
                      </span>
                    </span>
                  )}
                </h1>
                <span
                  className="sc-status-tag"
                  style={{ background: `${statusInfo.color}20`, color: statusInfo.color }}
                >
                  <span
                    className={`sc-status-dot ${analysis.status}`}
                    style={{ background: statusInfo.color }}
                  />
                  {statusInfo.label}
                </span>
                <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400, marginLeft: 8 }}>
                  {meta.name}
                  {isDone && elapsed > 0 && ` · 耗时 ${formatDuration(elapsed)}`}
                  {` · ${formatTime(analysis.createdAt)}`}
                </span>
              </div>
            </div>
            <div className="sc-header-actions">
              <button className="sc-btn" onClick={handleDelete}>
                删除
              </button>
              {isDone && results?.files?.[0]?.url && (
                <a className="sc-btn sc-btn-primary" href={results.files[0].url} download>
                  下载结果
                </a>
              )}
            </div>
          </div>

          {/* Running banner */}
          {isRunning && (
            <div className="sc-running">
              <div className="sc-spinner" />
              <div className="sc-running-msg">
                {taskData?.queuePosition > 0 ? (
                  <>
                    排队中 · 前面还有 <strong>{taskData.queuePosition}</strong> 个任务
                    <span style={{ color: '#9ca3af', marginLeft: 8 }}>
                      （服务器同时处理 {taskData.maxConcurrent || 3} 个任务，请稍候）
                    </span>
                  </>
                ) : (
                  taskData?.progressMessage || '正在启动...'
                )}
              </div>
              <div className="sc-running-bar">
                <div
                  className="sc-running-bar-fill"
                  style={{ width: `${taskData?.progress || 0}%` }}
                />
              </div>
              <div className="sc-running-pct">{taskData?.progress || 0}%</div>
            </div>
          )}

          {/* Failed banner */}
          {analysis.status === 'failed' &&
            (() => {
              const rawErr = analysis.error || taskData?.error || '未知错误';
              const translated = translateError(rawErr);
              return (
                <div className="sc-error-box">
                  <strong>❌ {translated ? translated.message : '分析失败'}</strong>
                  {translated && (
                    <div
                      style={{
                        margin: '8px 0',
                        padding: '8px 12px',
                        background: '#fef3c7',
                        borderRadius: 6,
                        fontSize: 12,
                        color: '#92400e',
                      }}
                    >
                      💡 {translated.suggestion}
                    </div>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: '#9ca3af' }}>
                      原始错误信息
                    </summary>
                    <pre style={{ marginTop: 6, fontSize: 10 }}>{rawErr}</pre>
                  </details>
                </div>
              );
            })()}

          {/* Done state */}
          {isDone && results && (
            <>
              {/* Tabs */}
              <div className="sc-result-tabs">
                {((analysis.type as string) === 'spatial_standard') && (
                  <button
                    className={`sc-tab ${tab === 'preview' ? 'active' : ''}`}
                    onClick={() => setTab('preview')}
                  >
                    数据预览
                  </button>
                )}
                <button
                  className={`sc-tab ${tab === 'plots' ? 'active' : ''}`}
                  onClick={() => setTab('plots')}
                >
                  图表 {results.plots?.length > 0 && `(${results.plots.length})`}
                </button>
                <button
                  className={`sc-tab ${tab === 'data' ? 'active' : ''}`}
                  onClick={() => setTab('data')}
                >
                  数据文件 {results.files?.length > 0 && `(${results.files.length})`}
                </button>
                <button
                  className={`sc-tab ${tab === 'params' ? 'active' : ''}`}
                  onClick={() => setTab('params')}
                >
                  参数
                </button>
              </div>

              {/* Plots tab — sc-plots-grid 卡片网格 */}
              {tab === 'plots' && (
                <>
                  {results.plots?.length > 0 ? (
                    <div className="sc-plots-grid">
                      {results.plots.map((p: PlotItem, i: number) => {
                        const isSelected = selectedPlot?.url === p.url;
                        const pMeta = SPATIAL_PLOT_META[p.filename] || SPATIAL_PLOT_META[p.name];
                        const topName = pMeta?.subtitle || (p.name || '').replace(/_/g, ' ');
                        const bottomLabel = pMeta?.title || p.name;
                        return (
                          <div
                            key={i}
                            className={`sc-plot-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedPlot(p)}
                            onDoubleClick={() => setLightboxSrc(p.url)}
                            title="单击查看介绍，双击放大"
                          >
                            <div className="sc-plot-card-title">{topName}</div>
                            <div className="sc-plot-card-image">
                              <img src={p.url} alt={p.name} loading="lazy" />
                            </div>
                            <div className="sc-plot-card-info">
                              <span className="sc-plot-card-label" title={bottomLabel}>
                                {bottomLabel}
                              </span>
                              <div className="sc-plot-card-btns">
                                <button
                                  className="sc-card-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLightboxSrc(p.url);
                                  }}
                                  title="放大查看"
                                >
                                  🔍
                                </button>
                                <a
                                  className="sc-card-btn"
                                  href={p.url}
                                  download={p.filename || p.name}
                                  onClick={(e) => e.stopPropagation()}
                                  title="下载图片"
                                >
                                  ⬇
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sc-empty">
                      <div className="sc-empty-desc">暂无图表输出</div>
                    </div>
                  )}
                </>
              )}

              {/* Data tab — sc-plots-grid 文件卡片 */}
              {tab === 'data' && (
                <>
                  {results.files?.length > 0 ? (
                    <div className="sc-plots-grid">
                      {results.files.map((f: FileItem, i: number) => {
                        const isCSV = /\.(csv|tsv|txt)$/i.test(f.name);
                        const isH5ad = /\.h5ad$/i.test(f.name);
                        const topName = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
                        const bottomLabel = isCSV ? '数据表' : isH5ad ? 'AnnData 对象' : '数据文件';
                        return (
                          <div
                            key={i}
                            className={`sc-plot-card sc-data-card ${selectedFile?.name === f.name ? 'selected' : ''}`}
                            onClick={() => setSelectedFile(f)}
                          >
                            <div className="sc-plot-card-title">{topName}</div>
                            <div className="sc-plot-card-image sc-data-card-icon">
                              <span>{isCSV ? '📊' : isH5ad ? '🧬' : '📄'}</span>
                              <span style={{ fontSize: 11, color: '#9ca3af', marginTop: 6 }}>
                                {f.name}
                              </span>
                            </div>
                            <div className="sc-plot-card-info">
                              <span className="sc-plot-card-label">{bottomLabel}</span>
                              <div className="sc-plot-card-btns">
                                {isCSV && (
                                  <button
                                    className="sc-card-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTablePreview({ name: f.name, url: f.url });
                                    }}
                                  >
                                    预览
                                  </button>
                                )}
                                <a className="sc-card-btn-primary" href={f.url} download>
                                  下载
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sc-empty">
                      <div className="sc-empty-desc">暂无数据文件</div>
                    </div>
                  )}
                </>
              )}

              {/* Preview tab — sc-data-tools-layout: 左 obs/var 表 (CsvTable) · 右工具卡 */}
              {tab === 'preview' && (
                <div className="sc-data-tools-layout">
                  <div className="sc-data-table-col">
                    {/* Meta / Features toggle */}
                    <div className="sc-data-view-switch">
                      <button
                        className={`sc-data-view-btn ${dataView === 'meta' ? 'active' : ''}`}
                        onClick={() => setDataView('meta')}
                        disabled={!dataset.metaUrl}
                      >
                        spot 元数据 (obs)
                      </button>
                      <button
                        className={`sc-data-view-btn ${dataView === 'features' ? 'active' : ''}`}
                        onClick={() => setDataView('features')}
                        disabled={!dataset.featuresUrl}
                      >
                        基因列表 (var)
                      </button>
                    </div>
                    {dataView === 'meta' && dataset.metaUrl ? (
                      <CsvTable
                        key={`meta-${dataset.id}`}
                        fileUrl={dataset.metaUrl}
                        pageSize={20}
                        rowKey="cell_id"
                      />
                    ) : dataView === 'features' && dataset.featuresUrl ? (
                      <CsvTable
                        key={`feat-${dataset.id}`}
                        fileUrl={dataset.featuresUrl}
                        pageSize={20}
                        rowKey="gene_symbol"
                      />
                    ) : (
                      <div className="sc-data-preview-hint">
                        <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                          ⏳ 数据预览正在生成中...
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
                          分析完成后刷新页面即可查看 spot 元数据和基因列表
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="sc-tools-card">
                    <div className="sc-tools-card-header">
                      <span className="sc-tools-card-title">空间分析工具</span>
                      {isPublicReadOnly && (
                        <span style={{ fontSize: 9, color: '#9ca3af' }}>只读</span>
                      )}
                    </div>
                    <div className="sc-tools-grid">
                      {(Object.keys(ANALYSIS_TYPES) as SpatialAnalysisType[]).map((key) => {
                        if (key === 'spatial_standard') return null;
                        const m = ANALYSIS_TYPES[key];
                        const isReady = !!m.available;
                        return (
                          <button
                            key={key}
                            className={`sc-tool-item ${!isReady ? 'sc-tool-item-wip' : ''}`}
                            onClick={() => (isReady ? handleToolClick(key) : undefined)}
                            title={isReady ? `${m.name} — ${m.desc}` : `${m.name}（开发中）`}
                            disabled={!isReady}
                          >
                            <span
                              className="sc-tool-item-icon"
                              style={{ background: isReady ? m.color : '#9ca3af' }}
                            >
                              {m.icon}
                            </span>
                            <span className="sc-tool-item-name">{m.shortName}</span>
                            {!isReady && <span className="sc-tool-item-wip-tag">开发中</span>}
                          </button>
                        );
                      })}
                      <button
                        className="sc-tool-item"
                        onClick={() => handleToolClick('spatial_standard')}
                        title="重新运行标准分析"
                      >
                        <span className="sc-tool-item-icon" style={{ background: '#64748b' }}>
                          S
                        </span>
                        <span className="sc-tool-item-name">重新分析</span>
                      </button>
                    </div>
                    {/* Stats summary */}
                    {results?.summary && (
                      <div
                        style={{
                          borderTop: '1px solid #e5ebe8',
                          marginTop: 12,
                          paddingTop: 10,
                          paddingLeft: 12,
                          paddingRight: 12,
                        }}
                      >
                        <div
                          style={{
                            fontSize: 10,
                            fontWeight: 800,
                            color: '#9ca3af',
                            marginBottom: 6,
                          }}
                        >
                          统计摘要
                        </div>
                        <div className="sc-stats-list">
                          {Object.entries(results.summary).map(([k, v]) => {
                            if (v == null || typeof v === 'object') return null;
                            const label = k.replace(/_/g, ' ');
                            const value = typeof v === 'number' ? v.toLocaleString() : String(v);
                            return (
                              <div key={k} className="sc-stats-item">
                                <span className="sc-stats-label">{label}</span>
                                <span className="sc-stats-value">{value}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Params tab */}
              {tab === 'params' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">分析参数</div>
                  <pre style={{ fontSize: 11, background: 'transparent', margin: 0 }}>
                    {JSON.stringify(analysis.params, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* ===== Right Info Panel ===== */}
        {tab !== 'preview' && <RightInfoPanel target={activePanelTarget} />}
      </section>

      {lightboxSrc && (
        <div className="sc-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="" />
        </div>
      )}

      {showContinueModal && dataset && (
        <NewAnalysisModal
          dataset={dataset}
          defaultType={showContinueModal}
          parentAnalysisId={analysis.id}
          onClose={() => setShowContinueModal(null)}
          onCreated={handleContinueCreated}
        />
      )}

      {tablePreview && (
        <TablePreviewModal
          fileName={tablePreview.name}
          fileUrl={tablePreview.url}
          onClose={() => setTablePreview(null)}
        />
      )}
    </main>
  );
}

// ============================================================
// Right info panel — mirrors single-cell pattern, spatial-aware
// ============================================================

interface PanelTarget {
  kind: 'plot' | 'file' | 'none';
  meta: Record<string, any> | null;
  plot: PlotItem | null;
  file: FileItem | null;
}

function RightInfoPanel({ target }: { target: PanelTarget }) {
  if (target.kind === 'none' || (!target.plot && !target.file)) {
    return (
      <aside className="sc-info-panel">
        <div className="sc-info-empty">
          <p>点击卡片查看详细介绍</p>
        </div>
      </aside>
    );
  }

  const meta = target.meta;
  const fallbackName = target.plot?.name || target.file?.name || '';

  return (
    <aside className="sc-info-panel">
      <div className="sc-info-content">
        {meta ? (
          <>
            <span className="sc-info-badge">{meta.category}</span>
            <h3 className="sc-info-title">{meta.title}</h3>
            <p className="sc-info-subtitle">{meta.subtitle}</p>

            <div className="sc-info-section">
              <strong>解决的生物学问题</strong>
              <p>{meta.biologicalQuestion}</p>
            </div>

            <div className="sc-info-section">
              <strong>应用场景</strong>
              <ul className="sc-info-list">
                {meta.scenarios.map((s: string, i: number) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="sc-info-section">
              <strong>{target.kind === 'file' ? '内容字段' : '输入格式'}</strong>
              <p>{meta.inputFormat}</p>
            </div>

            <div className="sc-info-section">
              <strong>{target.kind === 'file' ? '关键字段' : '关键参数'}</strong>
              <ul className="sc-info-param-list">
                {meta.keyParams.map((p: string, i: number) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="sc-info-section">
              <strong>依赖包</strong>
              <div className="sc-info-pkg-list">
                {meta.packages.length > 0 ? (
                  meta.packages.map((pkg: string) => (
                    <span key={pkg} className="sc-info-pkg-tag">
                      {pkg}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: '#9ca3af' }}>无</span>
                )}
              </div>
            </div>
          </>
        ) : (
          <>
            <h3 className="sc-info-title">{fallbackName}</h3>
            <p className="sc-info-subtitle">{target.plot?.filename || target.file?.name}</p>
            <div className="sc-info-section">
              <p style={{ color: '#9ca3af' }}>暂无该项的详细介绍。</p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

// (orphan helper removed along with AICard render)
