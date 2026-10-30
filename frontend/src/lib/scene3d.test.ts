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

  it('mesh-reference 校验源路径与 sha，并给出工作区加载提示', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      nodes: [{
        id: 'mesh', type: 'mesh-reference', source: { path: 'model3d/assets/a.glb', sourceSha256: 'a'.repeat(64) },
      }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.warnings[0]).toContain('外部 mesh');
    expect(result.view.warnings[0]).toContain('工作区');
    expect(result.view.nodes[0].type).toBe('mesh-reference');
  });

  it('mesh-reference 缺 sha / 非法扩展名 / 绝对路径 fail-closed（与服务端同判据）', () => {
    const cases: Array<{ source: unknown; keyword: string }> = [
      { source: { path: 'a.glb' }, keyword: 'mesh_source_hash_required' },
      { source: { path: 'notes.txt', sourceSha256: 'a'.repeat(64) }, keyword: 'mesh_format_unsupported' },
      { source: { path: '/etc/passwd.glb', sourceSha256: 'a'.repeat(64) }, keyword: 'source.path 非法' },
      { source: { path: '../outside.glb', sourceSha256: 'a'.repeat(64) }, keyword: 'source.path 非法' },
    ];
    for (const item of cases) {
      const result = normalizeScene3DForView({
        ...sampleScene3D(),
        nodes: [{ id: 'mesh', type: 'mesh-reference', source: item.source }],
      });
      expect(result.ok, JSON.stringify(item.source)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('；')).toContain(item.keyword);
    }
  });

  it('BLOCK-322 P2-01 声明相机与分辨率通过解析并保留在 scene 上', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      camera: { position: [300, -300, 260], target: [0, 0, 20], fovDeg: 35 },
      render: { width: 1600, height: 900 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.scene.camera).toMatchObject({ fovDeg: 35 });
    expect(result.view.scene.render).toEqual({ width: 1600, height: 900 });
    expect(result.view.warnings).toHaveLength(0);
  });

  it('BLOCK-322 P2-01 非法相机声明 fail-closed（同后端判据）', () => {
    const cases: Array<{ camera: unknown; keyword: string }> = [
      { camera: { position: [1, 2, 3] }, keyword: 'camera.target 非法' },
      { camera: { position: [1, 2, 3], target: [1, 2, 3] }, keyword: '视线退化' },
      { camera: { position: [1, 2, 3], target: [4, 5, 6], fovDeg: 200 }, keyword: 'camera.fovDeg' },
      { camera: { position: [1, 2, 3], target: [4, 5, 6], projection: 'orthographic' }, keyword: 'orthoScaleMm' },
      { camera: { position: [0, 0, 0], target: [0, 0, 100], up: [0, 0, 1] }, keyword: 'camera.up 与视线共线' },
      { camera: 'nope', keyword: 'camera 必须是对象' },
    ];
    for (const item of cases) {
      const result = normalizeScene3DForView({ ...sampleScene3D(), camera: item.camera });
      expect(result.ok, JSON.stringify(item.camera)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('；')).toContain(item.keyword);
    }
    const badRender = normalizeScene3DForView({ ...sampleScene3D(), render: { width: 8 } });
    expect(badRender.ok).toBe(false);
    if (badRender.ok) return;
    expect(badRender.errors.join('；')).toContain('render.width 须是 16..4096 的整数');
  });

  it('BLOCK-322 P2-01 正交机位在预览端如实声明差异，不假装一致', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      camera: {
        position: [0, -400, 200], target: [0, 0, 0], projection: 'orthographic', orthoScaleMm: 320,
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.warnings.join('；')).toContain('正交');
    expect(result.view.warnings.join('；')).toContain('不假装投影一致');
  });
});
