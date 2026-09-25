// ============================================================
// Brand identity — renderer-side single source (BLOCK-61)
//
// 主进程侧权威在 src/main/brand.js；渲染进程不能 require 主进程
// 模块，此文件为镜像，test/brand-identity.test.mjs 契约锁两文件
// 常量逐字段一致。业务代码禁止裸写品牌字面量——一律 import 本模块。
// ============================================================

export const BRAND = Object.freeze({
  /** 用户可见英文品牌（窗口标题 / wordmark / 文案）。 */
  APP_NAME: 'Gewu',
  /** 中文名。 */
  APP_NAME_ZH: '格物',
  /** 历史名——仅用于兼容识别，不用于展示。 */
  LEGACY_APP_NAME: 'BioF3',
  /** 用户 Documents 下的工作目录名（新装环境）。 */
  LOCAL_DIR_NAME: 'Gewu-Local',
  /** 上一代 Documents 目录名（既有环境数据连续性优先）。 */
  LEGACY_LOCAL_DIR_NAME: 'BioF3-Local',
} as const);

/**
 * 品牌命名空间下的 localStorage 读写：写入一律用新前缀 `gewu-`；
 * 读取依次回退 `gewu-${key}` → 历史三种分隔形态（`biof3-${key}` /
 * `biof3.${key}` / `biof3_${key}`）——既有用户偏好零丢失，读到旧形态
 * 后顺手迁移写入新 key。
 */
export function readBrandStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const fresh = window.localStorage.getItem(`gewu-${key}`);
    if (fresh != null) return fresh;
    for (const legacyKey of [`biof3-${key}`, `biof3.${key}`, `biof3_${key}`]) {
      const legacy = window.localStorage.getItem(legacyKey);
      if (legacy != null) {
        try {
          window.localStorage.setItem(`gewu-${key}`, legacy);
          window.localStorage.removeItem(legacyKey);
        } catch {
          /* 迁移写失败不影响读取 */
        }
        return legacy;
      }
    }
    return null;
  } catch {
    return null;
  }
}


