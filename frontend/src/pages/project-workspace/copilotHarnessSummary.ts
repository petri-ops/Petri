import type { HarnessContextSummary } from '@/lib/copilotContext';
import type { HarnessIndexSummary } from '@/lib/harness-client';

// BLOCK-92 Wave B-1 — 纯函数外迁（原 project-workspace.tsx，纯搬运零行为变化）。
export function toCopilotHarnessSummary(index: HarnessIndexSummary | null | undefined): HarnessContextSummary | undefined {
  if (!index) return undefined;
  return {
    fileCount: index.fileCount || 0,
    truncated: index.truncated,
    byKind: index.byKind,
    byRole: index.byRole,
    entries: (index.entries || []).slice(0, 24).map((entry) => ({
      relativePath: entry.relativePath,
      kind: entry.kind,
      role: entry.role,
      readable: entry.readable,
      table: entry.table
        ? {
            headers: (entry.table.headers || []).slice(0, 12),
            columnCount: entry.table.columnCount,
            rowSampleCount: entry.table.rowSampleCount,
            matrixOrientation: entry.table.matrixOrientation,
          }
        : undefined,
    })),
  };
}
