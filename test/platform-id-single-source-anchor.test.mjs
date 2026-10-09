'use strict';

/**
 * BLOCK-149 P3（BLOCK-146 P2-3 余项）——平台映射跨副本一致性契约锚。
 * BLOCK-152 P 轨更新：三副本已收敛为单源 core/shared-backend/host-platform.js
 * （deriveHostPlatform + HOST_PLATFORM_KEYS），本锚升级为单源契约守护：
 *
 *   ① src/plugin-schema.js PLATFORM_IDS —— canonical 键集合（plugin/运行时域，
 *      core 侧因 R3 禁 core→src 不能 require，键集合一致性由本锚跨源锁定）；
 *   ② core/shared-backend/host-platform.js —— 单源（键映射 + 键集合）；
 *   ③ core/shared-backend/capability-bundles.js —— require 单源再导出
 *      deriveHostPlatform（兼容既有消费方与宿主 monkeypatch 测试面，身份同一性
 *      由本锚锁定：再导出必须是同一函数对象，不得复制实现）；
 *   ④ src/plugin/runtime.js detectPlatform / scripts/build-r-bundle.mjs ——
 *      薄委托单源；二者无法参数化调用（读活体宿主），以文本断言锁「副本不得
 *      复活」（平台键字面量 / process.arch 分支签名再现即红）。
 *
 * 契约：deriveHostPlatform 四个规范宿主组合的输出 ⊆ PLATFORM_IDS 且逐组合
 * 映射正确；非规范宿主（linux/arm64、未知平台）输出仍是 `${platform}-${arch}`
 * 键形态、不造 registry 键——宿主平台无对应描述符时 getBundleDescriptor 返回
 * null 拒绝下载（fail-closed，见 capability-bundles.js #8 注释）。
 *
 * 红绿取舍（HK-01 豁免面登记）：本锚是纯契约锁——锁的是 HEAD 已正确的行为
 * （四组合输出与 PLATFORM_IDS 逐键一致），零生产行为变更，故以绿锚直接落地；
 * 若强行先红（如断言 linux/arm64 ∈ PLATFORM_IDS）实质是要求产品裁决「新增
 * linux-arm64 发布面」，超出本批「锚定一致性」范围。BLOCK-152 新增第三组锚同
 * 取舍：锁收敛后已成立的事实（单源身份同一 / 委托面 / 副本消亡），行为基线由
 * 既有测试承索（capability-bundles 24 + block146 8 + 本锚 2 + freeze 1 改前
 * 改后同套全绿）。
 *
 * arch 红线核对：.dependency-cruiser.cjs R1-R5 的 from 面均不含 ^test（R3 只拦
 * core→src），test/ 引 src/plugin-schema.js 不触任何规则；该文件头注亦自证
 * 「Pure module: no electron / fs / child_process deps. Safe to import from tests.」
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PLATFORM_IDS } = require('../src/plugin-schema.js');
const { deriveHostPlatform } = require('../core/shared-backend/capability-bundles.js');
const hostPlatform = require('../core/shared-backend/host-platform.js');

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

// ── BLOCK-152 P 轨收敛锚（绿锚，取舍见头注）────────────────────────────────

test('BLOCK-152 单源契约：HOST_PLATFORM_KEYS ⇔ PLATFORM_IDS 逐键一致，capability-bundles 再导出为同一函数对象', () => {
  // 键集合跨源锁定：单源 HOST_PLATFORM_KEYS（由键映射函数生成）必须与
  // canonical 键集合逐键一致——任一侧改键名另一侧不动即红。
  assert.deepEqual(
    [...hostPlatform.HOST_PLATFORM_KEYS],
    [...PLATFORM_IDS],
    `host-platform.js HOST_PLATFORM_KEYS [${hostPlatform.HOST_PLATFORM_KEYS.join(', ')}] ` +
      `必须与 src/plugin-schema.js PLATFORM_IDS [${PLATFORM_IDS.join(', ')}] 逐键一致`,
  );
  // 键集合须由单源的映射函数自洽生成（单一推导路径，键与映射不内部分叉）。
  assert.deepEqual(
    hostPlatform.HOST_PLATFORM_KEYS,
    Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']),
  );
  // 身份同一：capability-bundles 必须再导出单源函数对象本身（require 单源），
  // 不得复制第二份实现——复制后参数化断言仍绿、身份断言即红。
  assert.equal(
    capabilityBundlesIdentity(),
    true,
    'capability-bundles.js deriveHostPlatform 必须与 host-platform.js 单源是同一函数对象（require 再导出，非复制）',
  );
});

test('BLOCK-152 委托契约：runtime.detectPlatform / build-r-bundle 薄委托单源，三副本平台分支不得复活', () => {
  // runtime.js 依赖链经 src/plugin/paths.js 引 electron app（纯 node 不可加载，
  // 实测 2026-10-09），故本锚对其取文本断言而非 require——与
  // platform-branch-freeze / scripts-platform-contract 的文本门禁同形态：
  const runtimeSrc = readFileSync(path.join(repoRoot, 'src', 'plugin', 'runtime.js'), 'utf8');
  assert.match(runtimeSrc, /require\('\.\.\/\.\.\/core\/shared-backend\/host-platform'\)/,
    'src/plugin/runtime.js 必须静态 require 平台键单源（委托面不得拆除）');
  assert.doesNotMatch(runtimeSrc, /'(macos-arm64|macos-x64|windows-x64|linux-x64)'/,
    'src/plugin/runtime.js 不得再出现本地平台键字面量分支（副本复活）');

  const buildSrc = readFileSync(path.join(repoRoot, 'scripts', 'build-r-bundle.mjs'), 'utf8');
  assert.match(buildSrc, /host-platform\.js/,
    'scripts/build-r-bundle.mjs 必须 require 平台键单源');
  assert.doesNotMatch(buildSrc, /process\.arch/,
    'scripts/build-r-bundle.mjs 不得再出现本地 platform/arch 分支（currentPlatform 副本复活）');
});

// 身份断言的辅助：从 capability-bundles 导出对象取函数本体做引用比较。
// 独立成函数以便错误信息里带上两侧模块路径。
function capabilityBundlesIdentity() {
  const bundles = require('../core/shared-backend/capability-bundles.js');
  return bundles.deriveHostPlatform === hostPlatform.deriveHostPlatform;
}
