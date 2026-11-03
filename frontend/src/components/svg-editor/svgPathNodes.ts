/**
 * BLOCK-342 切片2 — 路径节点编辑 + 基础钢笔（纯逻辑，可单测）。
 *
 * 范围（诚实边界）：只解析 M/L/H/V/C/Z 绝对命令（小写相对命令不支持时如实返回 null，
 * 由调用方灰化/提示，不假装可编辑）。节点=锚点（M 起点 + 每段终点），手柄=C 控制点。
 * 所有改动产出合法 `d` 字符串，由调用方折算成白名单 `set_attr d` / `insert` op。
 */

export interface PathPoint { x: number; y: number }
export interface PathSeg {
  cmd: 'M' | 'L' | 'C' | 'Z';
  /** M/L: 1 点（终点）；C: [c1, c2, P3]（P0 语义上属于上一段终点）；Z: 空 */
  pts: PathPoint[];
}

export interface PathAnchor {
  /** 锚点序号（文档序，M 起点也算） */
  index: number;
  pos: PathPoint;
  /** 产生该锚点的段下标与点下标 */
  segIndex: number;
  ptIndex: number;
  /** C 段终点锚点的进手柄（该段 c1 与 c2 的 c2） */
  inHandle: PathPoint | null;
  /** 出手柄（紧随其后的 C 段 c1） */
  outHandle: PathPoint | null;
  /** 是否子路径起点（M） */
  isSubpathStart: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const NUM_RE = /-?\d*\.?\d+(?:e[-+]?\d+)?/iy;

/** 解析 `d`：只支持 M/L/H/V/C/Z 绝对命令；遇到未知命令返回 null（诚实降级）。 */
export function parsePathD(d: string): PathSeg[] | null {
  if (typeof d !== 'string' || d.trim() === '') return null;
  const segs: PathSeg[] = [];
  let i = 0;
  const n = d.length;
  let cur: PathPoint = { x: 0, y: 0 };
  let subpathStart: PathPoint = { x: 0, y: 0 };
  const skipWs = () => { while (i < n && /\s/.test(d[i])) i += 1; };
  const readNum = (): number | null => {
    skipWs();
    NUM_RE.lastIndex = i;
    const m = NUM_RE.exec(d);
    if (!m || m.index !== i) return null;
    i = NUM_RE.lastIndex;
    return Number(m[0]);
  };
  while (i < n) {
    skipWs();
    if (i >= n) break;
    const ch = d[i];
    if (!/[A-Za-z]/.test(ch)) return null;
    i += 1;
    const cmd = ch.toUpperCase();
    if (cmd !== ch) return null; // 小写（相对坐标）：诚实降级
    if (cmd === 'M' || cmd === 'L') {
      const x = readNum(); const y = readNum();
      if (x === null || y === null) return null;
      segs.push({ cmd, pts: [{ x, y }] });
      cur = { x, y };
      if (cmd === 'M') subpathStart = { x, y };
    } else if (cmd === 'H') {
      const x = readNum();
      if (x === null) return null;
      segs.push({ cmd: 'L', pts: [{ x, y: cur.y }] });
      cur = { x, y: cur.y };
    } else if (cmd === 'V') {
      const y = readNum();
      if (y === null) return null;
      segs.push({ cmd: 'L', pts: [{ x: cur.x, y }] });
      cur = { x: cur.x, y };
    } else if (cmd === 'C') {
      const c1x = readNum(); const c1y = readNum();
      const c2x = readNum(); const c2y = readNum();
      const x = readNum(); const y = readNum();
      if ([c1x, c1y, c2x, c2y, x, y].some((v) => v === null)) return null;
      segs.push({ cmd: 'C', pts: [{ x: c1x as number, y: c1y as number }, { x: c2x as number, y: c2y as number }, { x: x as number, y: y as number }] });
      cur = { x: x as number, y: y as number };
    } else if (cmd === 'Z') {
      segs.push({ cmd: 'Z', pts: [] });
      cur = { ...subpathStart };
    } else {
      return null;
    }
  }
  return segs.length > 0 ? segs : null;
}

/** 序列化回 `d`（数字保留 2 位小数，Z 无参数）。 */
export function serializePathD(segs: ReadonlyArray<PathSeg>): string {
  const parts: string[] = [];
  for (const seg of segs) {
    if (seg.cmd === 'Z') { parts.push('Z'); continue; }
    const p = seg.pts;
    if (seg.cmd === 'C') {
      parts.push(`C ${r2(p[0].x)} ${r2(p[0].y)} ${r2(p[1].x)} ${r2(p[1].y)} ${r2(p[2].x)} ${r2(p[2].y)}`);
    } else {
      parts.push(`${seg.cmd} ${r2(p[0].x)} ${r2(p[0].y)}`);
    }
  }
  return parts.join(' ');
}

/** 锚点清单：M 起点 + 每个非 Z 段终点，按文档序。 */
export function anchorsOf(segs: ReadonlyArray<PathSeg>): PathAnchor[] {
  const anchors: PathAnchor[] = [];
  segs.forEach((seg, idx) => {
    if (seg.cmd === 'Z') return;
    const prev = idx > 0 ? segs[idx - 1] : null;
    const next = segs[idx + 1];
    anchors.push({
      index: anchors.length,
      pos: { ...seg.pts[seg.pts.length - 1] },
      segIndex: idx,
      ptIndex: seg.cmd === 'C' ? 2 : 0,
      inHandle: seg.cmd === 'C' && prev && prev.cmd !== 'Z' ? { ...seg.pts[0] } : null,
      outHandle: next && next.cmd === 'C' ? { ...next.pts[0] } : null,
      isSubpathStart: seg.cmd === 'M',
    });
  });
  return anchors;
}

const clone = (segs: ReadonlyArray<PathSeg>): PathSeg[] => segs.map((s) => ({ cmd: s.cmd, pts: s.pts.map((p) => ({ ...p })) }));

/** 移动锚点 → 新 `d`（移动 M 时 Z 闭合点语义随之移动）。 */
export function moveAnchor(segs: ReadonlyArray<PathSeg>, anchor: PathAnchor, x: number, y: number): string {
  const next = clone(segs);
  next[anchor.segIndex].pts[anchor.ptIndex] = { x: r2(x), y: r2(y) };
  return serializePathD(next);
}

/** 移动 C 手柄（which: 1=c1 / 2=c2）→ 新 `d`。 */
export function moveControl(segs: ReadonlyArray<PathSeg>, segIndex: number, which: 1 | 2, x: number, y: number): string {
  const next = clone(segs);
  const seg = next[segIndex];
  if (!seg || seg.cmd !== 'C') return serializePathD(segs);
  seg.pts[which - 1] = { x: r2(x), y: r2(y) };
  return serializePathD(next);
}

/** 上一段的终点坐标（C 的 P0 语义来源）。 */
function prevEndOf(segs: ReadonlyArray<PathSeg>, idx: number): PathPoint {
  if (idx <= 0) return { x: 0, y: 0 };
  const prev = segs[idx - 1];
  if (prev.cmd === 'Z') return { x: 0, y: 0 };
  return prev.pts[prev.pts.length - 1];
}

/**
 * 段中点插入节点：L 取中点一分为二；C 用 de Casteljau t=0.5 一分为二。返回新 `d`。
 */
export function insertNodeAtSegMidpoint(segs: ReadonlyArray<PathSeg>, segIndex: number): string {
  const seg = segs[segIndex];
  if (!seg || seg.cmd === 'Z' || seg.cmd === 'M') return serializePathD(segs);
  const next = clone(segs);
  if (seg.cmd === 'L') {
    const p0 = prevEndOf(segs, segIndex);
    const mid = { x: r2((p0.x + seg.pts[0].x) / 2), y: r2((p0.y + seg.pts[0].y) / 2) };
    next.splice(segIndex, 1, { cmd: 'L', pts: [mid] }, { cmd: 'L', pts: [{ ...seg.pts[0] }] });
  } else {
    const p0 = prevEndOf(segs, segIndex);
    const [c1, c2, p3] = seg.pts;
    const l = (a: PathPoint, b: PathPoint): PathPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const ab = l(p0, c1); const bc = l(c1, c2); const cd = l(c2, p3);
    const abc = l(ab, bc); const bcd = l(bc, cd);
    const mid = l(abc, bcd);
    next.splice(segIndex, 1,
      { cmd: 'C', pts: [{ x: r2(ab.x), y: r2(ab.y) }, { x: r2(abc.x), y: r2(abc.y) }, { x: r2(mid.x), y: r2(mid.y) }] },
      { cmd: 'C', pts: [{ x: r2(bcd.x), y: r2(bcd.y) }, { x: r2(cd.x), y: r2(cd.y) }, { ...p3 }] });
  }
  return serializePathD(next);
}

/**
 * 删除锚点：L 锚=删该段；C 锚=所在段与出段合并为单 C（出段非 C 时如实拒绝）；
 * M 锚与删除后退化的子路径（只剩 M 或 M+Z）如实拒绝（返回 null）。
 */
export function deleteAnchor(segs: ReadonlyArray<PathSeg>, anchor: PathAnchor): string | null {
  if (anchor.isSubpathStart) return null;
  const idx = anchor.segIndex;
  const seg = segs[idx];
  const next = clone(segs);
  if (seg.cmd === 'L') {
    next.splice(idx, 1);
  } else if (seg.cmd === 'C') {
    const outSeg = next[idx + 1];
    if (!outSeg || outSeg.cmd !== 'C') return null;
    next.splice(idx, 2, { cmd: 'C', pts: [seg.pts[0], outSeg.pts[1], outSeg.pts[2]] });
  } else {
    return null;
  }
  // 退化检查：任一子路径在 Z/下一 M 前没有任何实体段 → 拒绝
  let pendingStart = false; let hasBody = false;
  for (const s of next) {
    if (s.cmd === 'M') {
      if (pendingStart && !hasBody) return null;
      pendingStart = true; hasBody = false;
    } else if (s.cmd === 'Z') {
      if (pendingStart && !hasBody) return null;
      pendingStart = false; hasBody = false;
    } else {
      hasBody = true;
    }
  }
  if (pendingStart && !hasBody) return null;
  return serializePathD(next);
}

/**
 * 平滑锚点：进/出都是 C 手柄时，出手柄镜像到进手柄对侧（长度保留出手柄原长）。
 * 条件不满足返回 null（如实拒绝，不假装平滑）。
 */
export function smoothAnchor(segs: ReadonlyArray<PathSeg>, anchor: PathAnchor): string | null {
  if (!anchor.inHandle || !anchor.outHandle) return null;
  const inSeg = segs[anchor.segIndex];
  const outSeg = segs[anchor.segIndex + 1];
  if (!inSeg || !outSeg || inSeg.cmd !== 'C' || outSeg.cmd !== 'C') return null;
  const next = clone(segs);
  const a = next[anchor.segIndex].pts[2];
  const dx = a.x - inSeg.pts[1].x;
  const dy = a.y - inSeg.pts[1].y;
  const norm = Math.hypot(dx, dy) || 1;
  const len = Math.hypot(outSeg.pts[0].x - a.x, outSeg.pts[0].y - a.y) || norm;
  next[anchor.segIndex + 1].pts[0] = { x: r2(a.x + (dx / norm) * len), y: r2(a.y + (dy / norm) * len) };
  return serializePathD(next);
}

/** 基础钢笔：点列 → `d`（M + L…，closed 时追加 Z）。少于 2 点返回 null。 */
export function penPathD(points: ReadonlyArray<PathPoint>, closed: boolean): string | null {
  if (points.length < 2) return null;
  const head = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${r2(p.x)} ${r2(p.y)}`).join(' ');
  return closed ? `${head} Z` : head;
}

/** 钢笔产物的 insert op markup（closed 填充色，open 只描边）。 */
export function penInsertMarkup(
  d: string,
  opts: { color?: string; strokeWidth?: number; closed: boolean },
): string {
  const color = opts.color || '#4a7cba';
  const stroke = opts.strokeWidth ?? 2;
  const fill = opts.closed ? ` fill="${color}"` : ' fill="none"';
  return `<path d="${d}"${fill} stroke="${color}" stroke-width="${stroke}" />`;
}
