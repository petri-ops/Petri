import * as React from 'react';
import { getApiPrefix, getToken } from '@/lib/authClient';
import { petriEvents, type UiActionRequestDetail } from '@/lib/events';
import type { PackUiActionDescriptor, WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import {
  dispatchWorkSurfaceUiAction,
  WORK_SURFACE_UI_ACTION_RESULT_EVENT,
  type WorkSurfaceUiActionResultDetail,
} from '@/lib/workSurface/uiActionBus';

const UI_ACTION_RESULT_TIMEOUT_MS = 4500;
let requestSeq = 0;

async function ackAct(ackToken: string, body: Record<string, unknown>): Promise<void> {
  if (!ackToken) return;
  try {
    await fetch(`${getApiPrefix()}/ai/act-ack/${encodeURIComponent(ackToken)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
  } catch { /* ack 失败不阻塞 UI；后端超时会如实回传 */ }
}

/**
 * BLOCK-217 — act(ui_action) → Q5 pack surface host 的唯一分发点。
 * 只接受已注册、指向 pack view 的动作；打开目标 surface 后经窗口事件送到
 * PackSurfaceFrame，等 iframe 结果回来再 POST act-ack。超时/未知动作都如实失败。
 */
export function useUiActionHost({
  uiActions,
  openRightPanel,
  descriptorFor,
}: {
  uiActions: readonly PackUiActionDescriptor[];
  openRightPanel: (surfaceId: string) => void;
  descriptorFor: (surfaceId: string) => WorkSurfaceDescriptor | undefined;
}): void {
  const pendingRef = React.useRef(new Map<string, { ackToken: string; timer: number }>());

  React.useEffect(() => {
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent<UiActionRequestDetail>).detail;
      if (!detail?.actionId || !detail.ackToken) return;
      const action = uiActions.find((candidate) => candidate.id === detail.actionId);
      const surface = action?.surfaceId ? descriptorFor(action.surfaceId) : undefined;
      if (!action || !action.surfaceId || surface?.kind !== 'pack-view') {
        void ackAct(detail.ackToken, {
          ok: false,
          info: { error: 'ui_action_not_available', message: '没有可用的 pack 视图承载该动作' },
        });
        return;
      }
      const requestId = `ui_${Date.now()}_${++requestSeq}`;
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        void ackAct(detail.ackToken, {
          ok: false,
          info: { error: 'ui_action_timeout', message: 'pack 视图未在时限内响应' },
        });
      }, UI_ACTION_RESULT_TIMEOUT_MS);
      pendingRef.current.set(requestId, { ackToken: detail.ackToken, timer });
      openRightPanel(action.surfaceId);
      dispatchWorkSurfaceUiAction({
        actionId: action.id,
        payload: detail.payload ?? {},
        requestId,
      });
    };

    const onResult = (event: Event) => {
      const detail = (event as CustomEvent<WorkSurfaceUiActionResultDetail>).detail;
      if (!detail?.requestId) return;
      const pending = pendingRef.current.get(detail.requestId);
      if (!pending) return;
      pendingRef.current.delete(detail.requestId);
      window.clearTimeout(pending.timer);
      void ackAct(pending.ackToken, {
        ok: detail.ok === true,
        info: {
          ...(typeof detail.message === 'string' ? { message: detail.message.slice(0, 500) } : {}),
        },
      });
    };

    window.addEventListener(petriEvents.uiActionRequest, onRequest);
    window.addEventListener(WORK_SURFACE_UI_ACTION_RESULT_EVENT, onResult);
    return () => {
      window.removeEventListener(petriEvents.uiActionRequest, onRequest);
      window.removeEventListener(WORK_SURFACE_UI_ACTION_RESULT_EVENT, onResult);
      for (const pending of pendingRef.current.values()) window.clearTimeout(pending.timer);
      pendingRef.current.clear();
    };
  }, [descriptorFor, openRightPanel, uiActions]);
}
