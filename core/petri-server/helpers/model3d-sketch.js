'use strict';

/**
 * helpers/model3d-sketch.js — NEXT-04B P3-1 草图 → TaskSpec。
 *
 * 只生成 task-spec/v1 草稿；不写盘、不建场景、不执行。
 * 已知尺寸由用户显式给出；缺少尺度/材料/约束必须进 missingInfo/assumptions，
 * 模型不得补造精确数值。
 */

const { callVision } = require('./llm-client');
const { parseTaskSpecResponse } = require('./task-spec');

const MAX_DATA_URL_CHARS = 12 * 1024 * 1024;
const MAX_DIMENSIONS_CHARS = 500;
const MAX_NOTES_CHARS = 1000;

function validateSketchImage(value) {
  const text = typeof value === 'string' ? value : '';
  if (!text) return { ok: false, error: 'image_required' };
  if (text.length > MAX_DATA_URL_CHARS) return { ok: false, error: 'image_too_large' };
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(text)) {
    return { ok: false, error: 'image_invalid' };
  }
  return { ok: true, image: text };
}

function cleanText(value, max) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function buildSketchPrompt(dimensions, notes) {
  const lines = [
    '把这张 3D 设计草图转成结构化 task-spec/v1，供后续参数化建模。',
    '只使用用户明确给出的尺寸；缺少尺度、材料、壁厚、装配或约束时必须写入 missingInfo 或 assumptions，禁止补造精确数值。',
    'taskType 必须是 "modeling"。输出严格 JSON：',
    '{"optimizedPrompt":"...","taskSpec":{"version":"task-spec/v1","taskType":"modeling","goal":"...","deliverables":[],"constraints":[],"assumptions":[],"acceptance":[],"missingInfo":[]},"changeSummary":[]}',
    dimensions ? `用户给出的已知尺寸：${dimensions}` : '用户未提供任何尺寸：所有尺度必须进入 missingInfo。',
  ];
  if (notes) lines.push(`补充说明：${notes}`);
  return lines.join('\n');
}

async function sketchToTaskSpec({ imageDataUrl, dimensions, notes, userId } = {}) {
  const image = validateSketchImage(imageDataUrl);
  if (!image.ok) return image;
  const dimensionsText = cleanText(dimensions, MAX_DIMENSIONS_CHARS);
  const notesText = cleanText(notes, MAX_NOTES_CHARS);
  const response = await callVision('', {
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: buildSketchPrompt(dimensionsText, notesText) },
        { type: 'image', image: image.image },
      ],
    }],
  }, { userId: userId || null, kind: 'model3d-sketch-spec' });
  if (!response || response.error) {
    return {
      ok: false,
      error: 'vision_unavailable',
      reason: response && response.error ? response.error : 'vision_failed',
      message: response && response.message ? response.message : null,
    };
  }
  const parsed = parseTaskSpecResponse(response.content);
  if (!parsed.ok) return { ok: false, ...parsed, model: response.model || null };
  return {
    ok: true,
    ...parsed.value,
    taskSpec: { ...parsed.value.taskSpec, taskType: 'modeling' },
    model: response.model || null,
    usage: response.usage || null,
  };
}

module.exports = {
  MAX_DATA_URL_CHARS,
  validateSketchImage,
  buildSketchPrompt,
  sketchToTaskSpec,
};
