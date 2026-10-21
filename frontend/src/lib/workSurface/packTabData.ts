/**
 * packTabData — BLOCK-236：pack 接管只读 tab 的数据桥。
 *
 * 只做三件事：按 tab 调**已存在的只读端点**、把结果裁到有界形状、失败如实返回原因。
 * 不新增数据 API、不建第二套 artifact/truth；写面（selection/changeset/replay）一律不进本桥。
 *
 * 诚实边界：`history` 目前**没有**现成列表端点（只有 `/revisions/:id/*` 单条），
 * 故一律返回 `no_endpoint`，由 host 回落核心历史面——不拿 lineage 数据冒充历史。
 */

export type PackTabId = 'lineage' | 'history' | 'revisions-source';

export interface PackTabParams {
  jobId?: string | null;
  revisionId?: string | null;
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

export interface PackSourcePayload {
  text: string;
  truncated: boolean;
}

export const PACK_TAB_LIMITS = Object.freeze({
  lineageNodes: 200,
  lineageEdges: 400,
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
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as unknown as Fetcher);
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
): Promise<PackTabResult<PackLineagePayload | PackSourcePayload>> {
  const base = deps.apiBase.replace(/\/$/, '');

  if (tab === 'history') return { ok: false, reason: 'no_endpoint' };

  if (tab === 'lineage') {
    const jobId = typeof params.jobId === 'string' ? params.jobId.trim() : '';
    if (!jobId) return { ok: false, reason: 'missing_job_id' };
    const res = await readJson(`${base}/api/result-studio/lineage?jobId=${encodeURIComponent(jobId)}`, deps);
    if (!res.ok) return res as PackTabResult<PackLineagePayload>;
    const raw = (res.data ?? {}) as { nodes?: unknown; edges?: unknown };
    const nodes = asArray<PackLineagePayload['nodes'][number]>(raw.nodes)
      .filter((n) => n && typeof n.id === 'string')
      .map((n) => ({ id: n.id, label: typeof n.label === 'string' ? n.label.slice(0, 120) : undefined, kind: typeof n.kind === 'string' ? n.kind : undefined }));
    const edges = asArray<PackLineagePayload['edges'][number]>(raw.edges)
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

  // revisions-source
  const revisionId = typeof params.revisionId === 'string' ? params.revisionId.trim() : '';
  if (!revisionId) return { ok: false, reason: 'missing_revision_id' };
  const res = await readJson(
    `${base}/api/result-studio/revisions/${encodeURIComponent(revisionId)}/source`,
    deps,
  );
  if (!res.ok) return res as PackTabResult<PackSourcePayload>;
  const payload = (res.data ?? {}) as { source?: unknown; text?: unknown };
  const source = typeof payload.source === 'string' ? payload.source : typeof payload.text === 'string' ? payload.text : '';
  if (!source) return { ok: false, reason: 'empty_source' };
  const clipped = clip(source, PACK_TAB_LIMITS.sourceChars);
  return { ok: true, data: { text: clipped.text, truncated: clipped.truncated } };
}
