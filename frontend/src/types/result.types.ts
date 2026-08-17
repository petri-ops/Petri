// ============================================================
// Result domain types — Phase 2 Result Studio UI
//
// Represents the shared result model (not branch-specific):
//   - Result: a piece of analysis output shared across branches
//   - ResultVersion: historical snapshots of a result
//
// Core principle: Results belong to projects, not branches.
// Branch switching affects Copilot conversation but not Result Studio.
// ============================================================

export type ResultType = 'chart' | 'table' | 'code' | 'text' | 'file' | 'conversation_export';

/** A result artifact — shared across branches within the same project. */
export interface Result {
  id: string;
  projectId: string;
  type: ResultType;
  name: string;
  /** The primary data payload. Format depends on `type`:
   *   - chart: { chartType, data, config }
   *   - table: { columns, rows }
   *   - code: { language, source }
   *   - text: string content
   *   - file: { path, mimeType }
   */
  data: unknown;
  /** Optional rendering / display configuration. */
  config?: Record<string, unknown>;
  /** Branch ID where this result was originally created. null for legacy results. */
  sourceBranchId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Historical snapshot of a Result — immutable once created. */
export interface ResultVersion {
  id: string;
  resultId: string;
  version: number;
  /** Snapshot of the result data at this version. */
  data: unknown;
  /** Optional snapshot of the result config. */
  config?: Record<string, unknown>;
  createdAt: number;
  /** Branch ID that created this version. null for legacy versions. */
  createdByBranchId: string | null;
}

/** Lightweight summary for listing / picker UIs. */
export interface ResultSummary {
  id: string;
  projectId: string;
  type: ResultType;
  name: string;
  sourceBranchId: string | null;
  updatedAt: number;
}

/** Options for listing results. */
export interface ListResultsOptions {
  type?: ResultType;
  limit?: number;
  offset?: number;
  /** Sort field. Defaults to 'updatedAt'. */
  sortBy?: 'updatedAt' | 'createdAt' | 'name';
  /** Sort direction. Defaults to 'desc'. */
  sortDir?: 'asc' | 'desc';
}
