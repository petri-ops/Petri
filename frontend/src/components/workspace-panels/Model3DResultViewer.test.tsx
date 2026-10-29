/**
 * RW-01 — Result Studio 内嵌 3D viewer（薄壳复用 Model3DScene）契约。
 *
 * plan: docs/rw01 §1.2/§1.5：
 * 1. 挂载即把 artifact 绑定进选择总线（setSelectionBusArtifact 语义）
 * 2. 点击面写 artifact 级选择（entityIds=[artifactId]，origin=point_select）
 * 3. WebGL 不可用时如实降级提示（经 Model3DScene onError 路径），不假装渲染成功
 *
 * Model3DScene 以 stub 代入：three.js/WebGL 在 happy-dom 无渲染上下文（真挂载会
 * V8 OOM——RW-06 vitest 通道债在册），薄壳契约（总线绑定/点击选择/降级 UI）不依赖
 * three.js 内部；Model3DScene 自身的渲染行为由 work-surface 实机腿承索。
 */
import assert from 'node:assert/strict';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import {
  getSelectionBusState,
  setSelectionBusArtifact,
  subscribeSelectionBus,
} from '@/lib/selectionBus';

const onErrorSpy = vi.fn();

vi.mock('@/components/work-surface/Model3DScene', () => ({
  Model3DScene: (props: {
    onError?: (message: string) => void;
    onReady?: (info: { objects: number; bounds: number[] }) => void;
  }) => {
    // 模拟 happy-dom 无 WebGL 的内核降级路径（onError 一次）
    React.useEffect(() => {
      props.onError?.('webgl_unavailable');
    }, []);
    return <div data-testid="model3d-scene-stub" />;
  },
}));

import Model3DResultViewer from './Model3DResultViewer';

afterEach(() => {
  cleanup();
  onErrorSpy.mockClear();
  setSelectionBusArtifact({ artifactId: '', revisionId: null });
});

describe('RW01 Model3DResultViewer', () => {
  it('挂载即绑定 artifact 进选择总线（换 artifact 清旧选择）', () => {
    const seen: Array<{ artifactId: string; revisionId: string | null }> = [];
    const unsubscribe = subscribeSelectionBus((state) => seen.push({ artifactId: state.artifactId, revisionId: state.revisionId }));
    try {
      render(
        <Model3DResultViewer
          url="http://localhost:3000/api/files/model3d/runs/r1/enclosure.glb"
          name="enclosure.glb"
          artifactId="model3d:model3d/recipes/box.scene3d.json:glb"
          revisionId="rev_model3d_abc"
        />,
      );
      const bound = seen.find((entry) => entry.artifactId === 'model3d:model3d/recipes/box.scene3d.json:glb');
      assert.ok(bound, '必须发生 artifact 绑定');
      assert.equal(bound.revisionId, 'rev_model3d_abc');
      assert.equal(getSelectionBusState().artifactId, 'model3d:model3d/recipes/box.scene3d.json:glb');
    } finally {
      unsubscribe();
    }
  });

  it('点击查看面写 artifact 级选择（point_select，entityIds=[artifactId]）', () => {
    render(
      <Model3DResultViewer
        url="http://localhost:3000/api/files/model3d/runs/r1/enclosure.glb"
        name="enclosure.glb"
        artifactId="model3d:x:glb"
        revisionId="rev1"
      />,
    );
    const surface = screen.getByTestId('model3d-result-viewer-surface');
    fireEvent.click(surface);
    const selection = getSelectionBusState().selection;
    assert.ok(selection, '点击必须写选择');
    assert.equal(selection.entityType, 'model3d_artifact');
    assert.equal(selection.origin, 'point_select');
    assert.deepEqual(selection.entityIds, ['model3d:x:glb']);
    assert.equal(selection.entityIdCount, 1);
    assert.equal(selection.revisionId, 'rev1');
  });

  it('WebGL 降级：onError 路径显示如实提示而非崩溃', () => {
    render(
      <Model3DResultViewer
        url="http://localhost:3000/api/files/model3d/runs/r1/enclosure.glb"
        name="enclosure.glb"
        artifactId="model3d:x:glb"
        revisionId="rev1"
      />,
    );
    expect(screen.getByText('3D 预览不可用')).toBeDefined();
    expect(screen.getByText(/WebGL/)).toBeDefined();
  });
});
