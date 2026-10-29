'use strict';

/**
 * helpers/model3d-review.js — NEXT-04B 多视角渲染 + 视觉辅助 QA。
 *
 * 视觉只返回观察/疑似问题/不确定项，不产生尺寸或几何通过的布尔真值。
 * 几何校验/Blender 报告仍是确定性事实；视觉缺席时如实降级。
 */

const fs = require('node:fs');
const path = require('node:path');
const scene3d = require('./scene3d');
const blender = require('./blender-provider');
const { callVision } = require('./llm-client');
const { imageDataUrlFromBuffer } = require('../agent-tools/vision-image-io');

const VIEW_LABELS = { front: '前视图', top: '顶视图', side: '侧视图', iso: '等轴视图' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function parseVisionReport(raw, viewNames) {
  const text = String(raw || '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      const rows = Array.isArray(parsed.views) ? parsed.views : [];
      const normalized = viewNames.map((view) => {
        const found = rows.find((row) => row && row.view === view) || {};
        return {
          view,
          observations: Array.isArray(found.observations) ? found.observations.map(String).slice(0, 12) : [],
          suspectedIssues: Array.isArray(found.suspectedIssues) ? found.suspectedIssues.map(String).slice(0, 12) : [],
          uncertain: Array.isArray(found.uncertain) ? found.uncertain.map(String).slice(0, 12) : [],
        };
      });
      return { parseStatus: 'structured', views: normalized, rawText: null };
    } catch { /* fall through to honest unstructured */ }
  }
  return {
    parseStatus: 'unstructured',
    views: viewNames.map((view) => ({
      view,
      observations: view === viewNames[0] ? [text.slice(0, 1000)].filter(Boolean) : [],
      suspectedIssues: [],
      uncertain: ['模型未返回结构化 JSON；以下仅保留原始观察文本'],
    })),
    rawText: text.slice(0, 2000),
  };
}

async function reviewRenders({ report, userId, viewOrder }) {
  const renders = report && report.renders ? report.renders : {};
  const views = (viewOrder && viewOrder.length > 0 ? viewOrder : Object.keys(renders)).filter((view) => renders[view]);
  if (views.length === 0) return { status: 'unavailable', reason: 'no_renders' };
  const content = [{
    type: 'text',
    text: [
      '你是 3D 设计视觉检查助手。请检查多视角渲染图，只描述看到的内容，不推断精确尺寸。',
      '仅返回 JSON：{"views":[{"view":"front|top|side|iso","observations":[],"suspectedIssues":[],"uncertain":[]}]}。',
      '每个数组最多 6 条、每条不超过 200 字；无法确认的写 uncertain，不得声称几何已通过。',
    ].join(''),
  }];
  for (const view of views) {
    const absolute = renders[view];
    if (!fs.existsSync(absolute)) continue;
    if (fs.statSync(absolute).size > MAX_IMAGE_BYTES) {
      content.push({ type: 'text', text: `${VIEW_LABELS[view] || view}（${view}）图片超过 4MB，已跳过视觉读取。` });
      continue;
    }
    const data = imageDataUrlFromBuffer(fs.readFileSync(absolute), absolute, path.basename(absolute));
    if (data.error) {
      content.push({ type: 'text', text: `${VIEW_LABELS[view] || view}（${view}）无法编码：${data.error}` });
      continue;
    }
    content.push({ type: 'text', text: `视图：${view}（${VIEW_LABELS[view] || view}）` });
    content.push({ type: 'image', image: data.dataUrl });
  }
  const response = await callVision('', { messages: [{ role: 'user', content }] }, {
    userId: userId || null,
    kind: 'model3d-vision-qa',
  });
  if (!response || response.error) {
    return {
      status: 'unavailable',
      reason: response && response.error ? response.error : 'vision_failed',
      message: response && response.message ? response.message : null,
    };
  }
  const parsed = parseVisionReport(response.content, views);
  return {
    status: parsed.parseStatus === 'structured' ? 'ready' : 'degraded',
    model: response.model || null,
    usage: response.usage || null,
    parseStatus: parsed.parseStatus,
    views: parsed.views,
    rawText: parsed.rawText,
  };
}

function resolveInputScene(scene) {
  const resolved = scene3d.resolveSceneSpec(scene);
  if (!resolved.ok) return resolved;
  return resolved;
}

async function runModel3DReview({ scene, workspaceRoot, userId, views } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const resolved = resolveInputScene(scene);
  if (!resolved.ok) return { ok: false, ...resolved };
  const capability = await blender.probeBlender();
  if (capability.status !== 'ready') {
    return { ok: false, error: 'capability_unavailable', reason: capability.reason, visionStatus: 'not_run' };
  }
  const render = await blender.runBlenderScene({
    scene: resolved.scene,
    workspaceRoot,
    views: Array.isArray(views) && views.length > 0 ? views : ['front', 'top', 'side', 'iso'],
    formats: [],
  });
  if (!render.ok) return { ok: false, ...render };
  const vision = await reviewRenders({
    report: render.report,
    userId,
    viewOrder: Array.isArray(views) && views.length > 0 ? views : ['front', 'top', 'side', 'iso'],
  });
  const relative = (absolute) => {
    if (!absolute) return null;
    return path.relative(workspaceRoot, absolute).replace(/\\/g, '/');
  };
  return {
    ok: true,
    schema: 'model3d-review/v1',
    sceneHash: scene3d.hashSceneSpec(resolved.scene),
    provider: { name: 'blender', version: capability.version },
    render: {
      outDir: render.outDir,
      report: {
        ...render.report,
        renders: Object.fromEntries(Object.entries(render.report.renders || {}).map(([key, value]) => [key, relative(value)])),
        exports: Object.fromEntries(Object.entries(render.report.exports || {}).map(([key, value]) => [key, relative(value)])),
      },
      outputs: render.outputs,
    },
    vision,
  };
}

module.exports = { parseVisionReport, reviewRenders, runModel3DReview };
