'use strict';

/**
 * helpers/cad-exchange.js — BLOCK-322 P4-04 CAD 交换适配层（RULING-01）。
 *
 * 唯一职责：把外部 STEP/IGES 文件转成现有资产链能消费的网格，或把 Blender
 * 已构建的 STL 转成 STEP。它不建立第二套场景真值、不重新求解 SceneSpec，
 * 也不在运行时下载内核；内核缺席时如实返回 capability_unavailable。
 *
 * 选型依据见 docs/block-322-ruling-01-cad-kernel.md：
 * - occt-wasm：STEP 导入/导出、XCAF 装配、STL/BREP、HLR/多视图 SVG；
 * - occt-import-js：只补 IGES 导入（occt-wasm 明确不含 IGES）。
 */

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

const requireFromHere = createRequire(__filename);
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CAD_INPUT_FORMATS = Object.freeze(['step', 'stp', 'iges', 'igs']);
const CAD_INPUT_EXTENSIONS = Object.freeze(CAD_INPUT_FORMATS.map((format) => `.${format}`));
const CAD_FORMAT_ALIASES = Object.freeze({ stp: 'step', igs: 'iges' });
const MAX_CAD_BYTES = 128 * 1024 * 1024;
const DEFAULT_STEP_SCHEMA = 'AP214';
const DEFAULT_SEW_TOLERANCE = 0.01;

let occtPromise = null;
let igesParserPromise = null;
let kernelProbePromise = null;

function packageVersion(name, fallback = 'unknown') {
  try {
    const rootPackage = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    return (rootPackage.dependencies && rootPackage.dependencies[name]) || fallback;
  } catch {
    return fallback;
  }
}

function cadFormatForPath(value) {
  const extension = path.extname(String(value || '').replace(/\\/g, '/')).toLowerCase();
  if (!extension) return null;
  const format = extension.slice(1);
  if (!CAD_INPUT_FORMATS.includes(format)) return null;
  return CAD_FORMAT_ALIASES[format] || format;
}

function loadOcct() {
  if (!occtPromise) occtPromise = import('occt-wasm');
  return occtPromise;
}

function loadIgesParser() {
  if (!igesParserPromise) igesParserPromise = Promise.resolve(requireFromHere('occt-import-js'));
  return igesParserPromise;
}

function disposeKernel(kernel) {
  try { kernel[Symbol.dispose]?.(); } catch { /* already disposed */ }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function normalizeBoundingBox(box) {
  if (!box || typeof box !== 'object') return null;
  const normalized = {
    xmin: finite(box.xmin), ymin: finite(box.ymin), zmin: finite(box.zmin),
    xmax: finite(box.xmax), ymax: finite(box.ymax), zmax: finite(box.zmax),
  };
  if (Object.values(normalized).some((value) => value === null)) return null;
  return normalized;
}

function summarizeXcaf(doc, maxNames = 24) {
  const roots = doc.getRoots();
  let labelCount = 0;
  let assemblyCount = 0;
  let componentCount = 0;
  const names = [];
  const walk = (label, depth) => {
    if (depth > 64) return;
    labelCount += 1;
    const info = doc.getLabelInfo(label);
    if (info.name && names.length < maxNames) names.push(info.name);
    if (info.isComponent) componentCount += 1;
    const prototype = doc.getReferredLabel(label) || label;
    const children = doc.getChildren(prototype);
    if (children.length > 0) assemblyCount += 1;
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  return { rootCount: roots.length, labelCount, componentCount, assemblyCount, names };
}

async function stepToGlb({ bytes } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { ok: false, error: 'cad_source_empty' };
  const { OcctKernel } = await loadOcct();
  const kernel = await OcctKernel.init();
  let doc;
  try {
    doc = kernel.importXCAFFromSTEP(input.toString('utf8'));
    const glb = doc.exportGLTF();
    return {
      ok: true,
      glb: Buffer.from(glb),
      summary: { ...summarizeXcaf(doc), kernel: 'occt-wasm', kernelVersion: packageVersion('occt-wasm') },
    };
  } catch (error) {
    return { ok: false, error: 'step_import_failed', message: String(error && error.message ? error.message : error) };
  } finally {
    try { doc?.close(); } catch { /* already closed */ }
    disposeKernel(kernel);
  }
}

async function stepToSvg({ bytes, views = ['front', 'top', 'right', 'iso'], width = 240, height = 240, showHidden = true } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { ok: false, error: 'cad_source_empty' };
  const { OcctKernel, renderMultiviewSVG } = await loadOcct();
  const kernel = await OcctKernel.init();
  try {
    const shape = kernel.importStep(input.toString('utf8'));
    const svg = renderMultiviewSVG(kernel, shape, { views, width, height, showHidden });
    const bbox = normalizeBoundingBox(kernel.getBoundingBox(shape));
    return { ok: true, svg, summary: { kernel: 'occt-wasm', kernelVersion: packageVersion('occt-wasm'), bbox, views } };
  } catch (error) {
    return { ok: false, error: 'step_drawing_failed', message: String(error && error.message ? error.message : error) };
  } finally {
    disposeKernel(kernel);
  }
}

function triangleNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

function writeBinaryStl(triangles) {
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write('BLOCK-322 CAD exchange (mm)', 0, 80, 'ascii');
  buffer.writeUInt32LE(triangles.length, 80);
  let offset = 84;
  for (const [a, b, c] of triangles) {
    const normal = triangleNormal(a, b, c);
    buffer.writeFloatLE(normal[0], offset);
    buffer.writeFloatLE(normal[1], offset + 4);
    buffer.writeFloatLE(normal[2], offset + 8);
    [a, b, c].forEach((vertex, index) => {
      const base = offset + 12 + index * 12;
      buffer.writeFloatLE(vertex[0], base);
      buffer.writeFloatLE(vertex[1], base + 4);
      buffer.writeFloatLE(vertex[2], base + 8);
    });
    offset += 50;
  }
  return buffer;
}

function meshArrays(mesh) {
  const positions = mesh?.attributes?.position?.array;
  const indices = mesh?.index?.array;
  if (!positions || !(positions.length >= 9)) return null;
  const index = indices && indices.length >= 3 ? indices : null;
  return { positions, index };
}

async function igesToStl({ bytes } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { ok: false, error: 'cad_source_empty' };
  let parser;
  try {
    const factory = await loadIgesParser();
    parser = await factory();
  } catch (error) {
    return { ok: false, error: 'iges_parser_unavailable', message: String(error && error.message ? error.message : error) };
  }
  let parsed;
  try {
    parsed = parser.ReadIgesFile(input, null);
  } catch (error) {
    return { ok: false, error: 'iges_import_failed', message: String(error && error.message ? error.message : error) };
  }
  if (!parsed || parsed.success !== true) {
    return { ok: false, error: 'iges_import_failed', message: 'IGES parser returned unsuccessful result' };
  }
  const meshes = Array.isArray(parsed.meshes) ? parsed.meshes : [];
  const triangles = [];
  const bbox = { xmin: Infinity, ymin: Infinity, zmin: Infinity, xmax: -Infinity, ymax: -Infinity, zmax: -Infinity };
  for (const mesh of meshes) {
    const arrays = meshArrays(mesh);
    if (!arrays) continue;
    const { positions, index } = arrays;
    const count = index ? index.length : positions.length / 3;
    for (let i = 0; i + 2 < count; i += 3) {
      const ia = index ? index[i] : i;
      const ib = index ? index[i + 1] : i + 1;
      const ic = index ? index[i + 2] : i + 2;
      const a = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
      const b = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
      const c = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
      if (![a, b, c].every((point) => point.every(Number.isFinite))) continue;
      triangles.push([a, b, c]);
      for (const point of [a, b, c]) {
        bbox.xmin = Math.min(bbox.xmin, point[0]);
        bbox.ymin = Math.min(bbox.ymin, point[1]);
        bbox.zmin = Math.min(bbox.zmin, point[2]);
        bbox.xmax = Math.max(bbox.xmax, point[0]);
        bbox.ymax = Math.max(bbox.ymax, point[1]);
        bbox.zmax = Math.max(bbox.zmax, point[2]);
      }
    }
  }
  if (triangles.length === 0) return { ok: false, error: 'iges_empty_mesh' };
  return {
    ok: true,
    stl: writeBinaryStl(triangles),
    summary: {
      kernel: 'occt-import-js',
      kernelVersion: packageVersion('occt-import-js'),
      meshCount: meshes.length,
      triangleCount: triangles.length,
      bbox: Object.values(bbox).every(Number.isFinite) ? bbox : null,
    },
  };
}

function solidifyStlShape(kernel, imported, tolerance) {
  const faces = kernel.getSubShapes(imported, 'face');
  if (!faces.length) return { ok: false, error: 'step_no_faces' };
  const sewn = kernel.sew(faces, clamp(Number(tolerance) || DEFAULT_SEW_TOLERANCE, 1e-6, 10));
  const shells = kernel.getSubShapes(sewn, 'shell');
  const solids = [];
  for (const shell of shells) {
    try {
      const solid = kernel.makeSolid(shell);
      if (kernel.isSolid(solid)) solids.push(solid);
    } catch { /* reject the whole conversion below rather than silently dropping a shell */ }
  }
  if (shells.length === 0 || solids.length !== shells.length) {
    return { ok: false, error: 'step_solidify_failed', shells: shells.length, solids: solids.length };
  }
  const shape = solids.length === 1 ? solids[0] : kernel.makeCompound(solids);
  return { ok: true, shape, solidCount: solids.length };
}

async function stlToStep({ bytes, schema = DEFAULT_STEP_SCHEMA, tolerance = DEFAULT_SEW_TOLERANCE } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { ok: false, error: 'cad_source_empty' };
  const { OcctKernel } = await loadOcct();
  const kernel = await OcctKernel.init();
  try {
    const imported = kernel.importStl(input);
    const solidified = solidifyStlShape(kernel, imported, tolerance);
    if (!solidified.ok) return solidified;
    const step = kernel.exportStep(solidified.shape, { schema, unit: 'millimeter' });
    const volume = Math.abs(Number(kernel.getVolume(solidified.shape)) || 0);
    const bbox = normalizeBoundingBox(kernel.getBoundingBox(solidified.shape));
    return {
      ok: true,
      step,
      summary: {
        kernel: 'occt-wasm',
        kernelVersion: packageVersion('occt-wasm'),
        schema,
        solid: solidified.solidCount === 1,
        solidCount: solidified.solidCount,
        faceted: true,
        volumeMm3: volume,
        bbox,
      },
    };
  } catch (error) {
    return { ok: false, error: 'step_export_failed', message: String(error && error.message ? error.message : error) };
  } finally {
    disposeKernel(kernel);
  }
}

async function igesToSvg({ bytes, views = ['front', 'top', 'right', 'iso'], width = 240, height = 240, showHidden = true } = {}) {
  const converted = await igesToStl({ bytes });
  if (!converted.ok) return converted;
  return stlToSvg({ bytes: converted.stl, views, width, height, showHidden, summary: converted.summary });
}

async function stlToSvg({ bytes, views = ['front', 'top', 'right', 'iso'], width = 240, height = 240, showHidden = true, summary = null } = {}) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (input.length === 0) return { ok: false, error: 'cad_source_empty' };
  const { OcctKernel, renderMultiviewSVG } = await loadOcct();
  const kernel = await OcctKernel.init();
  try {
    const imported = kernel.importStl(input);
    const solidified = solidifyStlShape(kernel, imported, DEFAULT_SEW_TOLERANCE);
    if (!solidified.ok) return solidified.error === 'step_no_faces' ? { ...solidified, error: 'drawing_no_faces' } : solidified;
    const svg = renderMultiviewSVG(kernel, solidified.shape, { views, width, height, showHidden });
    return {
      ok: true,
      svg,
      summary: {
        ...(summary || {}),
        solidCount: solidified.solidCount,
        bbox: normalizeBoundingBox(kernel.getBoundingBox(solidified.shape)),
        views,
      },
    };
  } catch (error) {
    return { ok: false, error: 'drawing_failed', message: String(error && error.message ? error.message : error) };
  } finally {
    disposeKernel(kernel);
  }
}

async function probeCadExchange() {
  if (!kernelProbePromise) {
    kernelProbePromise = (async () => {
      try {
        const { OcctKernel } = await loadOcct();
        const kernel = await OcctKernel.init();
        disposeKernel(kernel);
      } catch (error) {
        return {
          status: 'unavailable',
          reason: 'occt_wasm_unavailable',
          message: String(error && error.message ? error.message : error),
          kernel: null,
          version: null,
          formats: { stepImport: false, stepExport: false, igesImport: false, igesExport: false, drawingSvg: false },
        };
      }
      let igesImport = false;
      try {
        const factory = await loadIgesParser();
        await factory();
        igesImport = true;
      } catch { /* IGES is optional */ }
      return {
        status: 'ready',
        reason: null,
        kernel: 'occt-wasm',
        version: packageVersion('occt-wasm'),
        formats: {
          stepImport: true,
          stepExport: true,
          igesImport,
          igesExport: false,
          drawingSvg: true,
        },
        notes: igesImport
          ? ['STEP: occt-wasm', 'IGES: occt-import-js import-only', 'STEP export: faceted B-rep from Blender STL']
          : ['STEP: occt-wasm', 'IGES: parser unavailable', 'STEP export: faceted B-rep from Blender STL'],
      };
    })();
  }
  return kernelProbePromise;
}

module.exports = {
  CAD_INPUT_FORMATS,
  CAD_INPUT_EXTENSIONS,
  CAD_FORMAT_ALIASES,
  MAX_CAD_BYTES,
  DEFAULT_STEP_SCHEMA,
  cadFormatForPath,
  probeCadExchange,
  stepToGlb,
  stepToSvg,
  igesToStl,
  stlToStep,
  igesToSvg,
  stlToSvg,
  writeBinaryStl,
};
