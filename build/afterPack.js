const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

function normalizeBuilderArch(arch) {
  return ({ 0: 'x64', 1: 'ia32', 2: 'armv7l', 3: 'arm64', 4: 'universal' })[arch]
    || String(arch);
}

exports.normalizeBuilderArch = normalizeBuilderArch;
exports.probeNativeLoad = probeNativeLoad;
exports.resolveNativeSource = resolveNativeSource;
exports.listElectronProbeBins = listElectronProbeBins;

/**
 * BLOCK-353/C-48 — 原生模块 ABI 选源（fail-closed）。
 *
 * 旧实现假定 `node_modules/better-sqlite3/build/Release/better_sqlite3.node`
 * 在 install-app-deps 之后就是 Electron-ABI。实测不成立：@electron/rebuild 走
 * prebuild-install 时把 Electron-ABI 产物放到
 * `bin/<platform>-<arch>-<NODE_MODULE_VERSION>/better-sqlite3.node`，
 * build/Release 仍是开发 Node-ABI 的旧文件。后端 boot 因此 ERR_DLOPEN_FAILED，
 * supervisor 每 30s 无限重启，GUI 侧表现为「窗口在、后端一直不起」。
 * 修法：枚举候选 → 用打包 Electron 运行时实测 dlopen → 取第一个能加载的作为
 * 权威副本；一个都不行就在构建期红，不把坏包交给用户。
 */
// true=可加载；false=ABI 不匹配；null=探针运行时本身不可用（不作 ABI 结论）
function probeNativeLoad(probeBin, nativeBinary) {
  if (!probeBin) return null;
  try {
    execFileSync(probeBin, ['-e', `require(${JSON.stringify(nativeBinary)})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: PROBE_SPAWN_TIMEOUT_MS,
    });
    return true;
  } catch (e) {
    const detail = `${e.stderr || ''}${e.message || ''}`;
    if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|dlopen|different Node\.js version/i.test(detail)) return false;
    // 探针运行时自身失败（超时/被杀/无法执行）：留痕便于构建日志归因
    //（item66 x64 腿实测：Helper 构建时点不可用、构建后手测可加载——时机问题）
    console.warn(`[afterPack] 探针运行时不可用（${e.code || 'unknown'}）: ${probeBin} :: ${detail.slice(0, 200).replace(/\s+/g, ' ')}`);
    return null;
  }
}

// item 66 / HK-01 —— 探针时机修复：
// 旧实现探针一次定生死，实测在 afterPack 时点探针运行时/原生产物可能尚未就绪
//（两次 build:mac 均把可加载的 bin/darwin-arm64-149 误判，手动复测同一二进制
// exit=0：acceptance/g1-release-pipeline/UNSIGNED-BUILD-EVIDENCE.md §2）。
// 修法（fail-closed 语义不变）：
// ①产物就绪门——候选存在且 size/mtime 在 settle 间隔内稳定才探（等 build/复制完成）；
// ②幂等重试——探针运行时不可用（null）或探针窗口内产物仍在写时，有界预算内重扫重试；
// ③探针二进制多候选回退（packaged Helper → node_modules Electron → …）；
// ④预算耗尽仍无定论 → 维持 BLOCK-377 fail-closed（env 豁免口 PETRI_PACK_PROBE_FALLBACK=1
//   保留、登记制留痕）；稳定产物的确定性 ABI_MISMATCH 不重试耗预算，立即红。
const PROBE_SETTLE_MS_DEFAULT = 400;
const PROBE_READY_TIMEOUT_MS_DEFAULT = 120000;
// 单次探针超时：packaged Helper 首次执行可能触发 Rosetta 冷翻译（x64 腿实测
// 构建时点超时不可用、构建后手测可加载），放宽到 60s 只影响失败路径耗时
const PROBE_SPAWN_TIMEOUT_MS = 60000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statSignature(file) {
  try {
    const st = fs.statSync(file);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return null;
  }
}

// 单轮探测：遍历所有探针二进制，任一 true 即采用；全部可用探针均确定性 false
// 才判 mismatch；探针不可用（null）或窗口内产物被改写 = 无定论（pending）。
// false+null 混合不作 mismatch 结论：不可用探针未给出反证（item66 x64 腿实测，
// arm64 node_modules Electron 对 x64 产物的 false 是结构性假象），交由外层重试。
// 返回 { verdict, perBin } — perBin 供 fail-closed 错误逐探针留痕。
function probeOnce(probeBins, probe, file) {
  const perBin = [];
  if (!probeBins.length) return { verdict: 'pending', perBin };
  let definitiveFalse = false;
  let sawPending = false;
  for (const bin of probeBins) {
    const before = statSignature(file);
    const result = probe(bin, file);
    const after = statSignature(file);
    const label = `${path.basename(path.dirname(path.dirname(bin))) || bin}=${result === true ? 'OK' : result === false ? 'ABI_MISMATCH' : 'PROBE_UNAVAILABLE'}`;
    perBin.push(label);
    if (result === true) return { verdict: 'ok', perBin };
    // 探针窗口内产物被改写（build/复制竞态）→ 本轮结论不作数
    if (result === false && before !== null && before === after) definitiveFalse = true;
    else sawPending = true;
  }
  return { verdict: definitiveFalse && !sawPending ? 'mismatch' : 'pending', perBin };
}

// 产物就绪门：不存在=false（外层重扫等复制完成）；存在则等一个 settle 间隔
// 确认 size/mtime 未变（半成品不探）。预算耗尽=false（由外层 fail-closed 兜底）。
async function waitForArtifactStable(file, deadline, settleMs) {
  const sig = statSignature(file);
  if (sig === null) return false;
  while (Date.now() < deadline) {
    await sleep(settleMs);
    if (statSignature(file) === sig) return true;
  }
  return false;
}

// 候选枚举每轮重扫：bin/<platform>-<arch>-<modules>/ prebuild（版本降序）+
// build/Release 兜底——晚就绪的产物在下轮可见。
function enumerateNativeCandidates(projectDir) {
  const pkgRoot = path.join(projectDir, 'node_modules', 'better-sqlite3');
  const candidates = [];
  const binRoot = path.join(pkgRoot, 'bin');
  if (fs.existsSync(binRoot)) {
    for (const entry of fs.readdirSync(binRoot, { withFileTypes: true })) {
      // @electron/rebuild 的 prebuild 形态：bin/<platform>-<arch>-<modules>/
      if (!entry.isDirectory() || !/-\d+$/.test(entry.name)) continue;
      const file = path.join(binRoot, entry.name, 'better-sqlite3.node');
      if (fs.existsSync(file)) candidates.push(file);
    }
    candidates.sort((a, b) => Number(path.basename(path.dirname(b)).split('-').pop())
      - Number(path.basename(path.dirname(a)).split('-').pop()));
  }
  candidates.push(path.join(pkgRoot, 'build', 'Release', 'better_sqlite3.node'));
  return candidates;
}

// 探针二进制取全部存在候选（旧实现取首个存在者即定——Helper 恰好时机不可用
// 时 node_modules Electron 本可工作却被跳过）。
function listElectronProbeBins(context) {
  const name = context.packager.appInfo.productFilename;
  const candidates = [
    path.join(context.appOutDir, `${name}.app`, 'Contents', 'Frameworks',
      `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`),
    path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist',
      'Electron.app', 'Contents', 'MacOS', 'Electron'),
    path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(context.appOutDir, `${name}.exe`),
  ];
  return candidates.filter((p) => fs.existsSync(p));
}

async function resolveNativeSource(context, deps = {}) {
  const projectDir = context.packager.projectDir;
  const settleMs = deps.settleMs ?? PROBE_SETTLE_MS_DEFAULT;
  const readyTimeoutMs = deps.readyTimeoutMs ?? PROBE_READY_TIMEOUT_MS_DEFAULT;
  const probe = deps.probe || probeNativeLoad;
  const probeBins = deps.probeBins || listElectronProbeBins(context);
  const deadline = Date.now() + readyTimeoutMs;
  const traces = new Map();
  let adopted = null;
  let definitiveSeen = false; // 任一候选已获确定性实测结论（OK / 稳定产物 mismatch）
  let sawAnyPending = false; // 任一轮出现过无定论候选（探针不可用/产物未就绪或仍在写）

  while (Date.now() < deadline) {
    let pendingSeen = false;
    let unstableSeen = false;
    let notReadySeen = false;
    for (const file of enumerateNativeCandidates(projectDir)) {
      const rel = path.relative(projectDir, file);
      // ① 产物就绪门：等 better-sqlite3 build/复制完成再探
      if (!(await waitForArtifactStable(file, deadline, settleMs))) {
        const notReady = statSignature(file) === null;
        traces.set(file, `${rel}=${notReady ? 'NOT_READY' : 'UNSTABLE'}`);
        if (notReady) notReadySeen = true;
        else unstableSeen = true;
        sawAnyPending = true;
        continue;
      }
      const { verdict, perBin } = probeOnce(probeBins, probe, file);
      if (verdict === 'ok') {
        traces.set(file, `${rel}=OK`);
        adopted = file;
        break;
      }
      if (verdict === 'mismatch') {
        // 稳定产物的确定性 ABI 不匹配：不重试耗预算，保持红
        traces.set(file, `${rel}=ABI_MISMATCH[${perBin.join(',')}]`);
        definitiveSeen = true;
      } else {
        traces.set(file, `${rel}=PROBE_PENDING[${perBin.join(',')}]`);
        pendingSeen = true;
        sawAnyPending = true;
      }
    }
    if (adopted) return adopted;
    // 已有确定性结论时，一直未出现的候选不再拖重试（等它的理由只在没有
    // 任何实测结论时成立——与旧实现「不存在即跳过」行为对齐）。
    const sawPending = pendingSeen || unstableSeen || (notReadySeen && !definitiveSeen);
    if (!sawPending) break;
    await sleep(settleMs);
  }

  const labels = [...traces.values()].join(', ');
  if (sawAnyPending) {
    // BLOCK-377（S2 §8.8）——探针不可用=ABI 未实测，静默放行会把「没测过」伪装成
    // 「测过兼容」。显式 env 豁免口 PETRI_PACK_PROBE_FALLBACK=1（登记制留痕）保留，
    // 供探针基础设施缺失的受控场景；豁免采用首个非确定性 mismatch 的候选。
    if (process.env.PETRI_PACK_PROBE_FALLBACK === '1') {
      const fallback = enumerateNativeCandidates(projectDir)
        .find((f) => !String(traces.get(f) || '').startsWith(`${path.relative(projectDir, f)}=ABI_MISMATCH`) && fs.existsSync(f));
      if (fallback) {
        console.warn(`[afterPack] ABI 实测不可用且 PETRI_PACK_PROBE_FALLBACK=1（显式豁免）：采用候选 ${fallback}`);
        return fallback;
      }
    }
    throw new Error(
      `ABI 实测探针不可用且未设 PETRI_PACK_PROBE_FALLBACK=1（fail-closed，不静默放行；\n`
      + `已按产物就绪+幂等重试等待 ${readyTimeoutMs}ms）：${labels}\n`
      + '先修探针基础设施（probeNativeLoad），或显式设置豁免并登记原因。',
    );
  }
  throw new Error(
    '未找到匹配打包 Electron ABI 的 better-sqlite3 二进制。\n'
    + '先跑 npx electron-builder install-app-deps（构建中途不要 npm rebuild）；\n'
    + `候选实测：${labels}`,
  );
}

/**
 * electron-builder rebuilds the root native dependencies for Electron, while
 * Core is copied as an extraResource with its development-Node binary. Keep
 * both packaged backend servers on the same Electron Node ABI as the Helper
 * process used to launch them.
 */
exports.default = async function afterPack(context) {
  const resourcesDir = path.join(
    context.appOutDir,
    process.platform === 'darwin' ? `${context.packager.appInfo.productFilename}.app/Contents/Resources` : 'resources',
  );
  const source = await resolveNativeSource(context);
  if (!fs.existsSync(source)) {
    throw new Error(`rebuilt better-sqlite3 binary not found: ${source}`);
  }

  // 品牌图标全套集成（owner msg_22bba0ea1f99）：packaged 模式 resolveResource('icons',...)
  // 指向 process.resourcesPath/icons/（env-coordinator.js:47-52）；不复制则 tray 只走兜底
  // 且文件不存在。把 icons/ 全套随包复制（4.2MB，含 tray template/icns/ico/iconset）。
  const iconsSrc = path.join(__dirname, '..', 'icons');
  const iconsDst = path.join(resourcesDir, 'icons');
  if (fs.existsSync(iconsSrc)) fs.cpSync(iconsSrc, iconsDst, { recursive: true, force: true });

  // BLOCK-353（packaged 回归）— 把 asar 内生产依赖解出到 Resources/node_modules：
  // 打包后端（Resources/core/petri-server/server.js，ELECTRON_RUN_AS_NODE）的模块解析
  // 上溯链为 petri-server/node_modules → core/node_modules → Resources/node_modules → …，
  // 而 asar 内的 node_modules 对子进程不可见（ELECTRON_RUN_AS_NODE 无 asar 钩子）、
  // bundle 内上溯也不会越出 .app——不补这一层则 express 等运行时依赖不可解析，
  // 打包后端 boot 即崩（GUI 首启挂起真因，353 阻断级发现）。
  {
    const asar = require('@electron/asar');
    const asarPath = path.join(resourcesDir, 'app.asar');
    if (fs.existsSync(asarPath)) {
      const target = path.join(resourcesDir, 'node_modules');
      fs.rmSync(target, { recursive: true, force: true });
      const tmpExtract = fs.mkdtempSync(path.join(os.tmpdir(), 'afterPack-extract-'));
      try {
        asar.extractAll(asarPath, tmpExtract);
        // src/ 同步解出：打包后端 config.js 经 ../../src/main/... 相对 require——
        // Resources/core 下必须有 Resources/src（BLOCK-353 阻断级发现的另一半）。
        for (const dir of ['node_modules', 'src']) {
          if (fs.existsSync(path.join(tmpExtract, dir))) {
            fs.renameSync(path.join(tmpExtract, dir), path.join(resourcesDir, dir));
          }
        }
        // BLOCK-353 — electron 空导出 shim：打包后端 config.js →
        // ../../src/main/env-coordinator 顶层 require('electron')。ELECTRON_RUN_AS_NODE
        // 下内建 electron 模块不可用、bundle 内上溯无 npm shim → boot 崩；
        // 而 npm shim 的 index.js 会触发 install.js 下载（更不可用）。
        // 空导出（app=undefined）与 dev 后端实况完全一致（dev=require npm shim=字符串
        // → app=undefined，健康在案）；后端只用 getBackendPort（env 优先）不触 app。
        const electronShimDst = path.join(target, 'electron');
        fs.mkdirSync(electronShimDst, { recursive: true });
        fs.writeFileSync(path.join(electronShimDst, 'index.js'), 'module.exports = {};');
        fs.writeFileSync(path.join(electronShimDst, 'package.json'), JSON.stringify({ name: 'electron', version: '0.0.0-block353-shim', main: 'index.js' }));
      } finally {
        fs.rmSync(tmpExtract, { recursive: true, force: true });
      }
    }
  }
  for (const server of ['petri-server', 'py-server']) {
    const target = path.join(
      resourcesDir,
      'core',
      server,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    // BLOCK-353 — 补全 core 内 better-sqlite3 包（package.json/lib）：只拷 .node 时
    // require('better-sqlite3') 在 Resources/core 内无包入口 → 解析穿透到解出树
    //（node-ABI 副本）→ ERR_DLOPEN_FAILED。以仓库副本（纯 JS+manifest）为底、
    // .node 用 Electron-ABI 权威副本覆盖。
    const corePkgSrc = path.join(context.packager.projectDir, 'node_modules', 'better-sqlite3');
    const corePkgDst = path.join(resourcesDir, 'core', server, 'node_modules', 'better-sqlite3');
    if (fs.existsSync(corePkgSrc) && !fs.existsSync(path.join(corePkgDst, 'package.json'))) {
      fs.cpSync(corePkgSrc, corePkgDst, { recursive: true, force: true });
      fs.copyFileSync(source, path.join(corePkgDst, 'build', 'Release', 'better_sqlite3.node'));
    }
    // 顺序敏感：cpSync 可能把仓库 node-ABI .node 也带过来，再以根副本（此刻=Electron-ABI）
    // 最后覆盖一次，保证 core 内副本必为打包运行时 ABI。
    fs.copyFileSync(source, path.join(corePkgDst, 'build', 'Release', 'better_sqlite3.node'));
  }

  // BLOCK-353 — 解出的 asar node_modules 原生副本可能与打包运行时 ABI 不一致
  //（builder 原生重建存在缓存跳过），用 core 内刚复制的已知 Electron-ABI 副本覆盖
  //（解出树是后端 require 的祖先链，会遮蔽 core 副本——必须就地替换）。
  for (const server of ['petri-server', 'py-server']) {
    const knownGood = path.join(
      resourcesDir,
      'core',
      server,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    );
    const shadowing = path.join(
      resourcesDir,
      'node_modules',
      'better-sqlite3',
      'build',
      'Release',
      'better_sqlite3.node',
    );
    if (fs.existsSync(knownGood) && fs.existsSync(path.dirname(shadowing))) {
      fs.copyFileSync(knownGood, shadowing);
    }
  }

  // LF12 packaged qualification needs a deterministic way to prove that the
  // launched bundle came from the source commit and sealed baseline under
  // review. This bounded metadata contains no paths, URLs or credentials and
  // is written before signing so code-signature integrity remains valid.
  const projectDir = context.packager.projectDir;
  const g0 = require(path.join(projectDir, 'core', 'shared-backend', 'g0-baseline.js'));
  const subject = g0.getQualificationSubjectBaseline();
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectDir,
    encoding: 'utf8',
  }).trim();
  const buildSubject = {
    schemaVersion: 1,
    sourceCommit,
    baseline: {
      baselineId: subject.baselineId,
      baselineVersion: subject.baselineVersion,
      manifestDigest: subject.manifestDigest,
      bundleDigest: subject.bundleDigest,
    },
    platform: context.electronPlatformName,
    architecture: normalizeBuilderArch(context.arch),
    packageVersion: context.packager.appInfo.version,
    privacy: 'source_commit_baseline_digests_platform_architecture_and_package_version_only',
  };
  fs.writeFileSync(
    path.join(resourcesDir, 'g0-build-subject.json'),
    `${JSON.stringify(buildSubject, null, 2)}\n`,
  );

  // BLOCK-353/C-48 — core 并入 asar（系统性打包契约修复）：
  // 主进程（asar）的 src 模块图存在相对 require '../../core/...'（scheme.js/
  // env-coordinator 等），asar 内无 core/ → 加载即抛 Cannot find module → GUI
  // 首启错误框。本轮已把静态 require 全量路由 resolveCore（dev=repo/core、
  // packaged=Resources/core）+ tripwire 防复发；注入 asar 内 core/ 是第二层兜底，
  // 让残留/新增的相对路径同样可解，不必逐处打补丁。
  // 做法：extractAll → 注入 core/shared-backend + core/packages（纯 JS 2.4M）
  // → createPackageWithOptions 重写 asar（保留 *.node 的 unpack 规则）。
  // 本机无有效签名身份时 builder 会整段跳过 macOS 签名（日志 "skipped macOS
  // application code signing"），此时重打包过的 asar 会留下失效的 Electron
  // 原始封条（codesign: no resources but signature indicates they must be
  // present）→ helper spawn 被拦。收尾补一次全量 ad-hoc 重签；有证书的 CI
  // 会在后续签名阶段覆盖它，不影响正式签名链。
  const asarMod = require('@electron/asar');
  const asarPath = path.join(resourcesDir, 'app.asar');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'afterPack-asar-'));
  try {
    asarMod.extractAll(asarPath, staging);
    const srcCore = path.join(context.packager.projectDir, 'core');
    fs.cpSync(path.join(srcCore, 'shared-backend'), path.join(staging, 'core', 'shared-backend'), { recursive: true });
    fs.cpSync(path.join(srcCore, 'packages'), path.join(staging, 'core', 'packages'), { recursive: true });
    // crawlfs 对悬空/指向 staging 外的符号链接会 lstat 失败——node_modules/.bin
    // 全是这类 shim（require 不消费），整目录移除。
    fs.rmSync(path.join(staging, 'node_modules', '.bin'), { recursive: true, force: true });
    // 主进程用的原生副本同样换成通过 ABI 实测的权威副本。
    const stagingNative = path.join(staging, 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
    if (fs.existsSync(stagingNative)) fs.copyFileSync(source, stagingNative);
    // @electron/asar ≥3 的 createPackage* 是 async：不 await 会让 finally 先删
    // staging，crawlfs 随即 ENOENT（本轮多轮 build=1 的真因）。
    // unpack 规则必须保留：builder 默认把 .node 放 app.asar.unpacked，重打包若
    // 丢掉该标记，主进程 require .node 会直接对 asar 内路径 dlopen 而失败。
    await asarMod.createPackageWithOptions(staging, asarPath, { unpack: '**/*.node' });
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
  const unpackedNative = path.join(resourcesDir, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  if (fs.existsSync(unpackedNative)) fs.copyFileSync(source, unpackedNative);

  // BLOCK-353/C-48 — 打包后端 core 侧独有依赖补齐。
  // extraResources 不复制 core/petri-server/node_modules（产物内原本只有
  // afterPack 建的 better-sqlite3），而 multer/busboy/pdfjs-dist 等只在 core 侧；
  // 后端 routes 加载时 fail-open 丢掉 Files/Knowledge 路由。把 core 侧独有包
  // 合并进解出树（已存在的包不覆盖，保护上面的 Electron-ABI 权威副本）。
  const coreNodeModules = path.join(context.packager.projectDir, 'core', 'petri-server', 'node_modules');
  const extractedNodeModules = path.join(resourcesDir, 'node_modules');
  if (fs.existsSync(coreNodeModules) && fs.existsSync(extractedNodeModules)) {
    for (const entry of fs.readdirSync(coreNodeModules, { withFileTypes: true })) {
      if (entry.name === '.bin' || entry.name.startsWith('.')) continue;
      const dst = path.join(extractedNodeModules, entry.name);
      if (fs.existsSync(dst)) continue;
      fs.cpSync(path.join(coreNodeModules, entry.name), dst, {
        recursive: true,
        dereference: true,
      });
    }
  }

  if (process.platform === 'darwin') {
    const appBundle = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
    try {
      execFileSync('codesign', ['--force', '--deep', '-s', '-', appBundle], {
        stdio: 'pipe',
        timeout: 300000,
      });
    } catch (e) {
      console.warn(`[afterPack] ad-hoc 重签失败（可手补 codesign --force --deep -s - ${appBundle}）：`, e && e.message);
    }
  }
};
