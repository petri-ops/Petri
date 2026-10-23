// ============================================================
// useContextSources.ts — BLOCK-245 P3「`@` 候选装载」hook
//
// 职责边界：本文件只做**装载**（真实端点 → 原始行），形状/上限/不可用语
// 全部由 `contextSources.ts`（纯层）决定。七个来源各自独立结算——
// 一个源失败不拖垮其余六类（与 slashSources 的 per-source 独立同旨）。
//
// 数据面复核记录（P3 动手前逐条实码核实，见 plan §5 未做清单第 1 条）：
//   file         GET /api/workspaces/:id/tree?recursive=1（RightFileTree.tsx:139 同端点）
//   skill        slashSources.fetchSlashEntries（bridge.discover + 模板端点，60s 模块缓存）
//   connector    GET /api/mcp/servers（hooks/useMcpServers 同端点同行形状）
//   agent        GET /api/subagent/profiles（routes/subagent-profiles.js:15）
//   artifact     listProjectJobs(projectId) → GET /api/data/projects/:id/jobs
//   knowledge    knowledgeClient.fetchKnowledgeSpaces → GET /api/knowledge/spaces
//   conversation copilotConversationsClient.listConversationsStrict → GET /api/ai/conversations
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiPrefix } from '@/lib/authClient';
import { listProjectJobs } from '@/lib/project-store';
import { fetchKnowledgeSpaces } from '@/lib/knowledgeClient';
import { getConversationMessages, listConversationsStrict } from '../../copilotConversationsClient';
import { fetchSlashEntries } from '../slashSources';
import {
  CONTEXT_SOURCE_ORDER,
  buildAgentCandidates,
  buildConnectorCandidates,
  buildConversationCandidates,
  buildConversationDigest,
  buildFileCandidates,
  buildKnowledgeCandidates,
  buildResultCandidates,
  buildSkillCandidates,
  buildSnapshotCandidates,
  unavailableContextSource,
  type AgentProfileRow,
  type ConnectorRow,
  type ContextSourceId,
  type ContextSourceResult,
  type WorkspaceTreeRow,
} from '../contextSources';

/** 重新装载的最小间隔（菜单反复开关不重复打后端；手动刷新不受限）。 */
const RELOAD_TTL_MS = 30_000;

function reasonText(reason: unknown, fallback: string): string {
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason) return reason;
  return fallback;
}

async function loadFiles(projectId: string): Promise<ContextSourceResult> {
  if (!projectId) return unavailableContextSource('file', '未选择项目：文件候选需要项目工作区');
  const resp = await fetch(`${getApiPrefix()}/workspaces/${encodeURIComponent(projectId)}/tree?recursive=1`);
  const data = (await resp.json().catch(() => ({}))) as {
    ok?: unknown;
    entries?: WorkspaceTreeRow[];
    truncated?: unknown;
    error?: unknown;
  };
  if (!resp.ok || !data.ok) {
    throw new Error(typeof data.error === 'string' && data.error ? data.error : `工作区树请求失败（${resp.status}）`);
  }
  return buildFileCandidates(Array.isArray(data.entries) ? data.entries : [], {
    treeTruncated: data.truncated === true,
  });
}

async function loadSkills(): Promise<ContextSourceResult> {
  // fetchSlashEntries 自己按源独立降级（bridge 缺失/模板端点失败 = 该源空），
  // 因此这里拿到的空列表可能是「未安装技能」也可能是「桥不可用」——后者由
  // 斜杠菜单同一条路径承担，不在此处二次猜测原因。
  const entries = await fetchSlashEntries();
  return buildSkillCandidates(entries);
}

async function loadConnectors(): Promise<ContextSourceResult> {
  const resp = await fetch(`${getApiPrefix()}/mcp/servers`);
  const data = (await resp.json().catch(() => ({}))) as { servers?: ConnectorRow[] };
  if (!resp.ok) throw new Error(`MCP 服务清单请求失败（${resp.status}）`);
  return buildConnectorCandidates(Array.isArray(data.servers) ? data.servers : []);
}

async function loadAgents(): Promise<ContextSourceResult> {
  const resp = await fetch(`${getApiPrefix()}/subagent/profiles`);
  const data = (await resp.json().catch(() => ({}))) as { profiles?: AgentProfileRow[] };
  if (!resp.ok) throw new Error(`子智能体 profile 请求失败（${resp.status}）`);
  return buildAgentCandidates(Array.isArray(data.profiles) ? data.profiles : []);
}

async function loadResults(projectId: string): Promise<ContextSourceResult> {
  if (!projectId) return unavailableContextSource('artifact', '未选择项目：结果产物按项目隔离');
  const jobs = await listProjectJobs(projectId);
  return buildResultCandidates(jobs);
}

async function loadKnowledge(): Promise<ContextSourceResult> {
  const spaces = await fetchKnowledgeSpaces();
  return buildKnowledgeCandidates(spaces);
}

/** 最多给多少个会话补摘要（每个一次消息请求；上限防菜单打开变成批量拉取）。 */
const CONVERSATION_DIGEST_LIMIT = 6;

/**
 * BLOCK-246 C17 — 会话候选带**有界摘要**：列表照旧，只给最靠前的若干条补摘要
 * （逐条独立降级：某个会话的消息拉不到就退回"只有元数据"，不拖垮整个源）。
 */
async function loadConversations(projectId: string, conversationId?: string | null): Promise<ContextSourceResult> {
  const rows = await listConversationsStrict('active', projectId || undefined);
  const top = rows.filter((row) => row.id !== conversationId).slice(0, CONVERSATION_DIGEST_LIMIT);
  const digests = await Promise.allSettled(top.map((row) => getConversationMessages(row.id, 12)));
  const digestById = new Map<string, string[]>();
  digests.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const digest = buildConversationDigest(result.value);
    if (digest.lines.length > 0) digestById.set(top[index].id, digest.lines);
  });
  return buildConversationCandidates(
    rows.map((row) => ({ ...row, digest: digestById.get(row.id) })),
    conversationId,
  );
}

/** BLOCK-246 C16 — 应用快照：不需要端点，全部来自宿主已知状态。 */
function loadSnapshot(projectId: string, conversationId?: string | null): ContextSourceResult {
  return buildSnapshotCandidates({ projectId, conversationId });
}

export interface ContextSourcesApi {
  /** 按 CONTEXT_SOURCE_ORDER 排序的七源结果（含不可用原因）。 */
  sources: ContextSourceResult[];
  loading: boolean;
  /** 最后一次装载的整体失败（逐源失败已落在各自的 unavailableReason 上）。 */
  error: string | null;
  refresh: () => void;
}

export interface UseContextSourcesOptions {
  projectId: string;
  conversationId?: string | null;
  /** false = 菜单未打开，不装载；首次变 true 时装载一次（TTL 内复用）。 */
  enabled: boolean;
}

export function useContextSources(options: UseContextSourcesOptions): ContextSourcesApi {
  const { projectId, conversationId, enabled } = options;
  const [sources, setSources] = useState<ContextSourceResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const sequence = useRef(0);
  const loadedAt = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const requestId = ++sequence.current;
    setLoading(true);
    setError(null);
    const tasks: Array<{ id: ContextSourceId; run: () => Promise<ContextSourceResult> }> = [
      { id: 'file', run: () => loadFiles(projectId) },
      { id: 'skill', run: loadSkills },
      { id: 'connector', run: loadConnectors },
      { id: 'agent', run: loadAgents },
      { id: 'artifact', run: () => loadResults(projectId) },
      { id: 'knowledge', run: loadKnowledge },
      { id: 'conversation', run: () => loadConversations(projectId, conversationId) },
      // C16 应用快照：无端点，永远可用（未选项目时以 note 说明原因）
      { id: 'snapshot', run: async () => loadSnapshot(projectId, conversationId) },
    ];
    const settled = await Promise.allSettled(tasks.map((task) => task.run()));
    if (!alive.current || sequence.current !== requestId) return;
    const next: ContextSourceResult[] = settled.map((result, index) => (
      result.status === 'fulfilled'
        ? result.value
        : unavailableContextSource(tasks[index].id, reasonText(result.reason, '来源不可用'))
    ));
    // 任务表已按 CONTEXT_SOURCE_ORDER 排列；此处按 id 再对账一次，防以后插项漏改。
    next.sort(
      (a, b) => CONTEXT_SOURCE_ORDER.indexOf(a.sourceId) - CONTEXT_SOURCE_ORDER.indexOf(b.sourceId),
    );
    loadedAt.current = Date.now();
    setSources(next);
    setLoading(false);
  }, [projectId, conversationId]);

  useEffect(() => {
    if (!enabled) return undefined;
    if (loadedAt.current > 0 && Date.now() - loadedAt.current < RELOAD_TTL_MS) return undefined;
    // 装载延一拍（set-state-in-effect 语义：effect 同步面零 setState）
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [enabled, load]);

  const refresh = useCallback(() => {
    loadedAt.current = 0;
    void load();
  }, [load]);

  return { sources, loading, error, refresh };
}
