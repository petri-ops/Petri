'use strict';

/**
 * helpers/model3d-cad-drawing.js — BLOCK-322 P4-05 HLR 线框工程图（基础版）。
 *
 * 只对工作区内的 STEP/IGES 源文件做隐藏线消除多视图 SVG；不引入维度链/GD&T，
 * 也不把 SVG 当成新的场景真值。尺寸链/GD&T 需要特征级引用（RULING-04）。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const cadExchange = require('./cad-exchange');
const { inspectCadAsset } = require('./mesh-assets');
const { normalizeRenderViews } = require('./model3d-views');

const DRAWING_DIR = 'model3d/drawings';
const DEFAULT_VIEWS = Object.freeze(['front', 'top', 'right', 'iso']);
const MIN_SIZE = 120;
const MAX_SIZE = 1600;

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeStem(value) {
  const stem = path.basename(String(value || 'drawing').replace(/\\/g, '/')).replace(/\.[^.]+$/, '');
  return (stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 60)) || 'drawing';
}

function drawingViews(input) {
  if (input === undefined || input === null) return [...DEFAULT_VIEWS];
  const normalized = normalizeRenderViews(input);
  return normalized || null;
}

async function createCadDrawing({ workspaceRoot, sourcePath, views, width = 240, height = 240, showHidden = true } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const inspected = await inspectCadAsset({ workspaceRoot, relativePath: sourcePath });
  if (!inspected.ok) return inspected;
  const format = cadExchange.cadFormatForPath(inspected.path);
  if (!format) return { ok: false, error: 'cad_format_unsupported' };
  const normalizedViews = drawingViews(views);
  if (!normalizedViews) return { ok: false, error: 'drawing_views_invalid' };
  const size = (value) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(value) || 240));
  let sourceBytes;
  try {
    sourceBytes = fs.readFileSync(path.join(workspaceRoot, inspected.path));
  } catch (error) {
    return { ok: false, error: 'cad_source_not_found', message: error.message };
  }
  const converted = format === 'step'
    ? await cadExchange.stepToSvg({ bytes: sourceBytes, views: normalizedViews, width: size(width), height: size(height), showHidden: showHidden !== false })
    : await cadExchange.igesToSvg({ bytes: sourceBytes, views: normalizedViews, width: size(width), height: size(height), showHidden: showHidden !== false });
  if (!converted.ok) return converted;
  const outDir = path.join(workspaceRoot, ...DRAWING_DIR.split('/'));
  fs.mkdirSync(outDir, { recursive: true });
  const id = `${safeStem(inspected.path)}-${Date.now().toString(36)}`;
  const svgRel = `${DRAWING_DIR}/${id}.svg`;
  const svgPath = path.join(workspaceRoot, ...svgRel.split('/'));
  fs.writeFileSync(svgPath, converted.svg);
  const svgBytes = Buffer.byteLength(converted.svg);
  const svgSha = sha256(Buffer.from(converted.svg, 'utf8'));
  const manifestRel = `${DRAWING_DIR}/${id}.json`;
  const manifest = {
    schema: 'model3d-drawing-manifest/v1',
    generatedAt: new Date().toISOString(),
    source: {
      path: inspected.path,
      format,
      sha256: inspected.sourceSha256,
      bytes: inspected.bytes,
    },
    kernel: converted.summary?.kernel || null,
    kernelVersion: converted.summary?.kernelVersion || null,
    views: normalizedViews,
    svg: { path: svgRel, sha256: svgSha, bytes: svgBytes },
    capabilities: {
      hiddenLineRemoval: true,
      dimensions: false,
      gdt: false,
      note: 'HLR multiview line drawing only; dimension chains and GD&T require feature-level references (RULING-04).',
    },
    summary: converted.summary || {},
  };
  fs.writeFileSync(path.join(workspaceRoot, ...manifestRel.split('/')), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    ok: true,
    source: manifest.source,
    svgPath: svgRel,
    svgSha256: svgSha,
    bytes: svgBytes,
    manifestPath: manifestRel,
    manifest,
    summary: converted.summary || {},
    capabilities: manifest.capabilities,
  };
}

module.exports = {
  DRAWING_DIR,
  DEFAULT_VIEWS,
  createCadDrawing,
};
