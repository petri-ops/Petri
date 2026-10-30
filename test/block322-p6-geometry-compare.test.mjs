import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { compareGeometryReports } = require('../core/petri-server/helpers/model3d-geometry-compare.js');

function report(size, volume, objects, triangles = 12) {
  return {
    mesh: { objects, triangles, nonManifoldEdges: 0, watertight: true, volumesMm3: { base: volume } },
    boundsMm: { size },
  };
}

test('BLOCK-322 P6-03 几何对比 — bounds/体积/对象数/三角面差值', () => {
  const diff = compareGeometryReports(report([120, 80, 40], 384000, 2), report([130, 80, 40], 416000, 3, 16));
  assert.equal(diff.ok, true);
  assert.equal(diff.before.totalVolumeMm3, 384000);
  assert.equal(diff.after.totalVolumeMm3, 416000);
  assert.equal(diff.deltas.totalVolumeMm3, 32000);
  assert.deepEqual(diff.deltas.boundsMm, { x: 10, y: 0, z: 0 });
  assert.equal(diff.deltas.objects, 1);
  assert.equal(diff.deltas.triangles, 4);
  assert.equal(diff.changed, true);
});

test('BLOCK-322 P6-03 几何对比 — 相同报告 changed=false；缺报告 fail-closed', () => {
  const same = report([120, 80, 40], 384000, 2);
  assert.equal(compareGeometryReports(same, same).changed, false);
  assert.equal(compareGeometryReports(null, same).error, 'geometry_report_required');
  assert.equal(compareGeometryReports(same, {}).error, 'geometry_report_required');
});
