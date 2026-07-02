// ============================================================
// Copilot — site-wide floating AI assistant
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useEffect, useRef, useState, useCallback } from 'react';
import useBaseUrl from '@docusaurus/useBaseUrl';
import { streamChat, type ChatMessage, ackAct, getApiPrefix } from './copilotClient';
import {
  addTrace,
  clearTrace,
  subscribeTrace,
  formatTraceForCopy,
  type TraceEntry,
} from './copilotTrace';
import {
  listConversations,
  getConversationMessages,
  dismissTopicShift,
  type ConversationSummary,
} from './copilotConversationsClient';
import {
  detectPageFromUrl,
  getCopilotContext,
  setCopilotContext,
  subscribeCopilotContext,
  type CopilotContext,
} from './copilotContext';
import { CopilotMarkdown } from './copilotMarkdown';
import { parseActionsFromMarkdown } from './copilotActions';
import { ActResultCard, type ActExecution } from './ActResultCard';
import { scrapePage } from './copilotPageScraper';
import { fetchSummary, type SummaryInfo } from './copilotSummaryClient';
import { fetchRecentAgentActs } from './copilotPrivacyClient';
import { MemoryPanel } from './MemoryPanel';
import { invokeCopilotAct } from './copilotActRegistry';
import { listPlans } from './copilotPlansClient';
import PlanInlineCard from './PlanInlineCard';
import { Icon } from '@site/src/components/icons/Icon';

// Extracted types and helpers
import type { UIMessage, AgentStep } from './copilotTypes';
import { THREAD_KEY, OPEN_KEY } from './copilotTypes';
import {
  migrateLegacyHistory,
  loadHistory,
  saveHistory,
  buildMessageMetaTag,
  welcomeFor,
  QUICK_PROMPTS,
  contextLabel,
  truncate,
  pageBadgeLabel,
} from './copilotHelpers';

// (Types and helpers moved to copilotTypes.ts and copilotHelpers.ts)

export function CopilotChat(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [ctx, setCtx] = useState<CopilotContext>(() => getCopilotContext());
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  // MULTIMODAL_v1 — images pasted/attached for the next message (OSS urls).
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [imgUploading, setImgUploading] = useState(false);
  // Lightbox: enlarged preview of a sent image (click thumbnail to open).
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLightbox(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox]);
  const [streaming, setStreaming] = useState(false);
  const [_summary, setSummary] = useState<SummaryInfo | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [panelOpacitySetting, setPanelOpacitySetting] = useState<number>(() => {
    if (typeof window === 'undefined') return 1;
    const saved = localStorage.getItem('biof3-copilot-opacity');
    return saved ? parseFloat(saved) : 1;
  });
  const [showOpacitySlider, setShowOpacitySlider] = useState(false);
  const [trace, setTrace] = useState<TraceEntry[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem('biof3_copilot_active_conv');
    } catch {
      return null;
    }
  });
  const [activeConvTitle, setActiveConvTitle] = useState<string>('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [showConvDropdown, setShowConvDropdown] = useState(false);
  const [topicShiftHint, setTopicShiftHint] = useState<{
    conversationId: string;
    reason: string;
  } | null>(null);
  // PLAN_INLINE_v1 — track active plan id and bump key to refresh card
  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const [planRefreshKey, setPlanRefreshKey] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number }>(() => {
    if (typeof window === 'undefined') return { w: 420, h: 620 };
    try {
      const raw = localStorage.getItem('biof3_copilot_size');
      if (raw) {
        const s = JSON.parse(raw);
        if (s && typeof s.w === 'number' && typeof s.h === 'number') return s;
      }
    } catch {}
    return { w: 420, h: 620 };
  });
  // Position offsets from the *right* / *top* of the viewport, in pixels.
  // Default mirrors the "right edge, vertically centered" anchor.
  const [panelPos, setPanelPos] = useState<{ right: number; top: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('biof3_copilot_panel_pos');
      if (raw) {
        const p = JSON.parse(raw);
        // 边界 clamp：panel 至少 360x380，留 80px 余量。超出视口视为无效残留。
        if (
          p &&
          typeof p.right === 'number' &&
          typeof p.top === 'number' &&
          p.right < window.innerWidth - 80 &&
          p.top < window.innerHeight - 80 &&
          p.right >= -10 &&
          p.top >= -10
        ) {
          return p;
        }
      }
    } catch {}
    return null;
  });
  const [fabPos, setFabPos] = useState<{ right: number; top: number } | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem('biof3_copilot_fab_pos');
      if (raw) {
        const p = JSON.parse(raw);
        if (
          p &&
          typeof p.right === 'number' &&
          typeof p.top === 'number' &&
          // 边界 clamp：FAB 52x52，至少留 60px 余量。超出当前视口视为无效残留
          // （比如窗口缩小后旧坐标跑到屏外），丢弃回默认位置。
          p.right < window.innerWidth - 60 &&
          p.top < window.innerHeight - 60 &&
          p.right >= -10 &&
          p.top >= -10
        ) {
          return p;
        }
      }
    } catch {}
    return null;
  });
  // DOCK_MODE_v1 — when docked, panel becomes a full-height right column and
  // pushes page content left. Persisted so it survives reloads.
  const [docked, setDocked] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('biof3_copilot_docked') === '1';
    } catch {
      return false;
    }
  });
  // While dragging the panel near the right edge, show a dock-zone hint.
  const [dockHint, setDockHint] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeStart = useRef<{
    x: number;
    y: number;
    w: number;
    h: number;
    mode: 'left' | 'corner-tl' | 'corner-bl';
  } | null>(null);
  const dragStart = useRef<{
    x: number;
    y: number;
    right: number;
    top: number;
    target: 'fab' | 'panel';
  } | null>(null);
  const fabHadDragRef = useRef(false); // suppress click-after-drag
  const seenUndoTokens = useRef<Set<string>>(new Set());
  /** Terminal-style input history (↑/↓ in textarea). */
  const inputHistoryRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const historyDraftRef = useRef('');
  const logoUrl = useBaseUrl('/img/biof3-favicon.png');

  // Restore open state
  useEffect(() => {
    try {
      setOpen(localStorage.getItem(OPEN_KEY) === '1');
    } catch {}
  }, []);

  // DOCK_MODE_v1 — reflect docked state onto <body> so global CSS can push the
  // page content left. Only active while the panel is open + docked. Always
  // cleans up on unmount / when undocked / closed.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const active = open && docked;
    document.body.classList.toggle('biof3-copilot-docked', active);
    if (active) {
      document.body.style.setProperty('--biof3-dock-width', size.w + 'px');
    }
    try {
      localStorage.setItem('biof3_copilot_docked', docked ? '1' : '0');
    } catch {}
    return () => {
      // On effect cleanup we don't unconditionally remove — the next run sets it
      // correctly. But on unmount, ensure we don't leave the page shifted.
    };
  }, [open, docked, size.w]);

  // Safety: remove the body shift if the component unmounts entirely.
  useEffect(() => {
    return () => {
      if (typeof document !== 'undefined') {
        document.body.classList.remove('biof3-copilot-docked');
      }
    };
  }, []);

  // Subscribe to trace ring buffer for debug overlay
  useEffect(() => {
    return subscribeTrace((entries) => setTrace(entries));
  }, []);

  // Detect page from URL on mount + on URL changes
  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null;
    let scrapeTimer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const detected = detectPageFromUrl(window.location.href, document.title);
      const existing = getCopilotContext();
      // For non-React-driven pages we always re-detect (different URL = different content);
      // for SPAs whose React components imperatively push context (single-cell + figcode),
      // preserve fields when on same family — React will refresh them.
      const sameFamily = existing.page === detected.page;
      // W3-C: spatial-* are also React-driven (mirrors single-cell SPA pattern)
      const isReactDriven =
        detected.page.startsWith('single-cell-') ||
        detected.page.startsWith('spatial-') ||
        detected.page === 'figcode';
      const merged: CopilotContext =
        isReactDriven && sameFamily
          ? {
              ...existing,
              page: detected.page,
              pageTitle: detected.pageTitle ?? existing.pageTitle,
              pageUrl: window.location.href,
            }
          : {
              ...detected,
              pageUrl: window.location.href,
            };
      setCopilotContext(merged);
      setCtx(merged);

      // For docs/blog/home: scrape page content (debounced; DOM may not be ready yet).
      // figcode + single-cell are React-driven and self-publish via setCopilotContext.
      if (!isReactDriven) {
        if (scrapeTimer) clearTimeout(scrapeTimer);
        scrapeTimer = setTimeout(() => {
          const scraped = scrapePage(detected.page);
          if (Object.keys(scraped).length > 0) {
            setCopilotContext(scraped);
            setCtx({ ...getCopilotContext() });
          }
        }, 350);
      }
    };

    const onScroll = () => {
      // Update visibleHeading for docs/blog while user scrolls (debounced)
      const ctxNow = getCopilotContext();
      if (ctxNow.page !== 'docs' && ctxNow.page !== 'blog') return;
      if (scrollTimer) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const scraped = scrapePage(ctxNow.page);
        if (scraped.visibleHeading && scraped.visibleHeading !== ctxNow.visibleHeading) {
          setCopilotContext({ visibleHeading: scraped.visibleHeading });
          setCtx({ ...getCopilotContext() });
        }
      }, 200);
    };

    refresh();

    const onPop = () => refresh();
    const onHash = () => refresh();
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onHash);
    window.addEventListener('scroll', onScroll, { passive: true });

    // Note: we used to monkey-patch history.pushState / replaceState to detect
    // SPA navigations, but that fought with Docusaurus's react-router and caused
    // an infinite popstate loop on fragment URLs (e.g. /figcode/#xxx).
    // Now we rely on:
    //  - native 'popstate' (history.back / forward / SPA route changes via router)
    //  - native 'hashchange' (any #fragment change)
    //  - MutationObserver on <title> (catches Docusaurus title updates that don't
    //    fire popstate, e.g. when only metadata changes)
    // This covers all real navigation cases without breaking the router.

    // MutationObserver on <title> — Docusaurus updates title async via React side-effect
    const titleEl = document.querySelector('title');
    let titleObs: MutationObserver | null = null;
    if (titleEl) {
      titleObs = new MutationObserver(() => refresh());
      titleObs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }

    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('scroll', onScroll);
      if (titleObs) titleObs.disconnect();
      if (scrollTimer) clearTimeout(scrollTimer);
      if (scrapeTimer) clearTimeout(scrapeTimer);
    };
  }, []);

  // Subscribe to context changes pushed by single-cell views
  useEffect(() => {
    const unsub = subscribeCopilotContext((c) => setCtx({ ...c }));
    return unsub;
  }, []);

  // Load thread once on mount (also runs migration on first open)
  useEffect(() => {
    migrateLegacyHistory();
    setMessages(loadHistory());
  }, []);

  // Load conversation list when panel opens; also resolve activeConvId title
  useEffect(() => {
    if (!open) return;
    listConversations('active').then((arr) => {
      setConversations(arr);
      if (activeConvId) {
        const conv = arr.find((c) => c.id === activeConvId);
        if (conv) {
          setActiveConvTitle(conv.title);
          if (conv.last_topic_shift_reason && conv.last_topic_shift_at) {
            setTopicShiftHint({ conversationId: conv.id, reason: conv.last_topic_shift_reason });
          }
        } else {
          // Stale id (deleted / archived) — drop it
          setActiveConvId(null);
          setActiveConvTitle('');
        }
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Persist activeConvId
  useEffect(() => {
    try {
      if (activeConvId) localStorage.setItem('biof3_copilot_active_conv', activeConvId);
      else localStorage.removeItem('biof3_copilot_active_conv');
    } catch {}
  }, [activeConvId]);

  // PLAN_INLINE_v1 — when conversation changes (or on first open), fetch the
  // most recent active plan owned by this user. The server's plan tool keys
  // plans by user_id (not conversation_id directly), so we list and pick the
  // most-recently-updated active plan.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listPlans().then((arr) => {
      if (cancelled || !arr) return;
      const active = arr.find((p) => p.status === 'active' || p.status === 'paused');
      setActivePlanId(active ? active.id : null);
    });
    return () => {
      cancelled = true;
    };
  }, [open, activeConvId]);

  // Close conversation dropdown on outside click / Escape
  useEffect(() => {
    if (!showConvDropdown) return;
    const onDocClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (target.closest('.cp-conv-dropdown') || target.closest('.cp-conv-trigger')) return;
      setShowConvDropdown(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowConvDropdown(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [showConvDropdown]);

  // Auto-scroll to bottom when messages grow
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open]);

  // Persist open state + refresh summary when opened
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? '1' : '0');
    } catch {}
    if (open) {
      fetchSummary().then(setSummary);
    }
  }, [open]);

  // Listen for "Ask Copilot about this selection" events from the page tip
  useEffect(() => {
    const onAsk = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const selection: string = (detail.selection || '').trim();
      if (!selection) return;
      setOpen(true);
      // Compose a prompt referencing the selection
      const prompt = `针对当前页面我选中的这段内容，请帮我解释一下：\n\n> ${selection.replace(/\n/g, '\n> ')}`;
      // Pre-fill input so user can edit before sending, OR auto-send
      // We'll prefill + focus, let the user hit Enter (less intrusive than auto-send)
      setInput(prompt);
      setTimeout(() => {
        if (taRef.current) {
          taRef.current.focus();
          taRef.current.style.height = 'auto';
          taRef.current.style.height = Math.min(taRef.current.scrollHeight, 140) + 'px';
        }
      }, 80);
    };
    window.addEventListener('biof3:copilot-ask', onAsk as EventListener);
    return () => window.removeEventListener('biof3:copilot-ask', onAsk as EventListener);
  }, []);

  // STUDY_WITH_COPILOT_v1 — "🎓 让 AI 带我实战这一篇" entry point.
  // Frontmatter or DocItem footer fires this with the current doc's metadata
  // and the chat then opens + auto-sends a structured "tutor me" prompt.
  useEffect(() => {
    const onStudy = (e: Event) => {
      if (streaming) return;
      const detail = (e as CustomEvent).detail || {};
      const docTitle: string = String(detail.docTitle || '').trim();
      const docUrl: string = String(detail.docUrl || '').trim();
      const docSummary: string = String(detail.docSummary || '').trim();
      const docDomain: string = String(detail.docDomain || '').trim();
      const docMinutes: number | null =
        typeof detail.docMinutes === 'number' ? detail.docMinutes : null;
      if (!docTitle && !docUrl) return;
      setOpen(true);

      const lines: string[] = [];
      lines.push('我想认真把这一篇学下来，帮我制定学习计划。');
      lines.push('');
      lines.push(`篇目：${docTitle || '(无标题)'}`);
      if (docUrl) lines.push(`链接：${docUrl}`);
      if (docDomain) lines.push(`领域：${docDomain}`);
      if (docMinutes) lines.push(`预计耗时：${docMinutes} 分钟`);
      if (docSummary) {
        lines.push('');
        lines.push('正文摘要：');
        lines.push(docSummary.slice(0, 600));
      }
      lines.push('');
      lines.push('请按这个流程带我学：');
      lines.push('1) 先用 1-2 段话给我一个"为什么这一篇值得学"的导览');
      lines.push('2) 调用 plan 工具创建一个 3-5 步的学习计划');
      lines.push('3) 我每完成一步告诉你，你帮我对答案 / 给反馈');
      lines.push(
        `4) 全部完成后调用 verify_understanding({docUrl: "${docUrl}"}) 出 1-3 道理解题验证`
      );
      lines.push(
        '5) 我答完后，针对每个相关概念调一次 record_learning_signal({resource, concept, signal})；信号选 weak/moderate/strong'
      );
      lines.push('');
      lines.push('开始吧。');

      const prompt = lines.join('\n');
      setTimeout(() => {
        send(prompt);
      }, 60);
    };
    window.addEventListener('biof3:copilot-study', onStudy as EventListener);
    return () => window.removeEventListener('biof3:copilot-study', onStudy as EventListener);
    // send is recreated each render, but capturing stale isn't a problem here
    // because we always call the latest via the ref pattern of useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) => {
      const next = prev.map((m) => (m.pending ? { ...m, pending: false } : m));
      saveHistory(next);
      return next;
    });
    // After user-initiated stop, recover any acts that were committed but not surfaced
    setTimeout(() => recoverDroppedActs(), 500);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SSE-interrupt recovery — fetch recent audit and append acts we never received via SSE
  const recoverDroppedActs = useCallback(async () => {
    try {
      const items = await fetchRecentAgentActs();
      if (!items || items.length === 0) return;
      const now = Date.now();
      // Only consider acts from the last 60 seconds (current request scope)
      const recent = items.filter((it) => {
        const age = now - new Date(it.ts).getTime();
        return (
          age < 60_000 && !it.undone && it.undo_token && !seenUndoTokens.current.has(it.undo_token)
        );
      });
      if (recent.length === 0) return;
      // Append a recovered ActExecution to the latest assistant message
      const recovered: ActExecution[] = recent.map((it) => {
        seenUndoTokens.current.add(it.undo_token);
        return {
          actType: it.action,
          message: (it.result && it.result.message) || '已自动执行（SSE 断流后恢复）',
          undoToken: it.undo_token,
          // Allow undo for the remaining window — server caps at 30s, but the
          // act was committed at it.ts; compute precise expiry.
          undoableUntil: new Date(it.ts).getTime() + 30_000,
          analysisId: it.result && it.result.analysisId,
        };
      });
      setMessages((prev) => {
        const copy = prev.slice();
        const lastIdx = copy.length - 1;
        if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
          const acts = copy[lastIdx].acts || [];
          copy[lastIdx] = { ...copy[lastIdx], acts: [...acts, ...recovered] };
        }
        return copy;
      });
    } catch {}
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      const imgs = pendingImages;
      // Allow sending with only images (no text) when a multimodal model is on.
      if ((!trimmed && imgs.length === 0) || streaming) return;
      if (trimmed) {
        const h = inputHistoryRef.current;
        if (h[h.length - 1] !== trimmed) {
          h.push(trimmed);
          if (h.length > 80) h.shift();
        }
        historyIndexRef.current = -1;
        historyDraftRef.current = '';
      }
      setInput('');
      setPendingImages([]);
      if (taRef.current) taRef.current.style.height = 'auto';

      // Capture metadata for THIS message (not the conversation as a whole)
      const ctxNow = getCopilotContext();
      const meta: UIMessage['meta'] = {
        page: ctxNow.page,
        pageTitle: ctxNow.pageTitle,
        datasetId: ctxNow.datasetId,
        datasetName: ctxNow.datasetName,
        analysisId: ctxNow.analysisId,
        analysisName: ctxNow.analysisName,
        plotName: ctxNow.plotName,
        ts: new Date().toISOString(),
      };

      const userMsg: UIMessage = {
        role: 'user',
        content: trimmed,
        meta,
        ...(imgs.length ? { images: imgs } : {}),
      };
      const assistantMsg: UIMessage = { role: 'assistant', content: '', pending: true, meta };
      addTrace({ kind: 'user_msg', label: (trimmed || '[图片]').slice(0, 80), detail: meta.page });

      // Build upstream messages — for each prior message, prepend a metadata tag
      // so the LLM understands "用户在 X 页问的"
      const tagged: ChatMessage[] = messages
        .filter((m) => !m.error && !m.pending)
        .map((m) => {
          const tag = buildMessageMetaTag(m.meta);
          return {
            role: m.role,
            content: tag ? `${tag}\n${m.content}` : m.content,
            ...(m.images && m.images.length ? { images: m.images } : {}),
          };
        });
      const newUserTag = buildMessageMetaTag(meta);
      tagged.push({
        role: 'user',
        content: newUserTag ? `${newUserTag}\n${trimmed}` : trimmed,
        ...(imgs.length ? { images: imgs } : {}),
      });

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let acc = '';
      const stepsRef: AgentStep[] = [];
      const pushStep = (step: AgentStep) => {
        stepsRef.push(step);
        setMessages((prev) => {
          const copy = prev.slice();
          const lastIdx = copy.length - 1;
          if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
            copy[lastIdx] = { ...copy[lastIdx], steps: [...stepsRef] };
          }
          return copy;
        });
      };
      await streamChat({
        messages: tagged,
        context: ctxNow,
        conversationId: activeConvId || undefined,
        signal: ctrl.signal,
        onConversation: (info) => {
          if (info.conversationId && info.conversationId !== activeConvId) {
            setActiveConvId(info.conversationId);
          }
          if (info.title) setActiveConvTitle(info.title);
        },
        onTopicShift: (info) => {
          // Server thinks the user just pivoted topics; surface a banner with two options.
          setTopicShiftHint({ conversationId: info.conversationId, reason: info.reason });
        },
        onIter: () => {
          /* could show iteration counter */
        },
        onToolCall: (e) => {
          addTrace({
            kind: 'tool_call',
            label: e.name,
            detail: JSON.stringify(e.args).slice(0, 200),
          });
          pushStep({
            kind: 'tool_call',
            name: e.name,
            detail: JSON.stringify(e.args || {}),
            ts: Date.now(),
          });
        },
        onToolResult: (e) => {
          addTrace({
            kind: 'tool_result',
            label: (e.actType || e.name) + ': ' + (e.summary || ''),
            detail: e.message,
          });
          pushStep({
            kind: 'tool_result',
            name: e.name,
            detail: e.summary || '',
            ts: Date.now(),
          });
          // PLAN_INLINE_v1 — when LLM creates / updates a plan, surface it in chat.
          // Server sends structured planId field via SSE (preferred) but also
          // fall back to parsing message text in case backend doesn't propagate.
          if (e.name === 'plan') {
            if (e.planId) {
              setActivePlanId(e.planId);
            } else {
              // Fallback: parse from summary/message text
              const m = (e.summary || '') + ' ' + (e.message || '');
              const planMatch = m.match(/plan_[a-zA-Z0-9_-]+/);
              if (planMatch) setActivePlanId(planMatch[0]);
            }
            // Always bump refresh key so card re-fetches (covers update_step too)
            setPlanRefreshKey((k) => k + 1);
          }
          // If this was an act, append an ActExecution to the assistant message
          if (e.name === 'act' && e.actType) {
            const exec: ActExecution = {
              actType: e.actType,
              message: e.message,
              undoToken: e.undoToken,
              undoableUntil: e.undoableUntil,
              error: e.actError,
              analysisId: e.analysisId,
            };
            setMessages((prev) => {
              const copy = prev.slice();
              const lastIdx = copy.length - 1;
              if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
                const acts = copy[lastIdx].acts || [];
                copy[lastIdx] = { ...copy[lastIdx], acts: [...acts, exec] };
              }
              return copy;
            });

            // FIGCODE_ACT_v1: inject code into the figcode editor on the page
            if (e.actType === 'update_figcode_editor' && e.figcodeCode) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:figcode-replace-code', {
                    detail: { code: e.figcodeCode, autoRun: e.figcodeAutoRun !== false },
                  })
                );
              } catch {}
            }
            // SCRNA_UI_ACT_v1: control result-view UI
            if (e.actType === 'switch_result_tab' && e.scTab) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-switch-tab', { detail: { tab: e.scTab } })
                );
              } catch {}
            }
            if (e.actType === 'focus_cluster' && e.scCluster) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-focus-cluster', { detail: { cluster: e.scCluster } })
                );
              } catch {}
            }
            if (e.actType === 'highlight_gene' && e.scGene) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-highlight-gene', { detail: { gene: e.scGene } })
                );
              } catch {}
            }
            // SCRNA_DATA_ACT_v1: data ops (filter table, select cells, label, merge, replot, upload hint)
            if (e.actType === 'filter_table' && e.scColumnFilters) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:csvtable-filter', {
                    detail: { columnFilters: e.scColumnFilters },
                  })
                );
              } catch {}
            }
            if (e.actType === 'select_cells' && e.scColumnFilters) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:csvtable-filter', {
                    detail: { columnFilters: e.scColumnFilters },
                  })
                );
                if (e.scSubsetName) {
                  window.dispatchEvent(
                    new CustomEvent('biof3:sc-open-subset-modal', {
                      detail: { subsetName: e.scSubsetName },
                    })
                  );
                }
              } catch {}
            }
            if (e.actType === 'label_cells' && e.scLabelKey && e.scLabelValue) {
              try {
                if (e.scColumnFilters) {
                  window.dispatchEvent(
                    new CustomEvent('biof3:csvtable-filter', {
                      detail: { columnFilters: e.scColumnFilters },
                    })
                  );
                }
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-open-label-modal', {
                    detail: { labelKey: e.scLabelKey, labelValue: e.scLabelValue },
                  })
                );
              } catch {}
            }
            if (e.actType === 'merge_datasets' && e.scDatasetIds) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-merge-datasets', {
                    detail: { datasetIds: e.scDatasetIds, name: e.scMergeName },
                  })
                );
              } catch {}
            }
            if (e.actType === 'open_replot' && e.scOpenReplotForAnalysis) {
              try {
                window.dispatchEvent(
                  new CustomEvent('biof3:sc-open-replot', {
                    detail: { analysisId: e.scOpenReplotForAnalysis },
                  })
                );
              } catch {}
            }
            if (e.actType === 'upload_data_hint') {
              try {
                window.dispatchEvent(new CustomEvent('biof3:sc-upload-hint'));
              } catch {}
            }
            // TOOLS_ACT_v1: open a specific analysis tool
            if (e.actType === 'open_tool' && e.toolId) {
              try {
                const onToolsPage = window.location.pathname.startsWith('/tools');
                // KILLER_USE_CASE_1_v1 — pass autofill payload through
                const detail: unknown = { toolId: e.toolId };
                if (e.autofillFromJobId) {
                  detail.autofillFromJobId = e.autofillFromJobId;
                  detail.autofillSourceTool = e.autofillSourceTool;
                }
                if (onToolsPage) {
                  window.dispatchEvent(new CustomEvent('biof3:tools-open', { detail }));
                } else {
                  // Cross-page navigation. Stash autofill in sessionStorage so the
                  // tools page picks it up after route change. SessionStorage is
                  // ephemeral and tab-scoped, no leak risk.
                  if (e.autofillFromJobId) {
                    try {
                      sessionStorage.setItem('biof3_pending_tool_autofill', JSON.stringify(detail));
                    } catch {}
                  }
                  window.location.href = '/tools#' + e.toolId;
                }
              } catch {}
            }
            // OPEN_FIGCODE_PLOT_v1: jump to /figcode and auto-open the run modal of the card
            if (e.actType === 'open_figcode_plot' && e.figcardId) {
              try {
                const id = e.figcardId;
                const onFigcodePage = window.location.pathname.startsWith('/figcode');
                if (onFigcodePage) {
                  // already there — fire event directly
                  window.dispatchEvent(
                    new CustomEvent('biof3:figcode-open-run', { detail: { cardId: id } })
                  );
                } else {
                  // Stash intent + navigate. Page will pick it up on mount.
                  try {
                    sessionStorage.setItem('biof3_pending_figcode_open', id);
                  } catch {}
                  window.location.href = '/figcode#' + id;
                }
              } catch {}
            }
            // ACT_GENERIC_v1 — invoke registered handler dynamically
            if (e.actType === 'generic' && e.handlerId) {
              (async () => {
                const r = await invokeCopilotAct(e.handlerId!, e.payload || {});
                if (e.ackToken) {
                  ackAct(e.ackToken, r.ok ? { ok: true } : { error: r.error });
                  addTrace({
                    kind: 'ack',
                    label: 'generic:' + e.handlerId,
                    detail: r.ok ? 'ok' : 'err: ' + r.error,
                  });
                }
              })();
            }
            // Track this undoToken as 'seen' so we don't double-render on recovery
            if (e.undoToken) seenUndoTokens.current.add(e.undoToken);
            // ACT_ACK_v1 — confirm to server that the UI handler ran (within ~600ms window).
            // For frontend-side acts that we successfully dispatched above, the act fired.
            // We send ack regardless of which exact branch matched — the back end only cares
            // that the corresponding listener got the event.
            if (e.ackToken && e.actType !== 'generic') {
              // Slight delay to let the listener actually run before we ack (CustomEvent is sync, but
              // some handlers do setTimeout to wait for state).
              setTimeout(() => {
                ackAct(e.ackToken!, { ok: true });
                addTrace({ kind: 'ack', label: e.actType || e.name, detail: 'ok' });
              }, 50);
            }
          }
        },
        onDelta: (d) => {
          acc += d;
          setMessages((prev) => {
            const copy = prev.slice();
            const lastIdx = copy.length - 1;
            if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
              copy[lastIdx] = { ...copy[lastIdx], content: acc };
            }
            return copy;
          });
        },
        onDone: () => {
          setMessages((prev) => {
            const copy = prev.slice();
            const lastIdx = copy.length - 1;
            if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
              copy[lastIdx] = { ...copy[lastIdx], pending: false };
            }
            saveHistory(copy);
            return copy;
          });
          setStreaming(false);
          abortRef.current = null;
          // Background summarization may have happened — refetch after a delay
          setTimeout(() => {
            fetchSummary().then(setSummary);
          }, 8000);
          // Refresh conversations list (message_count + updated_at moved, possibly auto-titled)
          listConversations('active').then((arr) => {
            setConversations(arr);
            // Pick up server-side auto-title if it just landed
            const cur = arr.find((c) => c.id === activeConvId);
            if (cur && cur.title && cur.title !== activeConvTitle) {
              setActiveConvTitle(cur.title);
            }
          });
        },
        onError: (err) => {
          setMessages((prev) => {
            const copy = prev.slice();
            const lastIdx = copy.length - 1;
            if (lastIdx >= 0 && copy[lastIdx].role === 'assistant') {
              copy[lastIdx] = {
                ...copy[lastIdx],
                pending: false,
                error: err.message || '请求失败',
                content: copy[lastIdx].content || '',
              };
            }
            return copy;
          });
          setStreaming(false);
          abortRef.current = null;
          // Recovery: SSE may have dropped tool_result events while acts were already
          // committed server-side. Pull recent audit log and append any unseen ones.
          setTimeout(() => recoverDroppedActs(), 500);
        },
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, streaming, ctx, pendingImages]
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(input);
      return;
    }
    const hist = inputHistoryRef.current;
    if (e.key === 'ArrowUp' && !e.nativeEvent.isComposing) {
      if (hist.length === 0) return;
      e.preventDefault();
      if (historyIndexRef.current === -1) {
        historyDraftRef.current = input;
        historyIndexRef.current = hist.length - 1;
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current -= 1;
      }
      const next = hist[historyIndexRef.current] ?? '';
      setInput(next);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.style.height = 'auto';
          ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
          ta.setSelectionRange(next.length, next.length);
        }
      });
      return;
    }
    if (e.key === 'ArrowDown' && !e.nativeEvent.isComposing) {
      if (historyIndexRef.current === -1) return;
      e.preventDefault();
      if (historyIndexRef.current < hist.length - 1) {
        historyIndexRef.current += 1;
        const next = hist[historyIndexRef.current] ?? '';
        setInput(next);
        requestAnimationFrame(() => {
          const ta = taRef.current;
          if (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
            ta.setSelectionRange(next.length, next.length);
          }
        });
      } else {
        historyIndexRef.current = -1;
        const draft = historyDraftRef.current;
        setInput(draft);
        requestAnimationFrame(() => {
          const ta = taRef.current;
          if (ta) {
            ta.style.height = 'auto';
            ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
            ta.setSelectionRange(draft.length, draft.length);
          }
        });
      }
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const ta = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 140) + 'px';
  };

  // ---- MULTIMODAL_v1: image attach (paste / pick) → OSS, preview before send ----
  const MAX_IMAGES = 4;
  const uploadCopilotImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('图片不能超过 5MB');
      return;
    }
    setPendingImages((prev) => {
      if (prev.length >= MAX_IMAGES) {
        alert(`最多附 ${MAX_IMAGES} 张图片`);
        return prev;
      }
      return prev;
    });
    setImgUploading(true);
    try {
      const token =
        (typeof localStorage !== 'undefined' && localStorage.getItem('biof3_token')) || '';
      const fd = new FormData();
      fd.append('file', file);
      // Reuse the generic image→OSS endpoint (anonymous-OK, image-only, ≤5MB).
      const r = await fetch(getApiPrefix() + '/feedback/upload', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: fd,
      });
      const j = await r.json();
      if (j.status === 'ok' && j.url) {
        setPendingImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, j.url]));
      } else {
        alert(j.error || '图片上传失败');
      }
    } catch (e: unknown) {
      alert(errMsg(e) || '图片上传失败');
    } finally {
      setImgUploading(false);
    }
  }, []);

  const onInputPaste = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            e.preventDefault();
            void uploadCopilotImage(f);
          }
        }
      }
    },
    [uploadCopilotImage]
  );

  const clearHistory = () => {
    if (streaming) stop();
    setMessages([]);
    try {
      localStorage.removeItem(THREAD_KEY);
    } catch {}
  };

  // ---- Conversation switching ----
  const switchToConversation = useCallback(
    async (convId: string | null) => {
      if (streaming) stop();
      setShowConvDropdown(false);
      setTopicShiftHint(null);
      if (!convId) {
        // New conversation — clear local view; server will create one on next send
        setActiveConvId(null);
        setActiveConvTitle('');
        setMessages([]);
        try {
          localStorage.removeItem(THREAD_KEY);
        } catch {}
        return;
      }
      setActiveConvId(convId);
      const conv = conversations.find((c) => c.id === convId);
      if (conv) setActiveConvTitle(conv.title);
      // Load this conversation's messages from server
      const msgs = await getConversationMessages(convId, 200);
      const ui = msgs.map(
        (m): UIMessage => ({
          role: m.role === 'system' ? 'assistant' : (m.role as 'user' | 'assistant'),
          content: m.content,
          meta: m.meta
            ? {
                page: m.meta.page,
                pageTitle: m.meta.pageTitle,
                datasetId: m.meta.datasetId,
                analysisId: m.meta.analysisId,
                ts: m.ts,
              }
            : { ts: m.ts },
          // MULTIMODAL_v1: restore attached images persisted in the message meta.
          ...(m.meta && Array.isArray(m.meta.images) && m.meta.images.length
            ? { images: m.meta.images }
            : {}),
          autoActionsFired: true, // historical messages — never re-trigger
        })
      );
      setMessages(ui);
      saveHistory(ui);
    },
    [streaming, conversations, stop]
  );

  const startNewConversation = useCallback(async () => {
    if (streaming) stop();
    setShowConvDropdown(false);
    setTopicShiftHint(null);
    // Clear local state; the server will lazily create a new conv on next send
    setActiveConvId(null);
    setActiveConvTitle('');
    setMessages([]);
    try {
      localStorage.removeItem(THREAD_KEY);
    } catch {}
  }, [streaming, stop]);

  // ---- Drag handlers (move FAB / panel) ----
  const onDragStart = (target: 'fab' | 'panel') => (e: React.MouseEvent) => {
    // For FAB, only the button itself; for panel, only the header (set up below).
    e.preventDefault();
    // DOCK_MODE_v1: grabbing the docked panel's header pops it back to floating,
    // anchored near the right edge so the drag feels continuous.
    if (target === 'panel' && docked) {
      setDocked(false);
      setPanelPos({ right: 16, top: Math.max(0, Math.round((window.innerHeight - size.h) / 2)) });
    }
    const currentRight =
      target === 'fab' ? (fabPos?.right ?? 16) : docked ? 0 : (panelPos?.right ?? 16);
    const currentTop =
      target === 'fab'
        ? (fabPos?.top ?? Math.round(window.innerHeight / 2 - 26))
        : (panelPos?.top ?? Math.round((window.innerHeight - size.h) / 2));
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      right: currentRight,
      top: currentTop,
      target,
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'grabbing';
    if (target === 'fab') fabHadDragRef.current = false;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const ds = dragStart.current;
      if (!ds) return;
      const dx = ds.x - e.clientX; // moving cursor left → right offset increases
      const dy = e.clientY - ds.y; // moving cursor down → top increases
      const w = ds.target === 'fab' ? 52 : size.w;
      const h = ds.target === 'fab' ? 52 : size.h;
      const newRight = Math.max(0, Math.min(window.innerWidth - w, ds.right + dx));
      const newTop = Math.max(0, Math.min(window.innerHeight - h, ds.top + dy));
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        if (ds.target === 'fab') fabHadDragRef.current = true;
      }
      // DOCK_MODE_v1: panel OR collapsed FAB can dock — show hint when the
      // cursor is near the right edge on a wide screen.
      if (ds.target === 'panel' || ds.target === 'fab') {
        const cursorNearEdge = window.innerWidth - e.clientX <= 60;
        setDockHint(cursorNearEdge && window.innerWidth >= 997);
      }
      if (ds.target === 'fab') setFabPos({ right: newRight, top: newTop });
      else setPanelPos({ right: newRight, top: newTop });
    };
    const onUp = (e: MouseEvent) => {
      const ds = dragStart.current;
      if (!ds) return;
      dragStart.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      // DOCK_MODE_v1: if a panel OR collapsed-FAB drag ended near the right edge
      // on a wide screen, snap into docked side-column mode.
      if (ds.target === 'panel' || ds.target === 'fab') {
        const releasedNearEdge = window.innerWidth - e.clientX <= 60;
        if (releasedNearEdge && window.innerWidth >= 997) {
          if (ds.target === 'fab') {
            // Opening the panel from a docked FAB: suppress the click-to-open
            // that would otherwise fire, then open + dock.
            fabHadDragRef.current = true;
            setOpen(true);
          }
          setDocked(true);
        }
        setDockHint(false);
      }
      try {
        if (ds.target === 'fab') {
          if (fabPos) localStorage.setItem('biof3_copilot_fab_pos', JSON.stringify(fabPos));
        } else {
          if (panelPos) localStorage.setItem('biof3_copilot_panel_pos', JSON.stringify(panelPos));
        }
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [fabPos, panelPos, size.w, size.h, docked]);

  // ---- Resize handlers ----
  const onResizeStart = (mode: 'left' | 'corner-tl' | 'corner-bl') => (e: React.MouseEvent) => {
    e.preventDefault();
    resizeStart.current = { x: e.clientX, y: e.clientY, w: size.w, h: size.h, mode };
    document.body.style.userSelect = 'none';
    document.body.style.cursor =
      mode === 'left' ? 'ew-resize' : mode === 'corner-tl' ? 'nesw-resize' : 'nwse-resize';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const start = resizeStart.current;
      if (!start) return;
      // Panel anchors right-center: dragging LEFT grows width; dragging UP from top
      // corner or DOWN from bottom corner grows height (and we double the dy because
      // panel is vertically centered, so visible growth = 2 * mouse motion).
      const dx = start.x - e.clientX;
      let dy = 0;
      if (start.mode === 'corner-tl')
        dy = (start.y - e.clientY) * 2; // up grows
      else if (start.mode === 'corner-bl') dy = (e.clientY - start.y) * 2; // down grows
      const newW = Math.max(360, Math.min(window.innerWidth - 32, start.w + dx));
      const newH =
        start.mode === 'left'
          ? start.h
          : Math.max(380, Math.min(window.innerHeight - 32, start.h + dy));
      setSize({ w: newW, h: newH });
    };
    const onUp = () => {
      if (!resizeStart.current) return;
      resizeStart.current = null;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      try {
        localStorage.setItem('biof3_copilot_size', JSON.stringify(size));
      } catch {}
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [size]);

  const quick = QUICK_PROMPTS[ctx.page] || QUICK_PROMPTS.home;

  // Floating button only
  if (!open) {
    const fabStyle: React.CSSProperties = fabPos
      ? { right: fabPos.right, top: fabPos.top, transform: 'none' }
      : {};
    return (
      <>
        {dockHint && (
          <div className="cp-dock-zone">
            <span>松手嵌入右侧 →</span>
          </div>
        )}
        <button
          className="cp-fab"
          style={fabStyle}
          onClick={() => {
            if (fabHadDragRef.current) {
              fabHadDragRef.current = false;
              return;
            }
            setOpen(true);
          }}
          onMouseDown={onDragStart('fab')}
          aria-label="打开 BioF3 Copilot — 长按拖拽移动 / 拖到右侧嵌入"
          title="BioF3 Copilot · 长按拖拽移动 · 拖到右侧可嵌入"
        >
          <img className="cp-fab-icon" src={logoUrl} alt="BioF3" draggable={false} />
        </button>
      </>
    );
  }

  return (
    <div
      className={`cp-panel${docked ? ' cp-panel--docked' : ''}`}
      role="dialog"
      aria-label="AI Copilot"
      style={(() => {
        const base: React.CSSProperties = docked
          ? { width: size.w }
          : { width: size.w, height: size.h };
        if (panelOpacitySetting < 1) {
          base.opacity = panelOpacitySetting;
          base.transition = 'opacity 0.2s ease';
        }
        if (docked) {
          return base;
        }
        if (panelPos) {
          base.right = panelPos.right;
          base.top = panelPos.top;
          base.transform = 'none';
        }
        return base;
      })()}
    >
      {dockHint && (
        <div className="cp-dock-zone">
          <span>松手嵌入右侧 →</span>
        </div>
      )}
      <div className="cp-resize-left" onMouseDown={onResizeStart('left')} title="拖拽调整宽度" />
      <div
        className="cp-resize-corner cp-resize-corner-tl"
        onMouseDown={onResizeStart('corner-tl')}
        title="拖拽调整大小"
      />
      <div
        className="cp-resize-corner cp-resize-corner-bl"
        onMouseDown={onResizeStart('corner-bl')}
        title="拖拽调整大小"
      />
      <div
        className="cp-header"
        onMouseDown={(e) => {
          // Only drag when grabbing empty header area, not the buttons inside
          const tag = (e.target as HTMLElement).tagName;
          if (tag === 'BUTTON' || tag === 'IMG' || (e.target as HTMLElement).closest('button'))
            return;
          onDragStart('panel')(e);
        }}
        style={{ cursor: 'grab' }}
        title="拖拽移动浮窗"
      >
        <div className="cp-header-left">
          <span className="cp-header-icon">
            <img src={logoUrl} alt="" />
          </span>
          <div className="cp-header-text" style={{ position: 'relative' }}>
            <button
              className="cp-conv-trigger"
              onClick={(e) => {
                e.stopPropagation();
                setShowConvDropdown((s) => !s);
              }}
              title="切换会话 / 新对话"
            >
              <span className="cp-header-title">{activeConvTitle || 'BioF3 Copilot'}</span>
              <span className="cp-conv-arrow">▾</span>
            </button>
            <div className="cp-header-sub">{contextLabel(ctx)}</div>
            {showConvDropdown && (
              <div className="cp-conv-dropdown" onClick={(e) => e.stopPropagation()}>
                <button className="cp-conv-new" onClick={startNewConversation}>
                  ➕ 开始新对话
                </button>
                <div className="cp-conv-list">
                  {conversations.length === 0 ? (
                    <div className="cp-conv-empty">还没有其他会话</div>
                  ) : (
                    conversations.map((c) => (
                      <button
                        key={c.id}
                        className={`cp-conv-item ${c.id === activeConvId ? 'active' : ''}`}
                        onClick={() => switchToConversation(c.id)}
                        title={c.title}
                      >
                        <span className="cp-conv-item-title">{c.title}</span>
                        <span className="cp-conv-item-meta">
                          {c.message_count} 条 ·{' '}
                          {new Date(c.updated_at).toLocaleDateString('zh-CN')}
                        </span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="cp-header-actions">
          <button
            className={`cp-icon-btn ${showSummary ? 'cp-icon-btn-active' : ''}`}
            onClick={() => setShowSummary((s) => !s)}
            title="长期记忆 (事实档案 / 对话摘要)"
            aria-label="长期记忆"
          >
            <Icon name="archive" size={14} />
          </button>
          <button
            className={`cp-icon-btn ${docked ? 'cp-icon-btn-active' : ''}`}
            onClick={() => {
              if (docked) {
                setDocked(false);
                setPanelPos({
                  right: 16,
                  top: Math.max(0, Math.round((window.innerHeight - size.h) / 2)),
                });
              } else if (window.innerWidth >= 997) {
                setDocked(true);
              }
            }}
            title={docked ? '弹出为浮窗' : '嵌入到右侧（与页面并列）'}
            aria-label={docked ? '弹出为浮窗' : '嵌入右侧'}
          >
            <Icon name={docked ? 'arrow-right' : 'sidebar'} size={14} />
          </button>
          <button className="cp-icon-btn" onClick={clearHistory} title="清空当前对话">
            ↻
          </button>
          <a
            className="cp-icon-btn"
            href="/learning-report"
            target="_blank"
            rel="noopener"
            title="我的学习记录"
            aria-label="我的学习记录"
            onClick={(e) => e.stopPropagation()}
          >
            <Icon name="book" size={14} />
          </a>
          <button
            className="cp-icon-btn"
            onClick={() => setShowOpacitySlider((s) => !s)}
            title="调整透明度"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
          <button className="cp-icon-btn" onClick={() => setOpen(false)} title="关闭">
            ×
          </button>
        </div>
      </div>

      {showOpacitySlider && (
        <div
          className="cp-opacity-slider"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <span className="cp-opacity-label">透明度</span>
          <input
            type="range"
            min="15"
            max="100"
            value={Math.round(panelOpacitySetting * 100)}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10) / 100;
              setPanelOpacitySetting(v);
              localStorage.setItem('biof3-copilot-opacity', String(v));
            }}
            className="cp-opacity-range"
          />
          <span className="cp-opacity-value">{Math.round(panelOpacitySetting * 100)}%</span>
        </div>
      )}

      {showSummary && (
        <MemoryPanel
          onClose={() => setShowSummary(false)}
          onChange={() => {
            fetchSummary().then(setSummary);
            listConversations('active').then(setConversations);
          }}
          activeConvId={activeConvId}
          onSwitchConversation={(id) => {
            if (id) switchToConversation(id);
            else startNewConversation();
          }}
        />
      )}

      {showTrace && (
        <div className="cp-trace-panel">
          <div className="cp-trace-head">
            <span className="cp-trace-title">🐞 Agent Trace · {trace.length} 步</span>
            <button
              className="cp-trace-action"
              onClick={() => {
                const text = formatTraceForCopy(trace);
                navigator.clipboard.writeText(text).catch(() => {});
              }}
              title="复制全部到剪贴板"
            >
              📋 复制
            </button>
            <button className="cp-trace-action" onClick={() => clearTrace()} title="清空">
              清空
            </button>
            <button className="cp-mem-close" onClick={() => setShowTrace(false)} title="收起">
              ×
            </button>
          </div>
          <div className="cp-trace-body">
            {trace.length === 0 ? (
              <div className="cp-trace-empty">
                暂无步骤。和 Copilot 互动后这里会记录每个工具调用 / ACK / 错误。
              </div>
            ) : (
              trace
                .slice()
                .reverse()
                .map((e, i) => (
                  <div key={i} className={`cp-trace-row cp-trace-${e.kind}`}>
                    <span className="cp-trace-time">
                      {new Date(e.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                    </span>
                    <span className={`cp-trace-kind cp-trace-kind-${e.kind}`}>{e.kind}</span>
                    <span className="cp-trace-label">{e.label}</span>
                    {e.detail && (
                      <span className="cp-trace-detail" title={e.detail}>
                        {e.detail.slice(0, 80)}
                      </span>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      )}

      {!showSummary &&
        !showTrace &&
        topicShiftHint &&
        topicShiftHint.conversationId === activeConvId && (
          <div className="cp-topic-shift">
            <div className="cp-topic-shift-text">
              <span className="cp-topic-shift-icon">💡</span>
              <span>
                看起来你换话题了：<b>{topicShiftHint.reason}</b>
                。要不开个新会话，让记忆和计划更聚焦？
              </span>
            </div>
            <div className="cp-topic-shift-actions">
              <button
                className="cp-topic-shift-primary"
                onClick={async () => {
                  if (topicShiftHint?.conversationId) {
                    await dismissTopicShift(topicShiftHint.conversationId);
                  }
                  setTopicShiftHint(null);
                  startNewConversation();
                }}
              >
                开新会话
              </button>
              <button
                className="cp-topic-shift-secondary"
                onClick={async () => {
                  if (topicShiftHint?.conversationId) {
                    await dismissTopicShift(topicShiftHint.conversationId);
                  }
                  setTopicShiftHint(null);
                }}
              >
                继续当前
              </button>
            </div>
          </div>
        )}

      {!showSummary && !showTrace && (
        <div className="cp-messages" ref={listRef}>
          {/* PLAN_INLINE_v1 — sticky plan card at top of message list */}
          <PlanInlineCard
            planId={activePlanId}
            refreshKey={planRefreshKey}
            onStepChanged={(planId, stepN, status, allDone) => {
              // Tell the LLM about the user-initiated step change so it can
              // continue the chat naturally. Sent as the next user message.
              if (allDone) {
                // VERIFY_LOOP_v1 — closing the learning loop. When the plan's last
                // step is done, explicitly nudge LLM to call verify_understanding
                // (otherwise it usually wraps up with a "done!" message and never
                // generates the comprehension questions, leaving review_queue empty).
                // The docUrl hint is left for LLM to figure out from context.page.
                send(
                  `我已完成整个 plan 的所有步骤(plan ${planId.slice(0, 12)}…)。请现在调用 verify_understanding 出 1-3 道理解题验证我学懂了没,答完后用 record_learning_signal 记录我表现弱的概念到复习队列。`
                );
              } else if (status === 'done' || status === 'skipped') {
                const verb = status === 'done' ? '完成' : '跳过';
                send(
                  `我已${verb}了 plan(${planId.slice(0, 12)}…) 的第 ${stepN} 步,请继续陪我做下一步。`
                );
              }
            }}
          />
          {messages.length === 0 && (
            <div className="cp-welcome">
              <div className="cp-welcome-text">{welcomeFor(ctx)}</div>
              <div className="cp-quick-grid">
                {quick.map((q, i) => (
                  <button key={i} className="cp-quick-btn" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => {
            const prevMeta = i > 0 ? messages[i - 1].meta : undefined;
            const showCtxBadge =
              m.role === 'user' && m.meta?.page && m.meta.page !== prevMeta?.page;
            return (
              <div key={i} className={`cp-msg cp-msg-${m.role}`}>
                <div className="cp-msg-avatar">{m.role === 'user' ? '你' : 'AI'}</div>
                <div className="cp-msg-bubble">
                  {showCtxBadge && (
                    <div className="cp-msg-ctx-badge" title={m.meta?.pageTitle || ''}>
                      {pageBadgeLabel(m.meta!)}
                    </div>
                  )}
                  {m.role === 'assistant' ? (
                    <>
                      {m.steps && m.steps.length > 0 && (
                        <div className="cp-steps">
                          {(() => {
                            // Pair tool_call + tool_result by name (latest call wins)
                            const calls: Array<{
                              name: string;
                              args: string;
                              result?: string;
                              idx: number;
                            }> = [];
                            m.steps.forEach((s, idx) => {
                              if (s.kind === 'tool_call') {
                                calls.push({ name: s.name, args: s.detail, idx });
                              } else if (s.kind === 'tool_result') {
                                // Match the most recent un-resulted call with same name
                                for (let j = calls.length - 1; j >= 0; j--) {
                                  if (calls[j].name === s.name && calls[j].result === undefined) {
                                    calls[j].result = s.detail;
                                    break;
                                  }
                                }
                              }
                            });
                            // Trailing pending call (no result yet) → show animation
                            return calls.map((c, j) => (
                              <div
                                key={j}
                                className={`cp-step ${c.result === undefined ? 'cp-step-pending' : ''}`}
                              >
                                <span className="cp-step-icon">🔧</span>
                                <span className="cp-step-name">{c.name}</span>
                                <span className="cp-step-args">
                                  {truncate(c.args.replace(/[{}"]/g, ''), 60)}
                                </span>
                                {c.result !== undefined ? (
                                  <span className="cp-step-ok">✓ {truncate(c.result, 32)}</span>
                                ) : (
                                  <span className="cp-step-spin"></span>
                                )}
                              </div>
                            ));
                          })()}
                        </div>
                      )}
                      {m.acts && m.acts.length > 0 && (
                        <div className="cp-acts">
                          {m.acts.map((a, j) => (
                            <ActResultCard key={j} act={a} />
                          ))}
                        </div>
                      )}
                      {m.content ? (
                        (() => {
                          const parsed = parseActionsFromMarkdown(m.content);
                          return (
                            <CopilotMarkdown
                              text={parsed.text}
                              actions={parsed.actions}
                              suppressAutoExec={!!m.autoActionsFired}
                            />
                          );
                        })()
                      ) : m.pending && (!m.steps || m.steps.length === 0) ? (
                        <span className="cp-typing">
                          <span />
                          <span />
                          <span />
                        </span>
                      ) : null}
                      {m.error && <div className="cp-msg-error">⚠ {m.error}</div>}
                    </>
                  ) : (
                    <>
                      {m.images && m.images.length > 0 && (
                        <div className="cp-msg-images">
                          {m.images.map((u, j) => (
                            <img
                              key={j}
                              src={u}
                              alt={`图片${j + 1}`}
                              onClick={() => setLightbox(u)}
                              title="点击放大"
                            />
                          ))}
                        </div>
                      )}
                      {m.content && <div className="cp-msg-text">{m.content}</div>}
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="cp-input-area">
        {pendingImages.length > 0 && (
          <div className="cp-pending-images">
            {pendingImages.map((u, j) => (
              <div className="cp-pending-thumb" key={j}>
                <img src={u} alt={`待发送图片${j + 1}`} />
                <button
                  type="button"
                  className="cp-pending-remove"
                  onClick={() => setPendingImages((prev) => prev.filter((x) => x !== u))}
                  aria-label="移除图片"
                >
                  ×
                </button>
              </div>
            ))}
            {imgUploading && <div className="cp-pending-thumb cp-pending-loading">上传中</div>}
          </div>
        )}
        <div className="cp-input-row">
          <label
            className="cp-img-btn"
            title="添加图片（也可直接 Ctrl/Cmd+V 粘贴）"
            aria-label="添加图片"
          >
            <Icon name="image" size={16} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              style={{ display: 'none' }}
              disabled={imgUploading}
              onChange={(e) => {
                const files = e.target.files;
                if (files) Array.from(files).forEach((f) => void uploadCopilotImage(f));
                e.currentTarget.value = '';
              }}
            />
          </label>
          <textarea
            ref={taRef}
            className="cp-input"
            rows={1}
            value={input}
            placeholder="向 Copilot 提问… (↑↓ 历史, Enter 发送, Shift+Enter 换行)"
            onChange={onInputChange}
            onKeyDown={onKeyDown}
            onPaste={onInputPaste}
            disabled={false}
          />
          {streaming ? (
            <button className="cp-send-btn cp-stop-btn" onClick={stop} title="停止">
              ■
            </button>
          ) : (
            <button
              className="cp-send-btn"
              onClick={() => send(input)}
              disabled={(!input.trim() && pendingImages.length === 0) || imgUploading}
              title="发送"
            >
              ➤
            </button>
          )}
        </div>
      </div>

      {lightbox && (
        <div
          className="cp-lightbox"
          onClick={() => setLightbox(null)}
          role="dialog"
          aria-label="图片预览"
        >
          <button className="cp-lightbox-close" onClick={() => setLightbox(null)} aria-label="关闭">
            ×
          </button>
          <img src={lightbox} alt="预览" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
