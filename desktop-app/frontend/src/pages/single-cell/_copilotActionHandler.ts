// ============================================================
// Single-cell Copilot action handler.
//
// Bridges Copilot's action bus to in-app behaviors:
//   - start_analysis → navigate to dataset, open NewAnalysisModal pre-filled
//   - recluster      → navigate to dataset of the analysis, open recluster modal
//
// We use a window CustomEvent so the views (DatasetView/ResultView) can listen
// without importing this module.
// ============================================================

import { registerActionHandler, type ActionResult } from '@/components/copilot/copilotActionBus';
import type { CopilotAction } from '@/components/copilot/copilotActions';
import { getAnalysis } from './_store';

/** Payload broadcast on `biof3:open-new-analysis` event. */
export interface OpenNewAnalysisPayload {
  datasetId: string;
  defaultType: string;
  parentAnalysisId?: string;
  params?: Record<string, unknown>;
  source: 'copilot';
}

let unsubscribe: (() => void) | null = null;

export function installSingleCellActionHandler(): () => void {
  if (unsubscribe) return unsubscribe;

  unsubscribe = registerActionHandler(async (action: CopilotAction): Promise<ActionResult> => {
    if (action.type === 'start_analysis') {
      if (!action.datasetId) return { ok: false, error: '缺少 datasetId' };
      // Navigate to dataset page (if not already there)
      const targetHash = `#/dataset/${action.datasetId}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
      // Wait one tick so DatasetView mounts and registers its listener
      await new Promise((r) => setTimeout(r, 50));
      window.dispatchEvent(
        new CustomEvent<OpenNewAnalysisPayload>('biof3:open-new-analysis', {
          detail: {
            datasetId: action.datasetId,
            defaultType: action.analysisType,
            params: action.params,
            source: 'copilot',
          },
        })
      );
      return { ok: true, message: '已打开分析对话框，参数已填好，请确认后提交' };
    }

    if (action.type === 'recluster') {
      if (!action.analysisId) return { ok: false, error: '缺少 analysisId' };
      // Look up analysis to get its dataset
      const analysis = await getAnalysis(action.analysisId);
      if (!analysis) return { ok: false, error: '找不到这个分析（可能已被删除）' };
      const targetHash = `#/dataset/${analysis.datasetId}`;
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
      await new Promise((r) => setTimeout(r, 50));
      const params: Record<string, unknown> = {};
      if (typeof action.resolution === 'number') params.resolution = action.resolution;
      window.dispatchEvent(
        new CustomEvent<OpenNewAnalysisPayload>('biof3:open-new-analysis', {
          detail: {
            datasetId: analysis.datasetId,
            defaultType: 'recluster',
            parentAnalysisId: analysis.id,
            params,
            source: 'copilot',
          },
        })
      );
      return { ok: true, message: '已打开 recluster 对话框' };
    }

    return { ok: false, error: '当前页不支持此操作' };
  });
  return unsubscribe;
}
