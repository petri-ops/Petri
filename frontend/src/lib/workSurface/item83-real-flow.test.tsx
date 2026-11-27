/**
 * item83 第三轮 HK-01：用真实执行流形状（同 traceId / 不同 iteration / workspace URL）
 * 钉四类进面板、面板视频可播、网格按一轮聚合。不用旧 mock 的 /api/generated + 同 iteration。
 */
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generatedArtifactsFromActivities,
  generatedVideoArtifactsFromActivities,
} from './generatedFileSource';
import { groupGeneratedActivities } from '@/lib/generatedArtifactGroups';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

const TRACE = 'trace_77e5c0a5-074d-4da0-acf6-554575d2093a';
const wsUrl = (p: string) => `/api/workspaces/p1/file?path=${encodeURIComponent(p)}`;

const activities = [
  { key: 'a1', name: 'generate.image', status: 'success', traceId: TRACE, iteration: 2, resultData: { path: 'generated/image/a.png', url: wsUrl('generated/image/a.png'), mime: 'image/png' } },
  { key: 'a2', name: 'generate.model3d', status: 'success', traceId: TRACE, iteration: 4, resultData: { path: 'generated/model3d/s.glb', url: wsUrl('generated/model3d/s.glb'), mime: 'model/gltf-binary' } },
  { key: 'a3', name: 'generate.html', status: 'success', traceId: TRACE, iteration: 5, resultData: { path: 'generated/html/p.html', url: wsUrl('generated/html/p.html'), mime: 'text/html' } },
  { key: 'a4', name: 'generate.video', status: 'success', traceId: TRACE, iteration: 6, resultData: { path: 'generated/video/v.mp4', url: wsUrl('generated/video/v.mp4'), mime: 'video/mp4' } },
] as ToolActivityItem[];

afterEach(cleanup);

describe('item83 真实执行流三症', () => {
  it('HK-01 四类产物（workspace URL）全部进面板', () => {
    const list = generatedArtifactsFromActivities(activities);
    expect(list.map((a) => a.kind)).toEqual(['image', 'model3d', 'html', 'video']);
  });

  it('HK-01 面板视频供给链认 workspace URL，可生成 video 元素', () => {
    const videos = generatedVideoArtifactsFromActivities(activities);
    expect(videos.length).toBe(1);
    expect(videos[0].url).toBe(wsUrl('generated/video/v.mp4'));
  });

  it('HK-01 同一 traceId 的多轮产物聚合为一个网格（iteration 不同也不拆）', () => {
    const groups = groupGeneratedActivities(activities);
    expect(groups.length).toBe(1);
    expect(groups[0].artifacts.length).toBe(4);
  });
});
