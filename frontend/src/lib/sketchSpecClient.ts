import { getApiPrefix } from '@/components/copilot/copilotClient';

interface SketchTaskSpec {
  version: 'task-spec/v1';
  taskType: 'modeling';
  goal: string;
  deliverables: string[];
  constraints: string[];
  assumptions: string[];
  acceptance: string[];
  missingInfo: string[];
}

export interface SketchTaskSpecResult {
  ok: true;
  optimizedPrompt: string;
  taskSpec: SketchTaskSpec;
  changeSummary: string[];
  model: string | null;
  usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
}

export async function sketchToTaskSpec(input: {
  imageDataUrl: string;
  dimensions: string;
  notes: string;
}): Promise<SketchTaskSpecResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/sketch-spec`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => null) as
    | (SketchTaskSpecResult & { error?: string; reason?: string; message?: string | null })
    | null;
  if (!response.ok || !data || !data.ok) {
    const reason = data && (data.message || data.reason || data.error);
    throw new Error(reason || `HTTP ${response.status}`);
  }
  return data;
}
