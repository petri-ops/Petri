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

import { type ResultArtifactKind, type ResultArtifactRecord } from '@/lib/result-manifest';
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

/**
 * UI-638 点开腿 — 结果面 fallback 产物记录。
 *
 * 后端可能已按产物所在位置投影 url（model3d 走项目工作区读面，不是
 * /api/tools/file/<job>/<name>）。桌面端 API 与 SPA 不同源（:3001 vs :3000），
 * 站点绝对路径必须挂到 API base 才能被 <img>/GLTFLoader 直接取；未声明、
 * 缺 base 或可注入形态（相对路径 / 协议相对 // / 非 http 协议）回落到工具读面。
 */
export function artifactRecordsFromFiles(
  files: JobResultFile[],
  buildUrl: (name: string) => string,
  apiBase?: string,
): ResultArtifactRecord[] {
  return files.map((file) => {
    const name = artifactName(file);
    return {
      name,
      type: file.type,
      label: file.label || file.title,
      title: file.title,
      url: resolveDeclaredArtifactUrl(file.url, buildUrl(name), apiBase),
      preview: file.preview,
      download: file.download,
    };
  });
}

function resolveDeclaredArtifactUrl(
  declared: string | undefined,
  fallback: string,
  apiBase?: string,
): string {
  const value = String(declared || '').trim();
  if (!value) return fallback;
  if (/^(https?:|blob:)/i.test(value)) return value;
  if (/^\/(?!\/)/.test(value)) {
    if (!apiBase) return fallback;
    try {
      return new URL(value, apiBase).toString();
    } catch {
      return fallback;
    }
  }
  return fallback;
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
