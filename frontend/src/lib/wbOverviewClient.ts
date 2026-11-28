// ============================================================
// wbOverviewClient — item 88 第三波：wb 目标/任务只读投影客户端。
//
// 数据源：GET /api/wb/overview?projectId=（routes/wb-overview.js，只读面）。
// 形状契约见该路由注释；本模块只做拉取与形状归一，不解释 payload 语义。
// ============================================================

import { getApiPrefix } from '@/lib/env';

export interface WbOverviewTask {
  id: string;
  status: string;
  priority: number;
  /** 任务书：产物类型/验收标准恒在；标题类字段为后续 store 可选项（投影优先读它）。 */
  spec: {
    产物类型?: string;
    验收标准?: string[];
    计量?: Record<string, unknown>;
    咨询选项?: unknown;
    标题?: string;
    label?: string;
    title?: string;
  } | null;
  dependencies: string[];
  createdAt: string;
}

export interface WbOverviewGoal {
  id: string;
  description: string;
  budgetCny: number | null;
  status: string;
  acceptance: { 验收标准?: string[] } | null;
  tasks: WbOverviewTask[];
}

export interface WbOverview {
  ok: boolean;
  projectId: string;
  goals: WbOverviewGoal[];
}

export async function fetchWbOverview(projectId: string): Promise<WbOverview | null> {
  if (!projectId) return null;
  try {
    const response = await fetch(
      `${getApiPrefix()}/wb/overview?projectId=${encodeURIComponent(projectId)}`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const data: unknown = await response.json();
    if (!data || (data as WbOverview).ok !== true) return null;
    return data as WbOverview;
  } catch {
    return null;
  }
}
