// ============================================================
// DesktopSettingsPanel — shared helpers
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: line 79-82.
//
// Pure utility functions used across multiple sections. No React,
// no side effects — safe to import anywhere.
// ============================================================

export function formatMetricBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未知';
  return value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GB`
    : `${(value / 1024 ** 2).toFixed(0)} MB`;
}
