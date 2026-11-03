/**
 * BLOCK-342 切片3 — 图片嵌入（纯逻辑，可单测）。
 *
 * 安全边界（裁决留档）：只把**本地文件**嵌为 `data:image/(png|jpeg|gif|webp);base64,…`，
 * 原始文件 ≤ 2MB；拒绝 SVG（base64 内嵌是脱敏的走私面）、非图片类型与外链（断网裂图，
 * 违背本地主权）。后端 DANGEROUS_HREF_RE 只拦 javascript:/vbscript:/data:text/html，
 * 视图脱敏同口径，data:image 天然放行；这里是前端侧的「只生成安全值」守卫。
 */
import type { SvgOp } from './svgEditorModel';

export const IMAGE_EMBED_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_EMBED_TYPES: ReadonlyArray<string> = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

const DATA_URL_RE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/;

export type EmbedCheck = { ok: true } | { ok: false; reason: string };

/** 文件级校验：类型白名单 + 大小上限（SVG 显式拒绝并说明原因）。 */
export function validateEmbedFile(file: { type: string; size: number; name?: string }): EmbedCheck {
  const type = (file.type || '').toLowerCase();
  if (type === 'image/svg+xml' || /\.svg$/i.test(file.name || '')) {
    return { ok: false, reason: 'SVG 不作为位图嵌入（base64 内嵌会绕过脱敏）；请改用图层/路径粘贴' };
  }
  if (!IMAGE_EMBED_TYPES.includes(type)) {
    return { ok: false, reason: `只接受 PNG/JPEG/GIF/WebP（收到 ${type || '未知类型'}）` };
  }
  if (file.size > IMAGE_EMBED_MAX_BYTES) {
    return { ok: false, reason: `图片超过 2MB 上限（${(file.size / 1024 / 1024).toFixed(2)}MB），请先压缩` };
  }
  return { ok: true };
}

/** data URL 形态守卫：只放行白名单类型的 base64 形态（属性值天然无引号/尖括号）。 */
export function isSafeImageDataUrl(value: string): boolean {
  return typeof value === 'string' && value.length < 4 * 1024 * 1024 && DATA_URL_RE.test(value);
}

export interface ImageBox { x: number; y: number; width: number; height: number }

/**
 * 按自然尺寸适配：最长边落在 [minEdge, maxEdge]（小图放大到可见、大图缩到画布可容），保持长宽比。
 * 零/非法尺寸回落 160×120（诚实占位，不猜比例）。
 */
export function fitImageBox(
  naturalWidth: number,
  naturalHeight: number,
  opts: { maxEdge?: number; minEdge?: number; origin?: { x: number; y: number } } = {},
): ImageBox {
  const maxEdge = opts.maxEdge ?? 320;
  const minEdge = opts.minEdge ?? 64;
  const origin = opts.origin ?? { x: 20, y: 20 };
  const w = Number.isFinite(naturalWidth) && naturalWidth > 0 ? naturalWidth : 0;
  const h = Number.isFinite(naturalHeight) && naturalHeight > 0 ? naturalHeight : 0;
  if (w === 0 || h === 0) return { x: origin.x, y: origin.y, width: 160, height: 120 };
  const longest = Math.max(w, h);
  const scale = longest > maxEdge ? maxEdge / longest : longest < minEdge ? minEdge / longest : 1;
  const round = (n: number) => Math.round(n * 10) / 10;
  return { x: origin.x, y: origin.y, width: round(w * scale), height: round(h * scale) };
}

/** 嵌入 op：白名单 insert（markup 由后端再做一次安全校验）。dataUrl 不安全时返回 null。 */
export function imageInsertOp(dataUrl: string, box: ImageBox, parentPath: number[] = []): SvgOp | null {
  if (!isSafeImageDataUrl(dataUrl)) return null;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    op: 'insert',
    parent: { path: parentPath },
    index: 'end',
    markup: `<image href="${dataUrl}" x="${r(box.x)}" y="${r(box.y)}" width="${r(box.width)}" height="${r(box.height)}" preserveAspectRatio="xMidYMid meet" />`,
  };
}
