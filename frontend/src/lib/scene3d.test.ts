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

  it('BLOCK-322 P3-01 几何操作白名单：合法通过、非法逐条拒、并声明预览不重做几何', () => {
    const valid = normalizeScene3DForView({
      ...sampleScene3D(),
      nodes: [
        { id: 'cutter', type: 'box', dimensions: { width: 40, height: 40, depth: 40 } },
        {
          id: 'base',
          type: 'box',
          dimensions: { width: 120, height: 40, depth: 80 },
          modifiers: [
            { kind: 'boolean', operation: 'difference', target: 'cutter' },
            { kind: 'bevel', width: 2, segments: 2 },
            { kind: 'array', count: 3, offset: [140, 0, 0] },
          ],
        },
      ],
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;
    expect(valid.view.warnings.join('；')).toContain('预览显示未加工基元');
    expect(valid.view.warnings.join('；')).toContain('boolean/bevel/array');

    const cases: Array<{ nodes: unknown[]; keyword: string }> = [
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'shell', width: 1 }] }], keyword: 'kind 只支持 bevel/array/boolean' },
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'bevel', width: 0 }] }], keyword: 'width 须在 (0,100] mm' },
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'array', count: 999 }] }], keyword: 'count 须是 1..64 的整数' },
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'boolean', operation: 'difference', target: 'ghost' }] }], keyword: 'boolean 目标 ghost 不是已存在节点' },
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'boolean', operation: 'difference', target: 'a' }] }], keyword: '不能对节点自身做 boolean' },
      { nodes: [{ id: 'a', type: 'box', dimensions: { width: 1, height: 1, depth: 1 }, modifiers: [{ kind: 'bevel', width: 2, radius: 1 }] }], keyword: 'radius 不在 bevel 白名单' },
    ];
    for (const item of cases) {
      const result = normalizeScene3DForView({ ...sampleScene3D(), nodes: item.nodes });
      expect(result.ok, JSON.stringify(item.nodes)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('；')).toContain(item.keyword);
    }
  });

  it('BLOCK-322 P3-02a 三类装配约束通过解析，并如实声明预览未求值', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      constraints: [
        { kind: 'align', a: 'enclosure', b: 'port', axis: 'x' },
        { kind: 'distance', a: 'enclosure', b: 'port', axis: 'z', value: 60 },
        { kind: 'angle', a: 'enclosure', b: 'port', axis: 'z', value: -12.5 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.scene.constraints).toHaveLength(3);
    expect(result.view.stats.constraints).toBe(3);
    expect(result.view.warnings.join('；')).toContain('装配约束在服务端求值后烘进 transform');
    expect(result.view.warnings.join('；')).toContain('按声明位置显示');
  });

  it('BLOCK-322 P3-02a 非法约束 fail-closed（不再静默丢弃，与服务端同判据）', () => {
    const cases: Array<{ constraints: unknown; keyword: string }> = [
      { constraints: [{ kind: 'mate', a: 'enclosure', b: 'port', axis: 'x' }], keyword: 'kind 只支持 align/distance/angle' },
      { constraints: [{ kind: 'align', a: 'enclosure', b: 'ghost', axis: 'x' }], keyword: '引用未知节点' },
      { constraints: [{ kind: 'align', a: 'enclosure', b: 'enclosure', axis: 'x' }], keyword: '不能约束自身' },
      { constraints: [{ kind: 'distance', a: 'enclosure', b: 'port', axis: 'x' }], keyword: 'value 必须是有限数值' },
      { constraints: [{ kind: 'align', a: 'enclosure', b: 'port', axis: 'w' }], keyword: 'axis 非法' },
      { constraints: [{ kind: 'align', a: 'enclosure', b: 'port', axis: 'x', offset: 2 }], keyword: 'offset 不在 align 白名单' },
      { constraints: 'nope', keyword: 'constraints 必须是数组' },
    ];
    for (const item of cases) {
      const result = normalizeScene3DForView({ ...sampleScene3D(), constraints: item.constraints });
      expect(result.ok, JSON.stringify(item.constraints)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('；')).toContain(item.keyword);
    }
    const legacy = normalizeScene3DForView({
      ...sampleScene3D(),
      constraints: [{ kind: 'align', a: 'enclosure', b: 'port', axis: 'x' }],
    });
    expect(legacy.ok, '存量 align 场景不得因新白名单被拒').toBe(true);
  });

  it('BLOCK-322 P2-02 灯光与环境声明通过解析并保留在 scene 上', () => {
    const result = normalizeScene3DForView({
      ...sampleScene3D(),
      lights: [
        { id: 'key', kind: 'sun', energy: 3, color: '#ffffff', position: [200, -300, 400], target: [0, 0, 20] },
        { id: 'fill', kind: 'area', energy: 1.2, size: 180, position: [-220, -160, 120] },
      ],
      environment: { background: '#101418', worldStrength: 0.35, samples: 16, engine: 'cycles' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.scene.lights).toHaveLength(2);
    expect(result.view.scene.environment).toEqual({ background: '#101418', worldStrength: 0.35, samples: 16, engine: 'cycles' });
  });

  it('BLOCK-322 P2-02 非法灯光/环境 fail-closed（与后端同判据）', () => {
    const base = { ...sampleScene3D() };
    const cases: Array<{ extra: Record<string, unknown>; keyword: string }> = [
      { extra: { lights: [{ id: 'k', kind: 'laser', energy: 3, position: [0, 0, 1] }] }, keyword: 'kind 只支持 sun/point/spot/area' },
      { extra: { lights: [{ id: 'k', kind: 'sun', energy: 9000, position: [0, 0, 1] }] }, keyword: 'energy 须在 0..1000' },
      { extra: { lights: [{ id: 'k', kind: 'sun', energy: 3 }] }, keyword: 'position 非法' },
      { extra: { lights: [{ id: 'k', kind: 'sun', energy: 3, position: [0, 0, 1] }, { id: 'k', kind: 'point', energy: 1, position: [0, 0, 2] }] }, keyword: '重复灯光 id' },
      { extra: { lights: Array.from({ length: 17 }, (_, index) => ({ id: `l${index}`, kind: 'sun', energy: 1, position: [0, 0, index + 1] })) }, keyword: '灯光数量超限' },
      { extra: { lights: 'nope' }, keyword: 'lights 必须是数组' },
      { extra: { environment: { background: 'nope' } }, keyword: 'environment.background 须是 #rrggbb' },
      { extra: { environment: { samples: 0 } }, keyword: 'samples 须是 1..128 的整数' },
      { extra: { environment: { engine: 'eevee' } }, keyword: 'engine 只支持 workbench/cycles' },
      { extra: { environment: [] }, keyword: 'environment 必须是对象' },
    ];
    for (const item of cases) {
      const result = normalizeScene3DForView({ ...base, ...item.extra });
      expect(result.ok, JSON.stringify(item.extra)).toBe(false);
      if (result.ok) continue;
      expect(result.errors.join('；')).toContain(item.keyword);
    }
  });
});
