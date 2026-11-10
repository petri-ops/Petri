#!/usr/bin/env node
/**
 * scripts/post-s7-matrix-parity-gate.mjs — B-23 三矩阵同源机械门。
 *
 * 现状：quality:surface 串了 functional-surface-audit（surface-matrix.json）与
 * block357-capability-map（capability-map.md），但第三份 shelf-matrix.json 由
 * block352-shelf-audit 独立实机脚本生成（需隔离后端 + 兄弟仓 pack），不能串进
 * closeout（会引入活栈依赖 = 无栈必红的 fail-open 陷阱，且触碰 S 类兄弟仓边界）。
 *
 * 故本门**只做同源校验、不重跑实机**：
 *   ① capability-map.md 必须逐字等于 buildCapabilityMap(surface-matrix.json)；
 *   ② shelf-matrix.json 的技能清单必须与 resources/skills/manifest.json 同源
 *      （逐 id 在册、无多无少），且 verdict 只能是 available/shell/detour；
 *   ③ 三份产物时间戳可追（capability-map 头部必须引用 surface 的 generatedAt）。
 * 人工改动任一份而不重跑生成器 → 红。判据纯函数，可离线负测。
 *
 * 用法：node scripts/post-s7-matrix-parity-gate.mjs [--json]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCapabilityMap } from './block357-capability-map.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

export function evaluateMatrixParity(files) {
  const issues = [];
  const surface = JSON.parse(files['surface']);
  const shelf = JSON.parse(files['shelf']);
  const manifest = JSON.parse(files['manifest']);
  const mapMd = files['map'];

  // ① 能力地图必须与功能面矩阵同源（生成器逐字输出）
  const rebuilt = buildCapabilityMap(surface);
  if (mapMd !== rebuilt) issues.push('capability-map.md 与 buildCapabilityMap(surface-matrix) 不一致（手改或矩阵刷新未重跑生成器）');
  if (!mapMd.includes(String(surface.generatedAt))) {
    issues.push('capability-map.md 头部未引用 surface-matrix.generatedAt（时间链断裂）');
  }

  // ② 货架技能清单与 manifest 同源
  const manifestIds = Object.keys(manifest.skills || {}).sort();
  const shelfSkills = Array.isArray(shelf.shelves?.skills) ? shelf.shelves.skills : [];
  // 分域比对（2026-11-10 判据修正）：manifest 只登记 built-in 技能；
  // source='pack' 的领域包技能由兄弟仓提供（S 类边界），本仓只登记指针，不要求 manifest 同源。
  const builtInIds = shelfSkills.filter((r) => r.source === 'built-in').map((r) => r.name).sort();
  const packRows = shelfSkills.filter((r) => r.source === 'pack');
  const unknownSource = shelfSkills.filter((r) => !['built-in', 'pack'].includes(r.source));
  const missing = manifestIds.filter((id) => !builtInIds.includes(id));
  const extra = builtInIds.filter((id) => !manifestIds.includes(id));
  if (missing.length) issues.push(`shelf-matrix 缺 manifest 已登记 built-in 技能：${missing.join(', ')}`);
  if (extra.length) issues.push(`shelf-matrix 多出 manifest 未登记 built-in 技能：${extra.join(', ')}`);
  if (unknownSource.length) issues.push(`shelf-matrix 出现未知 source：${unknownSource.map((r) => r.name).join(', ')}`);
  if (packRows.some((r) => !r.name)) issues.push('pack 技能缺 name（兄弟仓指针不可追）');
  const badVerdict = shelfSkills.filter((r) => !['available', 'shell', 'detour'].includes(r.verdict));
  if (badVerdict.length) issues.push(`shelf-matrix 非法 verdict：${badVerdict.map((r) => r.name).join(', ')}`);

  return {
    ok: issues.length === 0, issues,
    counts: { surfaceTools: (surface.toolRows || []).length, manifestSkills: manifestIds.length, builtInSkills: builtInIds.length, packSkills: packRows.length },
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = {
    surface: read('acceptance/functional-audit-2026-11-04/surface-matrix.json'),
    shelf: read('acceptance/block-352/shelf-matrix.json'),
    manifest: read('resources/skills/manifest.json'),
    map: read('docs/capability-map.md'),
  };
  const r = evaluateMatrixParity(files);
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else if (r.ok) console.log(`[matrix-parity] PASS — 三矩阵同源 ${JSON.stringify(r.counts)}`);
  else { console.error('[matrix-parity] FAIL：'); for (const i of r.issues) console.error(`  - ${i}`); }
  process.exitCode = r.ok ? 0 : 1;
}
