// ============================================================
// Copilot context — pub/sub for current page state
// Used to feed system prompt with page-specific info.
// ============================================================

export type CopilotPage =
  | 'single-cell-projects'
  | 'single-cell-project'
  | 'single-cell-dataset'
  | 'single-cell-result'
  // W3-C: 空间组学云平台 4 页面（与 single-cell 同结构，命名对齐）
  | 'spatial-projects'
  | 'spatial-project'
  | 'spatial-dataset'
  | 'spatial-result'
  | 'figcode'
  | 'tools'
  | 'docs'
  | 'blog'
  | 'home'
  // 6.3 — desktop 项目工作台
  | 'desktop-project'
  | 'desktop-home'
  | 'unknown';

export interface HarnessContextSummary {
  fileCount: number;
  truncated?: boolean;
  byKind?: Record<string, number>;
  byRole?: Record<string, number>;
  entries?: {
    relativePath: string;
    kind: string;
    role: string;
    readable?: boolean;
    table?: {
      headers?: string[];
      columnCount?: number;
      rowSampleCount?: number;
      matrixOrientation?: string;
    };
  }[];
}

export interface CopilotContext {
  page: CopilotPage;
  pageTitle?: string;
  /** Current full URL (for citation) */
  pageUrl?: string;
  /** Excerpted main content from the page (~2K chars), for docs/blog/figcode etc. */
  pageContent?: string;
  /** Headings outline of current page, for "where am I in the document" awareness */
  pageOutline?: string[];
  /** Heading currently in viewport (closest one above the fold) */
  visibleHeading?: string;
  // W3-C: 当前云平台模块（决定 biof3-server system-prompt 走 spatial / single-cell 分支）
  currentModule?: 'single-cell' | 'spatial';
  // single-cell + spatial 共享字段（同结构）
  projectId?: string;
  datasetId?: string;
  datasetName?: string;
  analysisId?: string;
  analysisType?: string;
  analysisName?: string;
  summary?: unknown;
  /** Available cluster ids on the current result, for action suggestions */
  clusterIds?: (string | number)[];
  // figcode
  plotName?: string;
  codeContent?: string;
  // tools page
  toolId?: string;
  toolName?: string;
  toolResult?: unknown;
  availableTools?: string[];
  // 6.3 — desktop project workspace context
  /** Current project name (desktop workspace) */
  projectName?: string;
  /** Agent workspace permission selected in the chat input. */
  accessMode?: 'full' | 'workspace-write' | 'read';
  /** Project modality: single-cell / spatial / genome / etc. */
  projectModality?: string;
  /** Dataset summaries in current project (id + name + type + rows) */
  projectDatasets?: { id: string; name: string; type?: string; rows?: number }[];
  /** Recent job summaries in current project (id + tool + status + time) */
  projectJobs?: { id: string; toolId: string; status: string; name?: string; createdAt: number }[];
  /** Compact project-scope Harness file-index summary for agent parameter planning. */
  projectHarnessSummary?: HarnessContextSummary;
  /** Compact active job/artifact-scope Harness summary for result-aware follow-up. */
  activeJobHarnessSummary?: HarnessContextSummary;
  /** Current active job id being viewed */
  activeJobId?: string;
  /** Current artifact/file being viewed inside the project result panel */
  activeArtifact?: {
    jobId: string;
    toolId: string;
    name: string;
    type: string;
    label?: string;
    url?: string;
    revisionId?: string | null;
    artifactFamilyId?: string | null;
    entityType?: string | null;
    idField?: string | null;
    selectionId?: string | null;
    selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
    /** P4R-3 opaque binding; sent in request context, never rendered in chat text. */
    contextToken?: string | null;
    selection?: {
      artifactId: string;
      revisionId: string | null;
      entityType: string;
      origin: string;
      entityIdCount: number;
      truncated: boolean;
      durable: boolean;
      sampleEntityIds: string[];
      entityIdsHash: string | null;
      fields: string[];
      hasFilter: boolean;
      filterDescription: string | null;
      sort: Array<{ field: string; direction: 'asc' | 'desc' }>;
    } | null;
  } | null;
  /**
   * P4R-3 structured result-edit request. The visible user message remains the
   * user's own outcome; orchestration instructions are rendered by the backend
   * system prompt instead of being persisted as a fake user utterance.
   */
  resultEditRequest?: {
    origin: 'manual' | 'agent';
    completionExpectation: 'candidate' | 'result_action' | 'none';
    parameterPatch: Record<string, unknown>;
    scientificConfirmed: boolean;
  } | null;
}

let current: CopilotContext = { page: 'unknown' };
const listeners = new Set<(c: CopilotContext) => void>();

export function setCopilotContext(patch: Partial<CopilotContext>): void {
  current = { ...current, ...patch };
  listeners.forEach((fn) => fn(current));
}

export function getCopilotContext(): CopilotContext {
  return current;
}

export function subscribeCopilotContext(fn: (c: CopilotContext) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Cheap URL-based page detector for non–single-cell pages. */
export function detectPageFromUrl(url: string, title?: string): CopilotContext {
  if (typeof window === 'undefined') return { page: 'unknown' };
  try {
    const u = new URL(url);
    const path = u.pathname;
    const hash = u.hash;

    // single-cell SPA — page is set imperatively from inside the app via setCopilotContext
    if (path.startsWith('/single-cell')) {
      // route hashes like #/dataset/xxx, #/result/xxx, #/project/xxx
      if (hash.startsWith('#/result/'))
        return { page: 'single-cell-result', pageTitle: title, currentModule: 'single-cell' };
      if (hash.startsWith('#/dataset/'))
        return { page: 'single-cell-dataset', pageTitle: title, currentModule: 'single-cell' };
      if (hash.startsWith('#/project/'))
        return { page: 'single-cell-project', pageTitle: title, currentModule: 'single-cell' };
      return { page: 'single-cell-projects', pageTitle: title, currentModule: 'single-cell' };
    }
    // W3-C: spatial 空间组学云平台 SPA — 与 single-cell 同结构
    if (path.startsWith('/spatial')) {
      if (hash.startsWith('#/result/'))
        return { page: 'spatial-result', pageTitle: title, currentModule: 'spatial' };
      if (hash.startsWith('#/dataset/'))
        return { page: 'spatial-dataset', pageTitle: title, currentModule: 'spatial' };
      if (hash.startsWith('#/project/'))
        return { page: 'spatial-project', pageTitle: title, currentModule: 'spatial' };
      return { page: 'spatial-projects', pageTitle: title, currentModule: 'spatial' };
    }
    // 6.3 — desktop project workspace
    if (path.startsWith('/project/')) {
      return { page: 'desktop-project', pageTitle: title };
    }
    if (path === '/' || path === '') {
      return { page: 'desktop-home', pageTitle: title };
    }
    if (path.startsWith('/figcode') || path.includes('/figcode/')) {
      return { page: 'figcode', pageTitle: title };
    }
    if (path.startsWith('/blog') || path.includes('/blog/')) {
      return { page: 'blog', pageTitle: title };
    }
    if (path.startsWith('/docs') || path.includes('/docs/')) {
      return { page: 'docs', pageTitle: title };
    }
    return { page: 'unknown', pageTitle: title };
  } catch {
    return { page: 'unknown' };
  }
}
