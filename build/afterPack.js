const fs = require('fs');
const path = require('path');

/**
 * electron-builder rebuilds the root native dependencies for Electron, while
 * Core is copied as an extraResource with its development-Node binary. Keep
 * both packaged backend servers on the same Electron Node ABI as the Helper
 * process used to launch them.
 */
exports.default = async function afterPack(context) {
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
      context.appOutDir,
      process.platform === 'darwin' ? `${context.packager.appInfo.productFilename}.app/Contents/Resources` : 'resources',
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
};
