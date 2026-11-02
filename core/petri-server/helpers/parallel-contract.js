'use strict';

/**
 * helpers/parallel-contract.js — BLOCK-337 P3 并行互斥契约（纯函数，零 IO）。
 *
 * 红线：并行放行必须**机械可判**，不靠 agent 自觉。三条判据全部不相交才放行：
 *   ① truthDomain 不同（同一真相域只能一个 active 包）
 *   ② touchSurface 不相交（文件面 glob：一方是目录前缀、另一方落在其内 = 相交）
 *   ③ sharedBaselines 不相交（knip / lint / model-surface / code-size 这类共享基线文件
 *      双改必冲突，单改也会让另一方棘轮误红）
 *
 * glob 交集不可判定（一般情形 NP），这里只做**保守可判子集**：
 *   精确路径相等 / 一方 `dir/**` 覆盖另一方路径 / 双方同一 `dir/**` → 相交；其余不判相交。
 * 漏判由 truthDomain 与收口门禁兜底，宁慢勿腐的反面是「宁可漏判也不阻塞」——这里选前者：
 * 明显重叠必须拦，模糊情形交给 registry 的 truthDomain 声明。
 */

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : [];
}

function normalizePath(p) {
  return String(p).replace(/^\.\//, '').replace(/\/+$/, '');
}

/** glob → { prefix, exact } 的保守投影；无法投影返回 null。 */
function projectGlob(glob) {
  const value = normalizePath(glob);
  if (!value) return null;
  if (value.endsWith('/**')) return { prefix: value.slice(0, -3) };
  if (!value.includes('*')) return { exact: value };
  return null;
}

/** 单对路径/glob 是否相交（保守可判子集）。 */
function pathsOverlap(a, b) {
  const left = projectGlob(a);
  const right = projectGlob(b);
  if (!left || !right) return false;
  if (left.exact && right.exact) return left.exact === right.exact;
  if (left.prefix && right.prefix) {
    return left.prefix === right.prefix
      || left.prefix.startsWith(`${right.prefix}/`)
      || right.prefix.startsWith(`${left.prefix}/`);
  }
  if (left.prefix && right.exact) return right.exact === left.prefix || right.exact.startsWith(`${left.prefix}/`);
  if (right.prefix && left.exact) return left.exact === right.prefix || left.exact.startsWith(`${right.prefix}/`);
  return false;
}

function overlaps(listA, listB) {
  const hits = [];
  for (const a of listA) {
    for (const b of listB) {
      if (pathsOverlap(a, b)) hits.push([a, b]);
    }
  }
  return hits;
}

/** 两个 active 包能否并行。返回 { ok, conflicts:[{rule, detail}] }。 */
function canRunInParallel(pkgA, pkgB) {
  const a = pkgA || {};
  const b = pkgB || {};
  const conflicts = [];

  const domainA = typeof a.truthDomain === 'string' ? a.truthDomain : '';
  const domainB = typeof b.truthDomain === 'string' ? b.truthDomain : '';
  if (!domainA || !domainB) {
    conflicts.push({ rule: 'truth_domain_required', detail: '并行判定要求双方都声明 truthDomain' });
  } else if (domainA === domainB) {
    conflicts.push({ rule: 'same_truth_domain', detail: `同一真相域「${domainA}」只能有一个 active 包` });
  }

  const surfaceHits = overlaps(asArray(a.touchSurface), asArray(b.touchSurface));
  if (surfaceHits.length > 0) {
    conflicts.push({
      rule: 'touch_surface_overlap',
      detail: surfaceHits.slice(0, 5).map(([x, y]) => `${x} ↔ ${y}`).join('；'),
    });
  }

  const baselineHits = asArray(a.sharedBaselines).filter((item) => asArray(b.sharedBaselines).includes(item));
  if (baselineHits.length > 0) {
    conflicts.push({
      rule: 'shared_baseline_conflict',
      detail: `共享基线被双方同时改动：${baselineHits.join(', ')}`,
    });
  }

  return { ok: conflicts.length === 0, conflicts };
}

/**
 * 对一组 active 包做两两校验（registry 一次校验全表）。
 * @returns {{ ok:boolean, pairs:Array<{a:string,b:string,ok:boolean,conflicts:Array}> }}
 */
function validateParallelSet(packages) {
  const list = Array.isArray(packages) ? packages.filter(Boolean) : [];
  const pairs = [];
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      const verdict = canRunInParallel(list[i], list[j]);
      pairs.push({
        a: list[i].id || `#${i}`,
        b: list[j].id || `#${j}`,
        ok: verdict.ok,
        conflicts: verdict.conflicts,
      });
    }
  }
  return { ok: pairs.every((pair) => pair.ok), pairs };
}

module.exports = {
  pathsOverlap,
  overlaps,
  canRunInParallel,
  validateParallelSet,
};
