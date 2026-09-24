// ============================================================
// formatHarness.ts — SimpleChat harness payload formatting helpers
//
// Extracted from SimpleChat.tsx by BLOCK-9.2 PHASE 4 (commit 2). These
// helpers convert raw harness payloads (repairs / warnings / diagnostics)
// into the human-readable strings rendered inside the ApprovalRepairHint
// block. They are pure (no React, no hooks, no closures over component
// state), so they can live in their own module and be consumed by both
// the SimpleChat main component (stringifyParamValue) and the inline
// ApprovalRepairHint sub-component (formatHarnessRepair / Warning /
// DiagnosticIssue).
//
// 5 functions exported:
//   - stringifyParamValue(value): JSON.stringify with safe fallbacks.
//   - shortValue(value): truncate stringifyParamValue output to ≤64 chars.
//   - formatHarnessRepair(item): repair payload → user-facing sentence.
//   - formatHarnessWarning(item): warning payload → user-facing sentence.
//   - formatHarnessDiagnosticIssue(issue): diagnostic issue → sentence.
//
// The original call sites in SimpleChat.tsx are preserved verbatim;
// only the import source moves from local-scope helpers to this module.
// ApprovalCard / ApprovalRepairHint stay nested inside SimpleChat.tsx
// (P3-3 deferred per survey §4.4), but they consume these helpers via
// the same import path as the main component, which keeps the split
// simple and avoids touching the sub-component boundaries in this
// commit.
// ============================================================

import { unknownText } from '@/lib/unknownText';
import type { HarnessDiagnosticIssue } from '@/lib/harness-client';

export function stringifyParamValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return unknownText(value);
  }
}

export function shortValue(value: unknown): string {
  const text = stringifyParamValue(value);
  return text.length > 64 ? `${text.slice(0, 61)}…` : text;
}

export function formatHarnessRepair(item: Record<string, unknown>): string {
  const code = unknownText(item.code || '');
  const inputId = unknownText(item.inputId || '参数');
  if (code === 'file_input_prefilled') {
    return `已为 ${inputId} 选择候选文件：${shortValue(item.value)}`;
  }
  if (code === 'column_alias_mapped') {
    return `已识别 ${inputId} 的关键列别名：${shortValue(item.mappings)}`;
  }
  if (code === 'number_param_clamped') {
    return item.confirmationRequired
      ? `建议将 ${inputId} 从 ${shortValue(item.from)} 调整为 ${shortValue(item.to)}（需确认）`
      : `已将 ${inputId} 从 ${shortValue(item.from)} 调整为 ${shortValue(item.to)}`;
  }
  if (code === 'number_default_filled') {
    return `已补齐 ${inputId} 默认值：${shortValue(item.to)}`;
  }
  return `${inputId}: ${shortValue(item)}`;
}

export function formatHarnessWarning(item: Record<string, unknown>): string {
  const code = unknownText(item.code || '');
  const inputId = unknownText(item.inputId || '参数');
  if (code === 'missing_required_columns') {
    return `${inputId} 可能缺少必要列：${shortValue(item.missing)}`;
  }
  return `${inputId}: ${shortValue(item)}`;
}

export function formatHarnessDiagnosticIssue(issue: HarnessDiagnosticIssue): string {
  const inputId = issue.inputId ? `${String(issue.inputId)}：` : '';
  const message = String(issue.message || issue.code || '诊断问题');
  const detail = issue.detail ? `（${String(issue.detail)}）` : '';
  return `${inputId}${message}${detail}`;
}