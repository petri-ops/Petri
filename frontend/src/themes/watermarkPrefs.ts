/**
 * 背景水印偏好的**启动缓存**（不是真值）。
 *
 * 真值 = 服务端 `<dataDir>/user-prefs.json` 的 watermarkMode / watermarkOpacity /
 * watermarkCustomPath（注册表 `user-prefs` 族，与主题/字号同源）；localStorage 只让
 * 先前打开就能用正确水印，随后由服务端值收敛。自定义图片本体是图片资产而非偏好标量：
 * 服务端 prefs PUT 有 4kb 上限，故 data URI 只落本模块缓存，prefs 里只存路径/来源标签。
 * 键名/枚举/钳位边界由 prefCache.drift.test.ts 与注册表双向钉住（生产代码不 import core/**）。
 */

/** 内置六图样；远山沿用原 cultural-watermark.png，其余按 id 对应同名 asset。 */
export type BuiltinWatermarkId = 'mountain' | 'bamboo' | 'plum' | 'koi' | 'pine' | 'lotus';
export const BUILTIN_WATERMARK_IDS: ReadonlyArray<BuiltinWatermarkId> = [
  'mountain', 'bamboo', 'plum', 'koi', 'pine', 'lotus',
];
const BUILTIN_MODE_PREFIX = 'builtin:';
/** 复用 mode 字段本身表达图样选择，不新增 schema 键；默认远山=现状观感。 */
export type WatermarkMode = 'none' | `builtin:${BuiltinWatermarkId}` | 'custom';
export const DEFAULT_WATERMARK_MODE: WatermarkMode = 'builtin:mountain';
export const WATERMARK_MODE_VALUES: ReadonlyArray<WatermarkMode> = [
  'none', ...BUILTIN_WATERMARK_IDS.map((id) => `builtin:${id}` as WatermarkMode), 'custom',
];

export function toBuiltinWatermarkMode(id: BuiltinWatermarkId): WatermarkMode {
  return `${BUILTIN_MODE_PREFIX}${id}`;
}

/** 只认已登记的六个 id；旧值 'builtin' 与未知 builtin:* 一律不认。 */
export function builtinWatermarkId(mode: string): BuiltinWatermarkId | null {
  if (!mode.startsWith(BUILTIN_MODE_PREFIX)) return null;
  const id = mode.slice(BUILTIN_MODE_PREFIX.length);
  return (BUILTIN_WATERMARK_IDS as ReadonlyArray<string>).includes(id) ? id as BuiltinWatermarkId : null;
}

export const WATERMARK_MODE_STORAGE_KEY = 'petri-watermark-mode';
export const WATERMARK_OPACITY_STORAGE_KEY = 'petri-watermark-opacity';
/** 自定义图片 data URI 缓存（不是服务端字段；服务端只存 watermarkCustomPath 标签）。 */
export const WATERMARK_CUSTOM_STORAGE_KEY = 'petri-watermark-custom';

/** 水印不得抢内容：0–30%，默认维持现状 0.10。 */
export const WATERMARK_OPACITY_MIN = 0;
export const WATERMARK_OPACITY_MAX = 0.3;
export const WATERMARK_OPACITY_DEFAULT = 0.1;
/** 缓存上限 2MB（base64 约 2.7M 字符）；超限不采用，避免 localStorage 被单张图撑爆。 */
export const WATERMARK_CUSTOM_MAX_CHARS = 2 * 1024 * 1024;

export function isWatermarkMode(value: unknown): value is WatermarkMode {
  return typeof value === 'string' && (WATERMARK_MODE_VALUES as ReadonlyArray<string>).includes(value);
}

export function clampWatermarkOpacity(value: number): number {
  if (!Number.isFinite(value)) return WATERMARK_OPACITY_DEFAULT;
  return Math.min(WATERMARK_OPACITY_MAX, Math.max(WATERMARK_OPACITY_MIN, value));
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 缓存写失败不影响本端内存偏好 */
  }
}

export function readCachedWatermarkMode(): WatermarkMode {
  const saved = read(WATERMARK_MODE_STORAGE_KEY);
  return isWatermarkMode(saved) ? saved : DEFAULT_WATERMARK_MODE;
}

export function readCachedWatermarkOpacity(): number {
  const raw = read(WATERMARK_OPACITY_STORAGE_KEY);
  if (raw == null || raw.trim() === '') return WATERMARK_OPACITY_DEFAULT;
  const saved = Number(raw);
  return Number.isFinite(saved) ? clampWatermarkOpacity(saved) : WATERMARK_OPACITY_DEFAULT;
}

/** 只认图片 data URI 且未超限；其它一律回落空串。 */
export function readCachedWatermarkCustom(): string {
  const saved = read(WATERMARK_CUSTOM_STORAGE_KEY) || '';
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(saved)) return '';
  if (saved.length > WATERMARK_CUSTOM_MAX_CHARS) return '';
  return saved;
}

export function writeCachedWatermarkMode(value: WatermarkMode): void {
  write(WATERMARK_MODE_STORAGE_KEY, value);
}

export function writeCachedWatermarkOpacity(value: number): void {
  write(WATERMARK_OPACITY_STORAGE_KEY, String(clampWatermarkOpacity(value)));
}

export function writeCachedWatermarkCustom(value: string): void {
  if (!value) {
    try {
      localStorage.removeItem(WATERMARK_CUSTOM_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  if (!/^data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/.test(value)) return;
  if (value.length > WATERMARK_CUSTOM_MAX_CHARS) return;
  write(WATERMARK_CUSTOM_STORAGE_KEY, value);
}
