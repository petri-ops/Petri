/**
 * scripts/lib/anchor-ratchet.mjs — BLOCK-195 竞争力锚点清单的纯计算面。
 *
 * 与复跑器分离的理由：映射规则与清单自检必须能在**不执行任何命令**的情况下被契约测钉住
 * （跑完整清单要几分钟，契约测要毫秒级）。
 * 定分规则是 BLOCK-195 立项时先公布的，本文件即其唯一实现：改这里=改判分口径，必须过契约测。
 */
import fs from 'node:fs';
import path from 'node:path';

export const TIERS = ['unit', 'frontend', 'evals', 'live', 'probe'];
/** 点位状态序（棘轮对账用）：绿 > 无锚 > 红——绿退到无锚也算后退，防"删锚点洗白"。 */
export const POINT_RANK = { 'anchored-green': 2, unanchored: 1, 'anchored-red': 0 };

/** 点位状态三值推导（无证据不给分）：任一锚失败=red；无锚或锚全为环境档=unanchored；否则 green。 */
export function derivePointState(anchorStatuses) {
  const list = anchorStatuses || [];
  if (list.length === 0) return { state: 'unanchored', note: '无机械锚' };
  if (list.some((a) => a.status === 'fail')) return { state: 'anchored-red', note: '锚点复跑失败' };
  if (list.some((a) => a.status === 'pass')) return { state: 'anchored-green', note: null };
  return { state: 'unanchored', note: '锚点全部环境不可用（无证据不给分）' };
}

/** 维度分 = 5 × anchored_green 点位数 ÷ 点位数（一位小数）。无锚点位计入分母 → 分数上限被证据缺口压低。 */
export function scoreDimension(points) {
  const total = (points || []).length;
  if (!total) return 0;
  const green = points.filter((p) => p.state === 'anchored-green').length;
  return Math.round((5 * green / total) * 10) / 10;
}

/** @别名 → 共享命令（同一条命令只跑一次，多点位引用它）。未知别名返回 null。 */
export function resolveCmd(cmd, shared = {}) {
  if (typeof cmd !== 'string' || !cmd) return null;
  return cmd.startsWith('@') ? (shared[cmd.slice(1)] || null) : cmd;
}

/**
 * 清单结构自检：幽灵锚点（path 在仓库里不存在）、缺 derivesFrom（点位集合必须可指回总纲）、
 * 未知 tier、重复点位、命令别名解析失败。返回问题清单，非空即拒绝出分。
 */
export function auditList(list, root) {
  const issues = [];
  const ids = new Set();
  for (const d of (list && list.dimensions) || []) {
    for (const p of d.points || []) {
      const id = `${d.id}.${p.id}`;
      if (ids.has(id)) issues.push(`重复点位 ${id}`);
      ids.add(id);
      if (!p.derivesFrom) issues.push(`${id} 缺 derivesFrom（点位集合必须可指回总纲）`);
      if (!p.claim) issues.push(`${id} 缺 claim`);
      for (const a of p.anchors || []) {
        if (!fs.existsSync(path.join(root, a.path))) issues.push(`${id} 幽灵锚点：${a.path} 不存在`);
        if (!resolveCmd(a.cmd, list.sharedCommands)) issues.push(`${id} 命令无法解析：${a.cmd}`);
        if (!TIERS.includes(a.tier)) issues.push(`${id} 未知 tier：${a.tier}`);
      }
    }
  }
  return issues;
}

/**
 * 棘轮对账：现态比基线态更差即回归；**点位锚点集合收缩也即回归**。
 * 后者是本包自己撞出来的漏洞：红点位（rank=0）只要把锚点删掉就变成 unanchored（rank=1），
 * 对账会记成"改善"——删锚点洗白比修产品便宜得多，必须从机制上堵死。
 */
export function compareAnchorBaseline(current, baseline) {
  const regressions = [];
  const improvements = [];
  const now = current || [];
  for (const bp of (baseline && baseline.points) || []) {
    const hit = now.find((c) => c.id === bp.id);
    if (!hit) { regressions.push(`${bp.id}: 点位已从清单消失`); continue; }
    const basePaths = (bp.anchors || []).map((a) => a.path);
    const curPaths = new Set((hit.anchorPaths || []));
    const removed = basePaths.filter((p) => !curPaths.has(p));
    if (removed.length) regressions.push(`${bp.id}: 锚点被移除 ${removed.join(',')}`);
    const was = POINT_RANK[bp.state] ?? 0;
    const cur = POINT_RANK[hit.state] ?? 0;
    if (cur < was) regressions.push(`${bp.id}: ${bp.state}→${hit.state}`);
    else if (cur > was) improvements.push(`${bp.id}: ${bp.state}→${hit.state}`);
  }
  return { ok: regressions.length === 0, regressions, improvements };
}

/**
 * 锚点前置条件预检（文件面）：`fsExists` 不在场=环境档。
 * cdp 类前置由调用方异步探测（端口在答与否不是纯函数能判的），本函数对此返回 null 交给上层。
 */
export function unmetPrecondition(anchor, root) {
  const pre = anchor && anchor.precondition;
  if (!pre || !pre.fsExists) return null;
  try {
    if (!fs.existsSync(path.join(root, pre.fsExists))) return `前置缺失：${pre.fsExists}${pre.note ? `（${pre.note}）` : ''}`;
  } catch {
    return `前置检查失败：${pre.fsExists}`;
  }
  return null;
}
