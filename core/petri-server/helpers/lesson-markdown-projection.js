'use strict';

/**
 * helpers/lesson-markdown-projection.js — EVO-3 LEARNINGS.md 标记段投影（纯字符串操作）。
 * 职责边界：只做"生成/幂等替换/按 id 删除"标记段，不碰 fs / DB / 网络。
 * 物理落盘由调用方走既有 workspace_write 治理门（atomicPublish + sha256 乐观锁），
 * 本模块不自己写文件，不绕过治理（与 lesson-store.js 同纪律）。
 * 标记格式：<!-- evo:lesson:<id> --> ... <!-- /evo:lesson:<id> -->
 */

function markerOpen(id) { return `<!-- evo:lesson:${id} -->`; }
function markerClose(id) { return `<!-- /evo:lesson:${id} -->`; }

/**
 * 生成一条 lesson 的标记段。
 */
function buildLessonMarkdown(lesson = {}) {
  const id = String(lesson.sourceFingerprint || lesson.id || 'unknown').slice(0, 80);
  const title = String(lesson.title || '(untitled)').replace(/\s+/g, ' ').slice(0, 120);
  const action = String(lesson.action || '').replace(/\s+/g, ' ').slice(0, 400);
  const scope = String(lesson.scope || '?');
  const confidence = Number.isFinite(lesson.confidence) ? lesson.confidence.toFixed(2) : '?';
  return `${markerOpen(id)}\n- 标题 ${title}\n- 修正 ${action}\n- 分级 ${scope} · 置信 ${confidence}\n${markerClose(id)}`;
}

/**
 * 从一段已有 MD 中精确取出某 id 的标记段（含起止标记）。
 * @returns {string|null} 找不到返回 null
 */
function findLessonBlock(md, id) {
  if (typeof md !== 'string' || !id) return null;
  const open = markerOpen(String(id).slice(0, 80));
  const close = markerClose(String(id).slice(0, 80));
  const start = md.indexOf(open);
  if (start < 0) return null;
  const end = md.indexOf(close, start + open.length);
  if (end < 0) return null;
  return md.slice(start, end + close.length);
}

/**
 * 幂等 upsert：已存在同 id 段则整段替换，否则追加到末尾。
 */
function upsertLessonMarkdown(md = '', lesson = {}) {
  const id = String(lesson.sourceFingerprint || lesson.id || 'unknown').slice(0, 80);
  const block = buildLessonMarkdown(lesson);
  const existing = findLessonBlock(md, id);
  if (existing) return md.replace(existing, block);
  const base = typeof md === 'string' ? md : '';
  return base ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

/**
 * 按 id 删除标记段（回滚用）；找不到原样返回。
 */
function removeLessonMarkdown(md = '', id = '') {
  const existing = findLessonBlock(md, id);
  if (!existing) return typeof md === 'string' ? md : '';
  return md.replace(existing, '').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

module.exports = {
  markerOpen,
  markerClose,
  buildLessonMarkdown,
  findLessonBlock,
  upsertLessonMarkdown,
  removeLessonMarkdown,
};
