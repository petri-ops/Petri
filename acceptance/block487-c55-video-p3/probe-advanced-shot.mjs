/**
 * BLOCK-487 / C-55 VIDEO-P3 真实腿：对 P0 真实 video-project.json 的 sc2
 * 做「本地 SceneSpec v1 3D 高级镜头」替换，产出 advanced-shot-review.json + audit.json。
 *
 * 真源（只读）：
 *   - P0 工程：acceptance/block482-c55-video-p0/video-project.json（sha256 现读校验）
 *   - SceneSpec v1 additive joints[] 实测：acceptance/block-459/{PROBE-REPORT.md,SHA256SUMS.txt}
 * 诚实边界：BLOCK-459 mapping-verdicts.json 显示 jointExtrasNodes=0、六行 verdict=gap（机械扫描未命中），
 *   而 PROBE-REPORT.md 记 4 direct/2 convert 可行——两形态差异如实登记，不伪造 direct verdict；
 *   本包只做本地 specRef 引用替换契约，不接云生成、不付费、不外发、不建第二套 IR，观感零代签。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../../core/petri-server/helpers/video-advanced-shot.js');

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REPO = path.resolve(HERE, '../..');
const P0 = path.join(REPO, 'acceptance/block482-c55-video-p0/video-project.json');
const B459 = path.join(REPO, 'acceptance/block-459');

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const spec = readJson(P0);
const p0sha = sha256(fs.readFileSync(P0));

// 真源 digest：block-459 双进程一致的 rest GLB sha256（PROBE-REPORT §4 / SHA256SUMS.txt）
const shaTxt = fs.readFileSync(path.join(B459, 'SHA256SUMS.txt'), 'utf8');
const probeSha = (shaTxt.match(/^([0-9a-f]{64})\s+probe-rest\.glb$/m) || [])[1] || '';

// 诚实登记形态差异：机械 verdict 全 gap vs 报告 4direct/2convert，不伪造 direct。
const mappingVerdicts = readJson(path.join(B459, 'mapping-verdicts.json'));
const gapCount = Object.values(mappingVerdicts.verdicts || {}).filter((v) => v.verdict === 'gap').length;

// 本地 3D 高级镜头：来源=SceneSpec v1 specRef（引用真源 GLB digest），零付费零外发。
const shot = {
  id: 'shot-3d-sc2',
  kind: H.SHOT_KIND,
  source: {
    specRef: `scene3d/v1:sc-${probeSha.slice(0, 8) || 'local'}`,
    producer: 'local_scene3d',
    producerVersion: '1.6.3',
  },
  params: {
    camera: 'static-16x9',
    jointsRef: `scene3d/v1:sc-${probeSha.slice(0, 8) || 'local'}#joints`,
  },
  verification: {
    tool: 'block459-probe',
    verdict: 'mapping_feasible',
    digest: `sha256:${probeSha}`,
  },
  cost: { mode: 'zero', paid: false, external: false },
};

// SceneSpec v1（additive joints[]，形态取自 PROBE-REPORT §2 实测 rest 导出；glbSha256 用真源 digest）
const sceneSpec = {
  id: probeSha.slice(0, 8) || 'local',
  schemaVersion: 'scene3d/v1',
  source: { producer: 'local_scene3d', producerVersion: '1.6.3', glbSha256: probeSha },
  nodes: [{ id: 'base', kind: 'part', parent: null }],
  joints: [
    { name: 'hinge_arm', kind: 'revolute', axis: [0, 1, 0], range: { min: 0, max: 1.5707963267948966, unit: 'rad' }, value: 0, follows: null, ratio: null },
  ],
};

const review = H.buildAdvancedShotReview(spec, 'sc2', shot, sceneSpec);
const rep = H.replaceSceneWithAdvancedShot(spec, 'sc2', shot);
const unchanged = rep.unchanged || {};
const replaceability = rep.ok ? H.checkReplaceability(rep.spec) : { ok: false, criteria: {} };
const evidence = H.buildGenerationEvidence(shot);

const exitChecks = {
  E1_advanced_shot_replaces_normal_shot_without_touching_project_trunk:
    rep.ok && ['durationSec', 'captions', 'evidenceRefs', 'narration', 'timeline'].every((k) => unchanged[k] === true),
  E2_producer_renderer_domain_replaceability_criteria_hold:
    rep.ok && replaceability.ok && Object.values(replaceability.criteria).every(Boolean),
  E3_every_generated_shot_has_source_params_and_verification:
    rep.ok && evidence.ok && Object.values(evidence.evidence).every(Boolean),
};

const allPass = Object.values(exitChecks).every(Boolean)
  && review.ok === true
  && review.integrity.ok === true
  && review.humanReview.status === 'pending_human_eye';

const audit = {
  block: 'BLOCK-487',
  package: 'C-55 VIDEO-P3 高级镜头（本地 SceneSpec v1 3D 镜头替换）',
  at: new Date().toISOString(),
  verdict: allPass ? 'machine_pass' : 'machine_fail',
  p0Source: { path: 'acceptance/block482-c55-video-p0/video-project.json', sha256: p0sha },
  sceneSpecSource: {
    probeReport: 'acceptance/block-459/PROBE-REPORT.md',
    sha256SumFile: 'acceptance/block-459/SHA256SUMS.txt',
    probeRestGlbSha256: probeSha,
    formDiscrepancy: {
      mechanicalVerdictAllGap: gapCount === 6,
      gapCount,
      reportVerdict: '4 direct / 2 convert (PROBE-REPORT §3)',
      handling: '如实登记两形态差异，不伪造 direct verdict；本包只做 specRef 引用替换契约',
    },
  },
  unchanged,
  replaceability,
  evidence,
  exitChecks,
  constraints: H.CONSTRAINTS,
  deferredState: H.DEFERRED_STATE,
  humanReview: 'pending_human_eye（观感/成片终审零代签）',
  allPass,
};

const reviewPath = path.join(HERE, 'advanced-shot-review.json');
const auditPath = path.join(HERE, 'audit.json');
fs.writeFileSync(reviewPath, JSON.stringify(review, null, 2) + '\n');
fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2) + '\n');

console.log(JSON.stringify({
  verdict: audit.verdict,
  p0sha: p0sha.slice(0, 12),
  probeSha: probeSha.slice(0, 12),
  unchanged,
  replaceability: replaceability.criteria,
  evidence: evidence.evidence,
  exitChecks,
  integrity: review.integrity.ok,
  deferredPromoted: review.integrity.issues.filter((x) => x === 'deferred_promoted'),
  allPass,
}, null, 2));
process.exit(allPass ? 0 : 1);
