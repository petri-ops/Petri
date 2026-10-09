'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
// BLOCK-152 P 轨收敛：宿主→平台键推导单源（deriveHostPlatform），三副本
// （本文件 / scripts/build-r-bundle.mjs / src/plugin/runtime.js）统一至此。
// 下方仍经 module.exports 再导出，既有消费方与宿主 monkeypatch 测试面不变。
const { deriveHostPlatform } = require('./host-platform');

/**
 * Capability Bundle Registry — Stage 3 B1/B2 (single source of truth).
 *
 * A "capability bundle" is a prebuilt archive of heavyweight R/Python packages
 * (e.g. clusterProfiler + org.*.eg.db for enrichment) that a built-in analysis
 * module declares it needs via `plugin.json.requiresBundle`. Module code always
 * ships read-only inside the packaged app; bundles are fetched on demand into a
 * writable user directory by `capability-provisioning.js`.
 *
 * The gap this module closes (AUDIT-LOG §5): `plugin.json` only records a
 * `bundleId` (e.g. "r-enrichment") + `requiresBundleVersion`, but *nowhere*
 * mapped that bundleId to a concrete `{ url, sha256, sizeBytes }` descriptor.
 * This file IS that mapping — the single source of truth for "what is bundle X,
 * where does it live, and how do we verify it".
 *
 * Layering:
 *   - This module is PURE DATA + THIN ORCHESTRATION. It has no `electron`
 *     dependency and can run in core/ (biof3-server, tests) and the main process.
 *   - `capability-provisioning.js` is the generic download/verify/install
 *     engine. This module supplies it descriptors and decides *whether* a
 *     bundle should be fetched.
 *   - `ensureBundlesForPlugin()` is the orchestration layer used by both real
 *     R run paths (registry.js / tools-executor.js).
 *
 * CONVENTION — `sha256 === null` means "unpublished, do not download":
 *   We never fabricate hashes. A descriptor with `sha256 === null` is treated
 *   as `status: 'unpublished'` and provisioning will NOT attempt a download for
 *   it — an unverifiable bundle must never be fetched. Published descriptors
 *   below are backfilled only from `scripts/build-r-bundle.mjs` output after
 *   their OSS objects have been uploaded and checked.
 */

const BUNDLE_HOST = 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com';
// 平台键约定单一来源：src/plugin-schema.js PLATFORM_IDS（'macos-arm64' |
// 'macos-x64' | 'windows-x64' | 'linux-x64'）。DEFAULT_PLATFORM 只描述
// 「当前已发布 archive 的构建平台」（registry 数据面，见下方描述符），不再
// 充当查找缺省值——查找缺省值由 deriveHostPlatform() 按宿主推导（BLOCK-146 #8）。
const DEFAULT_PLATFORM = 'macos-arm64';
const DEFAULT_VERSION = '1.0.0';

/**
 * BLOCK-146 #8 — 缺省平台按宿主推导（BLOCK-152 起实现单源化到
 * ./host-platform.js，此处经 require 引入并再导出）。
 *
 * 审视发现 #8：此前 getBundleDescriptor 的缺省平台硬编码 'macos-arm64'，
 * 两个生产调用点（run-plugin-script.js / tools-executor.js）不传 platform，
 * Windows 宿主会判 ready 并下载 mac 二进制（sha256 是真实发布值 → 校验必过，
 * ledger 持久化 ready 不自愈）。根修：缺省平台按宿主推导；宿主平台无对应
 * registry 键时 getBundleDescriptor 返回 null（status 'unknown'，拒绝下载），
 * fail-closed 不造键。键约定 canonical = src/plugin-schema.js PLATFORM_IDS。
 *
 * 兼容契约（勿拆）：下方调用点写 `module.exports.deriveHostPlatform()`，
 * 测试可 monkeypatch 本模块导出模拟任意宿主（capability-bundles.test.mjs #8 /
 * block146-bundle-failfast-required-input.test.mjs 依赖此面）。
 */

function bundleUrl(bundleId, version, platform) {
  return `${BUNDLE_HOST}/bundles/${bundleId}-${version}-${platform}.tar.gz`;
}

/**
 * The registry: bundleId → descriptor.
 *
 * Each descriptor:
 *   - bundleId {string}
 *   - version {string}
 *   - url {string}       download URL (host must be on provisioning allowlist)
 *   - sha256 {string|null}   null ⇒ unpublished (do not download)
 *   - sizeBytes {number|null} null ⇒ unknown (bundle not built yet)
 *   - platforms {string[]}    supported platforms for this descriptor
 *
 * sha256/sizeBytes are immutable build descriptors for the published macOS
 * arm64 archives. New platform/version builds require their own verified
 * descriptors; a requested version with no descriptor remains unpublished.
 */
const BUNDLE_REGISTRY = Object.freeze({
  'r-enrichment': Object.freeze({
    bundleId: 'r-enrichment',
    version: DEFAULT_VERSION,
    url: bundleUrl('r-enrichment', DEFAULT_VERSION, DEFAULT_PLATFORM),
    sha256: 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820',
    sizeBytes: 422094687,
    platforms: Object.freeze([DEFAULT_PLATFORM]),
  }),
  'r-wgcna': Object.freeze({
    bundleId: 'r-wgcna',
    version: DEFAULT_VERSION,
    url: bundleUrl('r-wgcna', DEFAULT_VERSION, DEFAULT_PLATFORM),
    sha256: '439273d8b9cad414d3ed32f14076ac88649ca885e6b5854e0ae91bf5e7980288',
    sizeBytes: 82367498,
    platforms: Object.freeze([DEFAULT_PLATFORM]),
  }),
});

/**
 * Classify a descriptor's publication status.
 *   - 'unknown'     — no such bundleId in the registry, OR no descriptor for the
 *                     resolved platform (host-derived/explicit; BLOCK-146 #8)
 *   - 'unpublished' — registered but sha256 is null (not built/signed yet)
 *   - 'ready'       — registered and has a sha256 (verifiable, downloadable)
 */
function bundleStatus(descriptor) {
  if (!descriptor) return 'unknown';
  return descriptor.sha256 ? 'ready' : 'unpublished';
}

/**
 * Look up a bundle descriptor by id. Returns null for an unknown bundle or when
 * the descriptor does not support the requested platform.
 *
 * Platform resolution order (BLOCK-146 #8): explicit `opts.platform` override →
 * host-derived `deriveHostPlatform()`. A host platform with no matching
 * registry key resolves to null (never fabricates a key, never downloads).
 *
 * The returned copy carries `platform` (the resolved single platform key) next
 * to `platforms` (the descriptor's full support list), so install-time
 * assertions can pin the exact platform the fetch was for.
 *
 * @param {string} bundleId
 * @param {{platform?: string, version?: string}} [opts]
 * @returns {object|null} a shallow copy of the descriptor, or null
 */
function getBundleDescriptor(bundleId, opts = {}) {
  if (!bundleId || typeof bundleId !== 'string') return null;
  const base = BUNDLE_REGISTRY[bundleId];
  if (!base) return null;

  const platform = opts.platform || module.exports.deriveHostPlatform();
  if (Array.isArray(base.platforms) && !base.platforms.includes(platform)) {
    return null;
  }

  // A requested version different from the registered one is not an error here
  // (the caller may want the descriptor to compare); we surface the registered
  // descriptor and let the readiness/provisioning layer enforce version match.
  const version = opts.version || base.version;
  const platformMismatchSafe = { ...base, platforms: [...base.platforms], platform };
  if (version !== base.version) {
    // Re-derive the URL for the requested version so callers building a
    // per-version fetch get a consistent URL; sha256 stays null (we only have a
    // verified hash for the registered/built version).
    return {
      ...platformMismatchSafe,
      version,
      url: bundleUrl(bundleId, version, platform),
      sha256: base.version === version ? base.sha256 : null,
      sizeBytes: base.version === version ? base.sizeBytes : null,
    };
  }
  return platformMismatchSafe;
}

function normalizeRequiredBundles(pluginCfg) {
  if (!pluginCfg || !pluginCfg.requiresBundle) return [];
  const raw = Array.isArray(pluginCfg.requiresBundle)
    ? pluginCfg.requiresBundle
    : [pluginCfg.requiresBundle];
  return raw.filter((b) => typeof b === 'string' && b.length > 0);
}

/**
 * 把本地路径归一化为正斜杠形式，供 tar 命令行参数使用。
 *
 * 与 `--force-local` 配套：该标志会转义参数中的反斜杠，`C:\tmp\installed` 会被
 * tar 解析成 `C:\tmp` + `\i` + `nstalled`。正斜杠形式在 Windows bsdtar 与 POSIX
 * tar 上语义一致，且不含需要转义的字符。
 */
function toPosixPath(targetPath) {
  return String(targetPath).replace(/\\/g, '/');
}

/**
 * `--force-local` 只有 Windows bsdtar 需要（盘符路径被误判为远端主机规格）。
 * GNU tar 接受它为空操作，但 macOS 自带的 bsdtar 直接拒绝
 * （`Option --force-local is not supported`，2026-09-20 Mac 首跑实测），
 * 因此必须按平台条件附加，不得无条件加。
 */
const TAR_FORCE_LOCAL = process.platform === 'win32' ? ['--force-local'] : [];

/**
 * Extract a verified .tar.gz bundle into the library directory mounted by
 * R_LIBS_USER. The archive is trusted only after capability-provisioning has
 * matched its SHA-256 against the descriptor committed in this registry.
 *
 * A bundle-manifest.json marker is mandatory so a wrong-but-valid archive
 * cannot be recorded as a ready R library.
 */
function installTarGzBundle(archivePath, installDir, expected = {}) {
  fs.mkdirSync(installDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const rejectAndClean = (failure) => {
      try { fs.rmSync(installDir, { recursive: true, force: true }); } catch {}
      reject(failure);
    };
    execFile(
      'tar',
      // Windows 下两道必需处理（详见 TAR_FORCE_LOCAL 注释）：
      // 1. `--force-local` 按平台条件附加：防盘符路径被当成远端主机规格。
      // 2. 正斜杠归一化：`--force-local` 会转义参数里的反斜杠，`...\installed` 会被
      //    解析成 `...\i` + `nstalled`，必须先把分隔符换成 `/`（跨平台无害，保留）。
      [
        ...TAR_FORCE_LOCAL,
        '-xzf', toPosixPath(archivePath), '-C', toPosixPath(installDir),
      ],
      { timeout: 300000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const failure = new Error(
            `bundle_extract_failed: ${String(stderr || error.message).trim()}`
          );
          failure.code = 'bundle_extract_failed';
          rejectAndClean(failure);
          return;
        }
        const marker = path.join(installDir, 'bundle-manifest.json');
        if (!fs.existsSync(marker)) {
          const failure = new Error('bundle_manifest_missing');
          failure.code = 'bundle_manifest_missing';
          rejectAndClean(failure);
          return;
        }
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(marker, 'utf8'));
        } catch {
          const failure = new Error('bundle_manifest_invalid');
          failure.code = 'bundle_manifest_invalid';
          rejectAndClean(failure);
          return;
        }
        if (
          (expected.bundleId && manifest.bundleId !== expected.bundleId) ||
          (expected.version && manifest.bundleVersion !== expected.version)
        ) {
          const failure = new Error('bundle_manifest_mismatch');
          failure.code = 'bundle_manifest_mismatch';
          rejectAndClean(failure);
          return;
        }
        // BLOCK-146 #8：平台三元组一致性——archive 内 bundle-manifest.json 声明的
        // platform 必须与本次解析出的期望平台（descriptor.platform，由宿主推导或
        // 显式覆盖）一致。manifest 缺 platform 字段而期望已给出时同样拒装：
        // 无法验证一致性的 archive 不落地（fail-closed）。expected.platform 缺席
        // （如测试直接调 installTarGzBundle 只传 bundleId/version）则维持既有
        // 校验面，不新增断言。
        if (
          expected.platform &&
          manifest.platform !== expected.platform
        ) {
          const failure = new Error(
            `bundle_platform_mismatch: archive manifest declares platform `
            + `'${manifest.platform}' but the fetch was resolved for '${expected.platform}'`
          );
          failure.code = 'bundle_platform_mismatch';
          failure.declaredPlatform = manifest.platform ?? null;
          failure.expectedPlatform = expected.platform;
          rejectAndClean(failure);
          return;
        }
        resolve(installDir);
      }
    );
  });
}

/**
 * Resolve the bundle descriptors a plugin requires, each annotated with a
 * `status` for a future wiring layer to make decisions on.
 *
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string}} pluginCfg
 * @param {{platform?: string}} [opts]
 * @returns {Array<{bundleId:string, status:'ready'|'unpublished'|'unknown', descriptor:object|null}>}
 */
function resolveBundlesForPlugin(pluginCfg, opts = {}) {
  const bundleIds = normalizeRequiredBundles(pluginCfg);
  const version = (pluginCfg && pluginCfg.requiresBundleVersion) || undefined;
  // Call through module.exports so a test (or a future override layer) can swap
  // getBundleDescriptor and have resolve/ensure honor it.
  const lookup = module.exports.getBundleDescriptor;
  return bundleIds.map((bundleId) => {
    const descriptor = lookup(bundleId, { platform: opts.platform, version });
    return { bundleId, status: bundleStatus(descriptor), descriptor };
  });
}

/**
 * Orchestration layer: ensure every bundle a plugin requires is provisioned.
 *
 * For each required bundle:
 *   - unknown bundle           → { ok:false, status:'unknown' }        (no fetch)
 *   - unpublished (sha256=null)→ { ok:false, status:'unpublished' }    (no fetch)
 *   - already provisioned      → { ok:true,  status:'ready', alreadyReady:true }
 *   - ready + not installed    → provisionCapability(...) result
 *
 * Never throws; returns a structured aggregate. `options` are forwarded to
 * `provisionCapability` (download/hash/install/runtimesDir/onProgress can be
 * injected, e.g. by tests or the future wiring layer).
 *
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string}} pluginCfg
 * @param {object} [options] forwarded to provisionCapability + { platform }
 * @returns {Promise<{ok:boolean, results:Array<object>}>}
 */
async function ensureBundlesForPlugin(pluginCfg, options = {}) {
  const resolved = resolveBundlesForPlugin(pluginCfg, { platform: options.platform });
  if (resolved.length === 0) {
    return { ok: true, results: [] };
  }

  let cp = null;
  try {
    cp = require('./capability-provisioning');
  } catch (e) {
    return {
      ok: false,
      results: resolved.map((r) => ({
        bundleId: r.bundleId,
        ok: false,
        status: 'provisioning_unavailable',
        message: e.message,
      })),
    };
  }

  const results = [];
  for (const { bundleId, status, descriptor } of resolved) {
    if (status === 'unknown') {
      results.push({ bundleId, ok: false, status: 'unknown' });
      continue;
    }
    if (status === 'unpublished') {
      // sha256 is null — unverifiable, must not download.
      results.push({ bundleId, ok: false, status: 'unpublished' });
      continue;
    }

    // status === 'ready': check readiness first, then provision if needed.
    const capability = {
      capabilityId: descriptor.bundleId,
      version: descriptor.version,
      url: descriptor.url,
      sha256: descriptor.sha256,
      size: descriptor.sizeBytes || undefined,
      kind: 'bundle',
    };

    let ready = { ready: false };
    try {
      ready = cp.checkCapabilityReady(capability, options);
    } catch (e) {
      results.push({ bundleId, ok: false, status: 'readiness_check_failed', message: e.message });
      continue;
    }
    if (ready.ready) {
      results.push({ bundleId, ok: true, status: 'ready', alreadyReady: true, installDir: ready.installDir });
      continue;
    }

    const provisionOptions = { ...options };
    if (
      typeof provisionOptions.install !== 'function' &&
      /\.tar\.gz(?:$|[?#])/i.test(descriptor.url)
    ) {
      provisionOptions.install = (archivePath, installDir) =>
        installTarGzBundle(archivePath, installDir, {
          bundleId: descriptor.bundleId,
          version: descriptor.version,
          // BLOCK-146 #8：把解析出的平台穿进安装期望——archive manifest 声明的
          // platform 与本次 fetch 实际面向的平台不一致时拒装（防止 sha256 碰巧
          // 校验通过的错误平台二进制被记为 ready R library）。
          platform: descriptor.platform,
        });
    }
    const prov = await cp.provisionCapability(capability, provisionOptions);
    results.push({
      bundleId,
      ok: !!prov.ok,
      status: prov.ok ? 'ready' : 'provision_failed',
      alreadyReady: !!prov.alreadyReady,
      installDir: prov.installDir,
      error: prov.error,
      message: prov.message,
    });
  }

  return { ok: results.every((r) => r.ok), results };
}

/**
 * BLOCK-146 #9 — 必需 bundle 未就绪的结构化失败文案（单源，两条执行路径共用：
 * mcp/registry/run-plugin-script.js 与 helpers/tools-executor.js）。
 *
 * 语义判据：plugin.json 的 requiresBundle 声明即「必需」——normalizeRequiredBundles
 * 把声明列表全量视作 required，当前不存在 optional bundle 形态（可选形态出现时，
 * 其合法回退语义不受本函数影响）。文案对照 helpers/tool-dependencies.js
 * missingPackagesMessage 范式：缺什么（bundleId/status/error）+ 怎么办（可行动
 * 中文指引）。
 *
 * @param {string} toolId 工具/插件 id（用于点名）
 * @param {{ok:boolean, results:Array<{bundleId:string, ok:boolean, status:string, error?:string, message?:string}>}} ensureResult
 * @returns {string} 多行中文失败文案（可直接进 tool_jobs.error / MCP content）
 */
function formatRequiredBundleFailure(toolId, ensureResult) {
  const results = ensureResult && Array.isArray(ensureResult.results) ? ensureResult.results : [];
  const lines = [];
  for (const r of results) {
    if (r && r.ok) continue;
    const bundleId = (r && r.bundleId) || '(unknown)';
    const status = (r && r.status) || 'unknown';
    let hint;
    if (status === 'unknown' && BUNDLE_REGISTRY[bundleId]) {
      const supported = ((BUNDLE_REGISTRY[bundleId] || {}).platforms || []).join(', ') || '无';
      hint = `当前系统平台（${module.exports.deriveHostPlatform()}）没有该 bundle 的已发布版本（可用平台：${supported}）`;
    } else if (status === 'unknown') {
      hint = 'bundleId 未登记在 bundle 注册表';
    } else if (status === 'unpublished') {
      hint = '该 bundle 尚未发布（无已验证 sha256 描述符，fail-closed 不下载）';
    } else if (status === 'provision_failed') {
      hint = '该 bundle 下载/校验/安装失败';
    } else {
      hint = '该 bundle 未就绪';
    }
    const detail = [`status=${status}`];
    if (r && r.error) detail.push(`error=${r.error}`);
    if (r && r.message) detail.push(`message=${r.message}`);
    lines.push(`- ${bundleId}：${hint}（${detail.join(' / ')}）`);
  }
  if (lines.length === 0) lines.push('-（ensureBundlesForPlugin 未返回明细）');
  return [
    `执行失败: 插件 ${toolId} 必需的 capability bundle 未就绪，已停止执行：`,
    ...lines,
    '指引：平台不符时请在受支持的平台（如 macOS Apple Silicon）运行该分析——本机不会下载与当前平台不符的'
      + '预编译二进制；下载/校验/安装失败请检查网络与磁盘后重试。',
  ].join('\n');
}

module.exports = {
  BUNDLE_REGISTRY,
  deriveHostPlatform,
  getBundleDescriptor,
  resolveBundlesForPlugin,
  ensureBundlesForPlugin,
  bundleStatus,
  installTarGzBundle,
  formatRequiredBundleFailure,
  TAR_FORCE_LOCAL,
};
