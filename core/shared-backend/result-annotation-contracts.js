'use strict';

/**
 * shared-backend/result-annotation-contracts.js
 *
 * BLOCK-219 Q6 — 产物批注契约（校验 + 归一化 + 有界）。
 *
 * 设计约束（plan §0/§3）：
 * - **旁路**：批注只描述"在哪、写了什么"，永不回写原始产物文件。
 * - **归一化坐标**：rect = [x, y, w, h]，四值均为 0..1 的相对量；缩放/DPI 变化
 *   不影响复现。越界按页/图边界钳制，完全落在边界外则拒绝（不静默存空框）。
 * - **有界**：评论 ≤ MAX_ANNOTATION_COMMENT_CHARS；单 scope 条数上限由路由用
 *   MAX_ANNOTATIONS_PER_SCOPE 强制（本模块只提供常量，不做 IO）。
 * - **项目隔离**：projectId 必填；artifact/file 二选一由 surface 决定。
 *
 * 该文件是批注词汇的唯一书写处：路由、仓储、前端契约镜像都从这里取枚举/上限，
 * 不得各自复制字面量。
 */

const ANNOTATION_CONTRACT_VERSION = 1;

const ANNOTATION_SURFACES = Object.freeze(['result-artifact', 'workspace-file']);
const ANNOTATION_KINDS = Object.freeze(['region']);
const ANNOTATION_COLORS = Object.freeze(['amber', 'sky', 'rose']);

const MAX_ANNOTATION_COMMENT_CHARS = 2000;
const MAX_ANNOTATIONS_PER_SCOPE = 200;
const MAX_ANNOTATION_PAGE = 100000;
const MIN_ANNOTATION_SIDE = 0.001;
const MAX_ANNOTATION_IDENTIFIER_CHARS = 300;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 批注来源文件路径：workspace 相对路径。
 * 拒绝绝对路径 / 盘符 / 协议 / `..` 逃逸——与 shared-pack-assets 同一安全口径，
 * 但这里是用户文档路径词汇，不共享 pack 的 entry 归一化（那是包资产语义）。
 */
function isSafeRelativePath(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  if (filePath.includes('\0')) return false;
  const normalized = filePath.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.startsWith('/') || normalized.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.length === 0) return false;
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return false;
  return true;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * 归一化矩形：接受任意方向的拖拽（client 可能给出负宽高）。
 *
 * @returns {{ ok: true, rect: number[] } | { ok: false, code: string, message: string }}
 */
function normalizeAnnotationRect(input) {
  if (!Array.isArray(input) || input.length !== 4) {
    return { ok: false, code: 'rect_invalid', message: 'rect 必须是 [x, y, w, h] 四元数组。' };
  }
  const raw = input.map((value) => (typeof value === 'string' ? Number(value) : value));
  if (!raw.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return { ok: false, code: 'rect_not_finite', message: 'rect 四个分量必须是有限数字。' };
  }
  const [x, y, w, h] = raw;
  const x1 = clamp01(w >= 0 ? x : x + w);
  const y1 = clamp01(h >= 0 ? y : y + h);
  const x2 = clamp01(w >= 0 ? x + w : x);
  const y2 = clamp01(h >= 0 ? y + h : y);
  const width = x2 - x1;
  const height = y2 - y1;
  if (width < MIN_ANNOTATION_SIDE || height < MIN_ANNOTATION_SIDE) {
    return {
      ok: false,
      code: 'rect_too_small',
      message: `批注区域过小或完全落在边界外（最小边长 ${MIN_ANNOTATION_SIDE}）。`,
    };
  }
  const round = (value) => Math.round(value * 10000) / 10000;
  return { ok: true, rect: [round(x1), round(y1), round(width), round(height)] };
}

function normalizePage(value) {
  if (value === undefined || value === null || value === '') return { ok: true, page: null };
  const page = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(page) || page < 1 || page > MAX_ANNOTATION_PAGE) {
    return { ok: false, code: 'page_invalid', message: `page 必须是 1..${MAX_ANNOTATION_PAGE} 的整数。` };
  }
  return { ok: true, page };
}

/**
 * 校验并归一化一条批注输入。
 *
 * @returns {{ ok: true, annotation: object } | { ok: false, errors: Array<{code: string, message: string}> }}
 */
function normalizeAnnotationInput(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'annotation_invalid', message: '批注载荷必须是对象。' }] };
  }

  const projectId = readString(input.projectId);
  if (!projectId || projectId.length > MAX_ANNOTATION_IDENTIFIER_CHARS) {
    errors.push({ code: 'project_id_required', message: 'projectId 必填。' });
  }

  const surface = readString(input.surface);
  if (!ANNOTATION_SURFACES.includes(surface)) {
    errors.push({ code: 'surface_invalid', message: `surface 必须是 ${ANNOTATION_SURFACES.join(' | ')}。` });
  }

  const kind = readString(input.kind) || 'region';
  if (!ANNOTATION_KINDS.includes(kind)) {
    errors.push({ code: 'kind_invalid', message: `kind 必须是 ${ANNOTATION_KINDS.join(' | ')}。` });
  }

  const color = readString(input.color) || ANNOTATION_COLORS[0];
  if (!ANNOTATION_COLORS.includes(color)) {
    errors.push({ code: 'color_invalid', message: `color 必须是 ${ANNOTATION_COLORS.join(' | ')}。` });
  }

  const comment = readString(input.comment);
  if (!comment) {
    errors.push({ code: 'comment_required', message: '批注评论不能为空。' });
  } else if (comment.length > MAX_ANNOTATION_COMMENT_CHARS) {
    errors.push({
      code: 'comment_too_long',
      message: `批注评论不能超过 ${MAX_ANNOTATION_COMMENT_CHARS} 字（当前 ${comment.length}）。`,
    });
  }

  const rect = normalizeAnnotationRect(input.rect);
  if (!rect.ok) errors.push({ code: rect.code, message: rect.message });

  const page = normalizePage(input.page);
  if (!page.ok) errors.push({ code: page.code, message: page.message });

  const artifactId = readString(input.artifactId) || null;
  const revisionId = readString(input.revisionId) || null;
  const artifactName = readString(input.artifactName) || null;
  const filePathRaw = readString(input.filePath);
  let filePath = null;

  if (surface === 'result-artifact') {
    if (!artifactId) {
      errors.push({ code: 'artifact_id_required', message: '结果产物批注必须带 artifactId。' });
    }
    if (filePathRaw) {
      errors.push({ code: 'file_path_unexpected', message: '结果产物批注不接受 filePath。' });
    }
  } else if (surface === 'workspace-file') {
    if (!filePathRaw) {
      errors.push({ code: 'file_path_required', message: '工作区文件批注必须带 filePath。' });
    } else if (!isSafeRelativePath(filePathRaw)) {
      errors.push({ code: 'file_path_invalid', message: 'filePath 必须是项目内相对路径。' });
    } else {
      filePath = filePathRaw.replace(/\\/g, '/');
    }
    if (artifactId) {
      errors.push({ code: 'artifact_id_unexpected', message: '工作区文件批注不接受 artifactId。' });
    }
    if (revisionId) {
      errors.push({ code: 'revision_id_unexpected', message: '工作区文件批注不接受 revisionId。' });
    }
  }

  const conversationId = readString(input.conversationId) || null;
  const author = readString(input.author) || 'user';

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    annotation: {
      contractVersion: ANNOTATION_CONTRACT_VERSION,
      projectId,
      conversationId,
      surface,
      artifactId,
      revisionId,
      filePath,
      artifactName,
      kind,
      page: page.page,
      rect: rect.rect,
      comment,
      color,
      author,
    },
  };
}

/**
 * 批注 scope 的唯一判定：结果产物按 (artifactId, revisionId)，工作区文件按 filePath。
 * 读/写/删除与上限计数都走这一处，避免"同一批注两种归属"。
 */
function annotationScopeOf(annotation) {
  const projectId = readString(annotation && annotation.projectId);
  const surface = readString(annotation && annotation.surface);
  if (surface === 'result-artifact') {
    return {
      projectId,
      surface,
      artifactId: readString(annotation.artifactId) || null,
      revisionId: readString(annotation.revisionId) || null,
      filePath: null,
    };
  }
  return {
    projectId,
    surface: 'workspace-file',
    artifactId: null,
    revisionId: null,
    filePath: readString(annotation && annotation.filePath) || null,
  };
}

module.exports = {
  ANNOTATION_CONTRACT_VERSION,
  ANNOTATION_SURFACES,
  ANNOTATION_KINDS,
  ANNOTATION_COLORS,
  MAX_ANNOTATION_COMMENT_CHARS,
  MAX_ANNOTATIONS_PER_SCOPE,
  MAX_ANNOTATION_PAGE,
  MIN_ANNOTATION_SIDE,
  normalizeAnnotationInput,
  normalizeAnnotationRect,
  annotationScopeOf,
  isSafeRelativePath,
};
