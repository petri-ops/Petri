// ============================================================
// useContextMention.ts — BLOCK-245 P4「`@` 菜单」交互状态簇
//
// 把 `@` 触发/过滤/键盘导航/选中回落全部收在本簇，宿主（SimpleChat）只留
// 三个接点：onChange 里 syncInput、onKeyDown 里 handleKeyDown、JSX 里一条菜单。
// 这样既守住 SimpleChat.tsx 的 code-size 棘轮，也让键盘语义可脱离 DOM 单测。
//
// 红线：选中候选**只**调 onPickItem(ComposerContextItem)——不产文本模板、
// 不走 events、不建第二注入通道（events.ts:243-247 的 D2 裁决继续有效）。
// ============================================================
import { useCallback, useMemo, useRef, useState } from 'react';
import type { ComposerContextItem } from '../contextItems';
import {
  INACTIVE_MENTION,
  filterContextSources,
  flattenContextCandidates,
  parseMentionTrigger,
  removeMentionToken,
  type ContextCandidate,
  type ContextSourceResult,
  type MentionTrigger,
} from '../contextSources';
import { useContextSources } from './useContextSources';

/** 只用到的两个键盘事件面（便于纯逻辑单测，不依赖 React.DOMEvent）。 */
export interface MentionKeyEvent {
  key: string;
  preventDefault: () => void;
}

export interface UseContextMentionOptions {
  projectId: string;
  conversationId?: string | null;
  /** 选中候选 → 写进 P2 的上下文单列表。 */
  onPickItem: (item: ComposerContextItem) => void;
  /** 摘掉 `@token` 后的新正文与光标位写回 composer。 */
  applyText: (text: string, caret: number) => void;
}

export interface ContextMentionApi {
  /** 菜单是否展开（= 光标在 `@` token 内）。 */
  open: boolean;
  loading: boolean;
  /** 过滤+逐项上限后的候选（含不可用源）。 */
  sources: ContextSourceResult[];
  activeId: string | null;
  /** textarea onChange 内调用（传新值 + 光标位）。 */
  syncInput: (text: string, caret: number) => void;
  /** textarea onKeyDown 最先调用；返回 true = 已消费，宿主应直接 return。 */
  handleKeyDown: (event: MentionKeyEvent) => boolean;
  /** 点选/回车选中同一条路径。 */
  pick: (candidate: ContextCandidate) => void;
  hover: (candidate: ContextCandidate) => void;
  close: () => void;
}

export function useContextMention(options: UseContextMentionOptions): ContextMentionApi {
  const { projectId, conversationId, onPickItem, applyText } = options;
  const [trigger, setTrigger] = useState<MentionTrigger>(INACTIVE_MENTION);
  const [activeIndex, setActiveIndex] = useState(0);
  const textRef = useRef('');

  const { sources, loading } = useContextSources({
    projectId,
    conversationId,
    enabled: trigger.active,
  });

  const filtered = useMemo(
    () => (trigger.active ? filterContextSources(sources, trigger.query) : []),
    [sources, trigger.active, trigger.query],
  );
  const flat = useMemo(() => flattenContextCandidates(filtered), [filtered]);
  const activeId = flat[activeIndex]?.id ?? null;

  const syncInput = useCallback((text: string, caret: number) => {
    textRef.current = text;
    const next = parseMentionTrigger(text, caret);
    setTrigger(next.active ? next : INACTIVE_MENTION);
    // 每次正文变化都把高亮复位到首项（与斜杠面板同体感）。
    setActiveIndex(0);
  }, []);

  const close = useCallback(() => setTrigger(INACTIVE_MENTION), []);

  const pick = useCallback((candidate: ContextCandidate) => {
    onPickItem(candidate.item);
    const next = removeMentionToken(textRef.current, trigger);
    applyText(next.text, next.caret);
    setTrigger(INACTIVE_MENTION);
    setActiveIndex(0);
  }, [applyText, onPickItem, trigger]);

  const hover = useCallback((candidate: ContextCandidate) => {
    const index = flat.findIndex((entry) => entry.id === candidate.id);
    if (index >= 0) setActiveIndex(index);
  }, [flat]);

  const handleKeyDown = useCallback((event: MentionKeyEvent): boolean => {
    if (!trigger.active) return false;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (flat.length === 0 ? 0 : Math.min(flat.length - 1, prev + 1)));
      return true;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(0, prev - 1));
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const candidate = flat[activeIndex];
      if (candidate) pick(candidate);
      else close();
      return true;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return true;
    }
    return false;
  }, [activeIndex, close, flat, pick, trigger.active]);

  return {
    open: trigger.active,
    loading,
    sources: filtered,
    activeId,
    syncInput,
    handleKeyDown,
    pick,
    hover,
    close,
  };
}
