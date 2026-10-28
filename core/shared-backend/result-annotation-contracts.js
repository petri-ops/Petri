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

const ANNOTATION_CONTRACT_VERSION = 2;

// BLOCK-254 P6 — 三种归属面：结果产物（artifact+revision）/ 工作区文件（filePath）/
// 速记条目（entryId）。第三种只用于速记板里的图片批注，不与工作区路径混用。
const ANNOTATION_SURFACES = Object.freeze(['result-artifact', 'workspace-file', 'scratchpad-entry']);
const ANNOTATION_KINDS = Object.freeze(['region', 'ellipse', 'arrow', 'text', 'mosaic', 'text-selection', 'freehand']);
// BLOCK-264（C-43）— freehand 画笔：点序列几何（归一化 0..1，与 rect 同域）；
// 有界采样（≤MAX_FREEHAND_POINTS，超限等距抽稀不拒绝）；与 rect/anchor 均互斥。
const MAX_FREEHAND_POINTS = 512;
const PATH_KINDS = Object.freeze(['freehand']);
const ANNOTATION_COLORS = Object.freeze(['amber', 'sky', 'rose']);

/**
 * BLOCK-254 P5 — 文本锚点（text-selection）是**另一种定位方式**，不是另一种形状。
 *
 * 它与 rect 互斥：文本批注锚在「文件 + 行范围（+可选列/原文片段）」上，图像/PDF 批注
 * 锚在归一化矩形上。两者塞进同一条记录会导致「既说坐标又说行号」的自相矛盾，
 * 因此契约层直接拒绝越界组合，而不是靠调用方自觉。
 */
const ANNOTATION_ANCHOR_KINDS = Object.freeze(['text-range']);
/**
 * BLOCK-254 P7 — 锚点单位。源码行、文档段落、表格行三者序号语义不同，
 * 用加性字段区分（默认 line），避免把「第 3 段」说成「第 3 行」。
 */
const ANCHOR_UNITS = Object.freeze(['line', 'paragraph', 'row']);
const ANCHOR_SURFACE = 'workspace-file';
const MAX_ANCHOR_LINE = 1000000;
const MAX_ANCHOR_COLUMN = 100000;
const MAX_ANCHOR_QUOTE_CHARS = 500;
const MAX_ANCHOR_LANGUAGE_CHARS = 40;

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


/**
 * BLOCK-264（C-43）— 画笔路径归一化：点序列 [[x,y],...]，每点 0..1 clamp。
 * 有界：≤ MAX_FREEHAND_POINTS（超限等距抽稀——保留首尾与形状，不拒绝）；
 * 少于 2 点拒绝（画一笔至少两个采样）。
 */
function normalizeAnnotationPath(input) {
  if (!Array.isArray(input) || input.length < 2) {
    return { ok: false, code: 'path_invalid', message: 'path 必须是至少 2 个 [x,y] 点的数组。' };
  }
  const seenFinite = input.every((pt) => Array.isArray(pt) && pt.length === 2
    && pt.every((v) => typeof v === 'number' && Number.isFinite(v)));
  if (!seenFinite) {
    return { ok: false, code: 'path_not_finite', message: 'path 每个点必须是 [x, y] 有限数字对。' };
  }
  let points = input.map(([x, y]) => [clamp01(x), clamp01(y)]);
  if (points.length > MAX_FREEHAND_POINTS) {
    // 等距抽稀（保留首尾）
    const kept = [points[0]];
    const step = (points.length - 1) / (MAX_FREEHAND_POINTS - 1);
    for (let i = 1; i < MAX_FREEHAND_POINTS - 1; i += 1) {
      kept.push(points[Math.round(i * step)]);
    }
    kept.push(points[points.length - 1]);
    points = kept;
  }
  const round = (value) => Math.round(value * 10000) / 10000;
  return { ok: true, path: points.map(([x, y]) => [round(x), round(y)]), thinned: input.length > MAX_FREEHAND_POINTS };
}

function normalizePage(value) {
  if (value === undefined || value === null || value === '') return { ok: true, page: null };
  const page = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(page) || page < 1 || page > MAX_ANNOTATION_PAGE) {
    return { ok: false, code: 'page_invalid', message: `page 必须是 1..${MAX_ANNOTATION_PAGE} 的整数。` };
  }
  return { ok: true, page };
}

function normalizeAnchorLine(value, field, errors) {
  const raw = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(raw) || raw < 1 || raw > MAX_ANCHOR_LINE) {
    errors.push({ code: 'anchor_line_invalid', message: `${field} 必须是 1..${MAX_ANCHOR_LINE} 的整数。` });
    return null;
  }
  return raw;
}

function normalizeAnchorColumn(value, field, errors) {
  if (value === undefined || value === null || value === '') return null;
  const raw = typeof value === 'string' ? Number(value) : value;
  if (!Number.isInteger(raw) || raw < 0 || raw > MAX_ANCHOR_COLUMN) {
    errors.push({ code: 'anchor_column_invalid', message: `${field} 必须是 0..${MAX_ANCHOR_COLUMN} 的整数。` });
    return null;
  }
  return raw;
}

/**
 * 校验并归一化文本锚点（`kind='text-selection'` 专用）。
 *
 * @returns {{ ok: true, anchor: object } | { ok: false, errors: Array<{code: string, message: string}> }}
 */
function normalizeAnnotationAnchor(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: [{ code: 'anchor_invalid', message: 'anchor 必须是对象。' }] };
  }

  const anchorKind = readString(input.kind) || 'text-range';
  if (!ANNOTATION_ANCHOR_KINDS.includes(anchorKind)) {
    errors.push({ code: 'anchor_kind_invalid', message: `anchor.kind 必须是 ${ANNOTATION_ANCHOR_KINDS.join(' | ')}。` });
  }

  const startLine = normalizeAnchorLine(input.startLine, 'anchor.startLine', errors);
  const endLine = normalizeAnchorLine(input.endLine, 'anchor.endLine', errors);
  if (startLine !== null && endLine !== null && endLine < startLine) {
    errors.push({ code: 'anchor_range_inverted', message: 'anchor.endLine 不能小于 startLine。' });
  }

  const startColumn = normalizeAnchorColumn(input.startColumn, 'anchor.startColumn', errors);
  const endColumn = normalizeAnchorColumn(input.endColumn, 'anchor.endColumn', errors);
  if (
    startColumn !== null && endColumn !== null
    && startLine !== null && endLine === startLine
    && endColumn < startColumn
  ) {
    errors.push({ code: 'anchor_columns_inverted', message: '同一行内 anchor.endColumn 不能小于 startColumn。' });
  }

  const quote = readString(input.quote);
  if (!quote) {
    errors.push({ code: 'anchor_quote_required', message: '文本批注必须带选中原文（quote）。' });
  } else if (quote.length > MAX_ANCHOR_QUOTE_CHARS) {
    errors.push({
      code: 'anchor_quote_too_long',
      message: `选中原文不能超过 ${MAX_ANCHOR_QUOTE_CHARS} 字（当前 ${quote.length}），请缩小选区。`,
    });
  }

  const language = readString(input.language) || null;
  if (language && language.length > MAX_ANCHOR_LANGUAGE_CHARS) {
    errors.push({ code: 'anchor_language_too_long', message: `language 不能超过 ${MAX_ANCHOR_LANGUAGE_CHARS} 字。` });
  }

  const rawUnit = readString(input.unit);
  const unit = rawUnit || 'line';
  if (!ANCHOR_UNITS.includes(unit)) {
    errors.push({ code: 'anchor_unit_invalid', message: `unit 必须是 ${ANCHOR_UNITS.join(' | ')}。` });
  }

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    anchor: {
      kind: 'text-range',
      unit,
      startLine,
      endLine,
      startColumn,
      endColumn,
      quote,
      language,
    },
  };
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

  // 区域批注/文本锚点/画笔路径互斥：一条记录只能有一种定位方式。
  const isTextAnchor = kind === 'text-selection';
  const isPath = kind === 'freehand'; // BLOCK-264（C-43）
  let anchor = null;
  let normalizedRect = null;
  let normalizedPath = null;

  if (isTextAnchor) {
    if (surface && surface !== ANCHOR_SURFACE) {
      errors.push({
        code: 'anchor_surface_invalid',
        message: '文本锚点批注只支持工作区文件（结果产物是图像/PDF，没有文本行）。',
      });
    }
    if (input.rect !== undefined && input.rect !== null) {
      errors.push({ code: 'rect_unexpected', message: '文本锚点批注不接受 rect（区域与行锚点互斥）。' });
    }
    if (input.path !== undefined && input.path !== null) {
      errors.push({ code: 'path_unexpected', message: '文本锚点批注不接受 path。' });
    }
    const anchorResult = normalizeAnnotationAnchor(input.anchor);
    if (!anchorResult.ok) errors.push(...anchorResult.errors);
    else anchor = anchorResult.anchor;
  } else if (isPath) {
    if (input.anchor !== undefined && input.anchor !== null) {
      errors.push({ code: 'anchor_unexpected', message: 'freehand 批注不接受 anchor。' });
    }
    if (input.rect !== undefined && input.rect !== null) {
      errors.push({ code: 'rect_unexpected', message: 'freehand 批注不接受 rect（用 path 点序列）。' });
    }
    const pathResult = normalizeAnnotationPath(input.path);
    if (!pathResult.ok) errors.push({ code: pathResult.code, message: pathResult.message });
    else normalizedPath = pathResult.path;
  } else {
    if (input.anchor !== undefined && input.anchor !== null) {
      errors.push({ code: 'anchor_unexpected', message: '只有 text-selection 批注才带 anchor。' });
    }
    const wantsPath = input.path !== undefined && input.path !== null;
    if (wantsPath && kind !== 'arrow') {
      errors.push({ code: 'path_unexpected', message: '只有 freehand 批注才带 path。' });
    }
    if (wantsPath) {
      // BLOCK-303 — 箭头真形态：path=[起点, 终点] 两点线段（渲染为带箭头头部的线段，
      // 头部贴合线段方向）；旧数据的 arrow 仍以矩形对角线近似渲染，两种形态并存兼容。
      const pathResult = normalizeAnnotationPath(input.path);
      if (!pathResult.ok) {
        errors.push({ code: pathResult.code, message: pathResult.message });
      } else if (pathResult.path.length !== 2) {
        errors.push({ code: 'arrow_path_points', message: '箭头 path 必须恰好 2 个点（起点、终点）。' });
      } else {
        normalizedPath = pathResult.path;
      }
    }
    if (!wantsPath) {
      const rect = normalizeAnnotationRect(input.rect);
      if (!rect.ok) errors.push({ code: rect.code, message: rect.message });
      else normalizedRect = rect.rect;
    }
  }

  const page = normalizePage(input.page);
  if (!page.ok) errors.push({ code: page.code, message: page.message });
  else if (isTextAnchor && page.page !== null) {
    errors.push({ code: 'page_unexpected', message: '文本锚点批注不接受 page（用行号定位）。' });
  }

  const artifactId = readString(input.artifactId) || null;
  const revisionId = readString(input.revisionId) || null;
  const artifactName = readString(input.artifactName) || null;
  const filePathRaw = readString(input.filePath);
  const entryIdRaw = readString(input.entryId);
  let filePath = null;
  let entryId = null;

  if (surface === 'scratchpad-entry') {
    if (!entryIdRaw) {
      errors.push({ code: 'entry_id_required', message: '速记图片批注必须带 entryId。' });
    } else if (entryIdRaw.length > MAX_ANNOTATION_IDENTIFIER_CHARS) {
      errors.push({ code: 'entry_id_invalid', message: `entryId 不能超过 ${MAX_ANNOTATION_IDENTIFIER_CHARS} 字。` });
    } else {
      entryId = entryIdRaw;
    }
    // 速记条目既不是产物也不是工作区文件：混入其它身份一律拒绝，避免 scope 两种归属。
    if (filePathRaw) {
      errors.push({ code: 'file_path_unexpected', message: '速记批注不接受 filePath。' });
    }
    if (artifactId) {
      errors.push({ code: 'artifact_id_unexpected', message: '速记批注不接受 artifactId。' });
    }
    if (revisionId) {
      errors.push({ code: 'revision_id_unexpected', message: '速记批注不接受 revisionId。' });
    }
  } else if (surface === 'result-artifact') {
    if (!artifactId) {
      errors.push({ code: 'artifact_id_required', message: '结果产物批注必须带 artifactId。' });
    }
    if (filePathRaw) {
      errors.push({ code: 'file_path_unexpected', message: '结果产物批注不接受 filePath。' });
    }
    if (entryIdRaw) {
      errors.push({ code: 'entry_id_unexpected', message: '结果产物批注不接受 entryId。' });
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
    if (entryIdRaw) {
      errors.push({ code: 'entry_id_unexpected', message: '工作区文件批注不接受 entryId。' });
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
      // 仅 surface='scratchpad-entry' 有值；其余面恒为 null。
      entryId,
      artifactName,
      kind,
      page: page.page,
      rect: isTextAnchor || isPath || normalizedPath ? [] : normalizedRect,
      // BLOCK-264（C-43）— freehand 点序列（存 path_json 列；rect 恒 []）
      // BLOCK-303 — 箭头真形态同列：path=[起点,终点] 两点（rect 恒 []）
      path: normalizedPath,
      anchor: isTextAnchor ? anchor : null,
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
  if (surface === 'scratchpad-entry') {
    return {
      projectId,
      surface,
      artifactId: null,
      revisionId: null,
      filePath: null,
      entryId: readString(annotation.entryId) || null,
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
  ANNOTATION_ANCHOR_KINDS,
  MAX_FREEHAND_POINTS,
  PATH_KINDS,
  normalizeAnnotationPath,
  ANCHOR_UNITS,
  ANNOTATION_COLORS,
  MAX_ANCHOR_QUOTE_CHARS,
  normalizeAnnotationAnchor,
  MAX_ANNOTATION_COMMENT_CHARS,
  MAX_ANNOTATIONS_PER_SCOPE,
  MAX_ANNOTATION_PAGE,
  MIN_ANNOTATION_SIDE,
  normalizeAnnotationInput,
  normalizeAnnotationRect,
  annotationScopeOf,
  isSafeRelativePath,
};
