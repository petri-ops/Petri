'use strict';
/**
 * scripts/lib/evals-admission.mjs — BLOCK-191 formal-admission 门控棘轮（§4.1 ZCode）。
 *
 * 门控口径（2026-10-16 用户 AskUserQuestion 拍板「晋升=双齐+显式审计（推荐）」）：
 *  1) case manifest 齐：id + category + criteria 非空（派生自现有任务字段，不改字段名）。
 *  2) fixture 齐：有 fixtureFiles **或** 显式声明 `requiresFixture:false`（如纯策略拒答/供应商 ping
 *     本无工作区输入）。缺 fixture 又缺声明=未齐（防「默默少给 fixture 也照样晋升」退化）。
 *  3) 基线更新只走显式审计命令（--update / --update-snapshot），由 evals-admission.mjs 源码门核验。
 *  4) PASS 判定仍是「全 criteria 过」——本门只管**准入**，不改判定语义。
 * 纯函数，零 IO / 零 volatile / 无 provider。
 */

export const MANIFEST_FIELDS = ['id', 'category', 'criteria'];

/** 派生 case manifest（tier 由所在套件决定：real=晋升目标，smoke/golden=冒烟层）。 */
export function deriveAdmissionManifest(task, suite) {
  const t = task || {};
  const criteria = Array.isArray(t.criteria) ? t.criteria : [];
  const fixtureKeys = t.fixtureFiles && typeof t.fixtureFiles === 'object' ? Object.keys(t.fixtureFiles) : [];
  return {
    id: String(t.id || ''),
    suite: String(suite || ''),
    tier: suite === 'real' ? 'real' : 'smoke',
    covers: [String(t.category || ''), ...criteria.map((c) => c && c.kind)].filter(Boolean).join(','),
    hasManifestId: Boolean(t.id),
    hasCategory: Boolean(t.category),
    criteriaCount: criteria.length,
    fixtureCount: fixtureKeys.length,
    fixtureDeclaredNotNeeded: t.requiresFixture === false,
    manifestComplete: Boolean(t.id && t.category && criteria.length > 0),
  };
}

/**
 * 判晋升准入：返回 { admitted, missing[] }。
 * manifest 齐=所有层通用；**fixture 齐只约束 real 层**（§4.1 口径是 smoke→real 晋升需双齐，
 * 冒烟层非晋升目标故不逼 fixture）。real 层未齐 = 缺 fixture 又未显式声明 requiresFixture:false。
 */
export function evalAdmission(manifest) {
  const m = manifest || {};
  const missing = [];
  if (!m.manifestComplete) missing.push('manifest');
  if (m.tier === 'real' && m.fixtureCount <= 0 && m.fixtureDeclaredNotNeeded !== true) missing.push('fixture');
  return { admitted: missing.length === 0, missing };
}
