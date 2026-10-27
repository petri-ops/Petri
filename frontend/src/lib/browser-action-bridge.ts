// ============================================================
// browser-action-bridge.ts — BLOCK-269（C-40 尾项）浏览器连接器前端执行器。
//
// 职责：把 event-bus 下发的 browser-action 落到 BrowserPanel 的 webview 上，
// 并把结果 POST 回 /api/browser-connector/action-result（resolve 后端 pending）。
// webview 调用经 WebviewActionBridge 注入（纯逻辑可测；组件只供 bridge）。
//
// 红线：executeJavaScript 参数全部 JSON.stringify 注入（零字符串拼接 selector）；
// read_text 有界（20k，与后端截断对齐）；失败如实回传（不假装操作成功）。
// ============================================================
import { getApiPrefix, getToken } from '@/lib/authClient';

export interface BrowserActionParams {
  action: string;
  url?: string;
  selector?: string;
  text?: string;
  ackToken?: string;
}

/** webview 最小执行面（BrowserPanel 注入；测试用 mock）。 */
export interface WebviewActionBridge {
  navigate(url: string): Promise<void>;
  executeJavaScript(code: string): Promise<unknown>;
  capturePage?(): Promise<{ size?: { width?: number; height?: number } }>;
}

export interface ActionResult {
  ok: boolean;
  result?: unknown;
  error?: string;
  message?: string;
}

export const READ_TEXT_LIMIT = 20_000;

export async function performBrowserAction(
  params: BrowserActionParams,
  bridge: WebviewActionBridge,
): Promise<ActionResult> {
  const { action } = params;
  try {
    if (action === 'navigate') {
      if (!params.url) return { ok: false, error: 'url_required' };
      await bridge.navigate(params.url);
      return { ok: true, result: { url: params.url } };
    }
    if (action === 'read_text') {
      const raw = await bridge.executeJavaScript('document.body ? String(document.body.innerText || "") : ""');
      const text = typeof raw === 'string' ? raw : '';
      if (text.length > READ_TEXT_LIMIT) {
        return { ok: true, result: { text: text.slice(0, READ_TEXT_LIMIT), truncated: true } };
      }
      return { ok: true, result: { text } };
    }
    if (action === 'click') {
      const outcome = await bridge.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(params.selector || '')});
        if (!el) return { found: false };
        el.click();
        return { found: true, clicked: true };
      })()`);
      const shape = outcome && typeof outcome === 'object' ? (outcome as { found?: boolean }) : null;
      if (!shape || shape.found !== true) return { ok: false, error: 'selector_not_found' };
      return { ok: true, result: { clicked: true } };
    }
    if (action === 'fill') {
      const valueJson = JSON.stringify(typeof params.text === 'string' ? params.text : '');
      const outcome = await bridge.executeJavaScript(`(() => {
        const el = document.querySelector(${JSON.stringify(params.selector || '')});
        if (!el) return { found: false };
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
          : el instanceof HTMLInputElement ? HTMLInputElement.prototype : null;
        if (!proto) return { found: true, filled: false, reason: 'not_input' };
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (!setter) return { found: true, filled: false, reason: 'no_setter' };
        setter.call(el, ${valueJson});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return { found: true, filled: true };
      })()`);
      const shape = outcome && typeof outcome === 'object' ? (outcome as { found?: boolean; filled?: boolean }) : null;
      if (!shape || shape.found !== true) return { ok: false, error: 'selector_not_found' };
      if (shape.filled !== true) return { ok: false, error: 'fill_rejected' };
      return { ok: true, result: { filled: true } };
    }
    if (action === 'screenshot') {
      if (typeof bridge.capturePage !== 'function') return { ok: false, error: 'capture_unavailable' };
      const shot = await bridge.capturePage();
      // 传输层约束：只回尺寸不回像素（与 helpers/browser-connector 对齐）
      const size = shot && shot.size ? shot.size : {};
      return {
        ok: true,
        result: { width: Number(size.width) || 0, height: Number(size.height) || 0, pixels: 'not_transferred' },
      };
    }
    return { ok: false, error: 'action_not_allowed' };
  } catch (error) {
    return { ok: false, error: 'webview_error', message: String(error instanceof Error ? error.message : error) };
  }
}

/** 回传结果到后端（resolve pending）；失败静默（后端超时兜底）。 */
export async function postActionResult(actionId: string, outcome: ActionResult): Promise<void> {
  try {
    const token = getToken();
    await fetch(getApiPrefix() + '/browser-connector/action-result', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: JSON.stringify({ actionId, ...outcome }),
    });
  } catch {
    /* 回传失败由后端 25s 超时兜底如实报 transport_timeout */
  }
}
