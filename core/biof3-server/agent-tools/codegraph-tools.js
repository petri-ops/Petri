'use strict';

/**
 * agent-tools/codegraph-tools.js — BLOCK-124（C-13）符号图只读查询工具。
 *
 * 把 HK-03 内核（helpers/code-graph.js 单源）暴露为 agent 内建工具：
 *  - codegraph_who_imports：查「哪些文件导入了指定符号」+ 使用三态（USED_PROD/USED_TEST/UNUSED）
 *  - codegraph_classify_edges：单文件依赖盘点（出边 + 每个导出的入边分类）
 *
 * 边界（诚实面）：
 *  - 只读（sideEffect=none）；根解析复用 withWorkspace 双闸（projectId→workspace_path→realpath，
 *    越权/逃逸同 workspace_* 工具），不接受自由路径根。
 *  - 项目源文件数超 maxFiles → available:false 诚实拒绝（fileCount/maxFiles 如实回传），不截半图。
 *  - 输出有界（hits ≤50 / exports ≤150 / outbound ≤60，截断带 truncated 标记）。
 *  - 静态盲区（变量动态 require/字符串拼接路径）如实 UNRESOLVED；DEAD≠可删（动态消费方在盲区），
 *    语义写进 description 由模型自持。
 *  - 仅本地工作区（远程 ssh 执行目标的远程代码图不在此面，未来候选）。
 */

const path = require('path');
const { buildGraph, whoImports, classifyEdges } = require('../helpers/code-graph');
const { createWorkspaceTools } = require('./workspace-tools');

const DEFAULT_MAX_FILES = 5000; // 工具层收紧（内核安全网 20000；全仓 1604 文件实测 1.8s）
const MAX_HITS = 50;
const MAX_EXPORTS = 150;
const MAX_OUTBOUND = 60;

function createCodegraphTools(options = {}) {
  const dbProvider = options.dbProvider || (() => require('../db'));
  const maxFiles = options.maxFiles || DEFAULT_MAX_FILES;
  const ws = createWorkspaceTools({ dbProvider });

  function errorResult(error, message, extra = {}) {
    return { ok: false, error, message, ...extra };
  }

  function countKinds(hits) {
    const counts = { USED_PROD: 0, USED_TEST: 0, UNUSED: 0 };
    for (const h of hits) counts[h.kind] = (counts[h.kind] || 0) + 1;
    return counts;
  }

  /**
   * codegraph_who_imports — 符号引用查询（改动/删除前的影响面判定）。
   * @param {{symbol?: string}} args
   * @param {{projectId?: string, userId?: string}} ctx
   */
  async function whoImportsTool(args, ctx) {
    const symbol = typeof (args && args.symbol) === 'string' ? args.symbol.trim().slice(0, 200) : '';
    if (!symbol) return errorResult('missing_symbol', '缺少 symbol 参数（要查询引用的符号名）');
    return ws.withWorkspace(ctx, async ({ root }) => {
      let graph;
      try {
        graph = await buildGraph(root, { maxFiles });
      } catch (e) {
        if (e && e.code === 'too_many_files') {
          return {
            ok: true,
            available: false,
            fileCount: e.fileCount,
            maxFiles: e.maxFiles,
            message: `项目源文件 ${e.fileCount} 个超过符号图查询上限 ${e.maxFiles}，已拒绝全量建图（可用 workspace_search 定向检索代替）。`,
          };
        }
        throw e;
      }
      const all = whoImports(graph, symbol);
      const kindCounts = countKinds(all);
      const shown = all.slice(0, MAX_HITS).map((h) => ({
        file: h.file,
        kind: h.kind,
        used: h.used,
        via: h.via,
        target: h.target,
        resolved: h.resolved,
      }));
      const unresolved = graph.parseErrors.length ? graph.parseErrors.length : undefined;
      const parts = [
        `符号 "${symbol}" 共 ${all.length} 处引用：生产在用 ${kindCounts.USED_PROD} / 仅测试在用 ${kindCounts.USED_TEST} / 导入未用 ${kindCounts.UNUSED}。`,
      ];
      if (kindCounts.USED_TEST > 0) parts.push('有测试直接消费：改动后需同步修测试。');
      if (kindCounts.USED_PROD === 0 && kindCounts.USED_TEST === 0 && all.length === 0) {
        parts.push('零命中。注意：变量形式动态 require / 字符串拼接路径在静态盲区，删除裁决前仍需人工复核。');
      }
      return {
        ok: true,
        available: true,
        symbol,
        totalHits: all.length,
        kindCounts,
        hits: shown,
        truncated: all.length > MAX_HITS,
        parseErrorFiles: unresolved,
        message: parts.join(''),
      };
    });
  }

  /**
   * codegraph_classify_edges — 单文件依赖盘点（出边 + 导出入边三态）。
   * @param {{file?: string}} args
   * @param {{projectId?: string, userId?: string}} ctx
   */
  async function classifyEdgesTool(args, ctx) {
    const file = typeof (args && args.file) === 'string' ? args.file.trim().replace(/\\/g, '/') : '';
    if (!file) return errorResult('missing_file', '缺少 file 参数（项目内相对路径，如 src/lib.ts）');
    return ws.withWorkspace(ctx, async ({ root }) => {
      const abs = path.resolve(root, file);
      if (abs !== root && !abs.startsWith(root + path.sep)) {
        return errorResult('invalid_path', 'file 必须是项目内的相对路径');
      }
      let graph;
      try {
        graph = await buildGraph(root, { maxFiles });
      } catch (e) {
        if (e && e.code === 'too_many_files') {
          return {
            ok: true,
            available: false,
            fileCount: e.fileCount,
            maxFiles: e.maxFiles,
            message: `项目源文件 ${e.fileCount} 个超过符号图查询上限 ${e.maxFiles}，已拒绝全量建图。`,
          };
        }
        throw e;
      }
      const r = classifyEdges(graph, abs);
      const exportsShown = r.exports.slice(0, MAX_EXPORTS).map((e) => ({
        name: e.name,
        status: e.status,
        usedByCount: e.usedBy.length,
        unusedImportCount: e.importedByUnused.length,
        usedBy: e.usedBy.slice(0, 10).map((u) => u.file),
      }));
      const outboundShown = r.outbound.slice(0, MAX_OUTBOUND);
      const deadCount = r.exports.filter((e) => e.status === 'DEAD').length;
      const statusCount = r.exports.reduce((acc, e) => {
        acc[e.status] = (acc[e.status] || 0) + 1;
        return acc;
      }, {});
      return {
        ok: true,
        available: true,
        file: r.file,
        exportCount: r.exports.length,
        statusCount,
        exports: exportsShown,
        exportsTruncated: r.exports.length > MAX_EXPORTS,
        outbound: outboundShown,
        outboundTruncated: r.outbound.length > MAX_OUTBOUND,
        message: `${r.file}：导出 ${r.exports.length} 个（生产 ${statusCount.USED_PROD || 0} / 仅测试 ${statusCount.USED_TEST || 0} / DEAD ${deadCount}），出边 ${r.outbound.length} 条。DEAD≠可删：静态盲区（动态 require/字符串引用）里的消费方查不到，删除仍需复核。`,
      };
    });
  }

  return {
    whoImports: whoImportsTool,
    classifyEdges: classifyEdgesTool,
  };
}

const defaultTools = createCodegraphTools();

module.exports = {
  createCodegraphTools,
  tool_codegraph_who_imports: defaultTools.whoImports,
  tool_codegraph_classify_edges: defaultTools.classifyEdges,
};
