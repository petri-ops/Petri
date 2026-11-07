const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

function normalizeBuilderArch(arch) {
  return ({ 0: 'x64', 1: 'ia32', 2: 'armv7l', 3: 'arm64', 4: 'universal' })[arch]
    || String(arch);
}

exports.normalizeBuilderArch = normalizeBuilderArch;

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
function resolveElectronProbeBin(context) {
  const name = context.packager.appInfo.productFilename;
  const candidates = [
    path.join(context.appOutDir, `${name}.app`, 'Contents', 'Frameworks',
      `${name} Helper.app`, 'Contents', 'MacOS', `${name} Helper`),
    path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist',
      'Electron.app', 'Contents', 'MacOS', 'Electron'),
    path.join(context.packager.projectDir, 'node_modules', 'electron', 'dist', 'electron.exe'),
    path.join(context.appOutDir, `${name}.exe`),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

// true=可加载；false=ABI 不匹配；null=探针运行时本身不可用（不作 ABI 结论）
function probeNativeLoad(probeBin, nativeBinary) {
  if (!probeBin) return null;
  try {
    execFileSync(probeBin, ['-e', `require(${JSON.stringify(nativeBinary)})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000,
    });
    return true;
  } catch (e) {
    const detail = `${e.stderr || ''}${e.message || ''}`;
    if (/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|dlopen|different Node\.js version/i.test(detail)) return false;
    return null;
  }
}

function resolveNativeSource(context) {
  const projectDir = context.packager.projectDir;
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

  const probe = resolveElectronProbeBin(context);
  const traces = [];
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue;
    const ok = probeNativeLoad(probe, file);
    traces.push(`${path.relative(projectDir, file)}=${ok === true ? 'OK' : ok === false ? 'ABI_MISMATCH' : 'PROBE_UNAVAILABLE'}`);
    if (ok === true) return file;
    if (ok === null) {
      // BLOCK-377（S2 §8.8）——PROBE_UNAVAILABLE 不再静默采用首候选：探针不可用=
      // ABI 未实测，静默放行会把「没测过」伪装成「测过兼容」。显式 env 豁免口
      // PETRI_PACK_PROBE_FALLBACK=1（登记制留痕）供探针基础设施缺失的受控场景。
      if (process.env.PETRI_PACK_PROBE_FALLBACK === '1') {
        console.warn(`[afterPack] ABI 实测不可用且 PETRI_PACK_PROBE_FALLBACK=1（显式豁免）：采用首候选 ${file}`);
        return file;
      }
      throw new Error(
        `ABI 实测探针不可用且未设 PETRI_PACK_PROBE_FALLBACK=1（fail-closed，不静默放行）：${file}\n`
        + '先修探针基础设施（probeNativeLoad），或显式设置豁免并登记原因。',
      );
    }
  }
  throw new Error(
    '未找到匹配打包 Electron ABI 的 better-sqlite3 二进制。\n'
    + '先跑 npx electron-builder install-app-deps（构建中途不要 npm rebuild）；\n'
    + `候选实测：${traces.join(', ')}`,
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
  const source = resolveNativeSource(context);
  if (!fs.existsSync(source)) {
    throw new Error(`rebuilt better-sqlite3 binary not found: ${source}`);
  }

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
