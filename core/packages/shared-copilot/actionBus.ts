// ============================================================
// Copilot action bus — decouples Copilot UI from app pages
//
// The single-cell app subscribes here; when Copilot fires an action card,
// the app handles it (open modal, navigate, etc.) without Copilot needing
// to import any page-specific code.
// ============================================================

import { errMsg } from './error';
import type { CopilotAction } from './actions';

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

type Handler = (action: CopilotAction) => Promise<ActionResult> | ActionResult;

let handler: Handler | null = null;


export async function dispatchAction(action: CopilotAction): Promise<ActionResult> {
  // Universal handlers (work without page registration)
  if (action.type === 'external_link') {
    try {
      let url = String(action.url || '').trim();
      if (!url) return { ok: false, error: '缺少 URL' };

      // Sanity: AI sometimes gives '#/figcode' or 'petri.com/figcode' or other malformed URLs.
      // Try to normalize to either an absolute https URL or a leading-slash site path.
      if (url.startsWith('#/')) {
        // Treat #/foo as /foo (likely AI confused single-cell hash routes with site paths)
        url = url.replace(/^#\//, '/');
      } else if (url.startsWith('petri.com/') || url.startsWith('www.petri.com/')) {
        url = 'https://' + url;
      } else if (!url.startsWith('http') && !url.startsWith('/') && !url.startsWith('mailto:')) {
        // Bare path like 'figcode' → assume site-relative
        url = '/' + url;
      }

      const isExternal = /^https?:\/\//i.test(url) && !url.startsWith(window.location.origin);
      if (isExternal) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return { ok: true, message: '已在新标签页打开' };
      } else {
        // Same-origin: if URL is fully qualified, strip the origin so we get a relative path
        const sameOrigin = url.startsWith(window.location.origin)
          ? url.slice(window.location.origin.length)
          : url;
        window.location.href = sameOrigin;
        return { ok: true, message: '已跳转' };
      }
    } catch (e: unknown) {
      return { ok: false, error: errMsg(e) || '打开失败' };
    }
  }
  if (action.type === 'navigate') {
    try {
      const { target, id } = action;
      // If target looks like a URL/path, just navigate there directly
      if (typeof target === 'string' && (target.startsWith('/') || target.startsWith('http'))) {
        const isExternal =
          /^https?:\/\//.test(target) && !target.startsWith(window.location.origin);
        if (isExternal) {
          window.open(target, '_blank', 'noopener,noreferrer');
        } else {
          window.location.href = target;
        }
        return { ok: true, message: '已跳转' };
      }
      // Otherwise map to single-cell internal hash routes
      let hash = '#/';
      if (target === 'dataset' && id) hash = `#/dataset/${id}`;
      else if (target === 'result' && id) hash = `#/result/${id}`;
      else if (target === 'project' && id) hash = `#/project/${id}`;
      else hash = '#/';
      const path = window.location.pathname;
      if (path.startsWith('/single-cell')) {
        window.location.hash = hash;
      } else {
        window.location.href = '/single-cell/' + hash;
      }
      return { ok: true, message: '已跳转' };
    } catch (e: unknown) {
      return { ok: false, error: errMsg(e) || '跳转失败' };
    }
  }

  // Page-specific handlers
  if (handler) {
    try {
      return await handler(action);
    } catch (e: unknown) {
      return { ok: false, error: errMsg(e) || '执行失败' };
    }
  }
  return { ok: false, error: '当前页面不支持此操作。请进入对应页面后再试。' };
}
