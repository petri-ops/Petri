// ============================================================
// WorkingTreeReviewMount — BLOCK-16 thin-slice 全局 mount
//
// 提供 shell 级 open state，并通过 context 暴露手动 trigger（toolbar 用）。
// 挂在 App.tsx 根部，与 SimpleChat / CommandPalette 同级。
// ============================================================

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import { WorkingTreeReview } from './WorkingTreeReview';

interface WorkingTreeReviewContextValue {
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const WorkingTreeReviewContext = createContext<WorkingTreeReviewContextValue | null>(null);

export function useWorkingTreeReviewMount(): WorkingTreeReviewContextValue {
  const ctx = useContext(WorkingTreeReviewContext);
  if (!ctx) {
    return {
      open: () => undefined,
      close: () => undefined,
      isOpen: false,
    };
  }
  return ctx;
}

export function WorkingTreeReviewMount({ children }: { children?: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <WorkingTreeReviewContext.Provider value={{ open, close, isOpen }}>
      {children}
      <WorkingTreeReview isOpen={isOpen} onClose={close} />
    </WorkingTreeReviewContext.Provider>
  );
}
