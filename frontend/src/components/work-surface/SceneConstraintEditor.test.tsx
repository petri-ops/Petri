/**
 * BLOCK-322 P3-03 v2b 第二票（前端半）— 约束编辑器组件契约（红绿先行）。
 *
 * ① 合法提交 → add_constraint 操作发到 sceneEditClient
 * ② 校验失败 → 错误如实显示（后端 fail-closed 透传）
 * ③ 移除按钮 → remove_constraint
 */
import assert from 'node:assert/strict';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SceneConstraintEditor from './SceneConstraintEditor';

const applySceneOperations = vi.fn();

vi.mock('@/lib/sceneEditClient', () => ({
  applySceneOperations: (...args: unknown[]) => applySceneOperations(...args),
}));

const SCENE = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  name: 'probe',
  parameters: {},
  nodes: [
    { id: 'base', type: 'box', name: 'Base', dimensions: { width: 120, depth: 80, height: 30 }, transform: { position: [0, 0, 0] } },
    { id: 'lid', type: 'box', name: 'Lid', dimensions: { width: 120, depth: 80, height: 10 }, transform: { position: [0, 0, 0] } },
  ],
  constraints: [],
};

beforeEach(() => {
  applySceneOperations.mockReset();
});

afterEach(() => cleanup());

describe('P3-03 v2b SceneConstraintEditor', () => {
  it('合法提交 → add_constraint 操作发到 scene/apply', async () => {
    applySceneOperations.mockResolvedValue({ ok: true, scene: SCENE });
    render(
      <SceneConstraintEditor
        projectId="p_1"
        scene={SCENE as never}
        scenePath="model3d/scene.scene3d.json"
        expectedHash="hash_1"
        onSceneUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('constraint-editor-submit'));
    await waitFor(() => expect(applySceneOperations).toHaveBeenCalledTimes(1));
    const input = applySceneOperations.mock.calls[0][0];
    expect(input.operations[0].op).toBe('add_constraint');
    expect(input.operations[0].constraint.kind).toBe('mate');
    expect(input.operations[0].constraint.a).toBe('base');
    expect(input.operations[0].constraint.b).toBe('lid');
  });

  it('后端 fail-closed → 错误如实透传显示', async () => {
    applySceneOperations.mockResolvedValue({ ok: false, error: 'mate_face_incompatible', message: '世界法向须相反且同轴' });
    render(
      <SceneConstraintEditor
        projectId="p_1"
        scene={SCENE as never}
        scenePath="model3d/scene.scene3d.json"
        expectedHash={null}
        onSceneUpdated={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId('constraint-editor-submit'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('世界法向须相反'));
  });

  it('移除按钮 → remove_constraint 操作', async () => {
    const sceneWithConstraint = {
      ...SCENE,
      constraints: [{ id: 'cs_1', kind: 'mate', a: 'base', b: 'lid', aFace: '+z', bFace: '-z' }],
    };
    applySceneOperations.mockResolvedValue({ ok: true, scene: sceneWithConstraint });
    render(
      <SceneConstraintEditor
        projectId="p_1"
        scene={sceneWithConstraint as never}
        scenePath="model3d/scene.scene3d.json"
        expectedHash={null}
        onSceneUpdated={() => {}}
      />,
    );
    const removeBtn = screen.getByLabelText('移除约束 cs_1');
    fireEvent.click(removeBtn);
    await waitFor(() => expect(applySceneOperations).toHaveBeenCalledTimes(1));
    expect(applySceneOperations.mock.calls[0][0].operations[0].op).toBe('remove_constraint');
  });

  it('少于 2 个特征表节点 → 诚实提示（不渲染表单）', () => {
    const singleNodeScene = { ...SCENE, nodes: [SCENE.nodes[0]] };
    render(
      <SceneConstraintEditor
        projectId="p_1"
        scene={singleNodeScene as never}
        scenePath="model3d/scene.scene3d.json"
        expectedHash={null}
        onSceneUpdated={() => {}}
      />,
    );
    expect(screen.queryByTestId('constraint-editor-form')).toBeNull();
    expect(screen.getByText(/至少两个/)).toBeDefined();
  });
});
