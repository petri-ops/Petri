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

export async function fetchKnowledgeSpace(): Promise<KnowledgeSpaceState> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/space`);
  return jsonOrThrow<KnowledgeSpaceState>(resp);
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
