/**
 * task-scripts-gen/index.js — Registry of R script generators by analysis type.
 */
const {generateLoadCode} = require('./_load-code');
const {generateScRNAScript} = require('./scrna-standard');
const {generateReclusterScript} = require('./recluster');
const {generateDEGScript} = require('./deg');
const {generateEnrichmentScript} = require('./enrichment');
const {generateAnnotationScript} = require('./annotation');
const {generateIntegrationScript} = require('./integration');
const {generateTrajectoryScript} = require('./trajectory');
const {generateCommunicationScript} = require('./communication');
const {generateCellCycleScript} = require('./cell-cycle');
const {generateDoubletScript} = require('./doublet');

const STEP_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    ossInputUrl: {
      type: 'string',
      description: '输入数据 URL；单细胞步骤通常为 Seurat RDS，富集分析为基因列表 CSV。',
    },
    parentTaskId: {
      type: 'string',
      description: '可选的上游 task id；worker 可优先复用上一步缓存。',
    },
  },
  required: ['ossInputUrl'],
};

function stepInputSchema(parameters = {}) {
  return {
    ...STEP_INPUT_SCHEMA,
    properties: { ...STEP_INPUT_SCHEMA.properties, ...parameters },
  };
}

// 单细胞分析步骤元数据 —— 供 MCP tools/list 暴露。
// description: 给 agent 看的步骤说明；generate: 对应 R 脚本生成函数。
// inputSchema 契约在 Task 4 补全（tool-definition.json），Task 2 阶段用占位。
const STEP_META = {
  'scrna-standard': {
    description: '单细胞标准流程：QC → 归一化 → PCA → 聚类（生成 Seurat 对象 + UMAP/tSNE）',
    generate: generateScRNAScript,
    parameters: {
      species: { type: 'string', enum: ['human', 'mouse'], default: 'human' },
      nPCs: { type: 'number', default: 20 },
      resolution: { type: 'number', default: 0.5 },
    },
  },
  recluster: {
    description: '对指定 cluster 重新聚类（高分辨率细分亚群）',
    generate: generateReclusterScript,
    parameters: {
      nPCs: { type: 'number', default: 20 },
      resolution: { type: 'number', default: 0.5 },
    },
  },
  deg: {
    description: '差异表达分析（DESeq2/wilcox/t-test，按分组对比找 marker）',
    generate: generateDEGScript,
    parameters: {
      method: { type: 'string', enum: ['DESeq2', 'wilcox', 't-test'], default: 'DESeq2' },
      groupCol: { type: 'string', default: 'condition' },
      group1: { type: 'string', default: 'treatment' },
      group2: { type: 'string', default: 'control' },
      pCutoff: { type: 'number', default: 0.05 },
      fcCutoff: { type: 'number', default: 1 },
      topN: { type: 'number', default: 20 },
    },
  },
  enrichment: {
    description: 'GO/KEGG 富集分析（对 DEG 列表做功能注释）',
    generate: generateEnrichmentScript,
    parameters: {
      organism: { type: 'string', enum: ['human', 'mouse'], default: 'human' },
      geneListType: { type: 'string', enum: ['symbol', 'entrez'], default: 'symbol' },
      enrichType: { type: 'string', enum: ['GO', 'KEGG', 'both'], default: 'GO' },
      pvalueCutoff: { type: 'number', default: 0.05 },
      topTerms: { type: 'number', default: 15 },
    },
  },
  annotation: {
    description: '细胞类型注释（SingleR/手动 marker 比对）',
    generate: generateAnnotationScript,
    parameters: {
      reference: { type: 'string', default: 'HumanPrimaryCellAtlas' },
      labelLevel: { type: 'string', enum: ['main', 'fine'], default: 'main' },
    },
  },
  integration: {
    description: '多样本整合（Harmony/CCA/RPCA 去批次）',
    generate: generateIntegrationScript,
    parameters: {
      method: { type: 'string', enum: ['harmony', 'cca', 'rpca'], default: 'harmony' },
      batchCol: { type: 'string', default: 'orig.ident' },
      nPCs: { type: 'number', default: 20 },
      resolution: { type: 'number', default: 0.5 },
    },
  },
  trajectory: {
    description: '拟时序分析（Monocle3 细胞命运推断）',
    generate: generateTrajectoryScript,
    parameters: { rootCluster: { type: 'string', default: 'auto' } },
  },
  communication: {
    description: '细胞通讯分析（CellChat 配受体互作）',
    generate: generateCommunicationScript,
    parameters: {
      organism: { type: 'string', enum: ['human', 'mouse'], default: 'human' },
      minCells: { type: 'number', default: 10 },
      topPathways: { type: 'number', default: 20 },
    },
  },
  'cell-cycle': {
    description: '细胞周期打分（G1/S/G2M 期回归）',
    generate: generateCellCycleScript,
    parameters: { species: { type: 'string', enum: ['human', 'mouse'], default: 'human' } },
  },
  doublet: {
    description: 'Doublet 检测（DoubletFinder 过滤双细胞）',
    generate: generateDoubletScript,
    parameters: { expectedDoubletRate: { type: 'number', default: 0.05 } },
  },
};

/**
 * MCP 工具列表：把单细胞步骤转成 MCP tools/list 格式。
 * Task 2 阶段 inputSchema 用占位（Task 4 补全 tool-definition.json 契约）。
 * 返回 [{name, description, inputSchema, _isStep: true}]。
 */
function listStepTools() {
  return Object.entries(STEP_META).map(([name, meta]) => ({
    name,
    description: meta.description,
    inputSchema: meta.inputSchema || stepInputSchema(meta.parameters),
    _isStep: true,
  }));
}

module.exports = {
  generateLoadCode,
  generateScRNAScript,
  generateReclusterScript,
  generateDEGScript,
  generateEnrichmentScript,
  generateAnnotationScript,
  generateIntegrationScript,
  generateTrajectoryScript,
  generateCommunicationScript,
  generateCellCycleScript,
  generateDoubletScript,
  STEP_META,
  STEP_INPUT_SCHEMA,
  listStepTools,
};
