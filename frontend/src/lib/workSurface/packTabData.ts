/**
 * packTabData — BLOCK-236：pack 接管只读 tab 的数据桥。
 *
 * 只做三件事：按 tab 调**已存在的只读端点**、把结果裁到有界形状、失败如实返回原因。
 * 不新增数据 API、不建第二套 artifact/truth；写面（selection/changeset/replay）一律不进本桥。
 *
 * BLOCK-263（P4-REM P1）：`history` 改接真实有界端点 `/result-studio/history`（此前
 * 诚实 no_endpoint 回落核心）；载荷 ≤100 行字段白名单。
 */

export type PackTabId = 'lineage' | 'history' | 'revisions-source' | 'compare';

export interface PackTabParams {
  projectId?: string | null;
  jobId?: string | null;
  revisionId?: string | null;
  changeSetId?: string | null;
}

export interface PackTabResult<T> {
  ok: boolean;
  reason?: string;
  data?: T;
}

export interface PackLineagePayload {
  nodes: { id: string; label?: string; kind?: string }[];
  edges: { from: string; to: string; label?: string }[];
  truncated: boolean;
}

export interface PackComparePayload {
  /** added/removed 为 null = 该文件没有逐行差异（如结构化 JSON 或仅表格数据变化），UI 显示「—」。 */
  files: { path: string; status: string; added: number | null; removed: number | null }[];
  truncated: boolean;
}

export interface PackSourcePayload {
  text: string;
  truncated: boolean;
}

/** BLOCK-263（P4-REM P1）— history tab 载荷：job 的修订历史有界只读列表。 */
export interface PackHistoryPayload {
  revisions: {
    revisionId: string;
    ordinal: number;
    createdAt?: string;
    isCurrent?: boolean;
    validationStatus?: string;
  }[];
  truncated: boolean;
}

export const PACK_TAB_LIMITS = Object.freeze({
  lineageNodes: 200,
  lineageEdges: 400,
  compareFiles: 200,
  sourceChars: 200 * 1024,
});

type Fetcher = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export interface PackTabDeps {
  apiBase: string;
  fetchImpl?: Fetcher;
}

const TRUNCATION_MARK = '\n…（内容超出上限，已截断；完整内容请在核心视图打开）';

function clip(text: string, limit: number): { text: string; truncated: boolean } {
  if (text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit)}${TRUNCATION_MARK}`, truncated: true };
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

async function readJson(
  url: string,
  deps: PackTabDeps,
): Promise<PackTabResult<unknown>> {
  const fetchImpl: Fetcher | undefined = deps.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, reason: 'fetch_unavailable' };
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    const text = await res.text();
    try {
      return { ok: true, data: JSON.parse(text) };
    } catch {
      return { ok: false, reason: 'invalid_json' };
    }
  } catch {
    return { ok: false, reason: 'network_error' };
  }
}

export async function fetchPackTabData(
  tab: PackTabId,
  params: PackTabParams,
  deps: PackTabDeps,
): Promise<PackTabResult<PackLineagePayload | PackSourcePayload | PackComparePayload | PackHistoryPayload>> {
  const base = deps.apiBase.replace(/\/$/, '');

  if (tab === 'history') {
    // BLOCK-263（P4-REM P1）— 接真实有界端点（此前诚实 no_endpoint 回落核心）。
    const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
    if (!jobId) return { ok: false, reason: 'missing_job_id' };
    const res = await readJson(`${base}/result-studio/history?jobId=${encodeURIComponent(jobId)}`, deps);
    if (!res.ok) return res as PackTabResult<PackHistoryPayload>;
    const raw = (res.data ?? {}) as {
      revisions?: Array<{ revisionId?: unknown; ordinal?: unknown; createdAt?: unknown; isCurrent?: unknown; validationStatus?: unknown }>;
    };
    const list = asArray<NonNullable<PackHistoryPayload['revisions'][number]>>(raw.revisions)
      .filter((r) => r && typeof r.revisionId === 'string' && r.revisionId)
      .map((r) => ({
        revisionId: r.revisionId,
        ordinal: typeof r.ordinal === 'number' ? r.ordinal : 0,
        createdAt: typeof r.createdAt === 'string' ? r.createdAt.slice(0, 40) : undefined,
        isCurrent: r.isCurrent === true,
        validationStatus: typeof r.validationStatus === 'string' ? r.validationStatus.slice(0, 40) : undefined,
      }));
    return {
      ok: true,
      data: { revisions: list.slice(0, 100), truncated: list.length > 100 },
    };
  }

  if (tab === 'lineage') {
    const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
    if (!jobId) return { ok: false, reason: 'missing_job_id' };
    const res = await readJson(`${base}/result-studio/lineage?jobId=${encodeURIComponent(jobId)}`, deps);
    if (!res.ok) return res as PackTabResult<PackLineagePayload>;
    // 后端返回 { lineage: { chain, downstreamCount } }（祖先链），不是 nodes/edges；
    // 见 BLOCK-252 实机抓真。兼容旧顶层 nodes/edges 形状。
    const raw = (res.data ?? {}) as {
      nodes?: unknown;
      edges?: unknown;
      lineage?: { chain?: Array<{ toolJobId?: unknown; toolId?: unknown; isCurrent?: unknown }> } | null;
    };
    const chain = Array.isArray(raw.lineage?.chain) ? raw.lineage.chain : [];
    const lineageNodes = chain
      .filter((item) => item && typeof item.toolJobId === 'string' && item.toolJobId)
      .map((item) => ({
        id: String(item.toolJobId),
        label: typeof item.toolId === 'string' ? item.toolId.slice(0, 120) : undefined,
        kind: item.isCurrent === true ? 'current' : 'ancestor',
      }));
    const lineageEdges = lineageNodes.slice(1).map((node, index) => ({
      from: lineageNodes[index].id,
      to: node.id,
    }));
    const nodes = lineageNodes.length > 0
      ? lineageNodes
      : asArray<PackLineagePayload['nodes'][number]>(raw.nodes)
        .filter((n) => n && typeof n.id === 'string')
        .map((n) => ({ id: n.id, label: typeof n.label === 'string' ? n.label.slice(0, 120) : undefined, kind: typeof n.kind === 'string' ? n.kind : undefined }));
    const edges = lineageNodes.length > 0
      ? lineageEdges
      : asArray<PackLineagePayload['edges'][number]>(raw.edges)
        .filter((e) => e && typeof e.from === 'string' && typeof e.to === 'string')
        .map((e) => ({ from: e.from, to: e.to, label: typeof e.label === 'string' ? e.label.slice(0, 120) : undefined }));
    const truncated = nodes.length > PACK_TAB_LIMITS.lineageNodes || edges.length > PACK_TAB_LIMITS.lineageEdges;
    return {
      ok: true,
      data: {
        nodes: nodes.slice(0, PACK_TAB_LIMITS.lineageNodes),
        edges: edges.slice(0, PACK_TAB_LIMITS.lineageEdges),
        truncated,
      },
    };
  }

  // compare（BLOCK-236 第二批）：changeset 差异只读视图
  if (tab === 'compare') {
    const changeSetId = typeof params.changeSetId === 'string' ? params.changeSetId.trim() : '';
    if (!changeSetId) return { ok: false, reason: 'missing_changeset_id' };
    const res = await readJson(
      `${base}/result-studio/changesets/${encodeURIComponent(changeSetId)}/compare`,
      deps,
    );
    if (!res.ok) return res as PackTabResult<PackComparePayload>;
    // 真实响应是 compareResultChangeSet 的投影：changeSet.changedPaths + textDiff.patch，
    // 不存在的 `files` 只是旧假设（BLOCK-252 实机抓真）。逐文件 +/- 数从 patch 头分桶。
    const raw = (res.data ?? {}) as {
      files?: unknown[];
      changeSet?: { changedPaths?: Array<{ relativePath?: unknown; changeType?: unknown }> };
      textDiff?: { patch?: unknown; truncated?: unknown };
    };
    const patchLines = typeof raw.textDiff?.patch === 'string' ? String(raw.textDiff.patch).split('\n') : [];
    const countsByPath = new Map<string, { added: number; removed: number }>();
    let currentPath: string | null = null;
    for (const line of patchLines) {
      const diffMatch = /^diff --git a\/.+ b\/(.+)$/.exec(line);
      if (diffMatch) {
        currentPath = diffMatch[1];
        if (!countsByPath.has(currentPath)) countsByPath.set(currentPath, { added: 0, removed: 0 });
        continue;
      }
      if (!currentPath) continue;
      const counts = countsByPath.get(currentPath);
      if (!counts) continue;
      if (line.startsWith('+') && !line.startsWith('+++')) counts.added += 1;
      if (line.startsWith('-') && !line.startsWith('---')) counts.removed += 1;
    }
    const changedPaths = asArray<{ relativePath?: unknown; changeType?: unknown }>(raw.changeSet?.changedPaths)
      .filter((entry) => entry && typeof entry.relativePath === 'string');
    const files = changedPaths.length > 0
      ? changedPaths.map((entry) => {
        const path = String(entry.relativePath).slice(0, 300);
        const counts = countsByPath.get(String(entry.relativePath)) || null;
        return {
          path,
          status: typeof entry.changeType === 'string' ? entry.changeType : 'modified',
          added: counts ? counts.added : null,
          removed: counts ? counts.removed : null,
        };
      })
      : asArray<{ path?: unknown; status?: unknown; added?: unknown; removed?: unknown }>(raw.files)
        .filter((f) => f && typeof f.path === 'string')
        .map((f) => ({
          path: String(f.path).slice(0, 300),
          status: typeof f.status === 'string' ? f.status : 'modified',
          added: typeof f.added === 'number' ? f.added : null,
          removed: typeof f.removed === 'number' ? f.removed : null,
        }));
    return {
      ok: true,
      data: {
        files: files.slice(0, PACK_TAB_LIMITS.compareFiles),
        truncated: raw.textDiff?.truncated === true || files.length > PACK_TAB_LIMITS.compareFiles,
      },
    };
  }

  // revisions-source
  const revisionId = typeof params.revisionId === 'string' ? params.revisionId.trim() : '';
  if (!revisionId) return { ok: false, reason: 'missing_revision_id' };
  // 后端 source 端点强制 projectId（BLOCK-252 实机抓真：旧桥不带 → 永远 400）。
  const projectId = typeof params.projectId === 'string' ? params.projectId.trim() : '';
  if (!projectId) return { ok: false, reason: 'missing_project_id' };
  const query = new URLSearchParams({ projectId });
  const res = await readJson(
    `${base}/result-studio/revisions/${encodeURIComponent(revisionId)}/source?${query.toString()}`,
    deps,
  );
  if (!res.ok) return res as PackTabResult<PackSourcePayload>;
  const payload = (res.data ?? {}) as { source?: unknown; text?: unknown; content?: unknown };
  // 后端 source 投影字段名是 `content`（BLOCK-252 实机抓真：旧桥只读 source/text，永远 empty_source）。
  const source = typeof payload.content === 'string'
    ? payload.content
    : typeof payload.source === 'string'
      ? payload.source
      : typeof payload.text === 'string'
        ? payload.text
        : '';
  if (!source) return { ok: false, reason: 'empty_source' };
  const clipped = clip(source, PACK_TAB_LIMITS.sourceChars);
  return { ok: true, data: { text: clipped.text, truncated: clipped.truncated } };
}
