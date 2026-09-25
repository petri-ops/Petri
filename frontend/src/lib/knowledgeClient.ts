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
  /** BLOCK-94 F6 规模观测指标（向量通道暴力扫描警戒） */
  scale?: { readyChunks: number; scanWarnThreshold: number; scanWarning: boolean };
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
  /** BLOCK-94 F5：FTS MATCH 语法失败降级 LIKE 时诚实标注 */
  ftsDegraded?: boolean;
  docId?: string | null;
}

export interface KnowledgeSearchResponse extends KnowledgeSearchResult {
  query?: string;
}

async function jsonOrThrow<T>(resp: Response): Promise<T> {
  const body = (await resp.json().catch(() => ({}))) as { status?: unknown; error?: unknown };
  if (!resp.ok || body.status === 'error') {
    throw new Error(typeof body.error === 'string' && body.error ? body.error : `HTTP ${resp.status}`);
  }
  return body as T;
}

export async function fetchKnowledgeSpace(
  params?: { docLimit?: number; docOffset?: number; spaceId?: string }
): Promise<KnowledgeSpaceState> {
  const query = new URLSearchParams();
  if (params?.docLimit != null) query.set('docLimit', String(params.docLimit));
  if (params?.docOffset != null) query.set('docOffset', String(params.docOffset));
  if (params?.spaceId) query.set('spaceId', params.spaceId);
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
export async function pasteKnowledgeDocument(
  name: string,
  text: string,
  spaceId?: string
): Promise<{ document: KnowledgeDoc }> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/paste`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, text, spaceId: spaceId || undefined }),
  });
  return jsonOrThrow(resp);
}

/** BLOCK-94 F4：文档预览（索引分块全文 + 原始文件位置） */
export interface KnowledgeDocPreview {
  status: string;
  document: KnowledgeDoc;
  chunks: Array<{ seq: number; text: string }>;
  rawPath: string;
  rawAvailable: boolean;
}

export async function fetchKnowledgeDocumentPreview(id: string): Promise<KnowledgeDocPreview> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/${encodeURIComponent(id)}/preview`);
  return jsonOrThrow(resp);
}

/** BLOCK-94 F4：批量删除（不存在项诚实列出） */
export async function batchDeleteKnowledgeDocuments(ids: string[]): Promise<{ deleted: string[]; missing: string[] }> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents/batch-delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  return jsonOrThrow(resp);
}

export async function setKnowledgeSpaceEnabled(enabled: boolean, spaceId?: string): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/space`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled, spaceId: spaceId || undefined }),
  });
  await jsonOrThrow(resp);
}

export async function uploadKnowledgeDocumentsWithSpace(files: File[], spaceId: string): Promise<{ accepted: KnowledgeDoc[]; rejected: Array<{ name: string; error: string }> }> {
  const form = new FormData();
  for (const file of files) form.append('files', file);
  if (spaceId) form.append('spaceId', spaceId);
  const resp = await fetch(`${getApiPrefix()}/knowledge/documents`, { method: 'POST', body: form });
  return jsonOrThrow(resp);
}

export async function clearKnowledgeSpaceById(spaceId: string): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/space/clear`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ spaceId }),
  });
  await jsonOrThrow(resp);
}

export async function searchKnowledgeInSpace(
  query: string,
  spaceId: string,
  topK?: number,
  docId?: string
): Promise<KnowledgeSearchResponse> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, topK, docId: docId || undefined, spaceId }),
  });
  return jsonOrThrow<KnowledgeSearchResponse>(resp);
}

// ── BLOCK-99 G2 多空间管理 API ──

export interface KnowledgeSpaceSummary {
  id: string;
  name: string;
  enabled: boolean;
  embeddingModel: string;
  createdAt: string;
  updatedAt: string;
  documents: number;
  chunks: number;
}

export async function fetchKnowledgeSpaces(): Promise<KnowledgeSpaceSummary[]> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/spaces`);
  const body = await jsonOrThrow<{ status: string; spaces: KnowledgeSpaceSummary[] }>(resp);
  // 防御：导航组件不因载荷缺字段而崩（switcher 空列表 = 诚实降级）
  return Array.isArray(body?.spaces) ? body.spaces : [];
}

export async function createKnowledgeSpace(name: string): Promise<KnowledgeSpaceSummary> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/spaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const body = await jsonOrThrow<{ status: string; space: KnowledgeSpaceSummary }>(resp);
  return body.space;
}

export async function renameKnowledgeSpace(id: string, name: string): Promise<void> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/spaces/${encodeURIComponent(id)}/rename`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  await jsonOrThrow(resp);
}


export async function fetchKnowledgeSpaceImpact(id: string): Promise<{ documents: number; chunks: number }> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/spaces/${encodeURIComponent(id)}/impact`);
  const body = await jsonOrThrow<{ status: string; impact: { documents: number; chunks: number } }>(resp);
  return body.impact;
}

export async function deleteKnowledgeSpace(id: string): Promise<{ deleted: string; documents: number; chunks: number }> {
  const resp = await fetch(`${getApiPrefix()}/knowledge/spaces/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

