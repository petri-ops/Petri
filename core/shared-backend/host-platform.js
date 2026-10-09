'use strict';

/**
 * core/shared-backend/host-platform.js — 宿主 → 平台键推导单源（BLOCK-152 P 轨收敛）。
 *
 * 平台键约定 canonical = src/plugin-schema.js PLATFORM_IDS
 * （'macos-arm64' | 'macos-x64' | 'windows-x64' | 'linux-x64'）。core 侧不 require
 * src（dependency-cruiser R3 禁 core→src），键集合一致性由跨源锚测试守护：
 * test/platform-id-single-source-anchor.test.mjs（HOST_PLATFORM_KEYS ⇔ PLATFORM_IDS
 * 逐键对照，任一侧改键名另一侧不动即红）。
 *
 * 本模块收敛三处历史副本（同一约定曾各写一份，win32+arm64 边缘宿主已漂移出
 * 两种语义——本单源取 canonical 语义：win32 任何 arch → 'windows-x64'）：
 *   ① core/shared-backend/capability-bundles.js deriveHostPlatform（BLOCK-146 #8）
 *      —— require 本模块后再导出，内部调用继续走 module.exports.deriveHostPlatform()
 *      （宿主 monkeypatch 测试面不变，见 capability-bundles.test.mjs #8）；
 *   ② scripts/build-r-bundle.mjs currentPlatform —— createRequire 引本模块；
 *   ③ src/plugin/runtime.js detectPlatform —— 薄委托（dependency-cruiser R5 只拦
 *      core/biof3-server，src→core/shared-backend 合法，quality:arch 实测留痕）。
 *
 * fail-closed 语义（BLOCK-146 #8 沿用）：宿主平台无对应 canonical 键时输出
 * `${platform}-${arch}` 兜底形态（不造键）——调用方按 unknown/null 拒绝下载/安装。
 */

/**
 * 按宿主 platform/arch 推导平台键。
 * @param {string} [platform=process.platform]
 * @param {string} [arch=process.arch]
 * @returns {string} canonical 平台键，或非规范宿主的 `${platform}-${arch}` 形态
 */
function deriveHostPlatform(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return arch === 'arm64' ? 'macos-arm64' : 'macos-x64';
  if (platform === 'win32') return 'windows-x64';
  if (platform === 'linux') return arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  return `${platform}-${arch}`;
}

// 四个规范宿主组合 → canonical 平台键。键集合由上方同一映射函数生成（单一推导
// 路径，键与映射永不内部分叉），与 src/plugin-schema.js PLATFORM_IDS 逐键一致。
const CANONICAL_HOST_COMBOS = Object.freeze([
  { platform: 'darwin', arch: 'arm64' },
  { platform: 'darwin', arch: 'x64' },
  { platform: 'win32', arch: 'x64' },
  { platform: 'linux', arch: 'x64' },
]);

/** canonical 平台键集合（冻结；锚测试锁定 ⇔ src/plugin-schema.js PLATFORM_IDS）。 */
const HOST_PLATFORM_KEYS = Object.freeze(
  CANONICAL_HOST_COMBOS.map(({ platform, arch }) => deriveHostPlatform(platform, arch))
);

module.exports = { deriveHostPlatform, HOST_PLATFORM_KEYS };
