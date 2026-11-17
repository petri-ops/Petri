#!/usr/bin/env node
'use strict';

/**
 * acceptance/block460/e2e-run.mjs — BLOCK-460 端到端编排（P1 判据 M1 子集）：
 * 程序 → sidecar runner（真实执行）→ GLB → importSand3dGlb 归一 → validateSceneSpec
 * → digest 双锚交叉核对 → 证据落盘（e2e-result.json + 场景文档）。
 * 本脚本只做编排与断言；产物契约以 runner stdout JSON 与 helper 返回值为准。
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const { importSand3dGlb } = require(path.join(root, 'core/petri-server/helpers/scene3d-import.js'));
const scene3d = require(path.join(root, 'core/petri-server/helpers/scene3d.js'));

const checks = [];
function check(name, pass, detail) {
  checks.push({ name, pass: pass === true, detail: detail ?? null });
  if (pass !== true) console.error(`✖ ${name}: ${JSON.stringify(detail)}`);
  else console.log(`✔ ${name}`);
}

// 1) sidecar runner 真实执行（guard-ack 链内的调用形态；本脚本以同命令行 spawn 复现）
const run = spawnSync(
  process.execPath,
  ['sidecars/sand3d-runner/sand3d-runner.mjs', 'run',
    '--program', 'acceptance/block460/e2e-gate-assembly.py',
    '--out', 'acceptance/block460/e2e-out'],
  { cwd: root, encoding: 'utf8', timeout: 180000 },
);
const jsonLine = (run.stdout || '').split('\n').filter((line) => line.startsWith('{')).pop();
if (!jsonLine) {
  console.error(run.stdout, run.stderr);
  process.exit(1);
}
const runResult = JSON.parse(jsonLine);
check('runner-ok', runResult.ok === true, runResult);
check('runner-fingerprint-present', typeof runResult.fingerprint === 'string' && /^[0-9a-f]+$/.test(runResult.fingerprint), runResult.fingerprint);

// 2) 归一（rest 判据 + joints 抽取）
const glbArtifact = runResult.artifacts.find((a) => a.name.endsWith('.glb'));
check('glb-artifact-present', Boolean(glbArtifact), runResult.artifacts);
const glbRelative = path.posix.join(runResult.out, glbArtifact.name);
const imported = importSand3dGlb({
  workspaceRoot: root,
  glbRelativePath: glbRelative,
  programDigest: runResult.fingerprint,
});
check('import-ok', imported.ok === true, imported.ok ? undefined : { error: imported.error, errors: imported.errors });
check('import-rest-pose', imported.restPose === true, imported.restPose);
check('digest-cross-match', imported.glbSha256 === glbArtifact.sha256, { imported: imported.glbSha256, runner: glbArtifact.sha256 });

// 3) 校验（既有 validateSceneSpec 契约 + 关节内容断言）
const validated = scene3d.validateSceneSpec(imported.scene);
check('scene-valid', validated.ok === true, validated.ok ? undefined : validated.errors);
const jointIds = imported.scene.joints.map((joint) => joint.id).sort();
check('joints-extracted', JSON.stringify(jointIds) === JSON.stringify(['door_hinge', 'drawer_slide']), jointIds);
const hinge = imported.scene.joints.find((joint) => joint.id === 'door_hinge');
const slide = imported.scene.joints.find((joint) => joint.id === 'drawer_slide');
check('hinge-revolute-z-range-deg', hinge?.kind === 'revolute' && hinge?.range?.max === 100 && Array.isArray(hinge?.axis), hinge);
check('slide-prismatic-y-range-mm', slide?.kind === 'prismatic' && slide?.range?.max === 80 && Array.isArray(slide?.axis), slide);
check('provenance-digest', imported.scene.metadata?.provenance?.programDigest === runResult.fingerprint
  && imported.scene.metadata?.provenance?.glbSha256 === imported.glbSha256, imported.scene.metadata?.provenance);

// 4) 证据落盘
fs.writeFileSync(path.join(here, 'e2e-cabinet.scene3d.json'), `${JSON.stringify(imported.scene, null, 2)}\n`);
const result = {
  at: new Date().toISOString(),
  checks,
  allPass: checks.every((c) => c.pass),
  runner: { out: runResult.out, fingerprint: runResult.fingerprint, programSha256: runResult.programSha256, artifacts: runResult.artifacts },
  import: { ok: imported.ok, restPose: imported.restPose, glbSha256: imported.glbSha256, joints: imported.joints },
  sceneStats: validated.stats,
};
fs.writeFileSync(path.join(here, 'e2e-result.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(result.allPass ? 'E2E ALL PASS' : 'E2E FAILED');
process.exit(result.allPass ? 0 : 1);
