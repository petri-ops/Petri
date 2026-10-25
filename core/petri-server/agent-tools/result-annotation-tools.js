'use strict';

/**
 * agent-tools/result-annotation-tools.js — BLOCK-254 A-2 批注只读读取工具。
 *
 * 断点：批注进入 Agent 上下文原本只有一条路——用户在批注条上点「加入任务」，
 * 前端用 `buildAnnotationTaskPrompt` 拼一段文本发过来。模型自己无法按需回读
 * 「我在图上标了什么」，跨轮追问时只能靠上一轮正文里的转述。
 *
 * result_annotations_list — 按 scope（结果产物 artifact+revision / 工作区文件路径）
 * 有界读取旁路批注：kind 语义 + 页/百分比坐标 + 评论。只读、有界、项目隔离。
 *
 * 诚实边界（与 result-annotation-contracts 同一纪律）：
 *  - 只读（contract sideEffect=none / metadata readOnly）：不创建、不删除、不改产物。
 *  - 批注是旁路元数据：返回里显式声明「原始产物未被修改」，避免模型误以为文件被编辑。
 *  - 项目隔离 fail-closed：projectId 必填，不跨项目猜测；缺失即拒绝，不兜底。
 *  - 有界：条数 ≤20（硬顶 50）、单条评论截 400 字、总字符预算 6000。
 *  - 坐标语义只报「相对页/图的百分比」，不换算像素——缩放后依然成立。
 */

const MAX_ANNOTATIONS = 20;
const MAX_ANNOTATIONS_HARD_CAP = 50;
const MAX_COMMENT_CHARS = 400;
const MAX_BUDGET_CHARS = 6000;

const KIND_LABELS = Object.freeze({
  region: '矩形',
  ellipse: '椭圆',
  arrow: '箭头',
  text: '文本',
  mosaic: '马赛克',
});

// BLOCK-254 P6 — 与契约同集合（含速记条目归属）。
const ANNOTATION_SURFACES = Object.freeze(['result-artifact', 'workspace-file', 'scratchpad-entry']);

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clip(text, max) {
  const s = String(text ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clampLimit(raw) {
  const n = typeof raw === 'string' ? Number(raw) : raw;
  if (!Number.isInteger(n) || n < 1) return MAX_ANNOTATIONS;
  return Math.min(n, MAX_ANNOTATIONS_HARD_CAP);
}

/** 锚点的人类可读形态：有页号说页，否则按 surface 说区域。 */
function describeAnchor(annotation) {
  const page = typeof annotation.page === 'number' ? annotation.page : null;
  if (page !== null && page > 0) return `第 ${page} 页`;
  if (annotation.surface === 'workspace-file') return '文件区域';
  if (annotation.surface === 'scratchpad-entry') return '速记图片';
  return '图像区域';
}

function formatPercentRect(rect) {
  const values = Array.isArray(rect) ? rect : [];
  const pct = (value) => `${Math.round((Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0) * 100)}%`;
  const [x = 0, y = 0, width = 0, height = 0] = values;
  return `(${pct(x)}, ${pct(y)}, ${pct(width)}×${pct(height)})`;
}

/** 单条批注 → 模型可见的最小形态（无内部 id、无原始路径）。 */
function toReadableAnnotation(annotation, index) {
  const kind = readString(annotation.kind) || 'region';
  return {
    index: index + 1,
    kind,
    kindLabel: KIND_LABELS[kind] || KIND_LABELS.region,
    anchor: describeAnchor(annotation),
    rect: Array.isArray(annotation.rect) ? annotation.rect.slice(0, 4) : [],
    rectText: formatPercentRect(annotation.rect),
    comment: clip(annotation.comment, MAX_COMMENT_CHARS),
    color: readString(annotation.color) || 'amber',
    createdAt: annotation.createdAt || null,
  };
}

function defaultStore() {
  const dbModule = require('../db');
  const handle = typeof dbModule.getDatabase === 'function' ? dbModule.getDatabase() : dbModule.db;
  if (!handle) throw new Error('annotation store unavailable');
  const { createResultAnnotationStore } = require('../../shared-backend/result-annotation-store');
  return createResultAnnotationStore(handle);
}

/**
 * result_annotations_list — 有界读取某个 scope 的旁路批注。
 *
 * @param {{projectId?: string, surface?: string, artifactId?: string, revisionId?: string, filePath?: string, limit?: number}} args
 * @param {{listByScope?: (scope: object) => object[], store?: object}} [deps] 测试注入点
 */
async function tool_result_annotations_list(args = {}, deps = {}) {
  const projectId = readString(args.projectId);
  if (!projectId) {
    return {
      ok: false,
      error: 'missing_projectId',
      message: '需要 projectId（系统提示里的 projectId= 值；工作台场景已自动注入）。批注按项目隔离，不做跨项目猜测。',
    };
  }

  const artifactId = readString(args.artifactId);
  const entryId = readString(args.entryId);
  const filePath = readString(args.filePath).replace(/\\/g, '/');
  const rawSurface = readString(args.surface);
  const surface = rawSurface || (artifactId ? 'result-artifact' : entryId ? 'scratchpad-entry' : filePath ? 'workspace-file' : '');
  if (!ANNOTATION_SURFACES.includes(surface)) {
    return {
      ok: false,
      error: 'surface_invalid',
      message: `surface 必须是 ${ANNOTATION_SURFACES.join(' | ')}；也可用 artifactId / entryId / filePath 隐式指定。`,
    };
  }

  const scope = { projectId, surface };
  if (surface === 'scratchpad-entry') {
    if (!entryId) {
      return { ok: false, error: 'missing_entryId', message: '速记图片批注需要 entryId（速记条目 id）。' };
    }
    scope.entryId = entryId;
  } else if (surface === 'result-artifact') {
    if (!artifactId) {
      return { ok: false, error: 'missing_artifactId', message: '结果产物批注需要 artifactId。' };
    }
    scope.artifactId = artifactId;
    scope.revisionId = readString(args.revisionId) || null;
  } else {
    if (!filePath) {
      return { ok: false, error: 'missing_filePath', message: '工作区文件批注需要 filePath（项目内相对路径）。' };
    }
    const { isSafeRelativePath } = require('../../shared-backend/result-annotation-contracts');
    if (typeof isSafeRelativePath === 'function' && !isSafeRelativePath(filePath)) {
      return { ok: false, error: 'file_path_invalid', message: 'filePath 必须是项目内相对路径（不含盘符、协议或 .. 逃逸）。' };
    }
    scope.filePath = filePath;
  }

  const limit = clampLimit(args.limit);
  let rows;
  try {
    if (typeof deps.listByScope === 'function') {
      rows = deps.listByScope(scope);
    } else {
      const store = deps.store || defaultStore();
      rows = store.listByScope(scope);
    }
  } catch (error) {
    return { ok: false, error: 'annotation_read_failed', message: `读取批注失败：${error && error.message ? error.message : 'unknown'}` };
  }

  const all = Array.isArray(rows) ? rows : [];
  const total = all.length;
  if (total === 0) {
    return {
      ok: true,
      available: false,
      projectId,
      surface,
      scope,
      total: 0,
      returned: 0,
      truncated: false,
      annotations: [],
      message: '该范围没有任何批注。不要凭空描述批注内容；如需批注请让用户在结果面或文件预览里标注。',
    };
  }

  // 最近优先：批注是「用户此刻在意什么」的信号，旧批注在长会话里噪声更大。
  const recent = all.slice(Math.max(0, total - limit)).reverse();
  const annotations = [];
  let budget = 0;
  for (const row of recent) {
    const readable = toReadableAnnotation(row, annotations.length);
    const cost = readable.comment.length + 80;
    if (budget + cost > MAX_BUDGET_CHARS && annotations.length > 0) break;
    budget += cost;
    annotations.push(readable);
  }

  const truncated = annotations.length < total;
  return {
    ok: true,
    available: true,
    projectId,
    surface,
    scope,
    total,
    returned: annotations.length,
    truncated,
    order: 'recent-first',
    annotations,
    message: `该范围共 ${total} 条批注，返回最近 ${annotations.length} 条${truncated ? '（其余未展开）' : ''}。`
      + '坐标是相对页/图的百分比区域；批注只存在于旁路元数据中，原始产物文件未被修改——不要假设文件已被编辑，也不要编造未列出的批注。',
  };
}

module.exports = {
  tool_result_annotations_list,
  toReadableAnnotation,
  describeAnchor,
  formatPercentRect,
  MAX_ANNOTATIONS,
  MAX_ANNOTATIONS_HARD_CAP,
  MAX_COMMENT_CHARS,
};
