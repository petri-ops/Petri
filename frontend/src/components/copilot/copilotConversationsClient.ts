// ============================================================
// Conversation API client
// ============================================================

import { getApiPrefix } from './copilotClient';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export type ConversationStatus = 'active' | 'archived';

/**
 * 会话 REST 信封 wire 形状（BLOCK-105 §7 Batch-5 类型化；JSON 解析出站边界契约文档）。
 * 字段 unknown＝后端可能发任意 JSON，运行时防御式解构保持原样。
 */
interface ConversationsEnvelope {
  status?: unknown;
  conversations?: ConversationSummary[];
  conversation?: ConversationSummary | null;
  messages?: ConversationMessage[];
  hasMore?: unknown;
  nextBefore?: unknown;
  windowOffset?: unknown;
  compaction?: ConversationCompactionInfo | null;
}

export interface ConversationSummary {
  id: string;
  title: string;
  status: ConversationStatus;
  last_page: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_topic_shift_at?: string | null;
  last_topic_shift_reason?: string | null;
  project_id?: string | null;
  /** Branch support: ID of the parent conversation this was forked from */
  parent_id?: string | null;
  /** Branch support: visual color identifier for the branch line */
  branch_color?: string | null;
  /** BLOCK-88 P2（D3）：会话来源标记；'federation-delegation'=访客工程师委托会话 */
  origin?: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
  meta?: Record<string, unknown> | null;
}

export async function listConversations(
  status: ConversationStatus | 'all' = 'active',
  projectId?: string,
  opts?: { includeFederated?: boolean }
): Promise<ConversationSummary[]> {
  try {
    let url = getApiPrefix() + '/ai/conversations?status=' + status;
    if (projectId) url += '&project_id=' + encodeURIComponent(projectId);
    // BLOCK-88 P2（D3）：显式查看联邦委托会话（服务端默认视图隔离）
    if (opts && opts.includeFederated) url += '&includeFederated=1';
    const resp = await fetch(url, {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as ConversationsEnvelope;
    return data.status === 'ok' ? data.conversations || [] : [];
  } catch {
    return [];
  }
}

export async function createConversation(
  title?: string,
  lastPage?: string,
  projectId?: string | null
): Promise<ConversationSummary | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ title: title || '新对话', lastPage: lastPage || null, project_id: projectId || null }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as ConversationsEnvelope;
    return data.status === 'ok' ? data.conversation ?? null : null;
  } catch {
    return null;
  }
}

export async function getConversationMessages(
  id: string,
  limit = 100
): Promise<ConversationMessage[]> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/messages?limit=' + limit,
      { headers: getAuthHeader() }
    );
    if (!resp.ok) return [];
    const data = (await resp.json()) as ConversationsEnvelope;
    return data.status === 'ok' ? data.messages || [] : [];
  } catch {
    return [];
  }
}

/** BLOCK-99 G4 — 会话存在性校验（管理台复用独立 conversation；404/离线 → null）。 */
export async function getConversation(
  id: string
): Promise<ConversationSummary | null> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id),
      { headers: getAuthHeader() }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as ConversationsEnvelope;
    return data.status === 'ok' ? data.conversation ?? null : null;
  } catch {
    return null;
  }
}

/** BLOCK-95 B2/A5 — 会话压缩留痕（诚实可见；DB 原文始终可见）。 */
export interface ConversationCompactionInfo {
  summary: string;
  coversCount: number;
  sourceTokens: number;
  updatedAt: string;
}

/** BLOCK-95 A1 — 分页信封：最新窗口 + 向上游标。before=上一页响应的 nextBefore。 */
export interface ConversationMessagesPage {
  messages: ConversationMessage[];
  hasMore: boolean;
  nextBefore: number | null;
  /** 本批第一条（最旧）在全量消息中的 0-based 序号；fork-from-message 的
   *  untilIndex 由「窗口内 index」换算为「全量 index」时使用。 */
  windowOffset: number;
  /** BLOCK-95 B2/A5 — 会话压缩视图留痕（无压缩为 null）。 */
  compaction?: ConversationCompactionInfo | null;
}

export async function getConversationMessagesPage(
  id: string,
  limit = 200,
  before?: number | null
): Promise<ConversationMessagesPage | null> {
  try {
    let url =
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/messages?limit=' + limit;
    if (before) url += '&before=' + before;
    const resp = await fetch(url, { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = (await resp.json()) as ConversationsEnvelope;
    if (data.status !== 'ok') return null;
    return {
      messages: data.messages || [],
      hasMore: Boolean(data.hasMore),
      nextBefore: typeof data.nextBefore === 'number' ? data.nextBefore : null,
      windowOffset: typeof data.windowOffset === 'number' ? data.windowOffset : 0,
      compaction: data.compaction || null,
    };
  } catch {
    return null;
  }
}

export async function renameConversation(id: string, title: string): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ title }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function archiveConversation(id: string, archive: boolean): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ status: archive ? 'archived' : 'active' }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function deleteConversation(id: string): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function dismissTopicShift(id: string): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/dismiss-topic-shift',
      {
        method: 'POST',
        headers: getAuthHeader(),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fork an existing conversation — creates a new conversation with messages copied.
 * @param id - source conversation id
 * @param title - optional new conversation title
 * @param untilIndex - optional 0-based message index; if provided, only messages up to that index (inclusive) are copied.
 */
export async function forkConversation(
  id: string,
  title?: string,
  untilIndex?: number
): Promise<ConversationSummary | null> {
  try {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.title = title;
    if (untilIndex !== undefined) body.untilIndex = untilIndex;
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/fork',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) return null;
    const data = (await resp.json()) as ConversationsEnvelope;
    return data.status === 'ok' ? data.conversation ?? null : null;
  } catch {
    return null;
  }
}
