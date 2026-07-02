// ============================================================
// "Ask Copilot about this" floating action — appears near selected text.
// Click → fires global event to open Copilot with the selection prefilled.
// ============================================================

import React, { useEffect, useState } from 'react';

const MIN_SELECTION_CHARS = 6;
const MAX_SELECTION_CHARS = 600;

export function CopilotSelectionTip() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [text, setText] = useState('');

  useEffect(() => {
    const onMouseUp = () => {
      // Run on next tick so selection has settled
      setTimeout(() => {
        const sel = window.getSelection();
        if (!sel || sel.isCollapsed) {
          setPos(null);
          return;
        }
        const raw = sel.toString();
        const trimmed = raw.trim();
        if (trimmed.length < MIN_SELECTION_CHARS) {
          setPos(null);
          return;
        }
        // Skip selections inside Copilot itself or input fields
        const range = sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
        if (!range) {
          setPos(null);
          return;
        }
        let node: Node | null = range.commonAncestorContainer;
        while (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentNode;
        const el = node as HTMLElement | null;
        if (!el) {
          setPos(null);
          return;
        }
        if (
          el.closest('.cp-panel') ||
          el.closest('.cp-fab') ||
          el.closest('.cp-tip') ||
          el.closest('input, textarea') ||
          el.closest('pre') ||
          el.closest('code') ||
          el.closest('.cp-code-block') ||
          el.closest('.theme-code-block') ||
          el.closest('.run-modal-editor') ||
          el.closest('.monaco-editor') ||
          el.closest('.cm-editor')
        ) {
          setPos(null);
          return;
        }
        const rect = range.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) {
          setPos(null);
          return;
        }
        setText(trimmed.slice(0, MAX_SELECTION_CHARS));
        setPos({
          x: Math.min(window.innerWidth - 180, rect.left + rect.width / 2),
          y: Math.max(8, rect.top - 36),
        });
      }, 10);
    };

    const onScroll = () => setPos(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPos(null);
    };

    document.addEventListener('mouseup', onMouseUp);
    document.addEventListener('selectionchange', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed) setPos(null);
    });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('scroll', onScroll, true as unknown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  if (!pos) return null;

  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent('biof3:copilot-ask', {
        detail: {
          selection: text,
          url: window.location.href,
          title: document.title,
        },
      })
    );
    setPos(null);
  };

  return (
    <button
      className="cp-tip"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.preventDefault()} // don't drop the selection
      onClick={onClick}
      title="问 Copilot 关于这段内容"
    >
      <span className="cp-tip-icon">💬</span>
      <span className="cp-tip-text">问 Copilot</span>
    </button>
  );
}
