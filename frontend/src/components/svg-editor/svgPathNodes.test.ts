import { describe, expect, it } from 'vitest';
import {
  anchorsOf,
  deleteAnchor,
  insertNodeAtSegMidpoint,
  moveAnchor,
  moveControl,
  parsePathD,
  penInsertMarkup,
  penPathD,
  serializePathD,
  smoothAnchor,
} from './svgPathNodes';

describe('BLOCK-342 路径节点（解析/序列化）', () => {
  it('parsePathD：M/L/C/Z 与 H/V 展开为 L', () => {
    expect(parsePathD('M 10 20 L 30 40')).toEqual([
      { cmd: 'M', pts: [{ x: 10, y: 20 }] },
      { cmd: 'L', pts: [{ x: 30, y: 40 }] },
    ]);
    const segs = parsePathD('M 0 0 H 50 V 25 Z');
    expect(segs).toEqual([
      { cmd: 'M', pts: [{ x: 0, y: 0 }] },
      { cmd: 'L', pts: [{ x: 50, y: 0 }] },
      { cmd: 'L', pts: [{ x: 50, y: 25 }] },
      { cmd: 'Z', pts: [] },
    ]);
  });

  it('parsePathD：C 段携带 c1/c2/P3', () => {
    const segs = parsePathD('M 0 0 C 10 0 20 10 30 10');
    expect(segs?.[1]).toEqual({ cmd: 'C', pts: [{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 10 }] });
  });

  it('parsePathD：未知/小写命令如实返回 null（不假装可编辑）', () => {
    expect(parsePathD('M 0 0 Q 5 5 10 10')).toBeNull();
    expect(parsePathD('m 10 20 l 5 5')).toBeNull();
    expect(parsePathD('M 0 0 A 5 5 0 0 1 10 10')).toBeNull();
    expect(parsePathD('')).toBeNull();
  });

  it('serializePathD：round-trip 保留几何', () => {
    const d = 'M 10.5 20.25 L 30 40 C 10 0 20 10 30.123 10.456 Z';
    const segs = parsePathD(d);
    expect(segs).not.toBeNull();
    expect(serializePathD(segs as never[])).toBe('M 10.5 20.25 L 30 40 C 10 0 20 10 30.12 10.46 Z');
  });
});

describe('BLOCK-342 路径节点（编辑）', () => {
  it('anchorsOf：M + 两个 L 终点 = 3 锚点，带手柄信息', () => {
    const anchors = anchorsOf(parsePathD('M 0 0 L 100 0 L 100 100 Z') as never[]);
    expect(anchors).toHaveLength(3);
    expect(anchors[0]).toMatchObject({ pos: { x: 0, y: 0 }, isSubpathStart: true, segIndex: 0, ptIndex: 0 });
    expect(anchors[1]).toMatchObject({ pos: { x: 100, y: 0 }, segIndex: 1, ptIndex: 0 });
  });

  it('moveAnchor：改锚点只动对应点，round-trip 正确', () => {
    const d = moveAnchor(parsePathD('M 0 0 L 100 0 L 100 100 Z') as never[], anchorsOf(parsePathD('M 0 0 L 100 0 L 100 100 Z') as never[])[1], 120, 15);
    expect(d).toBe('M 0 0 L 120 15 L 100 100 Z');
  });

  it('insertNodeAtSegMidpoint：L 中点一分为二', () => {
    const parsed = parsePathD('M 0 0 L 100 0');
    const d = insertNodeAtSegMidpoint(parsed as never[], 1);
    expect(d).toBe('M 0 0 L 50 0 L 100 0');
  });

  it('insertNodeAtSegMidpoint：C 用 de Casteljau t=0.5 一分为二', () => {
    const parsed = parsePathD('M 0 0 C 0 100 100 100 100 0');
    const d = insertNodeAtSegMidpoint(parsed as never[], 1);
    // t=0.5 中点 = (50, 75)
    expect(d).toBe('M 0 0 C 0 50 25 75 50 75 C 75 75 100 50 100 0');
  });

  it('deleteAnchor：L 锚删除该段', () => {
    const parsed = parsePathD('M 0 0 L 100 0 L 100 100');
    const d = deleteAnchor(parsed as never[], anchorsOf(parsed as never[])[1]);
    expect(d).toBe('M 0 0 L 100 100');
  });

  it('deleteAnchor：C 锚=所在段与出段合并为单 C', () => {
    const parsed = parsePathD('M 0 0 C 0 50 50 100 100 100 C 150 100 200 50 200 0');
    const d = deleteAnchor(parsed as never[], anchorsOf(parsed as never[])[1]);
    expect(d).toBe('M 0 0 C 0 50 200 50 200 0');
    // 出段非 C（无段可并）→ 如实拒绝
    const tail = parsePathD('M 0 0 C 0 50 50 100 100 100');
    expect(deleteAnchor(tail as never[], anchorsOf(tail as never[])[1])).toBeNull();
  });

  it('deleteAnchor：M 锚与退化子路径如实拒绝', () => {
    const parsed = parsePathD('M 0 0 L 100 0');
    expect(deleteAnchor(parsed as never[], anchorsOf(parsed as never[])[0])).toBeNull();
    // 删掉唯一 L 后子路径只剩 M → 拒绝
    const two = parsePathD('M 0 0 L 100 0 L 100 100');
    const onlyL = deleteAnchor(two as never[], anchorsOf(two as never[])[1]);
    expect(deleteAnchor(parsePathD(onlyL as string) as never[], anchorsOf(parsePathD(onlyL as string) as never[])[1])).toBeNull();
  });

  it('smoothAnchor：进/出都是 C 时镜像出手柄（保留出手柄原长）；否则如实拒绝', () => {
    const parsed = parsePathD('M 0 0 C 0 50 50 100 100 100 C 140 130 180 80 200 0');
    const anchors = anchorsOf(parsed as never[]);
    const d = smoothAnchor(parsed as never[], anchors[1]);
    // 镜像方向=(1,0)（进手柄在 (50,100)，锚在 (100,100)），出手柄原长=hypot(40,30)=50 → 新出手柄 (150,100)
    expect(d).toBe('M 0 0 C 0 50 50 100 100 100 C 150 100 180 80 200 0');
    const line = parsePathD('M 0 0 L 100 0');
    expect(smoothAnchor(line as never[], anchorsOf(line as never[])[0])).toBeNull();
  });

  it('moveControl：只动指定手柄', () => {
    const parsed = parsePathD('M 0 0 C 0 50 50 100 100 100');
    const d = moveControl(parsed as never[], 1, 1, 5, 60);
    expect(d).toBe('M 0 0 C 5 60 50 100 100 100');
  });
});

describe('BLOCK-342 基础钢笔', () => {
  it('penPathD：点列 → M/L…，closed 追加 Z；<2 点拒绝', () => {
    expect(penPathD([{ x: 10, y: 10 }, { x: 50, y: 12.345 }, { x: 80, y: 40 }], false))
      .toBe('M 10 10 L 50 12.35 L 80 40');
    expect(penPathD([{ x: 10, y: 10 }, { x: 50, y: 12 }], true)).toBe('M 10 10 L 50 12 Z');
    expect(penPathD([{ x: 1, y: 1 }], false)).toBeNull();
  });

  it('penInsertMarkup：closed 填充 / open 只描边', () => {
    expect(penInsertMarkup('M 0 0 L 10 0 Z', { closed: true, color: '#123456', strokeWidth: 3 }))
      .toBe('<path d="M 0 0 L 10 0 Z" fill="#123456" stroke="#123456" stroke-width="3" />');
    expect(penInsertMarkup('M 0 0 L 10 0', { closed: false, color: '#123456' }))
      .toBe('<path d="M 0 0 L 10 0" fill="none" stroke="#123456" stroke-width="2" />');
  });
});
