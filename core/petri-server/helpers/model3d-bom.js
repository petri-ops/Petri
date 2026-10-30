'use strict';

/**
 * helpers/model3d-bom.js — P4-01 BOM 与质量属性。
 *
 * 体积只来自 Blender 网格报告（watertight 才可信）；密度来自节点材质或
 * metadata.defaultDensityKgM3，缺省 1000 kg/m³ 并在产物中显式声明。
 * 只生成表格/清单文件，不写 SceneSpec、不建第二 revision。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const scene3d = require('./scene3d');

const BOM_SCHEMA = 'model3d-bom/v1';
const DEFAULT_DENSITY_KG_M3 = 1000;

function sha256(text) {
  return crypto.createHash('sha256').update(String(text)).digest('hex');
}

function densityFor(node, scene, fallback) {
  const nodeDensity = node && node.material ? node.material.densityKgM3 : undefined;
  if (Number.isFinite(nodeDensity)) return { value: Number(nodeDensity), source: 'node.material' };
  const sceneDensity = scene && scene.metadata ? scene.metadata.defaultDensityKgM3 : undefined;
  if (Number.isFinite(sceneDensity)) return { value: Number(sceneDensity), source: 'scene.metadata' };
  return { value: fallback, source: 'default' };
}

function volumeFor(nodeId, volumes) {
  if (!volumes || typeof volumes !== 'object') return null;
  if (Number.isFinite(volumes[nodeId])) return Number(volumes[nodeId]);
  let sum = 0;
  let found = false;
  for (const [name, value] of Object.entries(volumes)) {
    if (name.startsWith(`${nodeId}:`) && Number.isFinite(value)) { sum += Number(value); found = true; }
  }
  return found ? sum : null;
}

function buildBom(scene, report, { defaultDensityKgM3 = DEFAULT_DENSITY_KG_M3 } = {}) {
  const resolved = scene3d.resolveSceneSpec(scene);
  if (!resolved.ok) return { ok: false, error: 'scene_invalid', errors: resolved.errors };
  const mesh = report && report.mesh;
  if (!mesh || !Number.isFinite(mesh.objects)) return { ok: false, error: 'mesh_report_required' };
  if (mesh.watertight !== true || Number(mesh.nonManifoldEdges) !== 0) {
    return { ok: false, error: 'mesh_not_watertight', nonManifoldEdges: mesh.nonManifoldEdges ?? null };
  }
  const volumes = mesh.volumesMm3 || {};
  const tolerances = Array.isArray(resolved.scene.metadata?.tolerances) ? resolved.scene.metadata.tolerances : [];
  const rows = resolved.scene.nodes.map((node) => {
    const volumeMm3 = volumeFor(node.id, volumes);
    const density = densityFor(node, resolved.scene, defaultDensityKgM3);
    const massG = volumeMm3 === null ? null : Number((volumeMm3 * density.value * 1e-6).toFixed(6));
    return {
      id: node.id,
      type: node.type,
      label: typeof node.label === 'string' ? node.label : null,
      volumeMm3: volumeMm3 === null ? null : Number(volumeMm3.toFixed(6)),
      densityKgM3: density.value,
      densitySource: density.source,
      massG,
      massKg: massG === null ? null : Number((massG / 1000).toFixed(9)),
      meshObject: volumeMm3 !== null,
    };
  });
  const totalVolumeMm3 = rows.reduce((sum, row) => sum + (row.volumeMm3 || 0), 0);
  const totalMassG = rows.reduce((sum, row) => sum + (row.massG || 0), 0);
  return {
    ok: true,
    schema: BOM_SCHEMA,
    sceneHash: scene3d.hashSceneSpec(resolved.scene),
    rows,
    totals: {
      nodes: rows.length,
      meshNodes: rows.filter((row) => row.meshObject).length,
      totalVolumeMm3: Number(totalVolumeMm3.toFixed(6)),
      totalMassG: Number(totalMassG.toFixed(6)),
      totalMassKg: Number((totalMassG / 1000).toFixed(9)),
    },
    assumptions: [`默认密度 ${defaultDensityKgM3} kg/m³（可在节点 material.densityKgM3 或 metadata.defaultDensityKgM3 覆盖）`],
    tolerances,
    mesh: {
      objects: mesh.objects,
      vertices: mesh.vertices ?? null,
      triangles: mesh.triangles ?? null,
      nonManifoldEdges: mesh.nonManifoldEdges ?? null,
      watertight: mesh.watertight === true,
    },
  };
}

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(bom) {
  const header = ['id', 'type', 'label', 'volumeMm3', 'densityKgM3', 'densitySource', 'massG', 'massKg', 'meshObject'];
  const lines = [header.join(',')];
  for (const row of bom.rows) lines.push(header.map((key) => csvCell(row[key])).join(','));
  lines.push(['TOTAL', '', '', bom.totals.totalVolumeMm3, '', '', bom.totals.totalMassG, bom.totals.totalMassKg, ''].join(','));
  return `${lines.join('\n')}\n`;
}

function toMarkdown(bom) {
  const lines = [
    '# BOM / 质量属性',
    '',
    `场景哈希：\`${bom.sceneHash}\``,
    `体积来源：Blender 网格报告（watertight=${bom.mesh.watertight}, 非流形边=${bom.mesh.nonManifoldEdges}）`,
    '',
    '| 节点 | 类型 | 标签 | 体积 mm³ | 密度 kg/m³ | 来源 | 质量 g | 质量 kg |',
    '| --- | --- | --- | ---: | ---: | --- | ---: | ---: |',
  ];
  for (const row of bom.rows) {
    lines.push(`| ${row.id} | ${row.type} | ${row.label || ''} | ${row.volumeMm3 ?? '—'} | ${row.densityKgM3} | ${row.densitySource} | ${row.massG ?? '—'} | ${row.massKg ?? '—'} |`);
  }
  lines.push(`| **合计** |  |  | **${bom.totals.totalVolumeMm3}** |  |  | **${bom.totals.totalMassG}** | **${bom.totals.totalMassKg}** |`);
  if (Array.isArray(bom.tolerances) && bom.tolerances.length > 0) {
    lines.push('', '## 公差声明', '', '| 节点 | 特征 | 标称 mm | 下偏差 mm | 上偏差 mm | 单位 |', '| --- | --- | ---: | ---: | ---: | --- |');
    for (const row of bom.tolerances) {
      lines.push(`| ${row.nodeId} | ${row.feature} | ${row.nominal} | ${row.lower} | ${row.upper} | ${row.unit} |`);
    }
  }
  lines.push('', `假设：${bom.assumptions.join('；')}`, '');
  return lines.join('\n');
}

function writeBomArtifacts({ workspaceRoot, bom, relativeDir = 'model3d/bom', runId }) {
  const targetDir = path.resolve(workspaceRoot, relativeDir, runId || `bom-${Date.now().toString(36)}`);
  const root = path.resolve(workspaceRoot);
  if (targetDir !== root && !targetDir.startsWith(`${root}${path.sep}`)) return { ok: false, error: 'output_path_outside_workspace' };
  fs.mkdirSync(targetDir, { recursive: true });
  const csv = toCsv(bom);
  const markdown = toMarkdown(bom);
  const json = `${JSON.stringify(bom, null, 2)}\n`;
  const files = [
    { name: 'bom.csv', content: csv, mime: 'text/csv' },
    { name: 'bom.md', content: markdown, mime: 'text/markdown' },
    { name: 'bom.json', content: json, mime: 'application/json' },
  ].map((file) => {
    fs.writeFileSync(path.join(targetDir, file.name), file.content);
    return { path: path.relative(root, path.join(targetDir, file.name)).replace(/\\/g, '/'), name: file.name, mime: file.mime, sha256: sha256(file.content), bytes: Buffer.byteLength(file.content) };
  });
  const manifest = {
    schema: 'model3d-bom-manifest/v1',
    generatedAt: new Date().toISOString(),
    sceneHash: bom.sceneHash,
    totals: bom.totals,
    files: files.map(({ content: _content, ...file }) => file),
  };
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  fs.writeFileSync(path.join(targetDir, 'bom-manifest.json'), manifestText);
  return {
    ok: true,
    dir: path.relative(root, targetDir).replace(/\\/g, '/'),
    files,
    manifest: {
      path: path.relative(root, path.join(targetDir, 'bom-manifest.json')).replace(/\\/g, '/'),
      sha256: sha256(manifestText),
    },
    csv,
    markdown,
  };
}

module.exports = { BOM_SCHEMA, DEFAULT_DENSITY_KG_M3, buildBom, toCsv, toMarkdown, writeBomArtifacts };
