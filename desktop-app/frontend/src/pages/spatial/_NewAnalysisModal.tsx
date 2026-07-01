// ============================================================
// /spatial — New Analysis Modal
//
// 与 /single-cell `_NewAnalysisModal.tsx` 同结构，分析类型清单是空间专属。
//
// 派发：spatial `_api.ts → submitSpatialTask`（py-server `/api/task`）。
// 缓存：W4-A — 子任务（spatial_recluster / svg / deconv / lr）通过 params.parentTaskId
//       让 py-server 从 biof3-py-tmp/_cache/task-{parentId}.h5ad 加载，跳过重复 QC + PCA + UMAP + Leiden。
// ============================================================
import React, { useState, useEffect, useCallback } from 'react';
import type { Dataset, Analysis } from './_types';
import { ANALYSIS_TYPES, type SpatialAnalysisType } from './_types';
import { createAnalysis, listAnalysesByDataset, getAnalysis } from './_store';
import { submitSpatialTask } from './_api';

interface Props {
  dataset: Dataset;
  defaultType?: SpatialAnalysisType;
  parentAnalysisId?: string;
  onClose: () => void;
  onCreated: (analysis: Analysis) => void;
}

export function NewAnalysisModal({
  dataset,
  defaultType,
  parentAnalysisId,
  onClose,
  onCreated,
}: Props) {
  const [type, setType] = useState<SpatialAnalysisType>(defaultType || 'spatial_standard');
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);
  const [analysisName, setAnalysisName] = useState('');

  // ---- spatial_standard params ----
  const [nPCs, setNPCs] = useState(30);
  const [resolution, setResolution] = useState(0.5);
  const [coordType, setCoordType] = useState<'generic' | 'grid'>('generic');
  const [nNeighbors, setNNeighbors] = useState(6);
  const [topSVGs, setTopSVGs] = useState(50);
  const [nHVGs, setNHVGs] = useState(2000);

  // ---- spatial_recluster params ----
  const [parentCluster, setParentCluster] = useState<string>('0');
  const [subResolution, setSubResolution] = useState(0.5);

  // ---- spatial_svg params ----
  const [svgTopN, setSvgTopN] = useState(50);
  const [svgMinMethods, setSvgMinMethods] = useState(2);
  const [svgNGenesTest, setSvgNGenesTest] = useState(1000);
  const [svgNPerms, setSvgNPerms] = useState(100);

  // ---- spatial_deconv params ----
  const [deconvNTrainingGenes, setDeconvNTrainingGenes] = useState(1000);
  const [deconvRefLabelKey, setDeconvRefLabelKey] = useState<'cell_subclass' | 'cell_class'>(
    'cell_subclass'
  );

  // ---- spatial_lr params ----
  const [lrResourceName, setLrResourceName] = useState<'mouseconsensus' | 'consensus'>(
    'mouseconsensus'
  );
  const [lrLocalName, setLrLocalName] = useState<'cosine' | 'jaccard' | 'pearson'>('cosine');
  const [lrNPerms, setLrNPerms] = useState(100);
  const [lrTopN, setLrTopN] = useState(20);

  // ---- Parent analysis picker (for child types: requiresResult=true) ----
  const [parentAnalyses, setParentAnalyses] = useState<Analysis[]>([]);
  const [parent, setParent] = useState<Analysis | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | undefined>(parentAnalysisId);

  const meta = ANALYSIS_TYPES[type];
  const isAvailable = !!meta.available;
  const requiresParent = meta.requiresResult;

  // Load candidate parents (done spatial_standard analyses on this dataset)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listAnalysesByDataset(dataset.id);
        const done = list.filter((a) => a.type === 'spatial_standard' && a.status === 'done');
        if (cancelled) return;
        setParentAnalyses(done);
        if (!parentAnalysisId && done.length > 0) {
          // Default to latest
          const sorted = [...done].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          );
          setSelectedParentId(sorted[0].id);
          setParent(sorted[0]);
        }
      } catch (err) {
        /* ignore */
      }

      if (parentAnalysisId) {
        try {
          const p = await getAnalysis(parentAnalysisId);
          if (!cancelled && p) {
            setParent(p);
            setSelectedParentId(parentAnalysisId);
          }
        } catch (err) {
          /* ignore */
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataset.id, parentAnalysisId]);

  const handleParentChange = useCallback(
    (id: string) => {
      setSelectedParentId(id);
      const found = parentAnalyses.find((a) => a.id === id);
      setParent(found || null);
    },
    [parentAnalyses]
  );

  // Available cluster IDs from parent's summary or first done analysis result
  const availableClusters: string[] = (() => {
    if (!parent) return [];
    const nClusters = parent.summary?.n_clusters || parent.summary?.nClusters;
    if (typeof nClusters === 'number' && nClusters > 0) {
      return Array.from({ length: nClusters }, (_, i) => String(i));
    }
    return [];
  })();

  // Reset cluster picker when parent changes (default to "0")
  useEffect(() => {
    if (availableClusters.length > 0 && !availableClusters.includes(parentCluster)) {
      setParentCluster(availableClusters[0]);
    }
  }, [availableClusters, parentCluster]);

  const handleSubmit = useCallback(async () => {
    if (!isAvailable) {
      alert(`${meta.name} 尚未上线（Wave 4-A 实现中）`);
      return;
    }
    if (requiresParent && !parent) {
      alert('此分析需要先有一个完成的「空间标准分析」作为父分析');
      return;
    }
    setSubmitting(true);
    try {
      // Build params + resolve parent task ID for cache hit
      let params: Record<string, unknown> = {};
      let parentTaskIdForRequest: string | undefined;

      if (type === 'spatial_standard') {
        params = { nPCs, resolution, coordType, nNeighbors, topSVGs, nHVGs };
      } else if (type === 'spatial_recluster' && parent) {
        params = { parentCluster, nPCs: 20, subResolution, nNeighbors: 15, topNMarkers: 5 };
        parentTaskIdForRequest = parent.taskId;
      } else if (type === 'spatial_svg' && parent) {
        params = {
          topN: svgTopN,
          minMethods: svgMinMethods,
          nGenesTest: svgNGenesTest,
          nPerms: svgNPerms,
        };
        parentTaskIdForRequest = parent.taskId;
      } else if (type === 'spatial_deconv' && parent) {
        params = { nTrainingGenes: deconvNTrainingGenes, refLabelKey: deconvRefLabelKey };
        parentTaskIdForRequest = parent.taskId;
      } else if (type === 'spatial_lr' && parent) {
        params = {
          resourceName: lrResourceName,
          localName: lrLocalName,
          nPerms: lrNPerms,
          topN: lrTopN,
        };
        parentTaskIdForRequest = parent.taskId;
      }

      // py-server requires non-empty ossInputUrl in /api/task contract — use the
      // dataset's original h5ad as fallback (cache lookup happens via params.parentTaskId).
      const taskId = await submitSpatialTask(type, dataset.ossUrl, params, parentTaskIdForRequest);

      const existing = await listAnalysesByDataset(dataset.id);
      const finalName = analysisName.trim() || getNextSpatialName(existing, type, parent?.name);

      const analysis = await createAnalysis({
        datasetId: dataset.id,
        taskId,
        type: type as string,
        name: finalName,
        // spatial_standard is root; child types record parent for sidebar tree
        parentAnalysisId: type === 'spatial_standard' ? undefined : parent?.id || parentAnalysisId,
        params,
        status: 'running',
      });

      onCreated(analysis);
    } catch (err) {
      alert(`提交失败: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [
    type,
    dataset,
    parent,
    parentAnalysisId,
    onCreated,
    analysisName,
    requiresParent,
    isAvailable,
    meta.name,
    nPCs,
    resolution,
    coordType,
    nNeighbors,
    topSVGs,
    nHVGs,
    parentCluster,
    subResolution,
    svgTopN,
    svgMinMethods,
    svgNGenesTest,
    svgNPerms,
    deconvNTrainingGenes,
    deconvRefLabelKey,
    lrResourceName,
    lrLocalName,
    lrNPerms,
    lrTopN,
  ]);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="sc-modal-header">
          <h2 className="sc-modal-title">新建空间分析</h2>
          <button className="sc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sc-modal-body">
          {/* Type picker — 5 spatial types */}
          <div className="sc-form-group">
            <label className="sc-form-label">分析类型</label>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
              {(Object.keys(ANALYSIS_TYPES) as SpatialAnalysisType[]).map((key) => {
                const m = ANALYSIS_TYPES[key];
                const enabled = !!m.available;
                const active = type === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => enabled && setType(key)}
                    disabled={!enabled}
                    title={enabled ? m.intro : `${m.name} — 待 Wave 4 实现`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: active ? `2px solid ${m.color}` : '1px solid #e2e8f0',
                      background: active ? `${m.color}10` : enabled ? '#fff' : '#f8fafc',
                      color: enabled ? '#1e293b' : '#94a3b8',
                      cursor: enabled ? 'pointer' : 'not-allowed',
                      textAlign: 'left',
                      opacity: enabled ? 1 : 0.6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 18,
                          height: 18,
                          lineHeight: '18px',
                          textAlign: 'center',
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#fff',
                          background: m.color,
                          borderRadius: 3,
                        }}
                      >
                        {m.icon}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{m.shortName}</span>
                      {!enabled && (
                        <span style={{ fontSize: 9, color: '#94a3b8', marginLeft: 'auto' }}>
                          WIP
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: '#64748b', marginTop: 4, lineHeight: 1.4 }}>
                      {m.desc}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tool intro card */}
          <div className="sc-tool-intro">
            <div className="sc-tool-intro-header">
              <span className="sc-tool-intro-icon" style={{ background: meta.color }}>
                {meta.icon}
              </span>
              <div>
                <div className="sc-tool-intro-name">{meta.name}</div>
                <div className="sc-tool-intro-desc">{meta.intro}</div>
              </div>
            </div>
            <div className="sc-tool-intro-meta">
              <div>
                <strong>输入：</strong>
                {meta.input}
              </div>
              <div>
                <strong>输出：</strong>
                {meta.output}
              </div>
              <div>
                <strong>Python 包：</strong>
                {meta.packages.join(', ')}
              </div>
            </div>
          </div>

          {/* Data source */}
          <div className="sc-form-group">
            <label className="sc-form-label">数据源</label>
            <div
              style={{
                fontSize: 11,
                color: '#475569',
                padding: '8px 10px',
                background: '#f8faf9',
                borderRadius: 5,
              }}
            >
              <div>
                ● 数据集：<strong>{dataset.name}</strong>
                {dataset.nCells != null && (
                  <span style={{ color: '#9ca3af', marginLeft: 6 }}>
                    ({dataset.nCells.toLocaleString()} spots)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Parent picker — for child types */}
          {requiresParent && parentAnalyses.length > 0 && (
            <div className="sc-form-group">
              <label className="sc-form-label">基于分析结果</label>
              <select
                className="sc-form-input"
                value={selectedParentId || ''}
                onChange={(e) => handleParentChange(e.target.value)}
              >
                {parentAnalyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} (空间标准分析 · {new Date(a.createdAt).toLocaleDateString('zh-CN')})
                  </option>
                ))}
              </select>
              <div className="sc-form-hint">
                将复用这次分析的 .h5ad（聚类 / UMAP / Leiden 全继承），跳过重复计算
              </div>
            </div>
          )}
          {requiresParent && parentAnalyses.length === 0 && (
            <div className="sc-info-banner" style={{ marginBottom: 8 }}>
              <strong>提示：</strong>
              此分析需要先完成一次「空间标准分析」。请先回到数据集页面发起标准分析。
            </div>
          )}

          {/* Analysis name */}
          <div className="sc-form-group">
            <label className="sc-form-label">分析名称</label>
            <input
              className="sc-form-input"
              value={analysisName}
              onChange={(e) => setAnalysisName(e.target.value)}
              placeholder={`默认：${meta.shortName} vN`}
            />
          </div>

          {/* Params */}
          <button
            className="sc-param-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ marginBottom: showAdvanced ? 10 : 0 }}
          >
            <span>参数设置</span>
            <span>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && type === 'spatial_standard' && (
            <>
              <div className="sc-param-group">
                <div className="sc-param-title">降维 & 聚类</div>
                <div className="sc-param-row">
                  <label>nPCs</label>
                  <input
                    type="number"
                    min={5}
                    max={50}
                    value={nPCs}
                    onChange={(e) => setNPCs(+e.target.value)}
                  />
                </div>
                <div className="sc-param-row">
                  <label>resolution</label>
                  <input
                    type="number"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={resolution}
                    onChange={(e) => setResolution(+e.target.value)}
                  />
                </div>
                <div className="sc-param-row">
                  <label>n HVGs</label>
                  <input
                    type="number"
                    min={500}
                    max={5000}
                    step={100}
                    value={nHVGs}
                    onChange={(e) => setNHVGs(+e.target.value)}
                  />
                </div>
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">空间邻域</div>
                <div className="sc-param-row">
                  <label>coordType</label>
                  <select
                    value={coordType}
                    onChange={(e) => setCoordType(e.target.value as string)}
                  >
                    <option value="generic">generic（任意坐标）</option>
                    <option value="grid">grid（Visium 六角网格）</option>
                  </select>
                </div>
                <div className="sc-param-row">
                  <label>n邻居</label>
                  <input
                    type="number"
                    min={4}
                    max={12}
                    value={nNeighbors}
                    onChange={(e) => setNNeighbors(+e.target.value)}
                  />
                </div>
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">空间高变基因</div>
                <div className="sc-param-row">
                  <label>top SVGs</label>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    step={10}
                    value={topSVGs}
                    onChange={(e) => setTopSVGs(+e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {showAdvanced && type === 'spatial_recluster' && (
            <>
              <div className="sc-param-group">
                <div className="sc-param-title">子集选择</div>
                <div className="sc-param-row">
                  <label>父 cluster</label>
                  {availableClusters.length > 0 ? (
                    <select
                      value={parentCluster}
                      onChange={(e) => setParentCluster(e.target.value)}
                    >
                      {availableClusters.map((c) => (
                        <option key={c} value={c}>
                          cluster {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={parentCluster}
                      onChange={(e) => setParentCluster(e.target.value)}
                      placeholder="输入 leiden cluster ID（如 3）"
                    />
                  )}
                </div>
                {availableClusters.length === 0 && parent && (
                  <div className="sc-form-hint">
                    父分析 summary 没有 n_clusters；请手动输入要细分的 cluster ID（参考父分析的
                    plot_001 / plot_002）。
                  </div>
                )}
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">子聚类</div>
                <div className="sc-param-row">
                  <label>sub resolution</label>
                  <input
                    type="number"
                    min={0.1}
                    max={2.0}
                    step={0.1}
                    value={subResolution}
                    onChange={(e) => setSubResolution(+e.target.value)}
                  />
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  resolution 越大子簇数越多。默认 0.5 通常给出 2-4 个子簇。
                </div>
              </div>
            </>
          )}

          {showAdvanced && type === 'spatial_svg' && (
            <>
              <div className="sc-param-group">
                <div className="sc-param-title">基因池</div>
                <div className="sc-param-row">
                  <label>测试基因数</label>
                  <input
                    type="number"
                    min={200}
                    max={5000}
                    step={100}
                    value={svgNGenesTest}
                    onChange={(e) => setSvgNGenesTest(+e.target.value)}
                  />
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  从父分析的 HVG 取 top-N 跑三方法。1000 通常够用；越多越慢（Sepal 慢）。
                </div>
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">三方法 + 交集</div>
                <div className="sc-param-row">
                  <label>每方法 top-N</label>
                  <input
                    type="number"
                    min={10}
                    max={200}
                    step={10}
                    value={svgTopN}
                    onChange={(e) => setSvgTopN(+e.target.value)}
                  />
                </div>
                <div className="sc-param-row">
                  <label>robust 门槛</label>
                  <select value={svgMinMethods} onChange={(e) => setSvgMinMethods(+e.target.value)}>
                    <option value={1}>≥ 1 方法 top-N（宽松）</option>
                    <option value={2}>≥ 2 方法 top-N（推荐）</option>
                    <option value={3}>= 3 方法 top-N（严格）</option>
                  </select>
                </div>
                <div className="sc-param-row">
                  <label>permutations</label>
                  <input
                    type="number"
                    min={50}
                    max={1000}
                    step={50}
                    value={svgNPerms}
                    onChange={(e) => setSvgNPerms(+e.target.value)}
                  />
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  permutations 影响 Moran/Geary 的 p 值精度。100 实用；500+ 是论文级。
                </div>
              </div>
            </>
          )}

          {showAdvanced && type === 'spatial_deconv' && (
            <>
              <div className="sc-param-group">
                <div className="sc-param-title">参考数据集</div>
                <div className="sc-param-row">
                  <label>label 字段</label>
                  <select
                    value={deconvRefLabelKey}
                    onChange={(e) => setDeconvRefLabelKey(e.target.value as string)}
                  >
                    <option value="cell_subclass">
                      cell_subclass（细致：L5 IT / Vip / Pvalb / Sst ...）
                    </option>
                    <option value="cell_class">
                      cell_class（粗：GABAergic / Glutamatergic / Non-Neuronal）
                    </option>
                  </select>
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  当前默认参考：sq.datasets.sc_mouse_cortex（Tasic 2018，21k 小鼠脑细胞）。
                  <br />
                  仅适用小鼠脑切片；其他物种/组织待 Wave 4-B 上线 reference 上传机制。
                </div>
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">Tangram 训练</div>
                <div className="sc-param-row">
                  <label>training genes</label>
                  <input
                    type="number"
                    min={300}
                    max={3000}
                    step={100}
                    value={deconvNTrainingGenes}
                    onChange={(e) => setDeconvNTrainingGenes(+e.target.value)}
                  />
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  从 sc 与 spatial 共有基因里挑 top-N（按 sc 平均表达排序）。1000
                  通常够；越多越慢（CPU 模式）。
                </div>
              </div>
            </>
          )}

          {showAdvanced && type === 'spatial_lr' && (
            <>
              <div className="sc-param-group">
                <div className="sc-param-title">LR 数据库</div>
                <div className="sc-param-row">
                  <label>resource</label>
                  <select
                    value={lrResourceName}
                    onChange={(e) => setLrResourceName(e.target.value as string)}
                  >
                    <option value="mouseconsensus">mouseconsensus（小鼠综合，默认）</option>
                    <option value="consensus">consensus（人综合）</option>
                  </select>
                </div>
                <div className="sc-form-hint" style={{ padding: '0 10px', fontSize: 10 }}>
                  consensus 涵盖 cellphonedb / cellchat / connectome / NATMI 等主流数据库。
                  <br />
                  小鼠 demo / 切片选 mouseconsensus；人体切片选 consensus。
                </div>
              </div>
              <div className="sc-param-group">
                <div className="sc-param-title">算法</div>
                <div className="sc-param-row">
                  <label>local metric</label>
                  <select
                    value={lrLocalName}
                    onChange={(e) => setLrLocalName(e.target.value as string)}
                  >
                    <option value="cosine">cosine（推荐）</option>
                    <option value="jaccard">jaccard</option>
                    <option value="pearson">pearson</option>
                  </select>
                </div>
                <div className="sc-param-row">
                  <label>permutations</label>
                  <input
                    type="number"
                    min={50}
                    max={1000}
                    step={50}
                    value={lrNPerms}
                    onChange={(e) => setLrNPerms(+e.target.value)}
                  />
                </div>
                <div className="sc-param-row">
                  <label>top-N pairs</label>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    step={5}
                    value={lrTopN}
                    onChange={(e) => setLrTopN(+e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {showAdvanced &&
            type !== 'spatial_standard' &&
            type !== 'spatial_recluster' &&
            type !== 'spatial_svg' &&
            type !== 'spatial_deconv' &&
            type !== 'spatial_lr' && (
              <div className="sc-info-banner" style={{ marginBottom: 8 }}>
                <strong>提示：</strong>
                {meta.name} 待 Wave 4-A 后续实现，参数表单稍后开放。
              </div>
            )}

          {!showAdvanced && <div className="sc-form-hint">使用默认参数，点击展开可调整</div>}
        </div>

        <div className="sc-modal-footer">
          <button className="sc-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="sc-btn sc-btn-primary"
            onClick={handleSubmit}
            disabled={submitting || !isAvailable || (requiresParent && !parent)}
            title={
              !isAvailable
                ? '此类型尚未上线'
                : requiresParent && !parent
                  ? '需要先完成空间标准分析'
                  : ''
            }
          >
            {submitting ? '提交中...' : isAvailable ? '开始分析' : '尚未上线'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getNextSpatialName(existing: Analysis[], type: string, parentName?: string): string {
  const count = existing.filter((a) => a.type === type).length;
  const meta = ANALYSIS_TYPES[type as SpatialAnalysisType];
  const shortName = meta?.shortName || type;
  const suffix = parentName && type === 'spatial_recluster' ? ` of ${parentName}` : '';
  return `${shortName} v${count + 1}${suffix}`;
}
