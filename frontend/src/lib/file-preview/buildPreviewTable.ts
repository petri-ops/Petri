// ============================================================
// File preview helpers — shared by ResultView and project-workspace.
//
// `buildPreviewTable` parses CSV/TSV text into a 2D string grid suitable
// for rendering in a table preview. It strips outer double-quotes from
// each cell (e.g. `"foo"` → `foo`) and trims whitespace.
//
// Originally duplicated as:
//   - ResultView.tsx `buildPreviewTable(text, fileName)`           — max 40 rows
//   - project-workspace.tsx `buildWorkspacePreviewTable(text, fileName)` — max 200 rows
//
// Senior-engineer principle (senior-engineer-review-2026-08-16.md §3.4):
// any helper used by ≥2 callers belongs in lib/. This file consolidates
// both implementations into a single parameterized function with the
// `maxRows` option defaulting to 40 (ResultView's stricter bound).
// ============================================================

export interface BuildPreviewTableOptions {
  /** Maximum rows to keep (default 40). ResultView uses 40; project-workspace
   *  historically used 200 for full-file preview; both pass explicitly. */
  maxRows?: number;
}

export function buildPreviewTable(
  text: string,
  fileName: string,
  options: BuildPreviewTableOptions = {}
): string[][] {
  const { maxRows = 40 } = options;
  const sep =
    fileName.toLowerCase().endsWith('.tsv') || text.includes('\t') ? '\t' : ',';
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, maxRows)
    .map((line) =>
      line.split(sep).map((cell) => cell.replace(/^"|"$/g, '').trim())
    );
}
