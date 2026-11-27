/**
 * item 83 核心验收 HK-01：生成工具成功返回 → 会话流自动出现结果卡片。
 * 零用户提示、零额外请求、agent 回复不需要任何特殊标记；触发只认 tool activity 的
 * name=generate.* + status=success + resultData 产物描述符。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolActivityList } from './ToolActivityList';
import type { ToolActivityItem } from './toolActivity';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const descriptor = (kind: string, name: string) => ({
  path: `/data/generated/generate-${kind}/${name}`,
  sha256: 'sha',
  mime: kind === 'image' ? 'image/png' : 'model/gltf-binary',
  url: `/api/generated/file/${kind}/${name}`,
  source: { provider: 'ark', model: 'seedream' },
});

function generateActivity(name: string, resultData: unknown): ToolActivityItem {
  return {
    key: `auto:${name}`,
    name,
    status: 'success',
    actionLabel: '已生成',
    // 故意不含任何用户提示/特殊标记：触发只能来自产物本身
    actionDetail: '',
    resultData,
  };
}

afterEach(() => cleanup());

describe('item 83 产物驱动自动出卡', () => {
  it('HK-01 generate.image 多候选数组：成功即出 3 个网格瓦片，无需标记或 toolJobId', async () => {
    render(<ToolActivityList activities={[generateActivity('generate.image', [
      descriptor('image', 'image-1.png'),
      descriptor('image', 'image-2.png'),
      descriptor('image', 'image-3.png'),
    ])]} forceOpen projectId={null} />);
    // item83 追加④：多产物改网格卡（原单卡 tabs 已被网格瓦片取代）。
    expect(await screen.findAllByTestId('chat-artifact-grid-tile')).toHaveLength(3);
    expect(screen.getByTestId('chat-artifact-grid-header').textContent).toContain('本轮产物 3 项');
  });

  it('HK-01 generate.model3d 单描述符：成功即出 3D 卡', async () => {
    render(<ToolActivityList activities={[generateActivity('generate.model3d', descriptor('model3d', 'scene.glb'))]} forceOpen projectId={null} />);
    expect(await screen.findByTestId('chat-artifact-3d-actions')).toBeTruthy();
  });

  it('HK-01 失败产物不自动出卡（fail-closed）', () => {
    render(<ToolActivityList activities={[{
      ...generateActivity('generate.image', descriptor('image', 'image-1.png')),
      status: 'error',
    }]} forceOpen projectId={null} />);
    expect(screen.queryByTestId('chat-artifact-card')).toBeNull();
  });
});
