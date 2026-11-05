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
  const source = path.join(
    context.packager.projectDir,
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  );
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
};
