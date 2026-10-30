'use strict';

/**
 * helpers/model3d-views.js — 渲染视角名的唯一声明处（BLOCK-322 P2-01）。
 *
 * 此前 front/top/side/iso 这组默认值在 blender-provider、model3d-tools（2 处）、
 * tool-defs（3 处 enum）、routes/model3d（REVIEW_VIEWS）、model3d-review（2 处）
 * 各写一遍；P2-01 要新增 `camera`（用 SceneSpec 声明的相机出图）——第三份清单
 * 就是再次漂移的信号，故收敛到这里。
 *
 * `camera` 视角只在场景声明了 `camera` 时有产物；未声明时构建脚本如实跳过，
 * 不产出「假相机」渲染。
 */

/** 固定机位视角（按包围盒自动取景）。 */
const STANDARD_VIEWS = Object.freeze(['front', 'top', 'side', 'iso']);
/** 声明相机视角（需 SceneSpec.camera 在场）。 */
const CAMERA_VIEW = 'camera';
/** 全部可请求视角。 */
const RENDER_VIEWS = Object.freeze([...STANDARD_VIEWS, CAMERA_VIEW]);
/** 默认视角集（未显式指定时使用；camera 缺席则不出图）。 */
const DEFAULT_RENDER_VIEWS = RENDER_VIEWS;

function isRenderView(value) {
  return typeof value === 'string' && RENDER_VIEWS.includes(value);
}

function normalizeRenderViews(input) {
  if (!Array.isArray(input)) return null;
  const views = [];
  for (const item of input) {
    const view = String(item || '').trim().toLowerCase();
    if (!isRenderView(view)) return null;
    if (!views.includes(view)) views.push(view);
  }
  return views.length > 0 ? views : null;
}

/**
 * BLOCK-322 P2-04 — 转盘/序列帧的请求参数唯一声明处。
 *
 * 动画是**输出请求**而不是场景真相：不进 SceneSpec、不参与 hash（同一份 SceneSpec
 * 转 24 帧还是 48 帧不改变几何，若写进场景就会为纯出图理由刷出新 revision）。
 * 上下界只在这里写一遍：provider、agent 工具与 REST 三条入口共用同一判定，
 * 免得某一处漏检而把 5000 帧的请求送进 Blender 撞 180s 超时。
 */
const DEFAULT_TURNTABLE_FRAMES = 24;
const TURNTABLE_MIN_FRAMES = 2;
const TURNTABLE_MAX_FRAMES = 48;
const DEFAULT_TURNTABLE_ELEVATION_DEG = 20;
const TURNTABLE_MIN_ELEVATION_DEG = -89;
const TURNTABLE_MAX_ELEVATION_DEG = 89;

/**
 * @returns {{ok: true, turntable: {frames:number, elevationDeg:number}|null} | {ok: false, error: string}}
 * 未请求（undefined/null/false）→ `turntable: null` 且 ok（存量行为零变化）；
 * 请求但越界 → 显式错误，不静默夹到边界值（静默改参就是「你要 8 帧给你 48 帧」）。
 */
function normalizeTurntable(raw) {
  if (raw === undefined || raw === null || raw === false) return { ok: true, turntable: null };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'turntable_invalid' };
  const frames = raw.frames === undefined ? DEFAULT_TURNTABLE_FRAMES : raw.frames;
  if (!Number.isInteger(frames) || frames < TURNTABLE_MIN_FRAMES || frames > TURNTABLE_MAX_FRAMES) {
    return { ok: false, error: `turntable_frames_invalid（须是 ${TURNTABLE_MIN_FRAMES}..${TURNTABLE_MAX_FRAMES} 的整数）` };
  }
  const elevationDeg = raw.elevationDeg === undefined ? DEFAULT_TURNTABLE_ELEVATION_DEG : raw.elevationDeg;
  if (typeof elevationDeg !== 'number' || !Number.isFinite(elevationDeg)
    || elevationDeg < TURNTABLE_MIN_ELEVATION_DEG || elevationDeg > TURNTABLE_MAX_ELEVATION_DEG) {
    return { ok: false, error: `turntable_elevation_invalid（须在 ${TURNTABLE_MIN_ELEVATION_DEG}..${TURNTABLE_MAX_ELEVATION_DEG} 度）` };
  }
  return { ok: true, turntable: { frames, elevationDeg } };
}

module.exports = {
  STANDARD_VIEWS,
  CAMERA_VIEW,
  RENDER_VIEWS,
  DEFAULT_RENDER_VIEWS,
  DEFAULT_TURNTABLE_FRAMES,
  TURNTABLE_MIN_FRAMES,
  TURNTABLE_MAX_FRAMES,
  TURNTABLE_MIN_ELEVATION_DEG,
  TURNTABLE_MAX_ELEVATION_DEG,
  isRenderView,
  normalizeRenderViews,
  normalizeTurntable,
};
