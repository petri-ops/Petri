/**
 * useKnowledgeConsole — BLOCK-99 G4 空间管理会话台逻辑（D3 独立轻量面 + D6 复用会话系统）
 *
 * 独立 conversation（localStorage 记忆，可回溯可审计；不触碰 SimpleChat 主文件），
 * 直连 copilotClient.streamChat（task 模式全基础设施复用：提交/订阅/断线重连）。
 * context.toolSubset='knowledge-console' 使后端只下发 knowledge 白名单工具；
 * 破坏性操作（D4 门）经 tool_result 的 confirmationRequired 投影为内联确认卡，
 * 用户确认后以固定格式消息回灌会话，由模型凭一次性 confirmToken 重调执行。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { streamChat, type ToolCallEvent, type ToolResultEvent } from '@/components/copilot/copilotClient';
import {
  createConversation,
  getConversation,
  getConversationMessages,
  type ConversationMessage,
} from '@/components/copilot/copilotConversationsClient';
import { dispatchPetriEvent, petriEvents } from '@/lib/events';

const CONVERSATION_KEY = 'petri_knowledge_console_conv';
const CONVERSATION_TITLE = '知识空间管理台';

export type ConsoleEntryStatus = 'running' | 'success' | 'error';

export interface ConsoleMessageEntry {
  kind: 'message';
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export interface ConsoleConfirmation {
  action: string;
  targetId: string;
  impactText: string;
  confirmToken: string;
  resolved: 'pending' | 'confirmed' | 'cancelled';
}

export interface ConsoleToolEntry {
  kind: 'tool';
  id: string;
  name: string;
  status: ConsoleEntryStatus;
  /** 工具调用实参（ToolResultEvent 不回传 args；D4 确认卡 targetId 由此取） */
  args?: Record<string, unknown>;
  summary?: string;
  confirmation?: ConsoleConfirmation;
}

export type ConsoleEntry = ConsoleMessageEntry | ConsoleToolEntry;

let entrySeq = 0;
function nextEntryId(prefix: string): string {
  entrySeq += 1;
  return `${prefix}_${Date.now()}_${entrySeq}`;
}

/** 变更类工具（成功后广播面板同步；读件与确认卡不广播） */
const MUTATING_TOOLS = new Set([
  'knowledge_space_create',
  'knowledge_space_rename',
  'knowledge_space_enable',
  'knowledge_space_bind',
  'knowledge_space_delete',
  'knowledge_space_clear',
  'knowledge_doc_move',
  'knowledge_doc_delete',
  'knowledge_doc_reindex',
]);

function impactTextFrom(impact: unknown): string {
  if (!impact || typeof impact !== 'object') return '';
  const i = impact as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof i.spaceName === 'string') parts.push(`空间「${i.spaceName}」`);
  if (typeof i.documents === 'number') parts.push(`${i.documents} 篇文档`);
  if (typeof i.chunks === 'number') parts.push(`${i.chunks} 个知识块`);
  if (Array.isArray(i.docNames) && i.docNames.length > 0) {
    parts.push(`文档：${i.docNames.map(String).join('、')}`);
  }
  return parts.join(' · ');
}

function confirmationFrom(name: string, args: Record<string, unknown>, data: unknown): ConsoleConfirmation | undefined {
  if (!data || typeof data !== 'object') return undefined;
  const d = data as Record<string, unknown>;
  if (d.confirmationRequired !== true || typeof d.confirmToken !== 'string') return undefined;
  const targetId =
    typeof args.spaceId === 'string' && args.spaceId
      ? args.spaceId
      : Array.isArray(args.docIds)
        ? (args.docIds as unknown[]).map(String).sort().join(',')
        : '';
  return {
    action: typeof d.action === 'string' ? d.action : name,
    targetId,
    impactText: impactTextFrom(d.impact) || (typeof d.message === 'string' ? d.message : ''),
    confirmToken: d.confirmToken,
    resolved: 'pending',
  };
}

function entriesFromHistory(messages: ConversationMessage[]): ConsoleEntry[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      kind: 'message' as const,
      id: m.id || nextEntryId('hist'),
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));
}

export function useKnowledgeConsole() {
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conversationRef = useRef<string | null>(null);
  const streamingRef = useRef(false);

  // D6 — 会话引导：localStorage 记忆的 conversation 仍存在则复用，否则新建。
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let conv = null;
      let convId: string | null = null;
      try {
        convId = localStorage.getItem(CONVERSATION_KEY) || null;
      } catch {}
      if (convId) {
        conv = await getConversation(convId);
      }
      if (!conv) {
        conv = await createConversation(CONVERSATION_TITLE, '/knowledge');
        convId = conv?.id || null;
        if (convId) {
          try {
            localStorage.setItem(CONVERSATION_KEY, convId);
          } catch {}
          // UI-396 机制复用：新建会话广播，左栏会话列表即时刷新
          dispatchPetriEvent(petriEvents.conversationCreated, {
            conversationId: convId,
            title: CONVERSATION_TITLE,
            projectId: null,
          });
        }
      }
      if (cancelled) return;
      if (convId) {
        const history = await getConversationMessages(convId);
        if (!cancelled) setEntries(entriesFromHistory(history));
      }
      conversationRef.current = convId;
      setConversationId(convId);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const send = useCallback(async (text: string): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || streamingRef.current || !conversationRef.current) return;
    setError(null);
    streamingRef.current = true;
    setStreaming(true);
    setEntries((prev) => [
      ...prev,
      { kind: 'message', id: nextEntryId('u'), role: 'user', content: trimmed },
    ]);

    const assistantId = nextEntryId('a');
    let assistantAcc = '';
    const toolEntries = new Map<string, string>(); // callId → entry id

    try {
      await streamChat({
        messages: [{ role: 'user', content: trimmed }],
        conversationId: conversationRef.current,
        // accessMode 必须显式声明：inferExecutionPolicy 无档位时 fail-closed 塌缩
        // 'read'（S-003 家法），mutating 管理工具会被 execution_not_allowed 全拒。
        // 管理台语义即完全访问（工具子集已收窄至 knowledge 白名单）。
        context: { page: 'knowledge', toolSubset: 'knowledge-console', accessMode: 'full' },
        onConversation: (info) => {
          // 服务端权威会话 id（正常应与本地一致；漂移则以服务端为准并回写记忆）
          if (info.conversationId && info.conversationId !== conversationRef.current) {
            conversationRef.current = info.conversationId;
            setConversationId(info.conversationId);
            try {
              localStorage.setItem(CONVERSATION_KEY, info.conversationId);
            } catch {}
          }
        },
        onToolCall: (e: ToolCallEvent) => {
          const id = nextEntryId('t');
          if (e.callId) toolEntries.set(e.callId, id);
          setEntries((prev) => [
            ...prev,
            { kind: 'tool', id, name: e.name, status: 'running', args: e.args },
          ]);
        },
        onToolResult: (e: ToolResultEvent) => {
          const entryId = (e.toolResult && e.toolResult.callId && toolEntries.get(e.toolResult.callId)) || null;
          const status: ConsoleEntryStatus =
            e.toolResult && e.toolResult.status === 'error' ? 'error' : 'success';
          const data = e.toolResult && (e.toolResult.data);
          const patch: Partial<ConsoleToolEntry> = { status, summary: e.summary };
          setEntries((prev) => {
            const next = prev.map((entry) => {
              if (entry.kind !== 'tool') return entry;
              const match = entryId ? entry.id === entryId : entry.name === e.name && entry.status === 'running';
              if (!match) return entry;
              // D4 门：破坏性首调 → 投影确认卡（pending），操作尚未执行
              const confirmation = confirmationFrom(e.name, entry.args || {}, data);
              return { ...entry, ...patch, confirmation: confirmation || entry.confirmation };
            });
            return next;
          });
          // 变更成功（非确认回执）→ 广播面板即时刷新
          if (
            status === 'success' &&
            MUTATING_TOOLS.has(e.name) &&
            !(data && typeof data === 'object' && (data as Record<string, unknown>).confirmationRequired === true)
          ) {
            dispatchPetriEvent(petriEvents.knowledgeConsoleSync);
          }
        },
        onDelta: (delta: string) => {
          assistantAcc += delta;
          setEntries((prev) => {
            const idx = prev.findIndex((e) => e.id === assistantId);
            if (idx >= 0) {
              return prev.map((e) =>
                e.id === assistantId && e.kind === 'message' ? { ...e, content: assistantAcc } : e
              );
            }
            return [...prev, { kind: 'message', id: assistantId, role: 'assistant', content: assistantAcc }];
          });
        },
        onError: (err: Error) => {
          setError(err.message || '会话请求失败');
        },
      });
      // 无正文收尾（纯工具轮次）：诚实占位，不假写答案
      setEntries((prev) => {
        const idx = prev.findIndex((e) => e.id === assistantId);
        if (idx >= 0) {
          return prev.map((e) =>
            e.id === assistantId && e.kind === 'message' && !e.content.trim()
              ? { ...e, content: '（本轮无正文回复）' }
              : e
          );
        }
        return prev;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      streamingRef.current = false;
      setStreaming(false);
    }
  }, []);

  // D4 确认门：用户点击确认 → 固定格式消息回灌（模型凭 token 重调执行）
  const confirmDestructive = useCallback(
    (entryId: string) => {
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== entryId || e.kind !== 'tool' || !e.confirmation) return e;
          if (e.confirmation.resolved !== 'pending') return e;
          const { action, targetId, confirmToken } = e.confirmation;
          void send(
            `我确认执行 ${action}（对象 id=${targetId}，confirmToken=${confirmToken}）。请立即凭此 confirmToken 重调工具执行，并简短报告结果。`
          );
          return { ...e, confirmation: { ...e.confirmation, resolved: 'confirmed' } };
        })
      );
    },
    [send]
  );

  const cancelDestructive = useCallback((entryId: string) => {
    setEntries((prev) =>
      prev.map((e) => {
        if (e.id !== entryId || e.kind !== 'tool' || !e.confirmation) return e;
        if (e.confirmation.resolved !== 'pending') return e;
        void send('我取消该破坏性操作，不要执行，不要重试。');
        return { ...e, confirmation: { ...e.confirmation, resolved: 'cancelled' } };
      })
    );
  }, [send]);

  return {
    entries,
    streaming,
    error,
    ready,
    conversationId,
    send,
    confirmDestructive,
    cancelDestructive,
  };
}
