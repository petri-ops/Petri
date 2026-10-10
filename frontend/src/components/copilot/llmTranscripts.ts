/**
 * BLOCK-37 P3 — 模型 I/O 信息流客户端（UI-274）
 *
 * 只读查询 petri-server 的 llm-transcripts 路由（数据源为
 * io-transcript.js 落盘的 <PETRI_LOCAL_DATA_DIR>/llm-transcripts/<conversationId>.jsonl）：
 *   - listLlmTranscripts: 会话级调用索引（不含正文）
 *   - fetchLlmTranscriptRecord: 单条完整记录（请求 messages 全量 + 响应聚合 + delta 帧）
 */

import { getApiPrefix, getAuthHeader } from './copilotClient';

export interface LlmTranscriptIndexEntry {
  id: string;
  ts: string;
  conversationId: string | null;
  kind: string;
  role: string;
  traceId?: string;
  provider?: string;
  profileId?: string;
  model?: string;
  attemptIndex: number;
  durationMs?: number;
  finishReason?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  messagesCount: number;
  framesCount: number;
  framesTruncated: boolean;
  truncated: boolean;
  messagesTruncated: number;
  error: string | null;
  sizeBytes: number;
}

export interface LlmTranscriptMessage {
  role?: string;
  content?: unknown;
  tool_calls?: unknown;
  [key: string]: unknown;
}

export interface LlmTranscriptRecord {
  id: string;
  ts: string;
  conversationId: string | null;
  kind: string;
  role: string;
  traceId?: string;
  provider?: string;
  profileId?: string;
  attemptIndex: number;
  model?: string;
  durationMs?: number;
  request: { messages: LlmTranscriptMessage[]; params?: string };
  response: {
    content?: string;
    reasoningContent?: string;
    toolCalls?: unknown[];
    finishReason?: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  } | null;
  error: string | null;
  frames?: unknown[];
  framesCount: number;
  framesTruncated: boolean;
  truncated: boolean;
  messagesTruncated: number;
}

async function requestJson<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { ...getAuthHeader() } });
  let body: (T & { status?: string; error?: string }) | null = null;
  try {
    body = (await resp.json()) as T & { status?: string; error?: string };
  } catch {
    // 非 JSON 响应按 HTTP 状态处理
  }
  if (!resp.ok || !body) {
    throw new Error(body?.error || `HTTP ${resp.status}`);
  }
  return body;
}

/** 列出会话全部模型调用索引（后端按 ts 升序返回；查看器内自行倒序展示）。 */
export async function listLlmTranscripts(conversationId: string): Promise<LlmTranscriptIndexEntry[]> {
  const params = new URLSearchParams({ conversationId });
  const body = await requestJson<{ count: number; records: LlmTranscriptIndexEntry[] }>(
    `${getApiPrefix()}/ai/agent/llm-transcripts?${params.toString()}`
  );
  return Array.isArray(body.records) ? body.records : [];
}

/** 读取单条完整记录。未命中时后端返回 404，此处抛错。 */
export async function fetchLlmTranscriptRecord(
  conversationId: string,
  id: string
): Promise<LlmTranscriptRecord> {
  const params = new URLSearchParams({ conversationId, id });
  const body = await requestJson<{ record: LlmTranscriptRecord }>(
    `${getApiPrefix()}/ai/agent/llm-transcripts/record?${params.toString()}`
  );
  return body.record;
}
