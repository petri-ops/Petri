// ============================================================
// Copilot Act Registry — Bootstrap & built-in handlers.
//
// This module is imported by `src/theme/Root.tsx` so its registrations
// take effect on every page.
//
// Adding a new AI-callable action is now ONE-STEP:
//
//     import {registerCopilotAct} from './copilotActRegistry';
//     registerCopilotAct({
//       id: 'export_dataset_csv',
//       description: 'Download the active dataset as CSV',
//       pages: ['single-cell-dataset'],
//       payloadSchema: {
//         filename: {type: 'string', description: '可选：文件名', required: false},
//       },
//       handler: ({filename}) => {
//         document.querySelector<HTMLButtonElement>('#export-csv-btn')?.click();
//       },
//     });
//
// The AI will see this in `discover_capabilities` next session and
// can call it through `act_generic` — no server-side patches needed.
// ============================================================

import { errMsg } from '@/lib/error';
import { registerCopilotAct, uploadActRegistry } from './copilotActRegistry';

// ============================================================
// Built-in / demo handlers
// ============================================================

/**
 * Example 1 — scroll the page to a heading or selector.
 * Useful when AI wants to focus user's attention on a specific section.
 */
registerCopilotAct({
  id: 'scroll_to_heading',
  description:
    '滚动当前页面到指定标题或 CSS 选择器位置（带平滑动画）。当用户问"在哪里能看到 X" 而 X 在当前页时优先用这个，比写一段长解释更直观。',
  pages: '*',
  payloadSchema: {
    selector: {
      type: 'string',
      description:
        'CSS 选择器 (如 "#my-section" 或 "h2[id=foo]")，或者直接是标题文本（会做模糊匹配）',
      required: true,
    },
  },
  example: { selector: '#troubleshooting' },
  handler: ({ selector }) => {
    if (!selector || typeof selector !== 'string') return { error: 'missing selector' };
    let el: HTMLElement | null = null;
    try {
      el = document.querySelector<HTMLElement>(selector);
    } catch {}
    if (!el) {
      // Fuzzy match by heading text
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4'));
      const t = selector.toLowerCase();
      el =
        (headings.find((h) => (h.textContent || '').toLowerCase().includes(t)) as HTMLElement) ||
        null;
    }
    if (!el) return { error: 'not found: ' + selector };
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.style.transition = 'background 0.4s';
    el.style.background = 'rgba(16, 185, 129, 0.18)';
    setTimeout(() => {
      try {
        el!.style.background = '';
      } catch {}
    }, 1400);
    return { ok: true };
  },
});

/**
 * Example 2 — copy text to clipboard.
 * Useful for "把这段命令复制到剪贴板"-style requests.
 */
registerCopilotAct({
  id: 'copy_to_clipboard',
  description: '把一段文本复制到用户剪贴板。适合"把这段命令复制给我"的请求。',
  pages: '*',
  payloadSchema: {
    text: { type: 'string', description: '要复制的文本内容', required: true },
    note: { type: 'string', description: '可选：复制后给用户的提示文字', required: false },
  },
  example: { text: 'pip install scanpy', note: '已复制 scanpy 安装命令' },
  handler: async ({ text, note }) => {
    if (!text || typeof text !== 'string') return { error: 'missing text' };
    try {
      await navigator.clipboard.writeText(text);
      // Lightweight toast
      const div = document.createElement('div');
      div.textContent = note || '已复制到剪贴板';
      div.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 2200);
      return { ok: true };
    } catch (e: unknown) {
      return { error: 'clipboard_blocked: ' + (errMsg(e) || 'unknown') };
    }
  },
});

/**
 * Example 3 — toggle dark/light theme.
 */
registerCopilotAct({
  id: 'toggle_theme',
  description: '切换深色/浅色主题。当用户说"太亮了"或"切换主题"时调用。',
  pages: '*',
  payloadSchema: {
    mode: {
      type: 'string',
      description: '"dark" / "light" / "auto"（自动反向切）',
      required: false,
    },
  },
  example: { mode: 'auto' },
  handler: ({ mode }) => {
    const html = document.documentElement;
    const cur = html.getAttribute('data-theme') || 'light';
    let next: string;
    if (mode === 'dark' || mode === 'light') next = mode;
    else next = cur === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {}
    return { ok: true };
  },
});

/**
 * Example 4 — share the current page (copy deep link with anchor).
 * Useful when user wants to send "look at this view" to a colleague.
 */
registerCopilotAct({
  id: 'share_current_view',
  description: '复制当前页面的完整 URL（含 hash 锚点）到剪贴板，方便分享给同事。',
  pages: '*',
  payloadSchema: {
    note: { type: 'string', description: '可选：toast 文字', required: false },
  },
  example: { note: '已复制当前视图链接' },
  handler: async ({ note }) => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      const div = document.createElement('div');
      div.textContent = note || '已复制当前视图链接';
      div.style.cssText =
        'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99999;box-shadow:0 4px 12px rgba(0,0,0,0.15)';
      document.body.appendChild(div);
      setTimeout(() => div.remove(), 2200);
      return { ok: true };
    } catch (e: unknown) {
      return { error: 'clipboard_blocked: ' + (errMsg(e) || 'unknown') };
    }
  },
});

/**
 * Example 5 — open new-analysis modal directly on the dataset page.
 * This is real workflow: user says "我想开始 UMAP 分析", AI navigates if needed
 * then fires this to skip clicking around.
 */
registerCopilotAct({
  id: 'open_new_analysis_modal',
  description:
    '在数据集页面直接打开"新建分析"对话框。用户说"想做 X 分析"或"开始一个 UMAP / DEG 分析"等，且当前在数据集页时调用。可以预填分析类型。',
  pages: ['single-cell-dataset'],
  payloadSchema: {
    defaultType: {
      type: 'string',
      description:
        '可选：预选分析类型，如 "scrna_standard" / "umap" / "deg" / "annotation" / "cellchat"',
      required: false,
    },
    parentAnalysisId: {
      type: 'string',
      description: '可选：父分析 id，用于子分析（如基于上游 standard 跑 DEG）',
      required: false,
    },
  },
  example: { defaultType: 'scrna_standard' },
  handler: ({ defaultType, parentAnalysisId }) => {
    try {
      window.dispatchEvent(
        new CustomEvent('biof3:open-new-analysis', {
          detail: { defaultType, parentAnalysisId },
        })
      );
      return { ok: true };
    } catch (e: unknown) {
      return { error: errMsg(e) || 'dispatch failed' };
    }
  },
});

/**
 * Example 6 — take user to top of page.
 * Tiny but commonly requested when scrolled deep.
 */
registerCopilotAct({
  id: 'scroll_to_top',
  description: '滚动到当前页面顶部。用户说"回到顶部"或迷失在长文档时使用。',
  pages: '*',
  payloadSchema: {},
  example: {},
  handler: () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return { ok: true };
  },
});

// ============================================================
// Auto-upload registry to server on app boot (and again later).
// ============================================================
if (typeof window !== 'undefined') {
  // Defer to next tick so other modules can register first
  setTimeout(() => {
    uploadActRegistry().catch(() => {
      /* ignore */
    });
  }, 1500);
  // Refresh every 30 minutes (handles login/logout, new tabs)
  setInterval(
    () => {
      uploadActRegistry().catch(() => {
        /* ignore */
      });
    },
    30 * 60 * 1000
  );
}
