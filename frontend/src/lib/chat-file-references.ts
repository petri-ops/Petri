/**
 * Gewu Desktop — chat file reference resolution (platform glue)
 *
 * Wires the platform-agnostic `resolveFileReferences` (in shared-copilot)
 * to biof3-server's `POST /api/harness/file-references/resolve` endpoint and
 * re-exports the pure classify / extract helpers so application code can
 * import everything from a single entry point.
 */
export {
  classifyLink,
  extractFileReferenceCandidates,
  isSafeHttpUrl,
  isSafeRelativeUrl,
  isFileReferenceCandidate,
  syntheticInternalUri,
  stripCodeRegions,
  resolveFileReferences,
  __resetFileReferenceCache,
  setFileReferenceFetcher,
  type ExtractContext,
  type LinkKind,
  type ReferenceResolution,
  type ResolvedArtifact,
  type ResolvedReference,
  type ResolvedWorkspaceFile,
  type ResolveRequest,
  type ResolveResponse,
  type FileReferenceFetcher,
} from '../../../core/packages/shared-copilot/chat-file-references';

// FileReferenceClickDetail is owned by the shared markdown renderer; re-export
// it here so platform code can import everything from a single entry point.
export { type FileReferenceClickDetail } from '../../../core/packages/shared-copilot/copilotMarkdown';

import { getPlatformApiPrefix, getToken } from './authClient';
import {
  setFileReferenceFetcher,
  type FileReferenceFetcher,
  type ResolveResponse,
} from '../../../core/packages/shared-copilot/chat-file-references';

const fetcher: FileReferenceFetcher = async (body) => {
  const token = getToken();
  try {
    // `globalThis.fetch` so unit tests can stub via `global.fetch = mockFn`.
    // The `as unknown as typeof fetch` dance keeps the strict TS check happy
    // when vitest's `vi.fn()` returns a looser signature than the lib type.
    const fetchImpl = (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetchImpl !== 'function') {
      return { ok: false, error: 'fetch unavailable' };
    }
    const resp = await fetchImpl(
      `${getPlatformApiPrefix()}/harness/file-references/resolve`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
    );
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
    return (await resp.json()) as ResolveResponse;
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
};

let wired = false;

/**
 * Ensure the shared resolver is wired to the platform fetcher. Idempotent;
 * the platform wrapper installs itself lazily on first call.
 */
function ensureWired(): void {
  if (wired) return;
  setFileReferenceFetcher(fetcher);
  wired = true;
}

// Install eagerly at module load so the renderer can call resolveFileReferences
// without an explicit wiring step.
ensureWired();