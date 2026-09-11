// ============================================================
// TextBlock — UI-305 P1 从 project-workspace.tsx 尾部整簇平移（原 3001-3017 行），
// 零行为变化；主文件按既有惯例再导出保持 '@/pages/project-workspace' 导入路径兼容。
// ============================================================
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { BottomTerminal } from '@/components/workspace-panels/BottomTerminal';
import styles from '../project-workspace.module.css';

export function TextBlock({ text }: { text?: string }): React.ReactElement | null {
  if (!text) return null;
  const clipped = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  return <pre className={styles.workspaceOfficeText}>{clipped}</pre>;
}








// EmbeddedTerminalPanel moved to @/components/workspace-panels/BottomTerminal (PR-3.1)
