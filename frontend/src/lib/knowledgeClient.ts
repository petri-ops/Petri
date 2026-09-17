/**
 * knowledgeClient.ts — BLOCK-69 知识空间前端 API 封装
 * 单一数据源 = 后端 /api/knowledge/*（启用状态单一真相在 DB，前端不造第二真相）。
 */

import { getApiPrefix } from '../components/copilot/copilotClient';

export type KnowledgeDocStatus = 'uploaded' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed';

export interface KnowledgeDoc {
  id: string;
  name: string;
  kind: string;
  size: number;
  status: KnowledgeDocStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSpaceState {
  status: string;
  space: { id: string; name: string; enabled: boolean; embeddingModel: string } | null;
  documents: KnowledgeDoc[];
  embeddingAvailable: boolean;
  knowledgeDir: string;
  queueDepth: number;
  /** BLOCK-94 F1 分页（服务端默认 docLimit=50） */
  documentsTotal?: number;
  documentsHasMore?: boolean;
  documentsLimit?: number;
  documentsOffset?: number;
  /** BLOCK-94 F1 嵌入模型失配统计：>0 时旧模型向量已隔离，提示重建 */
  staleEmbedding?: { staleChunks: number; staleDocs: number };
}

export interface KnowledgeHit {
  docId: string;
  docName: string;
  seq: number;
  score: number;
  channels: { vector?: number; fts?: number };
  text: string;
}

export interface KnowledgeSearchResult {
  status: string;
  hits: KnowledgeHit[];
  readyChunks: number;
  embeddingAvailable: boolean;
  embeddingError: string | null;
}

export interface KnowledgeSearchResponse extends KnowledgeSearchResult {
  query?: string;
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok || (body as { status?: string }).status === 'error') {
    throw new Error((body as { error?: string }).error || `HTTP ${resp.status}`);
  }
  return body as T;
}

export async function fetchKnowledgeSpace(
  params?: { docLimit?: number; docOffset?: number }
): Promise<KnowledgeSpaceState> {
  const query = new URLSearchParams();
  if (params?.docLimit != null) query.set('docLimit', String(params.docLimit));
  if (params?.docOffset != null) query.set('docOffset', String(params.docOffset));
  const qs = query.toString();
  const resp = await fetch(`${getApiPrefix()}/knowledge/space${qs ? `?${qs}` : ''}`);
  return jsonOrThrow<KnowledgeSpaceState>(resp);
}

/** BLOCK-94 F1：failed 文档批量重试（原始文件缺失的逐项诚实跳过） */
export async function retryFailedKnowledgeDocuments(): Promise<{
  requeued: number;
  skipped: Array<{ id: string; reason: string }>;
}> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/retry-failed`, { method: 'POST' });
  return jsonOrThrow(resp);
}

/** BLOCK-94 F3：粘贴文本直接入库（服务端补 .txt 后缀） */
export async function pasteKnowledgeDocument(name: string, text: string): Promise<{ document: KnowledgeDoc }> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text }),
  });
  return jsonOrThrow(resp);
}

export async function setKnowledgeSpaceEnabled(enabled: boolean): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  await jsonOrThrow(resp);
}

export async function uploadKnowledgeDocuments(files: File[]): Promise<{ accepted: KnowledgeDoc[]; rejected: Array<{ name: string; error: string }> }> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents`, { method: 'POST', body: form });
  return jsonOrThrow(resp);
}

export async function deleteKnowledgeDocument(id: string): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/${encodeURIComponent(id)}`, { method: 'DELETE' });
  await jsonOrThrow(resp);
}

export async function reindexKnowledgeDocument(id: string): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/${encodeURIComponent(id)}/reindex`, { method: 'POST' });
  await jsonOrThrow(resp);
}

export async function clearKnowledgeSpace(): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/space/clear`, { method: 'POST' });
  await jsonOrThrow(resp);
}

export async function searchKnowledge(query: string, topK?: number): Promise<KnowledgeSearchResponse> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK }),
  });
  return jsonOrThrow<KnowledgeSearchResponse>(resp);
}
