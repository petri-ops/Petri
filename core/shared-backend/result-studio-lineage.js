'use strict';

/**
 * result-studio-lineage.js — BLOCK-127（G0-BIO BIO-3 P1）lineage 投影。
 *
 * 输入是 result_workflow_graphs 的权威图（Job/Revision/Selection 真值投影，
 * 由 buildAuthoritativeWorkflowGraph 生成），本模块只做**用户可见的祖先链**
 * 投影：目标 job 沿 dependsOn 向上收集祖先，按「距当前的依赖深度」降序
 * （最上游在前、当前在末尾），并统计直接下游数。不猜语义：job 不在图中
 * 返回 null；依赖环以 visited 集防御，不死循环也不虚构链序（环内节点按
 * 首次访问深度参与排序，诚实上限是链内不重复）。
 */

/**
 * @returns {{ chain: Array<{toolJobId: string, toolId: string|null, isCurrent: boolean}>, downstreamCount: number } | null}
 */
function buildLineageChain(graph, toolJobId) {
  if (!graph || !Array.isArray(graph.nodes) || !toolJobId) return null;
  const byToolJobId = new Map();
  for (const node of graph.nodes) {
    if (node && node.toolJobId) byToolJobId.set(String(node.toolJobId), node);
  }
  const current = byToolJobId.get(String(toolJobId));
  if (!current) return null;

  // BFS 沿 dependsOn 向上，记录每个祖先距当前的最短深度（0=当前）。
  const depth = new Map([[current.id, 0]]);
  const queue = [current.id];
  const byNodeId = new Map(graph.nodes.filter((n) => n && n.id).map((n) => [n.id, n]));
  while (queue.length > 0) {
    const nodeId = queue.shift();
    const node = byNodeId.get(nodeId);
    if (!node || !Array.isArray(node.dependsOn)) continue;
    for (const parentId of node.dependsOn) {
      if (!byNodeId.has(parentId) || depth.has(parentId)) continue;
      depth.set(parentId, depth.get(nodeId) + 1);
      queue.push(parentId);
    }
  }

  // 链 = 深度降序（上游在前）；同深度按 toolJobId 稳定排序。
  const chain = [...depth.entries()]
    .map(([nodeId, d]) => ({ node: byNodeId.get(nodeId), d }))
    .filter((item) => item.node && item.node.toolJobId)
    .sort((a, b) => (b.d - a.d) || String(a.node.toolJobId).localeCompare(String(b.node.toolJobId)))
    .map((item) => ({
      toolJobId: String(item.node.toolJobId),
      toolId: item.node.toolId || null,
      isCurrent: item.node.id === current.id,
    }));

  // 直接下游 = dependsOn 指向当前节点的节点数。
  let downstreamCount = 0;
  for (const node of graph.nodes) {
    if (node && node.id !== current.id && Array.isArray(node.dependsOn) && node.dependsOn.includes(current.id)) {
      downstreamCount += 1;
    }
  }
  return { chain, downstreamCount };
}

module.exports = { buildLineageChain };
