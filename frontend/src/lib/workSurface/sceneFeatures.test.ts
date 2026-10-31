/**
 * BLOCK-322 P3-03 v2b 第二票 — 前端特征表同源移植契约（与后端 model3d-features.js 对账）。
 *
 * R4 禁 import → 同源移植（同 packWriteBridge 模式）；漂移由两侧测试对账：
 *   同输入（node.type + dimensions）→ 同 feature id（sha256 跨端一致）。
 */
import { describe, expect, it } from 'vitest';
import { deriveSceneFeatures, deriveSceneFeatureTable } from './sceneFeatures';

describe('P3-03 v2b sceneFeatures（前端移植）', () => {
  it('box 6 平面特征表', () => {
    const features = deriveSceneFeatures({ id: 'a', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } });
    expect(features.length).toBe(6);
    expect(features.every((f) => f.kind === 'plane')).toBe(true);
    expect(features.every((f) => f.id.startsWith('feat:'))).toBe(true);
  });

  it('cylinder 2 平面 + 1 圆柱侧', () => {
    const features = deriveSceneFeatures({ id: 'boss', type: 'cylinder', dimensions: { radius: 40, height: 25 } });
    expect(features.filter((f) => f.kind === 'plane').length).toBe(2);
    expect(features.filter((f) => f.kind === 'cylinder').length).toBe(1);
  });

  it('特征 id 跨调用可复现（同输入同 id）', () => {
    const node = { id: 'a', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } };
    const first = deriveSceneFeatures(node).map((f) => f.id);
    const second = deriveSceneFeatures(node).map((f) => f.id);
    expect(first).toEqual(second);
  });

  it('全场景特征表（按节点聚合）', () => {
    const table = deriveSceneFeatureTable([
      { id: 'a', type: 'box', dimensions: { width: 120, depth: 80, height: 30 } },
      { id: 'boss', type: 'cylinder', dimensions: { radius: 40, height: 25 } },
    ]);
    expect(Object.keys(table).sort()).toEqual(['a', 'boss']);
    expect(table.a.length).toBe(6);
    expect(table.boss.length).toBe(3);
  });
});
