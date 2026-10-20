import type { ConversationFileChange } from '@/components/copilot/conversationChangesStore';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

type GeneratedFileEvidenceState = 'workspace' | 'tool-record' | 'both' | 'none';
export type GeneratedFilesPanelState = 'loading' | 'error' | 'empty' | 'ready';

export interface GeneratedFileSource {
  path: string;
  status: 'created' | 'modified';
  tool?: string;
  iteration?: number;
  workspaceAvailable: boolean;
  toolRecordAvailable: boolean;
  toolRecordContent?: string;
  toolRecordTruncated?: boolean;
  toolRecordReason?: 'no_write_activity' | 'tool_result_has_no_content';
  evidenceState: GeneratedFileEvidenceState;
}

const WRITE_TOOLS = new Set(['workspace_write', 'workspace_replace', 'workspace_append']);

function readPathFromResultData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['path', 'filePath', 'file_path', 'relativePath', 'relative_path']) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function readContentFromResultData(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const record = data as Record<string, unknown>;
  for (const key of ['content', 'text', 'preview', 'writtenContent', 'written_content']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function activityMatchesPath(activity: ToolActivityItem, path: string): boolean {
  if (!WRITE_TOOLS.has(activity.name)) return false;
  const fromResult = readPathFromResultData(activity.resultData);
  if (fromResult === path) return true;
  const detail = activity.actionDetail || '';
  return detail.includes(path);
}

export function resolveGeneratedFileSource(input: {
  change: ConversationFileChange;
  activities?: readonly ToolActivityItem[];
  workspaceAvailable?: boolean;
}): GeneratedFileSource {
  const { change, activities = [], workspaceAvailable = true } = input;
  const latest = activities
    .filter((activity) => activityMatchesPath(activity, change.path))
    .slice()
    .reverse()
    .find((activity) => readContentFromResultData(activity.resultData) !== null)
    || activities
      .filter((activity) => activityMatchesPath(activity, change.path))
      .slice()
      .reverse()[0];

  const content = latest ? readContentFromResultData(latest.resultData) : null;
  const toolRecordAvailable = content !== null;
  const evidenceState: GeneratedFileEvidenceState = workspaceAvailable && toolRecordAvailable
    ? 'both'
    : workspaceAvailable
      ? 'workspace'
      : toolRecordAvailable
        ? 'tool-record'
        : 'none';

  return {
    path: change.path,
    status: change.status,
    ...(change.tool ? { tool: change.tool } : {}),
    ...(typeof change.iteration === 'number' ? { iteration: change.iteration } : {}),
    workspaceAvailable,
    toolRecordAvailable,
    ...(content !== null ? { toolRecordContent: content } : {}),
    ...(content !== null && latest?.truncated ? { toolRecordTruncated: true } : {}),
    ...(!toolRecordAvailable ? {
      toolRecordReason: latest ? 'tool_result_has_no_content' : 'no_write_activity',
    } : {}),
    evidenceState,
  };
}

export function resolveGeneratedFilesPanelState(input: {
  loading: boolean;
  error?: string | null;
  fileCount: number;
}): GeneratedFilesPanelState {
  if (input.loading) return 'loading';
  if (input.error) return 'error';
  if (input.fileCount === 0) return 'empty';
  return 'ready';
}
