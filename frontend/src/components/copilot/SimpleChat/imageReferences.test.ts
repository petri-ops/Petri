import { describe, expect, it } from 'vitest';

// BLOCK-52 P2 — 图片/结果图引用纯函数助手测试。
// 被测模块对 '@/lib/events' 仅 import type（编译期擦除），运行时零额外依赖。
import {
  MAX_IMAGE_REFERENCES,
  makeImageReference,
  appendImageReference,
  imageReferenceSourceLine,
  composeMessageWithImageReferences,
} from './imageReferences';
import type { ImageQuoteDetail } from '@/lib/events';

function detail(overrides: Partial<ImageQuoteDetail> = {}): ImageQuoteDetail {
  return {
    projectId: 'p1',
    kind: 'workspace-file',
    name: 'umap.png',
    path: 'figures/umap.png',
    url: 'file:///ws/figures/umap.png',
    ...overrides,
  };
}

describe('imageReferences (BLOCK-52 P2)', () => {
  it('makeImageReference: workspace 静态图 → 带 path 的引用卡；空 name/url → null', () => {
    const ref = makeImageReference(detail());
    expect(ref).not.toBeNull();
    expect(ref!.id.startsWith('imgref-')).toBe(true);
    expect(ref!.kind).toBe('workspace-file');
    expect(ref!.name).toBe('umap.png');
    expect(ref!.path).toBe('figures/umap.png');
    expect(ref!.artifact).toBeUndefined();

    expect(makeImageReference(detail({ name: '  ' }))).toBeNull();
    expect(makeImageReference(detail({ url: '' }))).toBeNull();
  });

  it('makeImageReference: 结果图带 artifact 血统；缺 toolJobId 降级拒绝', () => {
    const ref = makeImageReference(
      detail({
        kind: 'result-artifact',
        path: undefined,
        name: 'volcano.png',
        artifact: { toolJobId: 'tj-1', revisionOrdinal: 3, revisionId: 'rev-9' },
      }),
    );
    expect(ref).not.toBeNull();
    expect(ref!.kind).toBe('result-artifact');
    expect(ref!.path).toBeUndefined();
    expect(ref!.artifact).toEqual({ toolJobId: 'tj-1', revisionOrdinal: 3, revisionId: 'rev-9' });

    // 血统不完整（无 toolJobId）→ 模型无法读图 → 拒绝创建
    expect(makeImageReference(detail({ kind: 'result-artifact' }))).toBeNull();
    expect(
      makeImageReference(detail({ kind: 'result-artifact', artifact: { toolJobId: '' } })),
    ).toBeNull();
  });

  it('appendImageReference: 追加 / 同源去重 / 上限截断', () => {
    const first = appendImageReference([], detail());
    expect(first).toHaveLength(1);

    // 完全同源（同 kind+名+路径）→ 去重
    const deduped = appendImageReference(first, detail());
    expect(deduped).toHaveLength(1);

    // 同名不同 revision → 追加（结果图场景）
    const two = appendImageReference(
      first,
      detail({ kind: 'result-artifact', path: undefined, artifact: { toolJobId: 'tj-1', revisionId: 'rev-2' } }),
    );
    expect(two).toHaveLength(2);

    // 上限截断：保留最近 MAX 条
    let refs = first;
    for (let i = 0; i < MAX_IMAGE_REFERENCES + 3; i++) {
      refs = appendImageReference(refs, detail({ path: `figures/img-${i}.png` }));
    }
    expect(refs).toHaveLength(MAX_IMAGE_REFERENCES);
    expect(refs[refs.length - 1].path).toBe(`figures/img-${MAX_IMAGE_REFERENCES + 2}.png`);

    // 无效载荷 → 原样返回（同一数组引用）
    const same = appendImageReference(refs, detail({ url: ' ' }));
    expect(same).toBe(refs);
  });

  it('imageReferenceSourceLine: 结果图显示 rev 序号；静态图显示路径', () => {
    expect(
      imageReferenceSourceLine({
        id: 'x',
        kind: 'result-artifact',
        name: 'v.png',
        url: '',
        artifact: { toolJobId: 'tj-1', revisionOrdinal: 3 },
      }),
    ).toBe('Result Studio 结果图 · rev #3');
    expect(
      imageReferenceSourceLine({
        id: 'x',
        kind: 'result-artifact',
        name: 'v.png',
        url: '',
        artifact: { toolJobId: 'tj-1' },
      }),
    ).toBe('Result Studio 结果图');
    expect(
      imageReferenceSourceLine({ id: 'x', kind: 'workspace-file', name: 'umap.png', url: '', path: 'figures/umap.png' }),
    ).toBe('figures/umap.png');
  });

  it('composeMessageWithImageReferences: 静态图带 path 行；结果图带 artifact 元数据行', () => {
    expect(composeMessageWithImageReferences('这张图说明什么', [])).toBe('这张图说明什么');

    const workspaceRef = makeImageReference(detail())!;
    const artifactRef = makeImageReference(
      detail({
        kind: 'result-artifact',
        path: undefined,
        name: 'volcano.png',
        artifact: { toolJobId: 'tj-1', revisionOrdinal: 3, revisionId: 'rev-9', artifactId: 'art-2' },
      }),
    )!;

    const composed = composeMessageWithImageReferences('把点调大', [workspaceRef, artifactRef]);

    expect(composed).toContain('【引用图片 umap.png】');
    expect(composed).toContain('> 来源：figures/umap.png');
    expect(composed).toContain('> path: figures/umap.png');
    expect(composed).toContain('【引用图片 volcano.png】');
    expect(composed).toContain('> artifact: toolJobId=tj-1 revisionOrdinal=3 revisionId=rev-9 artifactId=art-2');
    expect(composed.endsWith('\n\n把点调大')).toBe(true);
  });
});
