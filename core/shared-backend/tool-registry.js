/**
 * shared-backend/tool-registry.js — 统一工具注册表
 *
 * Phase 1 产物：统一管理 R、Python 和 Built-in 工具的注册机制。
 * 提供跨语言的工具发现和路由能力，作为 Gateway 协调层的数据源。
 *
 * 工具注册表遵循 ToolEntry 接口：
 * {
 *   id: string,          // 工具唯一标识
 *   name: string,        // 工具显示名称
 *   language: 'r' | 'python' | 'builtin',
 *   endpoint: string,     // 执行端点 (如 '/api/tools/seurat-pca')
 *   metadata: {
 *     description: string,
 *     inputSchema: object,
 *     outputSchema: object,
 *   }
 * }
 */

const path = require('path');

// 内存注册表
const _registry = new Map();

// 内置工具定义（直接内联，不依赖外部加载）
const BUILTIN_TOOLS = [
  // R 工具
  {
    id: 'volcano-plot',
    name: 'Volcano Plot',
    language: 'r',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'deg_table',
    metadata: {
      description: 'Generate volcano plot for differential expression analysis',
      inputSchema: {
        type: 'object',
        properties: {
          deg_table: { type: 'string', description: 'Path to DEG table CSV' },
          pvalue: { type: 'number', default: 0.05, description: 'P-value threshold' },
          logfc: { type: 'number', default: 1, description: 'Log fold change threshold' },
        },
        required: ['deg_table'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          plot: { type: 'string', format: 'uri' },
          data: { type: 'string', format: 'uri' },
        },
      },
    },
  },
  {
    id: 'heatmap-basic',
    name: 'Basic Heatmap',
    language: 'r',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'data_matrix',
    metadata: {
      description: 'Generate basic heatmap visualization',
      inputSchema: {
        type: 'object',
        properties: {
          data_matrix: { type: 'string', description: 'Path to data matrix' },
          scale: { type: 'boolean', default: true },
        },
        required: ['data_matrix'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          plot: { type: 'string', format: 'uri' },
        },
      },
    },
  },
  {
    id: 'go-enrichment',
    name: 'GO Enrichment Analysis',
    language: 'r',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'enrichment_result',
    metadata: {
      description: 'Perform Gene Ontology enrichment analysis',
      inputSchema: {
        type: 'object',
        properties: {
          gene_list: { type: 'string', description: 'Path to gene list file' },
          organism: { type: 'string', default: 'hsa', description: 'Organism code (hsa/mmu/rno)' },
        },
        required: ['gene_list'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          table: { type: 'string', format: 'uri' },
          plot: { type: 'string', format: 'uri' },
        },
      },
    },
  },
  {
    id: 'seurat-pca',
    name: 'Seurat PCA',
    language: 'r',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'seurat_object',
    metadata: {
      description: 'Perform PCA dimensionality reduction using Seurat',
      inputSchema: {
        type: 'object',
        properties: {
          input_file: { type: 'string', description: 'Path to input data (matrix or Seurat object)' },
          npcs: { type: 'number', default: 50, description: 'Number of principal components' },
        },
        required: ['input_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          output_path: { type: 'string', format: 'uri' },
          eigenvalues: { type: 'array', items: { type: 'number' } },
        },
      },
    },
  },
  // Python 工具 (Phase 2 产物，历史上源自 py-server/tools-router.js；BLOCK-30 P1 起 py-server 已摘除，此处为内置注册)
  {
    id: 'spatial-standard',
    name: 'Spatial Standard',
    language: 'python',
    endpoint: '/api/tools/run',
    metadata: {
      description: 'Standard spatial transcriptomics data processing and visualization',
      inputSchema: {
        type: 'object',
        properties: {
          h5ad_file: { type: 'string', description: 'Path to .h5ad file' },
          sample_id: { type: 'string', description: 'Sample identifier' },
        },
        required: ['h5ad_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  {
    id: 'spatial-svg',
    name: 'Spatial SVG',
    language: 'python',
    endpoint: '/api/tools/run',
    metadata: {
      description: 'Generate SVG visualization for spatial transcriptomics data',
      inputSchema: {
        type: 'object',
        properties: {
          h5ad_file: { type: 'string', description: 'Path to .h5ad file' },
          sample_id: { type: 'string', description: 'Sample identifier' },
        },
        required: ['h5ad_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  {
    id: 'spatial-deconv',
    name: 'Spatial Deconv',
    language: 'python',
    endpoint: '/api/tools/run',
    metadata: {
      description: 'Cell type deconvolution for spatial transcriptomics data',
      inputSchema: {
        type: 'object',
        properties: {
          h5ad_file: { type: 'string', description: 'Path to .h5ad file' },
          reference: { type: 'string', description: 'Reference dataset path' },
        },
        required: ['h5ad_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  {
    id: 'spatial-lr',
    name: 'Spatial LR',
    language: 'python',
    endpoint: '/api/tools/run',
    metadata: {
      description: 'Ligand-receptor interaction analysis for spatial transcriptomics',
      inputSchema: {
        type: 'object',
        properties: {
          h5ad_file: { type: 'string', description: 'Path to .h5ad file' },
          database: { type: 'string', default: 'cellphonedb', description: 'LR database' },
        },
        required: ['h5ad_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  {
    id: 'ml-scvi-annotate',
    name: 'scVI Auto-Annotation',
    language: 'python',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'anndata_object',
    metadata: {
      description: 'Automatic cell type annotation using scVI deep learning model',
      inputSchema: {
        type: 'object',
        properties: {
          h5ad_file: { type: 'string', description: 'Path to .h5ad file' },
          model: { type: 'string', default: 'scvi', description: 'Model type (scvi/scarches)' },
        },
        required: ['h5ad_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
  {
    id: 'scanpy-cluster',
    name: 'Scanpy Clustering',
    language: 'python',
    endpoint: '/api/tools/run',
    pipelineCompatible: true,
    outputType: 'anndata_object',
    metadata: {
      description: 'Perform cell clustering using Scanpy',
      inputSchema: {
        type: 'object',
        properties: {
          input_file: { type: 'string', description: 'Path to input AnnData object' },
          n_neighbors: { type: 'number', default: 15, description: 'Number of neighbors for graph' },
          resolution: { type: 'number', default: 0.5, description: 'Clustering resolution' },
        },
        required: ['input_file'],
      },
      outputSchema: {
        type: 'object',
        properties: {
          output_path: { type: 'string', format: 'uri' },
          clusters: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
];

/**
 * 初始化注册表：加载内置工具
 */
function _initBuiltinTools() {
  for (const tool of BUILTIN_TOOLS) {
    _registry.set(tool.id, tool);
  }
}

// 启动时初始化内置工具
_initBuiltinTools();

/**
 * 注册工具
 * @param {Object} tool - ToolEntry 对象
 * @returns {Object} { ok: boolean, error?: string }
 */
function registerTool(tool) {
  if (!tool || !tool.id || !tool.name || !tool.language) {
    return { ok: false, error: 'Missing required fields: id, name, language' };
  }

  if (!['r', 'python', 'builtin'].includes(tool.language)) {
    return { ok: false, error: `Invalid language: ${tool.language}. Must be r, python, or builtin` };
  }

  const existing = _registry.get(tool.id);
  if (existing) {
    // 更新现有工具
    _registry.set(tool.id, { ...existing, ...tool });
  } else {
    _registry.set(tool.id, tool);
  }

  return { ok: true };
}

/**
 * 获取工具详情
 * @param {string} id - 工具 ID
 * @returns {Object|null} 工具定义或 null
 */
function getTool(id) {
  return _registry.get(id) || null;
}

/**
 * 列出所有工具
 * @param {Object} filter - 可选过滤条件
 * @param {string} filter.language - 按语言过滤 ('r' | 'python' | 'builtin')
 * @returns {Array} 工具列表
 */
function listTools(filter = {}) {
  let tools = Array.from(_registry.values());

  if (filter.language) {
    tools = tools.filter((t) => t.language === filter.language);
  }

  return tools.map((tool) => ({
    id: tool.id,
    name: tool.name,
    language: tool.language,
    endpoint: tool.endpoint,
    description: tool.metadata?.description || '',
    pipelineCompatible: tool.pipelineCompatible || false,
    outputType: tool.outputType || null,
    // 透传 MCP 兼容字段
    _language: tool._mcpTool?._language || tool.language,
    _pluginVersion: tool._mcpTool?._pluginVersion,
    _inputs: tool._mcpTool?._inputs,
    _outputs: tool._mcpTool?._outputs,
    _manifest: tool._mcpTool?._manifest,
  }));
}

/**
 * 按语言筛选工具
 * @param {string} language - 语言类型 ('r' | 'python' | 'builtin')
 * @returns {Array} 工具列表
 */
function getToolsByLanguage(language) {
  return listTools({ language });
}

/**
 * 获取 R 工具列表（用于 Gateway 路由）
 * @returns {Array} R 工具列表
 */
function getRTools() {
  return getToolsByLanguage('r');
}

/**
 * 获取 Python 工具列表（用于 Gateway 路由）
 * @returns {Array} Python 工具列表
 */
function getPythonTools() {
  return getToolsByLanguage('python');
}

/**
 * 获取内置工具列表
 * @returns {Array} 内置工具列表
 */
function getBuiltinTools() {
  return getToolsByLanguage('builtin');
}

/**
 * 从 R Server MCP Registry 迁移工具
 * 读取 biof3-server/mcp/registry.js 导出的工具定义并注册
 * @returns {Promise<{ ok: boolean, count: number, error?: string }>}
 */
async function migrateFromRServerRegistry() {
  try {
    const rRegistryPath = path.join(__dirname, '..', 'biof3-server', 'mcp', 'registry.js');
    const fs = require('fs');

    if (!fs.existsSync(rRegistryPath)) {
      return { ok: false, count: 0, error: 'R Server registry not found' };
    }

    // 动态 require R Server registry
    const rRegistry = require(rRegistryPath);

    // listTools 返回 MCP 格式，需要转换为 ToolEntry 格式
    if (typeof rRegistry.listTools === 'function') {
      // 异步获取工具列表
      const mcpTools = await Promise.resolve(rRegistry.listTools());
      let count = 0;
      for (const mcpTool of mcpTools || []) {
        const toolEntry = {
          id: mcpTool.name || mcpTool.id,
          name: mcpTool.title || mcpTool.name || mcpTool.id,
          language: mcpTool._language || 'r', // 从 R Server 透传的 language 字段
          endpoint: '/api/tools/run',
          metadata: {
            description: mcpTool.description || '',
            inputSchema: mcpTool.inputSchema || { type: 'object' },
            outputSchema: mcpTool.outputSchema || { type: 'object' },
          },
          // 透传 MCP 工具的额外元数据（用于兼容性）
          _mcpTool: {
            failureModes: mcpTool.failureModes,
            _language: mcpTool._language,
            _pluginVersion: mcpTool._pluginVersion,
            _inputs: mcpTool._inputs,
            _outputs: mcpTool._outputs,
            _manifest: mcpTool._manifest,
          },
        };
        const result = registerTool(toolEntry);
        if (result.ok) count++;
      }
      console.log(`[tool-registry] Migrated ${count} tools from R Server registry`);
      return { ok: true, count };
    }

    return { ok: true, count: 0 };
  } catch (e) {
    return { ok: false, count: 0, error: e.message };
  }
}

/**
 * 获取工具统计信息
 * @returns {Object} { total: number, byLanguage: Object }
 */
function getStats() {
  const byLanguage = { r: 0, python: 0, builtin: 0 };
  for (const tool of _registry.values()) {
    byLanguage[tool.language] = (byLanguage[tool.language] || 0) + 1;
  }
  return {
    total: _registry.size,
    byLanguage,
  };
}

/**
 * 清除所有注册的工具（主要用于测试）
 */
function clearAll() {
  _registry.clear();
  _initBuiltinTools();
}

/**
 * 初始化 Python 工具（启动时调用）
 * 使用内置的 Python 工具定义（BUILTIN_TOOLS 中已定义）。
 * （BLOCK-30 P1：py-server/tools-router.js 已随 py-server 摘除，
 * 原 migrateFromPyServerRegistry 迁移路径删除。）
 */
function initPythonTools() {
  const pythonTools = listTools({ language: 'python' });
  if (pythonTools.length > 0) {
    console.log(`[tool-registry] Initialized ${pythonTools.length} Python tools`);
  }
  return pythonTools;
}

// 启动时初始化 Python 工具
initPythonTools();

module.exports = {
  registerTool,
  getTool,
  listTools,
  getToolsByLanguage,
  getRTools,
  getPythonTools,
  getBuiltinTools,
  migrateFromRServerRegistry,
  initPythonTools,
  getStats,
  clearAll,
  // 常量导出
  LANGUAGES: ['r', 'python', 'builtin'],
};
