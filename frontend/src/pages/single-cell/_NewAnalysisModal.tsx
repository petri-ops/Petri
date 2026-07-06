import React, { useState, useEffect, useCallback } from 'react';
import type { AnalysisType, Dataset, Analysis } from './_types';
import { ANALYSIS_TYPES } from './_types';
import { listAnalysesByDataset, createAnalysis, getNextAnalysisName, getAnalysis } from './_store';
import { submitTask } from './_api';

interface Props {
  dataset: Dataset;
  defaultType?: AnalysisType;
  parentAnalysisId?: string;
  selectedCellIds?: string[];
  onClose: () => void;
  onCreated: (analysis: Analysis) => void;
}

export function NewAnalysisModal({
  dataset,
  defaultType,
  parentAnalysisId,
  selectedCellIds,
  onClose,
  onCreated,
}: Props) {
  const [type, _setType] = useState<AnalysisType>(defaultType || 'scrna_standard');
  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(true);

  // Analysis & subset naming
  const [analysisName, setAnalysisName] = useState('');
  const [subsetName, setSubsetName] = useState(() => {
    if (selectedCellIds && selectedCellIds.length > 0) {
      return `选中 ${selectedCellIds.length} cells (${new Date().toLocaleDateString('zh-CN')})`;
    }
    return '';
  });

  // ---- scRNA standard ----
  const [species, setSpecies] = useState<'human' | 'mouse'>('human');
  const [minCells, setMinCells] = useState(3);
  const [minFeatures, setMinFeatures] = useState(200);
  const [maxFeatures, setMaxFeatures] = useState(5000);
  const [maxMtPercent, setMaxMtPercent] = useState(20);
  const [nPCs, setNPCs] = useState(20);
  const [resolution, setResolution] = useState(0.5);
  const [normMethod, setNormMethod] = useState<'LogNormalize' | 'SCTransform'>('LogNormalize');

  // ---- DEG ----
  const [degMethod, setDegMethod] = useState<'DESeq2' | 'wilcox' | 't-test'>('DESeq2');
  const [groupCol, setGroupCol] = useState('seurat_clusters');
  const [group1, setGroup1] = useState('0');
  const [group2, setGroup2] = useState('1');
  const [pCutoff, setPCutoff] = useState(0.05);
  const [fcCutoff, setFcCutoff] = useState(1.0);
  const [topN, setTopN] = useState(20);

  // ---- Enrichment ----
  const [enrichOrganism, setEnrichOrganism] = useState<'human' | 'mouse'>('human');
  const [enrichType, setEnrichType] = useState<'GO' | 'KEGG' | 'both'>('both');
  const [enrichPCutoff, setEnrichPCutoff] = useState(0.05);
  const [enrichTopTerms, setEnrichTopTerms] = useState(15);

  // ---- Annotation ----
  const [annotRef, setAnnotRef] = useState('HumanPrimaryCellAtlas');
  const [annotLevel, setAnnotLevel] = useState<'main' | 'fine'>('main');

  // ---- Integration ----
  const [integMethod, setIntegMethod] = useState<'harmony' | 'cca' | 'rpca'>('harmony');
  const [batchCol, setBatchCol] = useState('orig.ident');

  // ---- Trajectory ----
  const [rootCluster, setRootCluster] = useState('auto');

  // ---- Communication ----
  const [commOrganism, setCommOrganism] = useState<'human' | 'mouse'>('human');

  // Parent analyses available (completed only)
  const [parentAnalyses, setParentAnalyses] = useState<Analysis[]>([]);
  const [parent, setParent] = useState<Analysis | null>(null);
  const [selectedParentId, setSelectedParentId] = useState<string | undefined>(parentAnalysisId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listAnalysesByDataset(dataset.id);
        const done = list.filter(
          (a) => (a.type === 'scrna_standard' || a.type === 'recluster') && a.status === 'done'
        );
        if (!cancelled) {
          setParentAnalyses(done);
          // Auto-select if only one available and no explicit parent
          if (!parentAnalysisId && done.length === 1) {
            setSelectedParentId(done[0].id);
            setParent(done[0]);
          } else if (!parentAnalysisId && done.length > 1) {
            // Default to latest
            const sorted = [...done].sort(
              (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
            );
            setSelectedParentId(sorted[0].id);
            setParent(sorted[0]);
          }
        }
      } catch (err) {
        /* ignore */
      }
      if (parentAnalysisId) {
        try {
          const p = await getAnalysis(parentAnalysisId);
          if (!cancelled) {
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

  // When user changes parent selection
  const handleParentChange = useCallback(
    (id: string) => {
      setSelectedParentId(id);
      const found = parentAnalyses.find((a) => a.id === id);
      setParent(found || null);
    },
    [parentAnalyses]
  );

  const requiresParent = ANALYSIS_TYPES[type].requiresResult;

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    try {
      // Build params based on type
      let params: Record<string, unknown> = {};
      const inputUrl = dataset.ossUrl;

      if (type === 'scrna_standard') {
        params = {
          species,
          minCells,
          minFeatures,
          maxFeatures,
          maxMtPercent,
          nPCs,
          resolution,
          normMethod,
        };
      } else if (type === 'recluster') {
        params = { nPCs, resolution, normMethod, skipQC: true };
      } else if (type === 'deg') {
        params = { method: degMethod, groupCol, group1, group2, pCutoff, fcCutoff, topN };
        // DEG could use parent's result (Seurat object from standard analysis)
        if (parent?.summary && requiresParent) {
          // We don't have direct result URLs stored — use raw dataset for now
          // Future: store parent's result rds url in analysis.summary
        }
      } else if (type === 'enrichment') {
        params = {
          organism: enrichOrganism,
          enrichType,
          pvalueCutoff: enrichPCutoff,
          topTerms: enrichTopTerms,
        };
      } else if (type === 'cell_annotation') {
        params = { reference: annotRef, labelLevel: annotLevel };
      } else if (type === 'scrna_integration') {
        params = { method: integMethod, batchCol, nPCs, resolution };
      } else if (type === 'trajectory') {
        params = { rootCluster, nDims: nPCs };
      } else if (type === 'communication') {
        params = { organism: commOrganism, minCells: 10, topPathways: 20 };
      } else if (type === 'cell_cycle') {
        params = { species };
      } else if (type === 'doublet_detection') {
        params = { expectedDoubletRate: 0.05 };
      }

      // Determine parentTaskId for cache loading — use user-selected parent
      let effectiveParentTaskId = parent?.taskId;
      if (!effectiveParentTaskId && selectedParentId) {
        const selectedAnalysis = parentAnalyses.find((a) => a.id === selectedParentId);
        if (selectedAnalysis) {
          effectiveParentTaskId = selectedAnalysis.taskId;
        }
      }

      // If cells are selected → create a new subset dataset, analysis goes under it
      let targetDatasetId = dataset.id;
      if (selectedCellIds && selectedCellIds.length > 0) {
        params.cellIds = selectedCellIds;
        // Create subset dataset under the same project
        const { createDataset: createDs } = await import('./_store');
        const subsetDs = await createDs({
          projectId: dataset.projectId,
          name: subsetName.trim() || `${dataset.name} (${selectedCellIds.length} cells)`,
          ossUrl: dataset.ossUrl,
          size: dataset.size,
          description: `子集来源：${dataset.name}，${selectedCellIds.length} 个细胞`,
          parentDatasetId: dataset.id,
        });
        targetDatasetId = subsetDs.id;
      }

      const taskId = await submitTask(type, inputUrl, params, effectiveParentTaskId);

      // Use custom name or auto-generate
      const existingAnalyses = await listAnalysesByDataset(targetDatasetId);
      const finalName = analysisName.trim() || getNextAnalysisName(existingAnalyses, type);

      // Use user-selected parent for hierarchy (sidebar tree)
      let resolvedParentAnalysisId = parentAnalysisId || selectedParentId;
      // Don't set parent for standard/recluster (they are root nodes)
      if (type === 'scrna_standard' || type === 'recluster') {
        resolvedParentAnalysisId = undefined;
      }

      const analysis = await createAnalysis({
        datasetId: targetDatasetId,
        taskId,
        type,
        name: finalName,
        parentAnalysisId: resolvedParentAnalysisId,
        params,
        status: 'running',
      });

      onCreated(analysis);
    } catch (err) {
      alert(`提交失败: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    type,
    dataset,
    parent,
    parentAnalysisId,
    selectedParentId,
    parentAnalyses,
    requiresParent,
    onCreated,
    species,
    minCells,
    minFeatures,
    maxFeatures,
    maxMtPercent,
    nPCs,
    resolution,
    normMethod,
    degMethod,
    groupCol,
    group1,
    group2,
    pCutoff,
    fcCutoff,
    topN,
    enrichOrganism,
    enrichType,
    enrichPCutoff,
    enrichTopTerms,
    annotRef,
    annotLevel,
    integMethod,
    batchCol,
    rootCluster,
    commOrganism,
  ]);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="sc-modal-header">
          <h2 className="sc-modal-title">新建分析</h2>
          <button className="sc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="sc-modal-body">
          {/* Tool introduction */}
          <div className="sc-tool-intro">
            <div className="sc-tool-intro-header">
              <span
                className="sc-tool-intro-icon"
                style={{ background: ANALYSIS_TYPES[type].color }}
              >
                {ANALYSIS_TYPES[type].icon}
              </span>
              <div>
                <div className="sc-tool-intro-name">{ANALYSIS_TYPES[type].name}</div>
                <div className="sc-tool-intro-desc">{ANALYSIS_TYPES[type].intro}</div>
              </div>
            </div>
            <div className="sc-tool-intro-meta">
              <div>
                <strong>输入：</strong>
                {ANALYSIS_TYPES[type].input}
              </div>
              <div>
                <strong>输出：</strong>
                {ANALYSIS_TYPES[type].output}
              </div>
              <div>
                <strong>R 包：</strong>
                {ANALYSIS_TYPES[type].packages.join(', ')}
              </div>
            </div>
          </div>

          {/* Input source */}
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
                ● 原始数据：<strong>{dataset.name}</strong>
                {dataset.nCells && (
                  <span style={{ color: '#9ca3af', marginLeft: 6 }}>
                    ({dataset.nCells.toLocaleString()} cells)
                  </span>
                )}
              </div>
              <div
                style={{
                  marginTop: 4,
                  color:
                    selectedCellIds && selectedCellIds.length > 0
                      ? 'var(--ifm-color-primary)'
                      : '#9ca3af',
                }}
              >
                →{' '}
                {selectedCellIds && selectedCellIds.length > 0 ? (
                  <>
                    <strong>使用选中的 {selectedCellIds.length.toLocaleString()} 个细胞</strong>
                  </>
                ) : (
                  '使用全部细胞'
                )}
              </div>
            </div>
          </div>

          {/* Parent analysis selector — shown for types that need a parent */}
          {type !== 'scrna_standard' && parentAnalyses.length > 0 && (
            <div className="sc-form-group">
              <label className="sc-form-label">基于分析结果</label>
              <select
                className="sc-form-input"
                value={selectedParentId || ''}
                onChange={(e) => handleParentChange(e.target.value)}
              >
                {parentAnalyses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} ({a.type === 'scrna_standard' ? '标准分析' : '降维聚类'} ·{' '}
                    {new Date(a.createdAt).toLocaleDateString('zh-CN')})
                  </option>
                ))}
              </select>
              <div className="sc-form-hint">选择用哪次分析的 Seurat 对象作为输入</div>
            </div>
          )}
          {type !== 'scrna_standard' && parentAnalyses.length === 0 && (
            <div className="sc-info-banner" style={{ marginBottom: 8 }}>
              <strong>提示：</strong>此分析需要先完成「标准分析」。如果上传的是 Seurat .rds
              对象也可以直接用。
            </div>
          )}

          {/* Naming */}
          <div className="sc-form-group">
            <label className="sc-form-label">分析名称</label>
            <input
              className="sc-form-input"
              value={analysisName}
              onChange={(e) => setAnalysisName(e.target.value)}
              placeholder={`默认：${ANALYSIS_TYPES[type].shortName} vN`}
            />
          </div>

          {selectedCellIds && selectedCellIds.length > 0 && (
            <div className="sc-form-group">
              <label className="sc-form-label">子集名称（自动保存）</label>
              <input
                className="sc-form-input"
                value={subsetName}
                onChange={(e) => setSubsetName(e.target.value)}
                placeholder="给选中的细胞起个名字"
              />
            </div>
          )}

          {/* Params — collapsible */}
          <button
            className="sc-param-toggle"
            onClick={() => setShowAdvanced(!showAdvanced)}
            style={{ marginBottom: showAdvanced ? 10 : 0 }}
          >
            <span>参数设置</span>
            <span>{showAdvanced ? '▲' : '▼'}</span>
          </button>

          {showAdvanced && (
            <>
              {type === 'scrna_standard' && (
                <>
                  <div className="sc-param-group">
                    <div className="sc-param-title">基本</div>
                    <div className="sc-param-row">
                      <label>物种</label>
                      <select
                        value={species}
                        onChange={(e) => setSpecies(e.target.value as string)}
                      >
                        <option value="human">Human</option>
                        <option value="mouse">Mouse</option>
                      </select>
                    </div>
                    <div className="sc-param-row">
                      <label>标准化</label>
                      <select
                        value={normMethod}
                        onChange={(e) => setNormMethod(e.target.value as string)}
                      >
                        <option value="LogNormalize">LogNormalize</option>
                        <option value="SCTransform">SCTransform</option>
                      </select>
                    </div>
                  </div>
                  <div className="sc-param-group">
                    <div className="sc-param-title">质控</div>
                    <div className="sc-param-row">
                      <label>min.cells</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={minCells}
                        onChange={(e) => setMinCells(+e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>min.features</label>
                      <input
                        type="number"
                        min={50}
                        max={1000}
                        step={50}
                        value={minFeatures}
                        onChange={(e) => setMinFeatures(+e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>max.features</label>
                      <input
                        type="number"
                        min={1000}
                        max={20000}
                        step={500}
                        value={maxFeatures}
                        onChange={(e) => setMaxFeatures(+e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>MT% 上限</label>
                      <input
                        type="number"
                        min={1}
                        max={50}
                        value={maxMtPercent}
                        onChange={(e) => setMaxMtPercent(+e.target.value)}
                      />
                    </div>
                  </div>
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
                  </div>
                </>
              )}

              {type === 'recluster' && (
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
                </div>
              )}

              {type === 'deg' && (
                <>
                  <div className="sc-param-group">
                    <div className="sc-param-title">方法</div>
                    <div className="sc-param-row">
                      <label>统计方法</label>
                      <select
                        value={degMethod}
                        onChange={(e) => setDegMethod(e.target.value as string)}
                      >
                        <option value="DESeq2">DESeq2 (bulk)</option>
                        <option value="wilcox">Wilcoxon (sc)</option>
                        <option value="t-test">t-test (sc)</option>
                      </select>
                    </div>
                  </div>
                  <div className="sc-param-group">
                    <div className="sc-param-title">分组</div>
                    <div className="sc-param-row">
                      <label>分组列名</label>
                      <input
                        type="text"
                        value={groupCol}
                        onChange={(e) => setGroupCol(e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>实验组</label>
                      <input
                        type="text"
                        value={group1}
                        onChange={(e) => setGroup1(e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>对照组</label>
                      <input
                        type="text"
                        value={group2}
                        onChange={(e) => setGroup2(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="sc-param-group">
                    <div className="sc-param-title">阈值</div>
                    <div className="sc-param-row">
                      <label>P 值</label>
                      <input
                        type="number"
                        min={0.001}
                        max={0.1}
                        step={0.005}
                        value={pCutoff}
                        onChange={(e) => setPCutoff(+e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>log2FC</label>
                      <input
                        type="number"
                        min={0}
                        max={5}
                        step={0.25}
                        value={fcCutoff}
                        onChange={(e) => setFcCutoff(+e.target.value)}
                      />
                    </div>
                    <div className="sc-param-row">
                      <label>Top N</label>
                      <input
                        type="number"
                        min={5}
                        max={100}
                        step={5}
                        value={topN}
                        onChange={(e) => setTopN(+e.target.value)}
                      />
                    </div>
                  </div>
                </>
              )}

              {type === 'enrichment' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">富集参数</div>
                  <div className="sc-param-row">
                    <label>物种</label>
                    <select
                      value={enrichOrganism}
                      onChange={(e) => setEnrichOrganism(e.target.value as string)}
                    >
                      <option value="human">Human</option>
                      <option value="mouse">Mouse</option>
                    </select>
                  </div>
                  <div className="sc-param-row">
                    <label>类型</label>
                    <select
                      value={enrichType}
                      onChange={(e) => setEnrichType(e.target.value as string)}
                    >
                      <option value="both">GO + KEGG</option>
                      <option value="GO">仅 GO</option>
                      <option value="KEGG">仅 KEGG</option>
                    </select>
                  </div>
                  <div className="sc-param-row">
                    <label>P 值</label>
                    <input
                      type="number"
                      min={0.001}
                      max={0.1}
                      step={0.005}
                      value={enrichPCutoff}
                      onChange={(e) => setEnrichPCutoff(+e.target.value)}
                    />
                  </div>
                  <div className="sc-param-row">
                    <label>Top 条目</label>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      step={5}
                      value={enrichTopTerms}
                      onChange={(e) => setEnrichTopTerms(+e.target.value)}
                    />
                  </div>
                </div>
              )}

              {type === 'cell_annotation' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">注释参数</div>
                  <div className="sc-param-row">
                    <label>Reference</label>
                    <select value={annotRef} onChange={(e) => setAnnotRef(e.target.value)}>
                      <option value="HumanPrimaryCellAtlas">HumanPrimaryCellAtlas</option>
                      <option value="BlueprintEncode">BlueprintEncode</option>
                      <option value="MouseRNAseq">MouseRNAseq</option>
                      <option value="ImmGen">ImmGen</option>
                    </select>
                  </div>
                  <div className="sc-param-row">
                    <label>标签粒度</label>
                    <select
                      value={annotLevel}
                      onChange={(e) => setAnnotLevel(e.target.value as string)}
                    >
                      <option value="main">Main</option>
                      <option value="fine">Fine</option>
                    </select>
                  </div>
                </div>
              )}

              {type === 'scrna_integration' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">整合参数</div>
                  <div className="sc-param-row">
                    <label>方法</label>
                    <select
                      value={integMethod}
                      onChange={(e) => setIntegMethod(e.target.value as string)}
                    >
                      <option value="harmony">Harmony</option>
                      <option value="cca">CCA</option>
                      <option value="rpca">RPCA</option>
                    </select>
                  </div>
                  <div className="sc-param-row">
                    <label>批次列名</label>
                    <input
                      type="text"
                      value={batchCol}
                      onChange={(e) => setBatchCol(e.target.value)}
                    />
                  </div>
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
                </div>
              )}

              {type === 'trajectory' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">轨迹参数</div>
                  <div className="sc-param-row">
                    <label>Root cluster</label>
                    <input
                      type="text"
                      value={rootCluster}
                      onChange={(e) => setRootCluster(e.target.value)}
                    />
                  </div>
                  <div className="sc-param-row">
                    <label>维度</label>
                    <input
                      type="number"
                      min={5}
                      max={50}
                      value={nPCs}
                      onChange={(e) => setNPCs(+e.target.value)}
                    />
                  </div>
                </div>
              )}

              {type === 'communication' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">通讯参数</div>
                  <div className="sc-param-row">
                    <label>物种</label>
                    <select
                      value={commOrganism}
                      onChange={(e) => setCommOrganism(e.target.value as string)}
                    >
                      <option value="human">Human</option>
                      <option value="mouse">Mouse</option>
                    </select>
                  </div>
                </div>
              )}
            </>
          )}

          {!showAdvanced && <div className="sc-form-hint">使用默认参数，点击展开可调整</div>}
        </div>

        <div className="sc-modal-footer">
          <button className="sc-btn" onClick={onClose}>
            取消
          </button>
          <button className="sc-btn sc-btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? '提交中...' : '开始分析'}
          </button>
        </div>
      </div>
    </div>
  );
}
