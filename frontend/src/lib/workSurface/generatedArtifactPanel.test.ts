/** item83 返工 HK-01：四类生成产物（image/video/model3d/html）全部进文件面板。 */
import { describe, expect, it } from 'vitest';
import { generatedArtifactsFromActivities } from './generatedFileSource';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

const descriptor = (kind: string, name: string) => ({
  path: `/data/generated/generate-${kind}/${name}`,
  url: `/api/generated/file/${kind}/${name}`,
  mime: kind === 'image' ? 'image/png' : kind === 'video' ? 'video/mp4' : kind === 'html' ? 'text/html' : 'model/gltf-binary',
  source: { provider: 'ark' },
});

describe('item83 四类产物进面板', () => {
  it('HK-01 image/video/model3d/html 全部归一化，且只认 /api/generated/', () => {
    const activities = [
      { key: 'a1', name: 'generate.image', status: 'success', resultData: descriptor('image', 'a.png') },
      { key: 'a2', name: 'generate.video', status: 'success', resultData: descriptor('video', 'b.mp4') },
      { key: 'a3', name: 'generate.model3d', status: 'success', resultData: descriptor('model3d', 'c.glb') },
      { key: 'a4', name: 'generate.html', status: 'success', resultData: descriptor('html', 'd.html') },
      // item83 第二轮：项目工作区读面是主路径，必须纳入面板。
      { key: 'a5', name: 'generate.image', status: 'success', resultData: { path: 'generated/image/x.png', url: '/api/workspaces/p/file?path=generated%2Fimage%2Fx.png' } },
      { key: 'a6', name: 'generate.image', status: 'success', resultData: { path: '/cwd/outside.png', url: '/api/workspaces/other/file?path=outside.png' } },
    ] as ToolActivityItem[];
    const artifacts = generatedArtifactsFromActivities(activities);
    expect(artifacts.map((a) => a.kind)).toEqual(['image', 'video', 'model3d', 'html', 'image', 'image']);
    expect(artifacts.every((a) => a.url.startsWith('/api/generated/file/') || a.url.startsWith('/api/workspaces/'))).toBe(true);
  });
});
