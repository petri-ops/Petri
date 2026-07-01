// ============================================================
// Lightweight client for /copilot-index.json (Phase β).
//
// The index is published at the site root by build-copilot-index.mjs.
// Components that need to read metadata about the current doc / figcode /
// blog entry call `fetchCopilotIndex()` (cached after first hit) and
// `lookupCopilotEntry(url)` to find the matching entry.
// ============================================================

export interface CopilotMeta {
  domain?: string;
  level?: 'beginner' | 'intermediate' | 'advanced';
  estimated_minutes?: number;
  prerequisites?: string[];
  learning_outcomes?: string[];
  hands_on?: boolean;
  related_concepts?: string[];
  fits_after?: string[];
  teaches?: string[];
}

export interface CopilotIndexDoc {
  path: string;
  url: string;
  title: string;
  summary: string;
  headings?: string[];
  copilot: CopilotMeta | null;
}

export interface CopilotIndexFigcode {
  id: string;
  url: string;
  title: string;
  subtitle?: string;
  category?: string;
  biologicalQuestion?: string;
  packages?: string[];
  tutorialUrl?: string | null;
  copilot: CopilotMeta | null;
}

export interface CopilotIndex {
  generatedAt: string;
  schemaVersion: number;
  counts: { docs: number; blog: number; figcode: number; acts: number };
  coverage?: Record<string, string>;
  domains?: string[];
  levels?: string[];
  docs: CopilotIndexDoc[];
  blog: unknown[];
  figcode: CopilotIndexFigcode[];
  acts: unknown[];
  warnings?: string[];
}

let _cache: CopilotIndex | null = null;
let _inflight: Promise<CopilotIndex | null> | null = null;

const INDEX_URL = '/copilot-index.json';

export function fetchCopilotIndex(): Promise<CopilotIndex | null> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = (async () => {
    if (typeof window === 'undefined') return null;
    try {
      const resp = await fetch(INDEX_URL, { cache: 'force-cache' });
      if (!resp.ok) return null;
      const json = (await resp.json()) as CopilotIndex;
      _cache = json;
      return json;
    } catch {
      return null;
    } finally {
      _inflight = null;
    }
  })();
  return _inflight;
}

/** Look up an entry by URL (e.g. '/docs/single-cell/module01' or '/figcode#volcano'). */
export async function lookupCopilotEntry(url: string): Promise<{
  kind: 'doc' | 'figcode' | 'blog';
  entry: CopilotIndexDoc | CopilotIndexFigcode | unknown;
} | null> {
  const idx = await fetchCopilotIndex();
  if (!idx || !url) return null;
  const norm = url.replace(/\/$/, '');
  const doc = (idx.docs || []).find((d) => d.url === norm);
  if (doc) return { kind: 'doc', entry: doc };
  const fig = (idx.figcode || []).find((f) => f.url === norm);
  if (fig) return { kind: 'figcode', entry: fig };
  const blog = (idx.blog || []).find((b: Record<string, unknown>) => b.url === norm);
  if (blog) return { kind: 'blog', entry: blog };
  return null;
}
