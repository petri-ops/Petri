// ============================================================
// conversationSegments.ts — BLOCK-107 P1a 会话信息流分段模型（D1=c）。
//
// 把一轮 assistant 回复投影为**按发生顺序（iteration）排列的有序分段序列**，
// 取代现状「固定模板顺序 + 类型分组堆叠」（SimpleChat.tsx:1043-1113）。
//
// 真源依据（BLOCK-107 plan §0.6 实测）：`toolActivities[].iteration` 覆盖率
// 315/315 = 100%，`reasoningByIteration` 的键为同序数字串——两者按 iteration
// 交错即可还原**迭代级**真实顺序，无需任何数据层改造（D1 由 b 修正为 c）。
//
// 分段语义（每个 iteration 内，BLOCK-108 P1 修订）：
//   progress（模型本迭代的过渡叙述——「模型说话」）→ tools（本迭代的工具簇，簇内
//   首行折叠本迭代思考——「模型做事」）→ …… → narrative（最终正文，恒在末尾）。
//   BLOCK-107 原语义为 reasoning 独立成段 + progress 在簇后（D5）；BLOCK-108 依用户
//   Qoder 形态裁决改为「叙述在簇前、思考入簇」（plan §7.2 取代登记）。
//
// 顺序依据：模型在一个 iteration 内先产出 reasoning_content / content，再发起
// tool_calls（loop-orchestrator.js:647-665 的流式阶段先于 toolCalls 取出），故同
// iteration 内 reasoning 与 progress（=该轮 streamedText）必在 tools 之前；
// progress 仅在该轮有工具调用时被记录（loop-orchestrator.js:771 的分支位置）。
//
// 兼容红线（D2）：无任何时间线素材（老数据）时**退化为单一 narrative 分段**，
// 渲染结果与现状一致；无 iteration 的历史活动归入 0 号段并排在最前，不丢内容。
// ============================================================

import type { ToolActivityItem, ToolActivityGroup } from './toolActivity';
import { groupToolActivities } from './toolActivity';

const FAILED_STATUSES: ReadonlySet<string> = new Set(['error', 'denied']);
const RUNNING_STATUSES: ReadonlySet<string> = new Set(['running', 'awaiting_confirmation']);

/** 折叠态思考行的预览长度上限。 */
export const REASONING_PREVIEW_CHARS = 64;

/** 无 iteration 号的历史活动归入此段（永远排最前）。 */
export const UNGROUPED_ITERATION = 0;

export interface ReasoningSegment {
  kind: 'reasoning';
  iteration: number;
  text: string;
  /** 折叠态一行预览（首行纯文本、剥 markdown 噪音、超长截断）。 */
  preview: string;
}

export interface ToolsSegment {
  kind: 'tools';
  iteration: number;
  activities: ToolActivityItem[];
  /** UI-383 既有折叠规则（同迭代内连续常规只读成功项归组），渲染层直接复用。 */
  groups: ToolActivityGroup[];
  totalCount: number;
  failedCount: number;
  runningCount: number;
  /** 簇内活动耗时之和（无任一活动带耗时时为 null，不伪造成 0）。 */
  durationMs: number | null;
  /** running = 有运行中/待确认项（渲染层据此展开并显示秒表）。 */
  state: 'running' | 'settled';
  /** BLOCK-108 P1 — 本迭代思考折入簇内（首行折叠、点击展开全文）。纯思考迭代仍独立成 ReasoningSegment。 */
  reasoning?: string;
  /** 折叠态一行预览（同 ReasoningSegment.preview 口径）。 */
  reasoningPreview?: string;
  /**
   * UI-430 — 相邻工具轮合并（ZCode 参考形态）：模型连续多轮每轮只发 1 个工具时，
   * 逐轮成簇会退化为成串匿名的「执行工具 1 次」。无过渡叙述分隔的相邻工具轮
   * 合并为一簇，`activities` 按迭代顺序拼接，`reasoningByIteration` 携带各轮
   * 思考供簇内逐轮交错渲染。单轮簇仍走 `reasoning`/`reasoningPreview` 旧字段。
   */
  reasoningByIteration?: Record<number, string>;
}

export interface ProgressSegment {
  kind: 'progress';
  iteration: number;
  content: string;
}

export interface NarrativeSegment {
  kind: 'narrative';
  text: string;
}

export type ConversationSegment =
  | ReasoningSegment
  | ToolsSegment
  | ProgressSegment
  | NarrativeSegment;

export interface ConversationSegmentsInput {
  content?: string;
  toolActivities?: ToolActivityItem[];
  reasoningByIteration?: Record<number, string>;
  progressUpdates?: Array<{ iteration: number; content: string }>;
}

/**
 * 折叠态一行预览：取首个非空行，剥离引用/列表/标题前缀与强调标记，
 * 压缩空白后按 REASONING_PREVIEW_CHARS 截断。空文本返回空串。
 */
export function reasoningPreview(text: string): string {
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw
      .replace(/^[\s>*\-+#]+/, '')
      .replace(/[*`_]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!line) continue;
    return line.length > REASONING_PREVIEW_CHARS
      ? `${line.slice(0, REASONING_PREVIEW_CHARS - 1)}…`
      : line;
  }
  return '';
}

function buildToolsSegment(iteration: number, activities: ToolActivityItem[]): ToolsSegment {
  let failedCount = 0;
  let runningCount = 0;
  let durationMs = 0;
  let hasDuration = false;
  for (const activity of activities) {
    if (FAILED_STATUSES.has(activity.status)) failedCount += 1;
    if (RUNNING_STATUSES.has(activity.status)) runningCount += 1;
    if (typeof activity.durationMs === 'number' && Number.isFinite(activity.durationMs)) {
      durationMs += activity.durationMs;
      hasDuration = true;
    }
  }
  return {
    kind: 'tools',
    iteration,
    activities,
    groups: groupToolActivities(activities),
    totalCount: activities.length,
    failedCount,
    runningCount,
    durationMs: hasDuration ? durationMs : null,
    state: runningCount > 0 ? 'running' : 'settled',
  };
}

/**
 * 投影一轮回复为有序分段序列。
 *
 * 无任何时间线素材（无活动、无思考段、无阶段进度）时返回单一 narrative 分段——老数据与
 * 「纯文本回答」轮次走这条路径，渲染与改造前一致（D2 兼容红线）。
 */
export function buildConversationSegments(
  input: ConversationSegmentsInput
): ConversationSegment[] {
  const content = typeof input.content === 'string' ? input.content : '';
  const activities = Array.isArray(input.toolActivities) ? input.toolActivities : [];
  const reasoning = input.reasoningByIteration || {};
  const progress = Array.isArray(input.progressUpdates) ? input.progressUpdates : [];

  const reasoningKeys = Object.keys(reasoning);
  if (activities.length === 0 && reasoningKeys.length === 0 && progress.length === 0) {
    return content.trim() ? [{ kind: 'narrative', text: content }] : [];
  }

  interface Bucket {
    activities: ToolActivityItem[];
    reasoning?: string;
    progress?: string;
  }
  const buckets = new Map<number, Bucket>();
  const bucketOf = (iteration: number): Bucket => {
    let bucket = buckets.get(iteration);
    if (!bucket) {
      bucket = { activities: [] };
      buckets.set(iteration, bucket);
    }
    return bucket;
  };

  for (const activity of activities) {
    const iteration = typeof activity.iteration === 'number'
      && Number.isFinite(activity.iteration)
      && activity.iteration > 0
      ? activity.iteration
      : UNGROUPED_ITERATION;
    bucketOf(iteration).activities.push(activity);
  }

  for (const [key, text] of Object.entries(reasoning)) {
    const iteration = Number(key);
    if (!Number.isInteger(iteration) || iteration < 1) continue;
    if (typeof text !== 'string' || !text.trim()) continue;
    const bucket = bucketOf(iteration);
    // 持久化格式为「一键一段」（agent-runner 按迭代聚合），同键重复时取首个。
    if (bucket.reasoning == null) bucket.reasoning = text;
  }

  for (const update of progress) {
    if (!update || typeof update.content !== 'string' || !update.content.trim()) continue;
    const iteration = Number.isInteger(update.iteration) && update.iteration > 0
      ? update.iteration
      : UNGROUPED_ITERATION;
    const bucket = bucketOf(iteration);
    if (bucket.progress == null) bucket.progress = update.content;
  }

  const segments: ConversationSegment[] = [];
  // UI-430 — 相邻工具轮合并：累计一段「无过渡叙述分隔」的连续工具轮，
  // flush 成单个 ToolsSegment（参考 ZCode 形态：连续 4 次调用是一簇「执行工具 4 次」，
  // 而不是 4 条匿名的「执行工具 1 次」）。progress（过渡叙述）与纯思考迭代是分隔符。
  interface RunBucket {
    iteration: number;
    activities: ToolActivityItem[];
    reasoning?: string;
  }
  let run: RunBucket[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      const only = run[0];
      const tools = buildToolsSegment(only.iteration, only.activities);
      if (only.reasoning) {
        tools.reasoning = only.reasoning;
        tools.reasoningPreview = reasoningPreview(only.reasoning);
      }
      segments.push(tools);
    } else {
      const activities = run.flatMap((bucket) => bucket.activities);
      const reasoningByIteration: Record<number, string> = {};
      for (const bucket of run) {
        if (bucket.reasoning) reasoningByIteration[bucket.iteration] = bucket.reasoning;
      }
      const merged = buildToolsSegment(run[0].iteration, activities);
      merged.reasoningByIteration = reasoningByIteration;
      segments.push(merged);
    }
    run = [];
  };

  for (const iteration of [...buckets.keys()].sort((a, b) => a - b)) {
    const bucket = buckets.get(iteration);
    if (!bucket) continue;
    const hasActivities = bucket.activities.length > 0;
    if (hasActivities) {
      // 过渡叙述在簇前，且它是簇的分隔符：先 flush 上一段合并簇。
      if (bucket.progress) {
        flushRun();
        segments.push({ kind: 'progress', iteration, content: bucket.progress });
      }
      run.push({ iteration, activities: bucket.activities, reasoning: bucket.reasoning });
    } else {
      // 纯思考迭代（无工具）：保持独立思考节点（BLOCK-107 行为不变），并结束当前合并段。
      flushRun();
      if (bucket.reasoning) {
        segments.push({
          kind: 'reasoning',
          iteration,
          text: bucket.reasoning,
          preview: reasoningPreview(bucket.reasoning),
        });
      } else if (bucket.progress) {
        segments.push({ kind: 'progress', iteration, content: bucket.progress });
      }
    }
  }
  flushRun();

  if (content.trim()) segments.push({ kind: 'narrative', text: content });
  return segments;
}

/** 分段中是否已包含正文（供渲染层判断是否需要在时间线之外补渲染正文）。 */
export function hasNarrativeSegment(segments: ConversationSegment[]): boolean {
  return segments.some((segment) => segment.kind === 'narrative');
}
