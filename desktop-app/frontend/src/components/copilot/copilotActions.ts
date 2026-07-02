// ============================================================
// Copilot actions — parse + execute action cards from LLM replies
// ============================================================

export type CopilotAction =
  | StartAnalysisAction
  | ReclusterAction
  | NavigateAction
  | ExternalLinkAction;

export interface StartAnalysisAction {
  type: 'start_analysis';
  label: string;
  datasetId: string;
  analysisType:
    | 'scrna_standard'
    | 'recluster'
    | 'deg'
    | 'enrichment'
    | 'cell_annotation'
    | 'scrna_integration'
    | 'trajectory';
  params?: Record<string, unknown>;
  rationale?: string;
}

export interface ReclusterAction {
  type: 'recluster';
  label: string;
  analysisId: string;
  cluster: string | number;
  resolution?: number;
  rationale?: string;
}

export interface NavigateAction {
  type: 'navigate';
  label: string;
  target: 'dataset' | 'result' | 'project' | 'projects';
  id?: string;
}

export interface ExternalLinkAction {
  type: 'external_link';
  label: string;
  url: string;
}

/**
 * Parse a markdown text and extract action cards (```action ... ``` blocks).
 * Returns the cleaned text (with action blocks replaced by sentinels) plus
 * the list of parsed actions.
 */
export interface ParsedReply {
  /** Markdown text with action blocks replaced by `[[ACTION:i]]` sentinels. */
  text: string;
  actions: CopilotAction[];
}

export function parseActionsFromMarkdown(md: string): ParsedReply {
  const actions: CopilotAction[] = [];
  // Match ```action\n...JSON...\n```
  const regex = /```action\s*\n([\s\S]*?)\n```/g;
  let lastIdx = 0;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = regex.exec(md)) !== null) {
    const before = md.slice(lastIdx, m.index);
    out += before;
    const jsonText = m[1].trim();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      // Streaming may give partial JSON — keep block visible until next chunk
      out += m[0];
      lastIdx = m.index + m[0].length;
      continue;
    }
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>).type === 'string'
    ) {
      const idx = actions.length;
      actions.push(parsed as CopilotAction);
      out += `\n\n[[ACTION:${idx}]]\n\n`;
    } else {
      out += m[0];
    }
    lastIdx = m.index + m[0].length;
  }
  out += md.slice(lastIdx);
  return { text: out, actions };
}

// ============================================================
// Action validators — ensure no destructive ops without confirmation
// ============================================================

export function isDestructive(_action: CopilotAction): boolean {
  // L1 only adds new analyses or navigates — nothing destructive yet.
  return false;
}

export function shortDescription(a: CopilotAction): string {
  switch (a.type) {
    case 'start_analysis':
      return `启动分析：${a.analysisType}${a.params ? ` (${Object.keys(a.params).length} 个参数)` : ''}`;
    case 'recluster':
      return `Recluster cluster ${a.cluster}${a.resolution ? ` @res=${a.resolution}` : ''}`;
    case 'navigate':
      return `跳转到 ${a.target}${a.id ? ' #' + a.id.slice(0, 8) : ''}`;
    case 'external_link':
      return `打开 ${a.url}`;
  }
}
