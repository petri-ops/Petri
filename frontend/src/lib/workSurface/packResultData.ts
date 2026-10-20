import * as React from 'react';
import { getToken } from '@/lib/authClient';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import type { ResultArtifactKind } from '@/lib/result-manifest';
import { resolveResultViewerAdapter, type ResultViewerAdapter } from '@/components/result-studio/resultSurface';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';

export interface PackResultData {
  status: 'ready' | 'unavailable' | 'error';
  adapter: ResultViewerAdapter;
  imageDataUrl?: string;
  rows?: string[][];
  text?: string;
  truncated?: boolean;
  reason?: string;
  sizeBytes?: number;
}

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 200_000;
const MAX_TABLE_ROWS = 200;
const MAX_TABLE_COLS = 50;

function isLocalArtifactUrl(url: string): boolean {
  if (url.startsWith('/')) return true;
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '::1';
  } catch {
    return false;
  }
}

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${mime || 'application/octet-stream'};base64,${btoa(binary)}`;
}

/**
 * BLOCK-218 — pack result surface 的只读、有界数据桥。
 * pack iframe 是独立 origin 且 CSP connect-src 'none'，不能自己取 artifact；
 * host 只按当前 artifact URL 抓一次，图/表/文本有界投影，binary/report 源码
 * 走诚实降级；不新增数据 API、不写 artifact/truth。
 */
export async function loadPackResultData(input: {
  url: string;
  kind: string;
  fileName: string;
  fetchImpl?: typeof fetch;
  maxImageBytes?: number;
  maxTextChars?: number;
}): Promise<PackResultData> {
  const adapter = resolveResultViewerAdapter({
    kind: input.kind as ResultArtifactKind,
    fileName: input.fileName,
  });
  if (!input.url) {
    return { status: 'unavailable', adapter, reason: 'no_artifact_url' };
  }
  const fetchImpl = input.fetchImpl || fetch;
  let response: Response;
  try {
    const headers: Record<string, string> = {};
    if (isLocalArtifactUrl(input.url)) headers.Authorization = `Bearer ${getToken()}`;
    response = await fetchImpl(input.url, { headers });
  } catch (error) {
    return { status: 'error', adapter, reason: error instanceof Error ? error.message : 'fetch_failed' };
  }
  if (!response.ok) {
    return { status: 'unavailable', adapter, reason: `artifact_http_${response.status}` };
  }

  if (adapter === 'image') {
    try {
      const blob = await response.blob();
      const limit = input.maxImageBytes ?? MAX_IMAGE_BYTES;
      if (blob.size > limit) {
        return { status: 'unavailable', adapter, reason: 'image_too_large', sizeBytes: blob.size };
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      return {
        status: 'ready',
        adapter,
        imageDataUrl: bytesToDataUrl(bytes, blob.type || 'image/png'),
        sizeBytes: blob.size,
      };
    } catch (error) {
      return { status: 'error', adapter, reason: error instanceof Error ? error.message : 'image_read_failed' };
    }
  }

  if (adapter === 'binary') {
    return { status: 'unavailable', adapter, reason: 'binary_not_inline' };
  }

  try {
    const text = await response.text();
    const limit = input.maxTextChars ?? MAX_TEXT_CHARS;
    const truncated = text.length > limit;
    const bounded = truncated ? text.slice(0, limit) : text;
    if (adapter === 'table') {
      const rows = buildPreviewTable(bounded, input.fileName, { maxRows: MAX_TABLE_ROWS })
        .map((row) => row.slice(0, MAX_TABLE_COLS));
      return { status: 'ready', adapter, rows, truncated, sizeBytes: text.length };
    }
    return { status: 'ready', adapter, text: bounded, truncated, sizeBytes: text.length };
  } catch (error) {
    return { status: 'error', adapter, reason: error instanceof Error ? error.message : 'text_read_failed' };
  }
}

export function usePackResultData(artifact: Pick<ActiveArtifact, 'url' | 'type' | 'semanticKind' | 'name'> | null): {
  data: PackResultData | null;
  loading: boolean;
} {
  const url = artifact?.url || '';
  const kind = artifact?.semanticKind || artifact?.type || '';
  const fileName = artifact?.name || '';
  const key = `${url}|${kind}|${fileName}`;
  const [entry, setEntry] = React.useState<{ key: string; data: PackResultData | null; loading: boolean }>({
    key,
    data: null,
    loading: Boolean(url),
  });

  // Render-phase adjustment keeps the effect body free of synchronous setState.
  if (url && entry.key !== key) {
    setEntry({ key, data: null, loading: true });
  }

  React.useEffect(() => {
    if (!url || !fileName) return undefined;
    let alive = true;
    void loadPackResultData({ url, kind, fileName }).then((data) => {
      if (alive) setEntry({ key, data, loading: false });
    });
    return () => { alive = false; };
  }, [fileName, key, kind, url]);

  if (!url) return { data: null, loading: false };
  const current = entry.key === key ? entry : null;
  return { data: current?.data ?? null, loading: current?.loading ?? false };
}
