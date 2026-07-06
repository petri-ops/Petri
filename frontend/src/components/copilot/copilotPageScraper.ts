// ============================================================
// Page scraper — extracts main content + outline from current page.
// Runs on URL changes for docs/blog/figcode/home pages.
// ============================================================

import type { CopilotContext } from './copilotContext';

const MAX_CONTENT_CHARS = 4000;

/** Find the most plausible main content container. Prefers desktop SPA classes, then Docusaurus theme markers. */
function findMainElement(): HTMLElement | null {
  const selectors = [
    // 桌面版自渲染 docs（含 .biof3-docs-title + article.biof3-docs-content）
    '.biof3-docs-main',
    '.biof3-docs-content',
    // Docusaurus theme markers（Web 版，保留兼容）
    'article',
    '[class*="docMainContainer"] article',
    '[class*="docItemContainer"]',
    '[class*="blogPostContainer"]',
    'main article',
    'main',
  ];
  for (const sel of selectors) {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (el && el.innerText && el.innerText.trim().length > 200) {
      return el;
    }
  }
  return null;
}

function collectOutline(root: HTMLElement): string[] {
  const headings = Array.from(root.querySelectorAll('h1, h2, h3'));
  return headings
    .map((h) => {
      const lvl = parseInt(h.tagName.slice(1), 10);
      const t = (h as HTMLElement).innerText.trim();
      if (!t) return null;
      const indent = '  '.repeat(Math.max(0, lvl - 1));
      return `${indent}${'#'.repeat(lvl)} ${t}`;
    })
    .filter((x): x is string => !!x)
    .slice(0, 30);
}

function extractText(root: HTMLElement): string {
  // Prefer innerText (respects display:none) then collapse whitespace
  let text = root.innerText || root.textContent || '';
  text = text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3}/g, '\n\n')
    .trim();
  if (text.length > MAX_CONTENT_CHARS) {
    text = text.slice(0, MAX_CONTENT_CHARS) + '\n\n…(后续内容已截断)';
  }
  return text;
}

/** Pick the heading currently nearest the top of the viewport. */
function findVisibleHeading(root: HTMLElement): string | undefined {
  const headings = Array.from(root.querySelectorAll('h1, h2, h3, h4')) as HTMLElement[];
  if (headings.length === 0) return undefined;
  const viewportTop = 80; // header height
  let best: HTMLElement | null = null;
  let bestTop = -Infinity;
  for (const h of headings) {
    const rect = h.getBoundingClientRect();
    if (rect.top <= viewportTop && rect.top > bestTop) {
      bestTop = rect.top;
      best = h;
    }
  }
  if (!best) {
    // Nothing above fold — pick the first below
    const below = headings.find((h) => h.getBoundingClientRect().top > viewportTop);
    return below?.innerText.trim();
  }
  return best.innerText.trim();
}

/** Try to read code content from a Monaco / CodeMirror / textarea editor. */
function _findEditorCode(): string | undefined {
  // Monaco
  const monaco = document.querySelector('.monaco-editor');
  if (monaco) {
    const lines = monaco.querySelectorAll('.view-line');
    if (lines.length > 0) {
      const txt = Array.from(lines)
        .map((l) => (l as HTMLElement).innerText)
        .join('\n');
      if (txt.trim().length > 0) return txt.slice(0, MAX_CONTENT_CHARS);
    }
  }
  // CodeMirror 6
  const cm = document.querySelector('.cm-content');
  if (cm) {
    const txt = (cm as HTMLElement).innerText;
    if (txt.trim().length > 0) return txt.slice(0, MAX_CONTENT_CHARS);
  }
  // Generic <pre><code>
  const pre = document.querySelector('main pre code, article pre code');
  if (pre) {
    const txt = (pre as HTMLElement).innerText;
    if (txt.trim().length > 100) return txt.slice(0, MAX_CONTENT_CHARS);
  }
  // Plain textarea
  const ta = document.querySelector(
    'textarea[data-figcode], main textarea, article textarea'
  ) as HTMLTextAreaElement | null;
  if (ta && ta.value && ta.value.trim().length > 0) return ta.value.slice(0, MAX_CONTENT_CHARS);
  return undefined;
}

/**
 * Scrape current page and return what's relevant for the given page kind.
 */
export function scrapePage(page: CopilotContext['page']): Partial<CopilotContext> {
  if (typeof window === 'undefined' || typeof document === 'undefined') return {};
  const out: Partial<CopilotContext> = { pageUrl: window.location.href, pageTitle: document.title };

  if (page === 'docs' || page === 'blog' || page === 'home') {
    const root = findMainElement();
    if (root) {
      out.pageOutline = collectOutline(root);
      out.pageContent = extractText(root);
      out.visibleHeading = findVisibleHeading(root);
    }
  }
  // figcode and single-cell pages set their context imperatively from React,
  // no DOM scraping (avoids overwriting React-driven state).
  return out;
}

/** Get currently selected text (for "ask about this selection" feature). */
export function getSelectionText(): string {
  if (typeof window === 'undefined') return '';
  const sel = window.getSelection?.();
  if (!sel) return '';
  return sel.toString().trim();
}
