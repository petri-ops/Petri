// ============================================================
// Pure helper functions for file-type detection and
// formatting used by the project-workspace page.
//
// All helpers are deliberately framework-agnostic: no React, no
// DOM access. This keeps them easy to unit-test in isolation and
// avoids accidental coupling to the project-workspace component.
//
// Originally embedded inside the 3222-line project-workspace.tsx;
// extracted by BLOCK-9 PHASE 3 senior-engineer-review split.
// ============================================================

import { fileExtension } from '@/lib/previewFileUtils';
import type { OfficePreviewKind } from '@/lib/office-file-preview';

export function isCsvFile(name?: string): boolean {
  const ext = fileExtension(name);
  return ext === 'csv' || ext === 'tsv';
}

export function isPdfFile(name?: string): boolean {
  return fileExtension(name) === 'pdf';
}

export function isHtmlFile(name?: string): boolean {
  const ext = fileExtension(name);
  return ext === 'html' || ext === 'htm';
}

export function withReportTheme(url: string, theme: 'light' | 'dark'): string {
  if (!url) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}theme=${theme}`;
}

export function isJsonFile(name?: string): boolean {
  return fileExtension(name) === 'json' || fileExtension(name) === 'jsonl';
}

export function detectOfficeKind(name?: string): OfficePreviewKind | null {
  if (!name) return null;
  const ext = name.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'docx':
    case 'docm':
    case 'dotx':
      return 'docx';
    case 'xlsx':
    case 'xlsm':
    case 'xltx':
    case 'xlsb':
      return 'xlsx';
    case 'pptx':
    case 'pptm':
    case 'ppsx':
    case 'potx':
      return 'pptx';
    case 'odt':
      return 'odt';
    case 'ods':
      return 'ods';
    case 'odp':
      return 'odp';
    case 'pages':
      return 'pages';
    case 'numbers':
      return 'numbers';
    case 'keynote':
      return 'keynote';
    default:
      return null;
  }
}

export function fallbackKindForExtension(ext: string): OfficePreviewKind {
  const normalized = ext.toLowerCase();
  if (normalized.startsWith('h5') || normalized === 'hdf5') return 'h5';
  switch (normalized) {
    case 'rdata':
      return 'rdata';
    case 'rds':
      return 'rds';
    case 'loom':
      return 'loom';
    case 'mtx':
      return 'mtx';
    case 'rtf':
      return 'rtf';
    case 'epub':
      return 'epub';
    default:
      return 'binary';
  }
}

/** Human-readable byte size: B / KB / MB / GB. */
export function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}
