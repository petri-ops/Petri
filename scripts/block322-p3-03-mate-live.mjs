#!/usr/bin/env node
/**
 * BLOCK-322 P3-03 mate 直连实机证据：轴对齐平面贴合的真实 Blender 构建。
 * 真实 Blender 4.5.10 LTS；不启动测试窗。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'acceptance', 'block-322-p3');
const WORKSPACE = fs.mkdtempSync(path.join(os.tmpdir(), 'b322-mate-'));
const scene3d = require(path.join(ROOT, 'core/petri-server/helpers/scene3d.js'));
const blender = require(path.join(ROOT, 'core/petri-server/helpers/blender-provider.js'));

const assertions = [];
function assert(id, pass, detail) {
  assertions.push({ id, pass: Boolean(pass), detail: String(detail ?? '').slice(0, 800) });
  if (pass) console.log(`PASS ${id}`);
  else console.error(`FAIL ${id}: ${detail}`);
}

function box(id, position, dimensions) {
  return { id, type: 'box', dimensions, transform: { position, rotation: [0, 0, 0] } };
}

function scene(nodes, constraints) {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes,
    constraints,
  };
}

async function main() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
  const base = box('base', [0, 0, 0], { width: 120, depth: 80, height: 40 });
  const cap = box('cap', [0, 0, 100], { width: 40, depth: 20, height: 10 });
  const source = scene([base, cap], [{
    kind: 'mate', a: 'base', b: 'cap', aFace: '+z', bFace: '-z', offset: 5,
  }]);
  const resolved = scene3d.resolveSceneSpec(source);
  assert('M1_resolve_ok', resolved.ok === true, JSON.stringify(resolved).slice(0, 600));
  const capPos = resolved.scene.nodes.find((node) => node.id === 'cap').transform.position;
  // base 顶面 z=20；cap 半高 5；offset 5 → cap 中心 z=30。
  assert('M2_cap_mated_position', JSON.stringify(capPos) === JSON.stringify([0, 0, 30]), JSON.stringify(capPos));
  assert('M3_source_not_mutated', source.nodes[1].transform.position[2] === 100, JSON.stringify(source.nodes[1].transform.position));
  assert('M4_mate_ledger', resolved.appliedConstraints.filter((row) => row.kind === 'mate').length === 3,
    JSON.stringify(resolved.appliedConstraints));

  const run = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot: WORKSPACE,
    views: [],
    formats: [],
  });
  assert('M5_blender_ok', run.ok === true, JSON.stringify(run).slice(0, 500));
  const size = run.report?.boundsMm?.size || [];
  // base z[-20,20] + cap z[25,35] → 全局 z 高度 55；x 120、y 80。
  assert('M6_bounds', size[0] === 120 && size[1] === 80 && Math.abs(size[2] - 55) < 1e-6, JSON.stringify(size));
  const volumes = Object.values(run.report?.mesh?.volumesMm3 || {}).map(Number);
  assert('M7_volumes', Math.abs(volumes.reduce((sum, value) => sum + value, 0) - 392000) < 1e-3, JSON.stringify(volumes));

  const evidence = {
    schema: 'block322-p3-mate-live/v1',
    generatedAt: new Date().toISOString(),
    provider: (await blender.probeBlender()).version,
    assertions,
    passed: assertions.every((entry) => entry.pass),
    resolved: {
      capPosition: capPos,
      appliedConstraints: resolved.appliedConstraints,
      boundsMm: run.report?.boundsMm || null,
      volumesMm3: run.report?.mesh?.volumesMm3 || null,
    },
  };
  fs.writeFileSync(path.join(EVIDENCE, 'block322-p3-mate-live.json'), JSON.stringify(evidence, null, 2));
  console.log(`assertions: ${assertions.filter((entry) => entry.pass).length}/${assertions.length}`);
  console.log(`evidence: ${path.relative(ROOT, path.join(EVIDENCE, 'block322-p3-mate-live.json'))}`);
  if (!evidence.passed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
