import { getApiPrefix } from '@/components/copilot/copilotClient';

type TaskType = 'general' | 'coding' | 'analysis' | 'result' | 'workflow' | 'modeling';

interface TaskSpecV1 {
  version: 'task-spec/v1';
  taskType: TaskType;
  goal: string;
  deliverables: string[];
  constraints: string[];
  assumptions: string[];
  acceptance: string[];
  missingInfo: string[];
}

interface CapabilitySnapshotRow {
  id: string;
  status: 'ready' | 'degraded' | 'unavailable' | 'disabled' | 'unknown';
  reason?: string | null;
  note?: string;
  connectedServers?: number;
}

export interface PromptEnhanceContext {
  projectName?: string;
  projectType?: string;
  workspaceLabel?: string;
  surface?: string;
  taskTypeHint?: TaskType;
  items?: Array<{ kind: string; label: string; source: string }>;
}

export interface PromptEnhanceResult {
  optimizedPrompt: string;
  taskSpec: TaskSpecV1;
  changeSummary: string[];
  contextUsed: string[];
  capabilitySnapshot: CapabilitySnapshotRow[];
  model: string | null;
}

export async function enhancePrompt(input: {
  prompt: string;
  context: PromptEnhanceContext;
  signal?: AbortSignal;
}): Promise<PromptEnhanceResult> {
  const response = await fetch(`${getApiPrefix()}/ai/agent/prompt-enhance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: input.prompt, context: input.context }),
    signal: input.signal || AbortSignal.timeout(25_000),
  });
  const data = await response.json().catch(() => null) as (PromptEnhanceResult & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !data || data.ok === false) {
    const code = data && data.error ? data.error : `http_${response.status}`;
    throw new Error(code);
  }
  return data;
}
