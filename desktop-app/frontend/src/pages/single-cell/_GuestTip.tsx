// ============================================================
// Guest mode tip — small popup at cursor position
// ============================================================

import React, { useState, useEffect } from 'react';

interface TipState {
  id: number;
  x: number;
  y: number;
  message: string;
}

let listeners: Array<(t: TipState) => void> = [];
let counter = 0;

/** Show a tip at the cursor (or specific) position. */
export function showGuestTip(message: string, e?: { clientX: number; clientY: number }) {
  const tip: TipState = {
    id: ++counter,
    x: e?.clientX ?? window.innerWidth / 2,
    y: e?.clientY ?? window.innerHeight / 2,
    message,
  };
  listeners.forEach((fn) => fn(tip));
}

export function GuestTipContainer() {
  const [tips, setTips] = useState<TipState[]>([]);

  useEffect(() => {
    const handler = (t: TipState) => {
      setTips((prev) => [...prev, t]);
      setTimeout(() => {
        setTips((prev) => prev.filter((x) => x.id !== t.id));
      }, 1800);
    };
    listeners.push(handler);
    return () => {
      listeners = listeners.filter((fn) => fn !== handler);
    };
  }, []);

  if (tips.length === 0) return null;

  return (
    <>
      {tips.map((t) => (
        <div key={t.id} className="sc-guest-tip" style={{ left: t.x, top: t.y }}>
          🔒 {t.message}
        </div>
      ))}
    </>
  );
}
