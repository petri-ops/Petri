'use strict';

/**
 * BLOCK-149 P3（BLOCK-146 P2-3 余项）——平台映射跨副本一致性契约锚。
 *
 * 平台键约定现有两处生产副本 + 一处构建侧副本（收敛为单源属重构候选，本批
 * 先钉一致性）：
 *   ① src/plugin-schema.js PLATFORM_IDS —— canonical 键集合（plugin/运行时域）；
 *   ② core/shared-backend/capability-bundles.js deriveHostPlatform —— bundle 域
 *      按宿主 platform/arch 推导键（BLOCK-146 #8 缺省平台根修的落点）；
 *   ③ scripts/build-r-bundle.mjs currentPlatform —— 构建侧同约定（脚本无
 *      require 面，不入本锚，注释指向）。
 *
 * 契约：deriveHostPlatform 四个规范宿主组合的输出 ⊆ PLATFORM_IDS 且逐组合
 * 映射正确；非规范宿主（linux/arm64、未知平台）输出仍是 `${platform}-${arch}`
 * 键形态、不造 registry 键——宿主平台无对应描述符时 getBundleDescriptor 返回
 * null 拒绝下载（fail-closed，见 capability-bundles.js #8 注释）。
 *
 * 红绿取舍（HK-01 豁免面登记）：本锚是纯契约锁——锁的是 HEAD 已正确的行为
 * （四组合输出与 PLATFORM_IDS 逐键一致），零生产行为变更，故以绿锚直接落地；
 * 若强行先红（如断言 linux/arm64 ∈ PLATFORM_IDS）实质是要求产品裁决「新增
 * linux-arm64 发布面」，超出本批「锚定一致性」范围。既有近邻
 * capability-bundles.test.mjs #8 只锚字面值，抓不住 ①② 漂移——本锚补的正是
 * 跨源 require 面：任一侧改键名，另一侧不动，此测试即红。
 *
 * arch 红线核对：.dependency-cruiser.cjs R1-R5 的 from 面均不含 ^test（R3 只拦
 * core→src），test/ 引 src/plugin-schema.js 不触任何规则；该文件头注亦自证
 * 「Pure module: no electron / fs / child_process deps. Safe to import from tests.」
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { PLATFORM_IDS } = require('../src/plugin-schema.js');
const { deriveHostPlatform } = require('../core/shared-backend/capability-bundles.js');

// 四个规范宿主组合 → 期望平台键（与 PLATFORM_IDS 逐键对照）
const CANONICAL_HOST_COMBOS = [
  { platform: 'darwin', arch: 'arm64', expected: 'macos-arm64' },
  { platform: 'darwin', arch: 'x64', expected: 'macos-x64' },
  { platform: 'win32', arch: 'x64', expected: 'windows-x64' },
  { platform: 'linux', arch: 'x64', expected: 'linux-x64' },
];

test('①② 一致性：deriveHostPlatform 四组合输出 ⊆ src/plugin-schema.js PLATFORM_IDS 且映射正确', () => {
  assert.ok(Array.isArray(PLATFORM_IDS) && PLATFORM_IDS.length > 0, 'PLATFORM_IDS 必须是非空数组');
  for (const { platform, arch, expected } of CANONICAL_HOST_COMBOS) {
    const actual = deriveHostPlatform(platform, arch);
    assert.equal(actual, expected, `${platform}/${arch} → ${expected}（映射漂移）`);
    assert.ok(
      PLATFORM_IDS.includes(actual),
      `输出键 ${actual} 必须 ∈ PLATFORM_IDS [${PLATFORM_IDS.join(', ')}]（副本 ①② 漂移）`,
    );
  }
});

test('fail-closed 键形态：非规范宿主输出 `${platform}-${arch}` 形态、不与 canonical 键混淆', () => {
  // linux/arm64 是合法宿主但无发布面：输出键形态正确，是否入 PLATFORM_IDS
  // 属未来 linux-arm64 发布裁决——本锚只钉形态，不钉集合归属（避免把「将来
  // 增键」误判为漂移）。
  assert.equal(deriveHostPlatform('linux', 'arm64'), 'linux-arm64');
  // 未知平台兜底分支：仍输出 `${platform}-${arch}` 键形态（永不命中 registry
  // 描述符 → unknown → 拒绝下载）。
  assert.equal(deriveHostPlatform('freebsd', 'x64'), 'freebsd-x64');
  // 缺省参数读真实宿主，任何宿主上都返回字符串键（不抛错、不返回 null）。
  assert.equal(typeof deriveHostPlatform(), 'string');
});
