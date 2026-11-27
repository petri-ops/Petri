import { describe, expect, it } from 'vitest';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';
import {
  generatedVideoArtifactsFromActivities,
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

  it('counts generated video artifacts toward the ready state (item 85)', () => {
    expect(resolveGeneratedFilesPanelState({ loading: false, fileCount: 0, generatedArtifactCount: 1 })).toBe('ready');
    expect(resolveGeneratedFilesPanelState({ loading: false, fileCount: 0, generatedArtifactCount: 0 })).toBe('empty');
    // 优先序不变：loading/error 仍压过产物计数
    expect(resolveGeneratedFilesPanelState({ loading: true, fileCount: 0, generatedArtifactCount: 1 })).toBe('loading');
  });
});

describe('generated video artifacts from activities (item 85)', () => {
  it('collects video descriptors from successful generate.video activities', () => {
    const items = generatedVideoArtifactsFromActivities([
      activity({
        name: 'generate.video',
        resultData: {
          path: '/data/generated/generate-video/clip.mp4',
          url: '/api/generated/file/video/clip.mp4',
          mime: 'video/mp4',
        },
      }),
    ]);
    expect(items).toEqual([
      { name: 'clip.mp4', path: '/data/generated/generate-video/clip.mp4', url: '/api/generated/file/video/clip.mp4' },
    ]);
  });

  it('supports array resultData and dedupes by url keeping the first', () => {
    const items = generatedVideoArtifactsFromActivities([
      activity({
        name: 'generate.video',
        resultData: [
          { path: '/d/v/a.mp4', url: '/api/generated/file/video/a.mp4' },
          { path: '/d/v/b.mp4', url: '/api/generated/file/video/b.mp4' },
        ],
      }),
      activity({
        name: 'generate.video',
        resultData: { path: '/d/v/a-renamed.mp4', url: '/api/generated/file/video/a.mp4' },
      }),
    ]);
    expect(items.map((item) => item.name)).toEqual(['a.mp4', 'b.mp4']);
    expect(items[0].path).toBe('/d/v/a.mp4');
  });

  it('ignores failed activities, non-generated urls, and non-video kinds (fail-closed)', () => {
    const items = generatedVideoArtifactsFromActivities([
      activity({ name: 'generate.video', status: 'error', resultData: { path: '/d/v/x.mp4', url: '/api/generated/file/video/x.mp4' } }),
      activity({ name: 'generate.video', resultData: { path: '/d/v/y.mp4', url: '/workspace/raw/y.mp4' } }),
      activity({ name: 'generate.image', resultData: { path: '/d/i/z.png', url: '/api/generated/file/image/z.png' } }),
      activity({ name: 'generate.video', resultData: { path: '/d/v/no-url.mp4' } }),
      activity({ name: 'generate.video', resultData: { url: '/api/generated/file/video/no-path.mp4' } }),
    ]);
    expect(items).toEqual([]);
  });
});
