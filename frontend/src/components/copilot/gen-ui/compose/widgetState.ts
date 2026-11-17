/**
 * frontend/src/components/copilot/gen-ui/compose/widgetState.ts
 *
 * BLOCK-461 [W11 P2] ComposeCard 的 widgetState 通道——复用既有
 * `/api/gen-ui/widget-state` REST（gen_ui_widget_state 单一存储，不建第二持久化）；
 * 上限 16KiB 沿既有 cap（src/ipc/gen-ui.js 同值）。前端走 getApiPrefix 惯例
 *（沿 annotation-client 的 fetch 形态；服务端裁决为准）。
 */

import { getApiPrefix, getToken } from '@/lib/authClient';

/** 与既有 gen_ui_widget_state 16KiB cap 同值（src/ipc/gen-ui.js / routes/gen-ui.js）。 */
export const WIDGET_STATE_MAX_BYTES = 16 * 1024;

export interface WidgetStateResult {
  ok: boolean;
  state?: Record<string, unknown>;
  code?: string;
}

function stateBytes(state: Record<string, unknown>): number {
  return new TextEncoder().encode(JSON.stringify(state)).length;
}

export async function loadWidgetState({ scopeKey, filePath }: { scopeKey: string; filePath: string }): Promise<WidgetStateResult> {
  try {
    const query = new URLSearchParams({ scopeKey, filePath });
    const response = await fetch(`${getApiPrefix()}/gen-ui/widget-state?${query.toString()}`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const body = (await response.json()) as { ok?: boolean; state?: Record<string, unknown>; code?: string };
    if (!response.ok || !body.ok) return { ok: false, code: body.code ?? `http_${response.status}` };
    return { ok: true, state: body.state ?? {} };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : String(error) };
  }
}

export async function saveWidgetState({ scopeKey, filePath, state }: { scopeKey: string; filePath: string; state: Record<string, unknown> }): Promise<WidgetStateResult> {
  // 16KiB cap 前置拦截（fail-closed：超限不发请求，调用侧如实降级）
  if (stateBytes(state) > WIDGET_STATE_MAX_BYTES) {
    return { ok: false, code: 'state-too-large' };
  }
  try {
    const response = await fetch(`${getApiPrefix()}/gen-ui/widget-state`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ scopeKey, filePath, state }),
    });
    const body = (await response.json()) as { ok?: boolean; code?: string };
    if (!response.ok || !body.ok) return { ok: false, code: body.code ?? `http_${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : String(error) };
  }
}
