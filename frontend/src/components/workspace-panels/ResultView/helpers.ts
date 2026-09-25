// ============================================================
// ResultView — pure helpers
//
// Extracted from src/components/workspace-panels/ResultView.tsx
// by BLOCK-9.2 PHASE 2. Original location: lines 144 (toArtifactRevision)
// + lines 229-264 (5 helpers).
//
// Pure utility functions used by ResultArtifactShell. No React state,
// no side effects — safe to import anywhere.
// ============================================================

import { type ResultArtifactKind } from '@/lib/result-manifest';
import type { IconName } from '@/components/icons/Icon';
import type { JobResultFile } from './types';
import type { ArtifactRevision } from '@/components/result-studio/resultStudioClient';

export function toArtifactRevision(input: unknown): ArtifactRevision | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Partial<ArtifactRevision>;
  if (typeof candidate.revisionId !== 'string') return null;
  if (!Number.isInteger(candidate.revisionOrdinal) || (candidate.revisionOrdinal as number) < 1) return null;
  return candidate as ArtifactRevision;
}

export function artifactName(file: JobResultFile): string {
  return file.name || file.filename || '';
}

export function artifactKindIcon(kind: ResultArtifactKind): IconName {
  if (kind === 'report') return 'book';
  if (kind === 'plot') return 'svg';
  if (kind === 'table') return 'bar-chart';
  if (kind === 'text') return 'file';
  if (kind === 'data') return 'database';
  return 'file';
}


export function workflowStageLabel(stage: string): string {
  return {
    inspect: '检查输入',
    infer: '识别结构',
    select: '选择工具',
    repair: '修复参数',
    confirm: '等待确认',
    run: '运行分析',
    verify: '校验产物',
    report: '生成报告',
  }[stage] || stage;
}
