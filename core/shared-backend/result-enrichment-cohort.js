/**
 * result-enrichment-cohort.js — G1 首包 W1：selection→enrichment candidate cohort 决策。
 *
 * 纯函数（零副作用、零新依赖）：只决定一次 enrichment 执行后「产物应如何进入
 * ChangeSet/Revision Truth」——默认作为 pending candidate（需 compare → adopt/revert →
 * replay），legacyAutoAdopt=true 才回溯旧 dev 自动 current 行为（显式开关，默认关）。
 *
 * 实际写操作仍走既有 `ensureChainRevisions` / `adoptChangeSet`（单一 Truth），
 * 本模块不新增第二套 enrichment 工具、不放宽任何 cohort 安全门。
 */

const REQUIRED_STAGES = Object.freeze(['candidate', 'compare', 'adopt_or_revert', 'replay']);

function planEnrichmentCohort(input = {}) {
  const executed = input && input.executed;
  if (!executed || executed.ok !== true) {
    return {
      eligible: false,
      mode: 'rejected',
      reason: 'fail_closed_not_ok',
      requiredStages: [...REQUIRED_STAGES],
    };
  }
  const artifactTruth = executed.artifactTruth || (executed.result && executed.result.artifactTruth);
  if (!artifactTruth || artifactTruth.status !== 'valid' || artifactTruth.blocking === true) {
    return {
      eligible: false,
      mode: 'rejected',
      reason: 'fail_closed_artifact_truth_invalid',
      requiredStages: [...REQUIRED_STAGES],
    };
  }
  if (input.legacyAutoAdopt === true) {
    return {
      eligible: true,
      mode: 'legacy_auto_current',
      autoAdopt: true,
      legacy: true,
      requiredStages: [...REQUIRED_STAGES],
    };
  }
  return {
    eligible: true,
    mode: 'pending_candidate',
    autoAdopt: false,
    legacy: false,
    requiredStages: [...REQUIRED_STAGES],
  };
}

module.exports = { REQUIRED_STAGES, planEnrichmentCohort };
