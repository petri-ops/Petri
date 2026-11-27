/**
 * item83 返工追加第4症 HK-01：真实 3D 描述符形态必须自动挂卡，覆盖降级路径。
 * 真实来源：owner 会话 model3d_asset（import，workspace-relative GLB）与
 * model3d_recipe（84 本地近似，source.provider='local'），均非 generate.model3d。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ChatArtifactGridCard } from './ChatArtifactGridCard';
import { groupGeneratedActivities } from '@/lib/generatedArtifactGroups';
import type { ToolActivityItem } from './toolActivity';

afterEach(cleanup);

const assetActivity = {
  key: 'a1', name: 'model3d_asset', status: 'success', iteration: 1,
  actionDetail: 'action=import · name=lucky-cat-seed3d',
  resultData: {
    ok: true,
    asset: {
      id: 'asset-0eb6c91266461400', name: 'lucky-cat-seed3d',
      path: 'model3d/assets/0eb6c912664614004089ca8b4df5ea797f87a15d6092128607597bfecfab190e.glb',
      sha256: '0eb6c912664614004089ca8b4df5ea797f87a15d6092128607597bfecfab190e',
      bytes: 22861024, format: 'glb',
      sourcePath: 'concept/3d/lucky-cat-seed3d/pbr/mesh_textured_pbr.glb',
    },
  },
};

const recipeActivity = {
  key: 'a2', name: 'model3d_recipe', status: 'success', iteration: 2,
  resultData: {
    ok: true,
    recipe: { id: 'box-enclosure' },
    written: { path: 'model3d/recipes/box-enclosure.scene3d.json' },
    render: { ok: true, outputs: [{ path: 'model3d/runs/wave1/model.glb' }] },
    source: {
      provider: 'local', mode: 'parametric-recipe', status: 'approximation',
      synthetic: true, label: '本地近似非 AI 生成',
    },
  },
};

const generatedActivity = {
  key: 'a3', name: 'generate.model3d', status: 'success', iteration: 3,
  resultData: {
    path: '/data/generated/generate-model3d/model-cgt1.glb',
    sha256: 'a'.repeat(64), mime: 'model/gltf-binary',
    url: '/api/generated/file/model3d/model-cgt1.glb',
    source: { provider: 'ark', model: 'seed3d', mode: 'image-to-3d' },
  },
};

describe('item83 真实 3D 自动挂卡', () => {
  it('HK-01 三条真实路径全部归一化为 3D 产物', () => {
    const groups = groupGeneratedActivities([assetActivity, recipeActivity, generatedActivity] as ToolActivityItem[]);
    const artifacts = groups.flatMap((g) => g.artifacts);
    expect(artifacts.filter((a) => (a.name || '').endsWith('.glb')).length).toBe(3);
    expect(artifacts.some((a) => a.source?.provider === 'local')).toBe(true);
  });

  it('HK-01 GLB 生成后会话区自动出 3D 卡（含降级路径）', () => {
    const groups = groupGeneratedActivities([assetActivity, recipeActivity, generatedActivity] as ToolActivityItem[]);
    render(<ChatArtifactGridCard groups={groups} projectId="p1" />);
    expect(screen.getAllByTestId('chat-artifact-card').length).toBeGreaterThanOrEqual(3);
  });
});
