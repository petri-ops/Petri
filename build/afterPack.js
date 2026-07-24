const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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

  for (const server of ['r-server', 'py-server']) {
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
