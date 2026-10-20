import { describe, expect, it } from 'vitest';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';
import {
  resolveGeneratedFileSource,
  resolveGeneratedFilesPanelState,
} from './generatedFileSource';
import type { ConversationFileChange } from '@/components/copilot/conversationChangesStore';

const CHANGE: ConversationFileChange = {
  path: 'scripts/analysis.R',
  status: 'modified',
  lastChangedAt: 2,
  tool: 'workspace_write',
  iteration: 3,
};

function activity(overrides: Partial<ToolActivityItem>): ToolActivityItem {
  return {
    key: 'k',
    name: 'workspace_write',
    status: 'success',
    actionLabel: '已写入',
    ...overrides,
  };
}

describe('generated file source', () => {
  it('marks both sources when workspace and tool record are available', () => {
    const source = resolveGeneratedFileSource({
      change: CHANGE,
      workspaceAvailable: true,
      activities: [activity({ resultData: { path: CHANGE.path, content: 'x <- 1' } })],
    });
    expect(source.evidenceState).toBe('both');
    expect(source.toolRecordContent).toBe('x <- 1');
    expect(source.toolRecordReason).toBeUndefined();
  });

  it('keeps workspace available but honestly reports a missing tool record', () => {
    const noActivity = resolveGeneratedFileSource({ change: CHANGE, workspaceAvailable: true });
    expect(noActivity.evidenceState).toBe('workspace');
    expect(noActivity.toolRecordReason).toBe('no_write_activity');

    const emptyRecord = resolveGeneratedFileSource({
      change: CHANGE,
      workspaceAvailable: true,
      activities: [activity({ resultData: { path: CHANGE.path, bytes: 12 } })],
    });
    expect(emptyRecord.toolRecordReason).toBe('tool_result_has_no_content');
  });

  it('can fall back to a tool record when the workspace file is unavailable', () => {
    const source = resolveGeneratedFileSource({
      change: CHANGE,
      workspaceAvailable: false,
      activities: [activity({ resultData: { filePath: CHANGE.path, text: 'recorded' } })],
    });
    expect(source.evidenceState).toBe('tool-record');
    expect(source.workspaceAvailable).toBe(false);
  });

  it('returns none when neither source has evidence', () => {
    const source = resolveGeneratedFileSource({ change: CHANGE, workspaceAvailable: false });
    expect(source.evidenceState).toBe('none');
  });

  it('computes the four panel states in priority order', () => {
    expect(resolveGeneratedFilesPanelState({ loading: true, error: 'x', fileCount: 3 })).toBe('loading');
    expect(resolveGeneratedFilesPanelState({ loading: false, error: 'x', fileCount: 3 })).toBe('error');
    expect(resolveGeneratedFilesPanelState({ loading: false, fileCount: 0 })).toBe('empty');
    expect(resolveGeneratedFilesPanelState({ loading: false, fileCount: 2 })).toBe('ready');
  });
});
