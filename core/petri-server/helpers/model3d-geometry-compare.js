'use strict';

/**
 * helpers/model3d-geometry-compare.js — P6-03 场景 diff 之上的几何差值投影。
 *
 * 只消费 Blender 网格报告（已经过构建/加工后的真实结果），不重算几何、不建第二执行器。
 * 体积/包围盒/对象数/三角面差值均为显式数字；报告缺失时返回 null，不用 0 冒充。
 */

function factsFromReport(report) {
  const mesh = report && report.mesh ? report.mesh : null;
  if (!mesh) return null;
  const volumes = mesh.volumesMm3 && typeof mesh.volumesMm3 === 'object' ? Object.values(mesh.volumesMm3) : [];
  const totalVolumeMm3 = volumes.every((value) => Number.isFinite(value))
    ? Number(volumes.reduce((sum, value) => sum + Number(value), 0).toFixed(6))
    : null;
  const size = report.boundsMm && Array.isArray(report.boundsMm.size) ? report.boundsMm.size : null;
  return {
    objects: Number.isFinite(mesh.objects) ? mesh.objects : null,
    triangles: Number.isFinite(mesh.triangles) ? mesh.triangles : null,
    nonManifoldEdges: Number.isFinite(mesh.nonManifoldEdges) ? mesh.nonManifoldEdges : null,
    watertight: mesh.watertight === true,
    totalVolumeMm3,
    boundsMm: size && size.length === 3 ? { x: size[0], y: size[1], z: size[2] } : null,
  };
}

function delta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return null;
  return Number((after - before).toFixed(6));
}

function compareGeometryReports(beforeReport, afterReport) {
  const before = factsFromReport(beforeReport);
  const after = factsFromReport(afterReport);
  if (!before || !after) return { ok: false, error: 'geometry_report_required' };
  return {
    ok: true,
    schema: 'model3d-geometry-compare/v1',
    before,
    after,
    deltas: {
      objects: delta(before.objects, after.objects),
      triangles: delta(before.triangles, after.triangles),
      totalVolumeMm3: delta(before.totalVolumeMm3, after.totalVolumeMm3),
      boundsMm: before.boundsMm && after.boundsMm ? {
        x: delta(before.boundsMm.x, after.boundsMm.x),
        y: delta(before.boundsMm.y, after.boundsMm.y),
        z: delta(before.boundsMm.z, after.boundsMm.z),
      } : null,
    },
    changed: Boolean(
      before.objects !== after.objects
      || before.triangles !== after.triangles
      || before.totalVolumeMm3 !== after.totalVolumeMm3
      || JSON.stringify(before.boundsMm) !== JSON.stringify(after.boundsMm)
      || before.watertight !== after.watertight
    ),
  };
}

module.exports = { factsFromReport, compareGeometryReports };
