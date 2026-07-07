// ============================================================
// workflow-chains.ts — Phase 8: Agent 工作流编排
//
// 定义标准分析链路：当前工具完成后，推荐下一步工具，
// 并提供参数映射规则（从上一步结果自动填充下一步输入）。
// ============================================================

export interface ChainStep {
  /** Source tool id (the tool that just completed) */
  from: string;
  /** Recommended next tool id */
  to: string;
  /** Human-readable reason shown to the user */
  reason: string;
  /**
   * Parameter mapping: key = next tool's input field id,
   * value = a function that receives the previous job's result
   * and returns a value (or undefined to skip).
   *
   * For simplicity we use a string template that references
   * result file names or job metadata:
   *   "{jobId}"            — previous job id
   *   "{file:deg_table}"   — url of a result file named deg_table
   *   "{toolId}"           — previous tool id
   */
  paramMap?: Record<string, string>;
  /** If true, auto-trigger the agent with a pre-filled prompt */
  autoPrompt?: boolean;
}

// ── Standard analysis chains ──────────────────────────────

export const CHAINS: ChainStep[] = [
  // DESeq2 → GO/KEGG enrichment
  {
    from: 'deseq2',
    to: 'go-kegg',
    reason: '差异分析完成，建议对差异基因进行 GO/KEGG 功能富集分析',
    paramMap: {
      genes: '{file:deg_table}',
      species: 'human',
      analysis_type: 'all',
      gene_id_type: 'SYMBOL',
      padj_cutoff: '0.05',
      lfc_cutoff: '1',
    },
    autoPrompt: false,
  },
  // DESeq2 → 火山图在线绘图
  {
    from: 'deseq2',
    to: 'figcode:volcano',
    reason: '差异分析完成，可在线调整火山图样式',
    autoPrompt: false,
  },
  // GO/KEGG → GSEA (if available)
  {
    from: 'go-kegg',
    to: 'gsea',
    reason: 'ORA 富集完成，建议补充 GSEA 分析以检测通路整体趋势',
    autoPrompt: false,
  },
  // 单细胞聚类 → marker 基因
  {
    from: 'sc-cluster',
    to: 'sc-markers',
    reason: '聚类完成，建议进行 marker 基因检测以注释细胞类型',
    autoPrompt: false,
  },
  // marker 基因 → GO 富集
  {
    from: 'sc-markers',
    to: 'go-kegg',
    reason: 'Marker 基因已识别，建议进行功能富集分析',
    paramMap: {
      genes: '{file:marker_table}',
      species: 'human',
      analysis_type: 'GO-BP',
      gene_id_type: 'SYMBOL',
    },
    autoPrompt: false,
  },
  // 生存分析 → 风险模型
  {
    from: 'survival-cox',
    to: 'survival-forest',
    reason: 'Cox 回归完成，建议绘制森林图展示各变量 HR',
    autoPrompt: false,
  },
];

// ── Helper: find recommended next steps for a completed tool ──

export function getNextSteps(toolId: string): ChainStep[] {
  return CHAINS.filter((c) => c.from === toolId);
}

// ── Helper: resolve a param template against a completed job ──

export interface ResolvedJob {
  id: string;
  toolId: string;
  resultFiles?: Array<{ name: string; url: string; type: string; label?: string }>;
}

export function resolveParamMap(
  paramMap: Record<string, string>,
  job: ResolvedJob
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, template] of Object.entries(paramMap)) {
    if (template === '{jobId}') {
      resolved[key] = job.id;
    } else if (template.startsWith('{file:')) {
      const fileName = template.slice(6, -1); // extract name between {file: and }
      const file = job.resultFiles?.find(
        (f) => f.name === fileName || f.name.replace(/\.\w+$/, '') === fileName
      );
      if (file) resolved[key] = file.url;
    } else if (template === '{toolId}') {
      resolved[key] = job.toolId;
    } else {
      // literal value
      resolved[key] = template;
    }
  }
  return resolved;
}

// ── Helper: build an agent prompt for a recommended next step ──

export function buildChainPrompt(
  step: ChainStep,
  job: ResolvedJob,
  toolTitle: string
): string {
  const resolved = step.paramMap
    ? resolveParamMap(step.paramMap, job)
    : {};

  const paramLines = Object.entries(resolved)
    .map(([k, v]) => `  - ${k}: ${v.length > 80 ? v.slice(0, 80) + '…' : v}`)
    .join('\n');

  return [
    `分析链路推荐：${toolTitle} 已完成。`,
    `推荐下一步：使用「${step.to}」工具。`,
    `原因：${step.reason}`,
    step.paramMap ? `\n建议参数：\n${paramLines}` : '',
    `\n请帮我启动「${step.to}」分析。`,
  ].join('\n');
}
