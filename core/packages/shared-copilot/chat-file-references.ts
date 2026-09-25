/**
 * BioF3 Shared — chat file reference resolution (pure logic)
 *
 * Plan:  "会话文件直达预览" — pure classification + extraction helpers +
 *        a platform-agnostic resolver that takes a fetcher callback so
 *        this file has no dependency on authClient / electron / etc.
 *
 * The platform glue lives in
 * `frontend/src/lib/chat-file-references.ts` and wires `fetchJson` to the
 * `biof3-server` `/api/harness/file-references/resolve` endpoint.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ResolvedArtifact {
  kind: 'artifact';
  jobId: string;
  artifactName: string;
  name?: string;
  label?: string;
  url?: string;
  type?: string;
  projectId?: string;
}

export interface ResolvedWorkspaceFile {
  kind: 'workspace';
  projectId: string;
  relativePath: string;
  name?: string;
  url?: string;
}

export type ResolvedReference = ResolvedArtifact | ResolvedWorkspaceFile;

export interface ReferenceResolution {
  reference: string;
  resolved: ResolvedReference | null;
  reason?: string;
}

export interface ExtractContext {
  projectId?: string;
  activeJobId?: string | null;
  activeArtifactName?: string;
}

/**
 * Fetcher contract: the platform layer supplies a function that returns a
 * Promise resolving to the parsed response body. The shared module never
 * touches `fetch`, `getToken`, or `getPlatformApiPrefix` directly.
 */
export type FileReferenceFetcher = (body: ResolveRequest) => Promise<ResolveResponse>;

export interface ResolveRequest {
  projectId: string;
  activeJobId?: string | null;
  references: string[];
}

export interface ResolveResponse {
  ok: boolean;
  results?: ReferenceResolution[];
  error?: string;
}

// ---------------------------------------------------------------------------
// URL safety — shared with the renderer
// ---------------------------------------------------------------------------

export type LinkKind = 'external' | 'internal' | 'workspace' | 'artifact' | 'dangerous';

function isSafeHttpUrl(raw: string): boolean {
  const value = (raw || '').trim();
  if (!value) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return true;
    return false;
  } catch {
    return false;
  }
}

function isSafeRelativeUrl(raw: string): boolean {
  const value = (raw || '').trim();
  if (!value) return false;
  if (/[\u0000-\u001F\u007F]/.test(value)) return false;
  if (value.startsWith('#')) return true;
  if (value.startsWith('/')) return true;
  if (value.startsWith('./') || value.startsWith('../')) return true;
  return false;
}

export function classifyLink(raw: string): LinkKind {
  const value = (raw || '').trim();
  if (!value) return 'dangerous';
  if (/[\u0000-\u001F\u007F]/.test(value)) return 'dangerous';
  if (/^(javascript|data|vbscript|file|ftp):/i.test(value)) return 'dangerous';
  // BLOCK-61 改名回归修复 —— 内部 URI 协议改名 biof3:// → gewu://。
  // 双协议兼容：历史持久化消息里的 biof3:// 引用必须继续工作；
  // 新产出的统一为 gewu://。
  if (/^(?:biof3|gewu):\/\/workspace\//i.test(value)) return 'workspace';
  if (/^(?:biof3|gewu):\/\/artifact\//i.test(value)) return 'artifact';
  if (/^(?:biof3|gewu):/i.test(value)) return 'dangerous';
  if (/^\/(?:Users|Volumes|private|tmp|var|etc|home)\//i.test(value)) return 'dangerous';
  if (isSafeRelativeUrl(value)) return 'internal';
  if (/^mailto:/i.test(value)) {
    const after = value.slice(7);
    return after && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(after) ? 'external' : 'dangerous';
  }
  if (isSafeHttpUrl(value)) return 'external';
  return 'dangerous';
}

// ---------------------------------------------------------------------------
// Candidate extraction
// ---------------------------------------------------------------------------

const INTERNAL_URI_RE = /\b((?:biof3|gewu):\/\/(?:artifact|workspace)\/[^\s)\]\>"']+)/gi;
const TOOLS_FILE_URL_RE = /\/api\/(?:[^/]+\/)?tools\/file\/([A-Za-z0-9._-]+)\/([^\s)\]\>"']+)/gi;
const PROJECT_RELATIVE_RE =
  /(?:^|[\s(\["'>])((?:\.{0,2}\/)?(?:[\p{L}\p{N}_.-]+\/)+[\p{L}\p{N}_.-]+\.[A-Za-z0-9]+)(?=$|[\s,.，。 、;；:：!?！？)\]"'])/gu;
const QUOTED_FILE_REFERENCE_RE =
  /(["'])(\.?\.?\/?[^"'\n]+\.[A-Za-z0-9][A-Za-z0-9.]*?)\1/gu;
const ABSOLUTE_FILE_REFERENCE_RE =
  /(?:^|[\s(\[`])((?:\/[\p{L}\p{N}_. -]+)+\.[A-Za-z0-9][A-Za-z0-9.]*)(?=$|[\s,.，。 、;；:：!?！？)\]"'])/gu;
const MARKDOWN_LINK_TARGET_RE = /\[[^\]\n]+\]\(([^()\s]+)\)/g;
const FILE_EXTENSION_PATTERN =
  '(?:html?|pdf|rtf|epub|docx?|docm|dotx?|xlsx?|xlsm|xlsb|xltx?|pptx?|pptm|ppsx?|potx?|odt|ods|odp|odg|pages|numbers|keynote|png|apng|jpe?g|svg|webp|gif|avif|bmp|ico|tiff?|heic|heif|csv|tsv|json|jsonl|md|markdown|rmd|qmd|rds|rda|rdata|h5ad|loom|h5|hdf5|mtx|txt|log|ya?ml|toml|ini|env|xml|zip|tar|tar\\.gz|tgz|gz|bz2|xz|js|jsx|mjs|cjs|ts|tsx|css|scss|less|vue|svelte|py|pyi|ipynb|r|rproj|sh|bash|zsh|fish|sql|java|kt|kts|go|rs|c|h|cc|cpp|hpp|cs|rb|php|swift|scala|pl|pm|lua|ex|exs|erl|hrl|fs|fsx|gradle|properties|lock|dockerfile|makefile|bed|bedgraph|bam|bai|sam|cram|vcf|bcf|gtf|gff|gff3|fasta|fa|fna|fastq|fq|nwk|newick)';
const ARTIFACT_FILENAME_RE = new RegExp(
  `([\\p{L}\\p{N}_.-]+\\.${FILE_EXTENSION_PATTERN})(?=$|[\\s,.，。 、;；:：!?！？)\\]"'])`,
  'giu',
);
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const EXACT_INTERNAL_URI_RE = /^(?:biof3|gewu):\/\/(?:artifact|workspace)\/[^\s)\]\>"']+$/i;
const EXACT_TOOLS_FILE_URL_RE =
  /^\/api\/(?:[^/]+\/)?tools\/file\/([A-Za-z0-9._-]+)\/([^\s)\]\>"']+)$/i;
const EXACT_PROJECT_RELATIVE_RE =
  /^(?:\.{0,2}\/)?(?:[^/\n]+\/)+[^/\n]+\.[A-Za-z0-9][A-Za-z0-9.]*$/;
const EXACT_ABSOLUTE_FILE_REFERENCE_RE =
  /^(?:\/[\p{L}\p{N}_. -]+)+\.[A-Za-z0-9][A-Za-z0-9.]*$/u;
const EXACT_ARTIFACT_FILENAME_RE = new RegExp(
  `^[\\p{L}\\p{N}_. -]+\\.${FILE_EXTENSION_PATTERN}$`,
  'iu',
);

function stripCodeRegions(markdown: string): string {
  let out = markdown.replace(/```[\s\S]*?(?:```|$)/g, (block) => block.replace(/[^\n]/g, ' '));
  out = out.replace(/`[^`\n]*`/g, (span) => span.replace(/[^\n]/g, ' '));
  out = out.replace(/<pre[\s\S]*?<\/pre>/gi, (span) => span.replace(/[^\n]/g, ' '));
  out = out.replace(/<code[\s\S]*?<\/code>/gi, (span) => span.replace(/[^\n]/g, ' '));
  return out;
}

function isFileReferenceCandidate(raw: string): boolean {
  const value = (raw || '').trim();
  if (!value || value.length > 256 || /[\u0000-\u001F\u007F]/.test(value)) return false;
  if (EXACT_INTERNAL_URI_RE.test(value) || EXACT_TOOLS_FILE_URL_RE.test(value)) return true;
  if (EXACT_PROJECT_RELATIVE_RE.test(value) || EXACT_ABSOLUTE_FILE_REFERENCE_RE.test(value)) return true;
  return EXACT_ARTIFACT_FILENAME_RE.test(value);
}

function pushUnique(target: string[], next: string | null | undefined): void {
  if (!next) return;
  const trimmed = next.trim();
  if (!trimmed) return;
  if (target.includes(trimmed)) return;
  target.push(trimmed);
}

export function extractFileReferenceCandidates(
  markdown: string,
  opts: ExtractContext = {},
  limit = 32
): string[] {
  const cleaned = stripCodeRegions(typeof markdown === 'string' ? markdown : '');
  if (!cleaned) return [];
  const out: string[] = [];

  const collect = (raw: string | null | undefined) => {
    pushUnique(out, raw);
  };

  for (const m of cleaned.matchAll(INTERNAL_URI_RE)) {
    collect(m[1]);
  }

  for (const m of cleaned.matchAll(TOOLS_FILE_URL_RE)) {
    const jobId = m[1];
    let fileName = m[2];
    try {
      fileName = decodeURIComponent(fileName);
    } catch {
      continue;
    }
    collect(`${jobId}/${fileName}`);
    if (!opts.activeJobId || opts.activeJobId === jobId) {
      collect(fileName);
    }
  }

  for (const m of cleaned.matchAll(PROJECT_RELATIVE_RE)) {
    const candidate = (m[1] || '').trim();
    if (!candidate) continue;
    if (candidate.length > 256) continue;
    collect(candidate);
  }

  for (const m of cleaned.matchAll(QUOTED_FILE_REFERENCE_RE)) {
    const candidate = (m[2] || '').trim();
    if (isFileReferenceCandidate(candidate)) collect(candidate);
  }

  for (const m of cleaned.matchAll(ABSOLUTE_FILE_REFERENCE_RE)) {
    const candidate = (m[1] || '').trim();
    if (isFileReferenceCandidate(candidate)) collect(candidate);
  }

  for (const m of cleaned.matchAll(MARKDOWN_LINK_TARGET_RE)) {
    const candidate = (m[1] || '').trim();
    if (isFileReferenceCandidate(candidate)) collect(candidate);
  }

  for (const m of cleaned.matchAll(ARTIFACT_FILENAME_RE)) {
    const name = m[1] || '';
    if (opts.activeArtifactName && name.toLowerCase() === opts.activeArtifactName.toLowerCase())
      continue;
    collect(name);
  }

  // Models commonly wrap result filenames in backticks. Keep fenced code and
  // arbitrary expressions excluded, but allow a code span whose complete
  // content is a plausible file reference; the server still verifies it.
  const withoutFences = (typeof markdown === 'string' ? markdown : '').replace(
    /```[\s\S]*?(?:```|$)/g,
    (block) => block.replace(/[^\n]/g, ' ')
  );
  for (const m of withoutFences.matchAll(INLINE_CODE_RE)) {
    const candidate = (m[1] || '').trim();
    if (!isFileReferenceCandidate(candidate)) continue;
    if (
      opts.activeArtifactName &&
      candidate.toLowerCase() === opts.activeArtifactName.toLowerCase()
    )
      continue;
    collect(candidate);
  }

  return out.slice(0, limit);
}


// ---------------------------------------------------------------------------
// Platform-agnostic resolver — uses an injected fetcher
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_LIMIT = 512;
interface CacheEntry {
  expiresAt: number;
  value: ReferenceResolution | null;
}
const resolutionCache = new Map<string, CacheEntry>();
const inFlightBatches = new Map<string, Promise<Map<string, ReferenceResolution | null>>>();

function cacheKey(
  projectId: string,
  activeJobId: string | null | undefined,
  reference: string
): string {
  return `${projectId}::${activeJobId || ''}::${reference}`;
}

function dedupKey(
  projectId: string,
  activeJobId: string | null | undefined,
  references: string[]
): string {
  return `${projectId}::${activeJobId || ''}::${[...references].sort().join('\u001f')}`;
}

function readCached(key: string): ReferenceResolution | null | undefined {
  const entry = resolutionCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    resolutionCache.delete(key);
    return undefined;
  }
  resolutionCache.delete(key);
  resolutionCache.set(key, entry);
  return entry.value;
}

function writeCached(key: string, value: ReferenceResolution | null): void {
  resolutionCache.delete(key);
  resolutionCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  while (resolutionCache.size > CACHE_LIMIT) {
    const oldest = resolutionCache.keys().next().value;
    if (!oldest) break;
    resolutionCache.delete(oldest);
  }
}

function normalizeResolution(entry: ReferenceResolution): ReferenceResolution {
  const resolved = entry?.resolved;
  if (!resolved || resolved.kind !== 'artifact') return entry;
  const artifactName = resolved.artifactName || resolved.name;
  if (!artifactName)
    return { ...entry, resolved: null, reason: entry.reason || 'artifact_name_missing' };
  return {
    ...entry,
    resolved: {
      ...resolved,
      artifactName,
      name: resolved.name || artifactName,
    },
  };
}

/**
 * Set the fetcher used by `resolveFileReferences`. The platform layer must
 * call this exactly once at module load (e.g. from `frontend/src/lib/chat-file-references.ts`).
 */
export function setFileReferenceFetcher(fetcher: FileReferenceFetcher | null): void {
  fileReferenceFetcher = fetcher;
}

let fileReferenceFetcher: FileReferenceFetcher | null = null;

/**
 * Batch resolve a set of references for one project/activeJob pair. The
 * shared cache + in-flight dedup lives here; the actual HTTP call is
 * delegated to the platform-supplied fetcher.
 */
export async function resolveFileReferences(
  ctx: ExtractContext | null | undefined,
  references: string[]
): Promise<Map<string, ReferenceResolution | null>> {
  const out = new Map<string, ReferenceResolution | null>();
  const projectId = (ctx?.projectId || '').trim();
  if (!projectId || references.length === 0) return out;
  const activeJobId = ctx?.activeJobId || null;

  if (!fileReferenceFetcher) return out;

  const resolved = new Map<string, ReferenceResolution | null>();
  const missing: string[] = [];
  for (const ref of references) {
    const cached = readCached(cacheKey(projectId, activeJobId, ref));
    if (cached !== undefined) resolved.set(ref, cached);
    else missing.push(ref);
  }
  if (missing.length > 0) {
    const key = dedupKey(projectId, activeJobId, missing);
    let shared = inFlightBatches.get(key);
    if (!shared) {
      shared = runBatchResolve(fileReferenceFetcher, projectId, activeJobId, missing);
      inFlightBatches.set(key, shared);
      void shared.finally(() => inFlightBatches.delete(key));
    }
    const fresh = await shared;
    for (const [ref, entry] of fresh.entries()) resolved.set(ref, entry);
  }

  for (const ref of references) {
    if (resolved.has(ref)) {
      out.set(ref, resolved.get(ref) ?? null);
    } else {
      out.set(ref, null);
    }
  }
  return out;
}

async function runBatchResolve(
  fetcher: FileReferenceFetcher,
  projectId: string,
  activeJobId: string | null,
  references: string[]
): Promise<Map<string, ReferenceResolution | null>> {
  const result = new Map<string, ReferenceResolution | null>();
  try {
    const data = await fetcher({ projectId, activeJobId, references });
    if (data && data.ok && Array.isArray(data.results)) {
      for (const rawEntry of data.results) {
        const entry = normalizeResolution(rawEntry);
        result.set(entry.reference, entry);
        const key = cacheKey(projectId, activeJobId, entry.reference);
        writeCached(key, entry);
      }
      for (const ref of references) {
        if (!result.has(ref)) {
          result.set(ref, null);
          const key = cacheKey(projectId, activeJobId, ref);
          writeCached(key, null);
        }
      }
      return result;
    }
  } catch {
    // fall through to per-reference fallback below
  }

  // Per-reference fallback keeps the chat usable when the endpoint is
  // temporarily unreachable. Only unexpired cached entries are reused.
  for (const ref of references) {
    const cached = readCached(cacheKey(projectId, activeJobId, ref));
    result.set(ref, cached === undefined ? null : cached);
  }
  return result;
}

/** Test-only: clear the resolution cache. Production code never calls this. */
export function __resetFileReferenceCache(): void {
  resolutionCache.clear();
  inFlightBatches.clear();
}
