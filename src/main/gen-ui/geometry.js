/**
 * src/main/gen-ui/geometry.js
 *
 * BLOCK-166 P2 复制图片的几何校验（规格 §6.5）：capturePage 区域必须有限、
 * 正尺寸、上限 10000px。纯函数供 Node 直测。
 */

const MAX_CAPTURE_PX = 10_000;

/**
 * @param {unknown} rect 期望 {x,y,width,height} 有限数
 * @returns {{x:number,y:number,width:number,height:number}|null} 归一化整数区域；非法返回 null
 */
function validateCaptureRect(rect) {
  if (!rect || typeof rect !== 'object' || Array.isArray(rect)) return null;
  const keys = ['x', 'y', 'width', 'height'];
  for (const key of keys) {
    const value = rect[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  }
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.floor(rect.width);
  const height = Math.floor(rect.height);
  if (width <= 0 || height <= 0) return null;
  if (width > MAX_CAPTURE_PX || height > MAX_CAPTURE_PX) return null;
  if (x < -MAX_CAPTURE_PX || y < -MAX_CAPTURE_PX) return null;
  return { x, y, width, height };
}

module.exports = { validateCaptureRect };
