/**
 * 自定义水印图片的导入约束与「转透明」处理（纯前端，零新依赖、不强依赖后端）。
 * 转透明沿用方向文档的 ImageMagick 思路：负片（255 - 亮度）后 level 8%/85%
 * 映射为 alpha，墨色统一 #1b2b40。纯函数 `applyWatermarkAlpha` 不碰 DOM 可单测。
 */

/** 单张自定义水印上限 2MB（防止 localStorage data URI 缓存被撑爆）。 */
export const WATERMARK_IMAGE_MAX_BYTES = 2 * 1024 * 1024;
/** 只接受位图；SVG 可能带脚本、GIF 动画不适合静态水印。 */
export const WATERMARK_IMAGE_TYPES: ReadonlyArray<string> = ['image/png', 'image/jpeg', 'image/webp'];

export interface WatermarkFileLike {
  type: string;
  size: number;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

export function validateWatermarkFile(file: WatermarkFileLike): ValidationResult {
  if (!WATERMARK_IMAGE_TYPES.includes(file.type)) {
    return { ok: false, error: '仅支持 PNG、JPEG、WebP 图片；SVG/GIF 等格式不支持。' };
  }
  if (!(file.size > 0)) {
    return { ok: false, error: '图片为空，无法作为水印。' };
  }
  if (file.size > WATERMARK_IMAGE_MAX_BYTES) {
    return { ok: false, error: `图片大小超过 2MB 上限（当前 ${(file.size / 1024 / 1024).toFixed(1)}MB），请压缩后再导入。` };
  }
  return { ok: true };
}

export interface WatermarkInput {
  kind: 'data' | 'same-origin' | 'local-path' | 'external' | 'invalid';
  value: string;
  /** 拒绝原因（可展示给用户的诚实错误）；接受时为空。 */
  error?: string;
}

/** 路径输入分类：只认图片 data URI 与同源路径；本地绝对路径/外链给诚实提示。 */
export function parseWatermarkInput(raw: string): WatermarkInput {
  const value = raw.trim();
  if (!value) return { kind: 'invalid', value, error: '请输入图片路径或地址。' };
  if (/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value)) {
    if (value.length > 2 * 1024 * 1024) {
      return { kind: 'invalid', value, error: '图片数据超过 2MB 上限，请用「选择文件」导入并压缩。' };
    }
    return { kind: 'data', value };
  }
  if (value.startsWith('/api/files/') || /^uploads\//.test(value)) {
    // 应用内存储键归一到可直接在 CSS url() 里用的同源路径
    return { kind: 'same-origin', value: value.startsWith('/api/files/') ? value : `/api/files/${value}` };
  }
  if (/^https?:\/\//i.test(value)) {
    return { kind: 'external', value, error: '外部域名图片被应用安全策略（CSP）拦截，请先下载到本地再选择文件导入。' };
  }
  if (value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value)) {
    return { kind: 'local-path', value, error: '渲染层无法读取本地绝对路径，请点「选择文件」导入这张图片。' };
  }
  return { kind: 'invalid', value, error: '无法识别的路径：请填图片 data URI、应用内路径，或选择本地文件。' };
}

/** ImageMagick -level 8%,85% 的等价区间（作用在负片亮度上）。 */
const LEVEL_LOW = 0.08 * 255;
const LEVEL_HIGH = 0.85 * 255;

export function alphaFromLuminance(luminance: number): number {
  const negated = 255 - luminance;
  const leveled = (negated - LEVEL_LOW) / (LEVEL_HIGH - LEVEL_LOW);
  return Math.max(0, Math.min(255, Math.round(leveled * 255)));
}

/** 墨色 #1b2b40：与内置水墨素材的主色一致。 */
const INK_R = 0x1b;
const INK_G = 0x2b;
const INK_B = 0x40;

/** 逐像素把浅底转透明、墨色归一；就地修改并返回同一 buffer 供 canvas 写回。 */
export function applyWatermarkAlpha(pixels: Uint8ClampedArray): Uint8ClampedArray {
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    const luminance = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
    pixels[i] = INK_R;
    pixels[i + 1] = INK_G;
    pixels[i + 2] = INK_B;
    pixels[i + 3] = alphaFromLuminance(luminance);
  }
  return pixels;
}

/** 浏览器 File → data URI（FileReader；无新依赖）。 */
export function readFileAsDataUri(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

/** canvas 转透明：data URI → 逐像素 level → PNG data URI（不强依赖后端）。 */
export async function toTransparentWatermark(dataUri: string): Promise<string> {
  if (typeof document === 'undefined') return dataUri;
  const image = new Image();
  image.src = dataUri;
  await image.decode();
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUri;
  ctx.drawImage(image, 0, 0);
  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyWatermarkAlpha(frame.data);
  ctx.putImageData(frame, 0, 0);
  return canvas.toDataURL('image/png');
}
