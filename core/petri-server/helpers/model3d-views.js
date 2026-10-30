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

module.exports = {
  STANDARD_VIEWS,
  CAMERA_VIEW,
  RENDER_VIEWS,
  DEFAULT_RENDER_VIEWS,
  isRenderView,
  normalizeRenderViews,
};
