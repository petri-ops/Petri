import { describe, expect, it } from 'vitest';
import { resolveResultViewer, viewerProfileCanSelect } from './viewerRegistry';

/**
 * RW-01 — viewerRegistry 3D 路由契约（HK-01 红绿先行：实现前本文件三断言红）。
 *
 * 契约来源：docs/rw-01-3d-artifact-revision-plan.md §5 G1 前端两件：
 * 1. kind='model3d' 与 .glb/.gltf/.stl/.obj/.scene3d.json 扩展名命中 model3d adapter
 *    （先于 .json / binary 兜底）
 * 2. profile：artifact 级选择能力声明（canSelect=true），比较/导出如实 false
 */
describe('RW01 viewerRegistry model3d routing', () => {
  it('kind=model3d 命中 model3d adapter（扩展名无关）', () => {
    const resolved = resolveResultViewer({ kind: 'model3d', fileName: 'enclosure.glb' });
    expect(resolved.adapter).toBe('model3d');
  });

  it('3D 扩展名族命中 model3d adapter（先于 json/binary 兜底）', () => {
    for (const fileName of ['enclosure.glb', 'enclosure.gltf', 'enclosure.stl', 'enclosure.obj', 'box-enclosure.scene3d.json']) {
      const resolved = resolveResultViewer({ kind: 'file', fileName });
      expect(resolved.adapter).toBe('model3d');
    }
  });

  it('model3d profile：可进选择总线（artifact 级），不可比较；导出能力如实声明', () => {
    const resolved = resolveResultViewer({ kind: 'model3d', fileName: 'a.glb' });
    expect(resolved.canSelect).toBe(true);
    expect(resolved.canCompare).toBe(false);
    expect(viewerProfileCanSelect('model3d')).toBe(true);
  });

  it('非 3D 扩展名与未知 kind 不被 3D 规则误捕', () => {
    expect(resolveResultViewer({ kind: 'table', fileName: 'data.csv' }).adapter).toBe('table');
    expect(resolveResultViewer({ kind: 'file', fileName: 'notes.json' }).adapter).toBe('json');
    expect(resolveResultViewer({ kind: 'file', fileName: 'model.ply' }).adapter).toBe('binary');
  });
});
