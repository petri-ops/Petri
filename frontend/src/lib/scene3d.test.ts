import { describe, expect, it } from 'vitest';
import { normalizeScene3DForView, sampleScene3D } from './scene3d';

describe('scene3d viewer normalization (NEXT-04A)', () => {
  it('示例 SceneSpec 解析参数引用并给出统计', () => {
    const result = normalizeScene3DForView(sampleScene3D());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.stats.nodes).toBe(2);
    expect(result.view.nodes[0].dimensions).toMatchObject({ width: 120, height: 40, depth: 80 });
    expect(result.view.nodes[0].type).toBe('box');
  });

  it('未知版本/单位/非法尺寸 fail-closed', () => {
    const invalid = normalizeScene3DForView({
      ...sampleScene3D(),
      units: 'inch',
      nodes: [{ id: 'x', type: 'box', dimensions: { width: 'missing', height: 1, depth: 1 } }],
    });
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.errors.join('；')).toContain('units 必须是 mm');
    expect(invalid.errors.join('；')).toContain('引用无效');
  });

  it('mesh-reference 保留警告但不伪造几何', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      nodes: [{
        id: 'mesh', type: 'mesh-reference', source: { path: 'a.glb', sourceSha256: 'a'.repeat(64) },
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.warnings[0]).toContain('外部 mesh');
  });
});
