// ============================================================
// Mobile drawer state for single-cell sidebar
// Adds 'is-mobile-open' class to .sc-sidebar when open
// Backdrop click + Escape key close the drawer
// ============================================================

import { useState, useEffect, useCallback } from 'react';

export function useMobileDrawer(): [boolean, () => void, () => void] {
  const [open, setOpen] = useState(false);

  // Close on route change / Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    // Lock body scroll while drawer is open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  return [open, openDrawer, closeDrawer];
}
