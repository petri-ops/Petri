// ============================================================
// AI Copilot client — shared across BioF3 modules
// ============================================================

import { getApiPrefix } from './_config';
import { getAuthHeaders } from './_auth';

export interface InterpretResult {
  /** AI-generated interpretation in Chinese */
  interpretation: string;
  /** Quick cell type hints from local marker lookup */
  cellTypeHints?: Record<string, string>;
  /** Source: 'deepseek' = AI, 'fallback' = local lookup only */
  source: 'deepseek' | 'fallback';
}

/**
 * Get AI interpretation for an analysis result.
 */
export async function interpretAnalysis(input: {
  analysisType: string;
  summary: Record<string, unknown>;
  topMarkers?: Record<string, string[]>;
}): Promise<InterpretResult | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/interpret', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(input),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'ok') return null;
    return {
      interpretation: data.interpretation,
      cellTypeHints: data.cellTypeHints,
      source: data.source,
    };
  } catch {
    return null;
  }
}
