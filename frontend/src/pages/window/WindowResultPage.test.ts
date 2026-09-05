// BLOCK-59 P1 — 结果窗窗口键解析（jobId:artifactName）。
// 键由主进程路由白名单产出（encodeURIComponent 后单段），本解析只负责
// 把首段冒号拆成 jobId / artifactName，artifactName 内允许再含冒号。
import { describe, expect, it } from 'vitest';
import { parseWindowKey } from './WindowResultPage';

describe('parseWindowKey', () => {
  it('拆分 jobId 与 artifactName', () => {
    expect(parseWindowKey('tj_abc:volcano-plot.png')).toEqual({
      jobId: 'tj_abc',
      artifactName: 'volcano-plot.png',
    });
  });

  it('artifactName 内的冒号保留在名称里（只拆首段）', () => {
    expect(parseWindowKey('tj_abc:a:b.png')).toEqual({
      jobId: 'tj_abc',
      artifactName: 'a:b.png',
    });
  });

  it('非 ASCII 产物名原样保留', () => {
    expect(parseWindowKey('tj_r1:火山图.png')).toEqual({
      jobId: 'tj_r1',
      artifactName: '火山图.png',
    });
  });

  it('无冒号 / 空串 / 冒号开头 → 非法键（双空）', () => {
    expect(parseWindowKey('tj_abc')).toEqual({ jobId: '', artifactName: '' });
    expect(parseWindowKey('')).toEqual({ jobId: '', artifactName: '' });
    expect(parseWindowKey(':name.png')).toEqual({ jobId: '', artifactName: '' });
  });
});
