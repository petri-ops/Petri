/**
 * Plugin Manager — 桌面版插件下载/安装/卸载/更新
 *
 * 每个插件是一个 zip，包含：
 *   plugin.json          — 插件清单（language/packages/platform/...）
 *   tool-definition.json — 工具定义（_data.ts 里的对象）
 *   scripts/             — R/Python 脚本
 *   packages/            — 预编译语言包
 *   demo-data/           — Demo 数据（可选）
 *
 * 安装流程：下载 → SHA256 校验 → 解压 → 版本校验 → 安装包 → 注册 → 记录
 * 卸载流程：删除专属包 → 删除脚本/数据 → 注销 → 记录
 *
 * BLOCK-9.2 PHASE 3: 1457 → ~360 lines. The 4 install* orchestrators
 * + checkUpdates / loadAllPlugins / uninstallPlugin stay in this file
 * (they cross-reference each other + onProgress callbacks + multiple
 * SHARED_BACKEND_DIR requires that would create a fragile dependency
 * graph if every helper were its own module). The plumbing helpers
 * (paths / installed / io / zip / manifest-source / content-plugin /
 * registry / runtime / uninstall) move to ./plugin/. The 21 public
 * exports below are preserved verbatim so callers (`require('./plugin-
 * manager')`) see no behavior change.
 */

const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');

const {
  PLUGINS_DIR,
  RUNTIMES_DIR,
  INSTALLED_FILE,
  BUILT_IN_PLUGINS_DIR,
  MANIFEST_URL,
  SHARED_BACKEND_DIR,
  PROJECT_ROOT,
  getFixRPathsScript,
} = require('./plugin/paths');

const { getPythonSitePackagesDir } = require(path.join(SHARED_BACKEND_DIR, 'runtime-paths'));

const {
  PLATFORM_IDS,
  ALLOWED_RUNTIME_HOSTS,
  normalizeRemotePluginEntry,
  selectArtifact,
  assertAllowedUrl,
  validateManifest,
} = require('./plugin-schema');

// Helper delegations: re-export everything ./plugin/{runtime,io,installed,manifest-source,content-plugin,registry,zip,uninstall}
// exposes so callers can keep doing `require('./plugin-manager').getInstalledPlugins()`.
const { detectPlatform } = require('./plugin/runtime');
const { getRuntimeStatus } = require('./plugin/runtime');
void PLATFORM_IDS; void ALLOWED_RUNTIME_HOSTS; void normalizeRemotePluginEntry;

const {
  streamingSha256,
  assertArtifactChecksumDeclared,
  dirSize,
  copyDirSync,
  downloadFile,
  verifyChecksum,
} = require('./plugin/io');

const { extractZipFile } = require('./plugin/zip');
void verifyChecksum;

const {
  getInstalledPlugins,
  saveInstalledPlugins,
  addInstalledPlugin,
  removeInstalledPlugin,
} = require('./plugin/installed');
const { getBuiltInManifest, getRemoteManifest } = require('./plugin/manifest-source');
const {
  registerContentPlugin,
  unregisterContentPlugin,
  listContentPluginDocs,
  readContentPluginDoc,
  listAllContentPlugins,
  extractMdTitle,
  extractSidebarPos,
} = require('./plugin/content-plugin');
const { registerPluginInServer } = require('./plugin/registry');
const {
  uninstallPlugin,
  uninstallRuntime,
  removePackage,
  checkUpdates,
  loadAllPlugins,
} = require('./plugin/uninstall');

const pluginLoader = require(path.join(PROJECT_ROOT, 'r-server', 'plugin-loader.js'));

// ════════════════════════════════════════════════════════════════
// Install orchestrators — kept in this module because each cross-
// calls the others and they all need onProgress + the SHARED_BACKEND
// executor at the same call sites.
// ════════════════════════════════════════════════════════════════

// ── 安装 Content 插件（教程/文档）──────────────────────────────
// Content 插件安装路径：
//   1. 内置则从 resources/built-in-plugins/{id} 复制；远程则下载 zip 校验解压
//   2. 读取 plugin.json 校验 type === 'content-plugin' + contentType + omics
//   3. 注册 docsDir 到 globalThis._biof3ContentPlugins
//   4. 不装语言包、不走工具注册、不需要重启
async function installContentPlugin(pluginId, plugin, platform, onProgress) {
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  const isBuiltIn = !!plugin._builtIn;

  if (isBuiltIn) {
    const srcDir = path.join(BUILT_IN_PLUGINS_DIR, pluginId);
    if (!fs.existsSync(srcDir)) throw new Error(`内置插件源目录不存在: ${srcDir}`);
    console.log(`[plugin] copying built-in ${pluginId} from ${srcDir}`);
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    copyDirSync(srcDir, pluginDir);
  } else {
    const { artifact } = selectArtifact(plugin, platform);
    assertAllowedUrl(artifact.url);
    assertArtifactChecksumDeclared('content-plugin', pluginId, platform, artifact);
    const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
    console.log(`[plugin] downloading content-plugin ${pluginId}`);
    await downloadFile(artifact.url, zipPath, onProgress);
    if (artifact.sha256) {
      const actualHash = await streamingSha256(zipPath);
      const expected = String(artifact.sha256).replace(/^sha256:/i, '').trim().toLowerCase();
      if (actualHash !== expected) {
        try { fs.unlinkSync(zipPath); } catch {}
        throw new Error(`SHA-256 mismatch for content-plugin ${pluginId}`);
      }
    }
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    await extractZipFile(zipPath, pluginDir);
    try { fs.unlinkSync(zipPath); } catch {}
    const entries = fs.readdirSync(pluginDir);
    if (entries.length === 1 && fs.statSync(path.join(pluginDir, entries[0])).isDirectory() && !fs.existsSync(path.join(pluginDir, 'plugin.json'))) {
      const nested = path.join(pluginDir, entries[0]);
      for (const e of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
      }
      fs.rmdirSync(nested);
    }
  }

  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) throw new Error('plugin.json 不存在: ' + metaPath);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  if (meta.type !== 'content-plugin') {
    throw new Error(`插件 ${pluginId} type 应为 content-plugin，实际为 ${meta.type}`);
  }

  registerContentPlugin(pluginDir, meta);

  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform: platform || detectPlatform(),
    language: meta.language || 'content',
    type: 'content-plugin',
  });

  console.log(`[plugin] content-plugin installed: ${pluginId} v${plugin.version}`);
}

// ── 安装 Runtime ───────────────────────────────────────────────
async function installRuntime(pluginId, plugin, platform, onProgress) {
  const lang = plugin.language;
  if (!lang) throw new Error('Runtime 插件缺少 language 字段');

  const runtimeName = lang === 'r' ? 'R' : 'Python';
  const runtimeDir = path.join(RUNTIMES_DIR, runtimeName);
  fs.mkdirSync(RUNTIMES_DIR, { recursive: true });

  const { artifact } = selectArtifact(plugin, platform);
  assertAllowedUrl(artifact.url);
  assertArtifactChecksumDeclared('runtime', pluginId, platform, artifact);

  const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });
  console.log(`[plugin] downloading runtime ${pluginId} from ${artifact.url} (platform=${platform})`);
  await downloadFile(artifact.url, zipPath, onProgress);

  if (typeof artifact.sizeBytes === 'number' && artifact.sizeBytes > 0) {
    const actualSize = fs.statSync(zipPath).size;
    if (actualSize !== artifact.sizeBytes) {
      try { fs.unlinkSync(zipPath); } catch {}
      throw new Error(`Size mismatch for runtime ${pluginId}: expected ${artifact.sizeBytes}, actual ${actualSize}`);
    }
  }

  if (artifact.sha256) {
    const actualHash = await streamingSha256(zipPath);
    const expected = String(artifact.sha256).replace(/^sha256:/i, '').trim().toLowerCase();
    if (actualHash !== expected) {
      try { fs.unlinkSync(zipPath); } catch {}
      throw new Error(`SHA-256 mismatch for runtime ${pluginId} on ${platform}`);
    }
  }

  if (fs.existsSync(runtimeDir)) fs.rmSync(runtimeDir, { recursive: true, force: true });
  await extractZipFile(zipPath, runtimeDir);
  try { fs.unlinkSync(zipPath); } catch {}

  const entries = fs.readdirSync(runtimeDir);
  if (entries.length === 1 && fs.statSync(path.join(runtimeDir, entries[0])).isDirectory() && !fs.existsSync(path.join(runtimeDir, 'bin'))) {
    const nested = path.join(runtimeDir, entries[0]);
    for (const e of fs.readdirSync(nested)) {
      fs.renameSync(path.join(nested, e), path.join(runtimeDir, e));
    }
    fs.rmdirSync(nested);
  }

  if (lang === 'r') {
    const fixScript = getFixRPathsScript();
    if (!fs.existsSync(fixScript)) {
      console.warn('[plugin] fix-r-paths.mjs not found, R may not start:', fixScript);
    } else {
      console.log('[plugin] running fix-r-paths.mjs for R runtime...');
      await new Promise((resolve, reject) => {
        execFile(
          process.execPath,
          [fixScript, runtimeDir],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            timeout: 120000,
            maxBuffer: 8 * 1024 * 1024,
          },
          (err, stdout, stderr) => {
            if (stdout) console.log(stdout.trim());
            if (stderr) console.error(stderr.trim());
            if (err) reject(new Error('R 路径修正失败: ' + err.message));
            else resolve();
          },
        );
      });
    }
  }

  if (lang === 'r') process.env.BIOF3_R_HOME = runtimeDir;
  else process.env.BIOF3_PY_HOME = runtimeDir;

  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform: detectPlatform(),
    language: lang,
    type: 'runtime',
  });

  console.log(`[plugin] runtime installed: ${pluginId} v${plugin.version} → ${runtimeDir}`);
  console.log('[plugin] ⚠️  restart app to activate new runtime');
}

// ── 安装 FigCode 卡片/数据包插件 ──────────────────────────────
async function installFigcodePack(pluginId, plugin, platform, onProgress) {
  const lang = plugin.language;
  if (!lang) throw new Error('FigCode 插件缺少 language 字段');

  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  const { artifact } = selectArtifact(plugin, platform);
  assertAllowedUrl(artifact.url);
  assertArtifactChecksumDeclared('figcode-pack', pluginId, platform, artifact);
  const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
  console.log(`[plugin] downloading figcode-pack ${pluginId}`);
  await downloadFile(artifact.url, zipPath, onProgress);

  if (artifact.sha256) {
    const actualHash = await streamingSha256(zipPath);
    const expected = String(artifact.sha256).replace(/^sha256:/i, '').trim().toLowerCase();
    if (actualHash !== expected) {
      try { fs.unlinkSync(zipPath); } catch {}
      throw new Error(`SHA-256 mismatch for figcode-pack ${pluginId}`);
    }
  }

  if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
  await extractZipFile(zipPath, pluginDir);
  try { fs.unlinkSync(zipPath); } catch {}

  const entries = fs.readdirSync(pluginDir);
  if (entries.length === 1 && fs.statSync(path.join(pluginDir, entries[0])).isDirectory() && !fs.existsSync(path.join(pluginDir, 'plugin.json'))) {
    const nested = path.join(pluginDir, entries[0]);
    for (const e of fs.readdirSync(nested)) {
      fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
    }
    fs.rmdirSync(nested);
  }

  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) throw new Error('plugin.json 不存在: ' + metaPath);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

  const pkgDir = path.join(pluginDir, 'packages', lang);
  if (fs.existsSync(pkgDir)) {
    console.log(`[plugin] installing figcode packages from ${pkgDir}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(lang);
    let targetDir;
    if (lang === 'r') targetDir = path.join(RUNTIMES_DIR, 'R', 'library');
    else targetDir = getPythonSitePackagesDir(path.join(RUNTIMES_DIR, 'Python'));
    executor.installPackages(pkgDir, targetDir);
    console.log(`[plugin] figcode packages installed → ${targetDir}`);
  } else {
    console.log(`[plugin] no packages dir at ${pkgDir}, skipping`);
  }

  if (meta.packages && meta.packages[lang]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(lang);
    const pkgList = Array.isArray(meta.packages[lang])
      ? meta.packages[lang]
      : Object.keys(meta.packages[lang]);
    for (const pkgName of pkgList) {
      if (!executor.checkPackageInstalled(pkgName)) {
        console.warn(`[plugin] 包 ${pkgName} 安装后检查失败（可能需要重启）`);
      }
    }
  }

  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    language: lang,
    type: 'figcode-pack',
  });

  console.log(`[plugin] figcode-pack installed: ${pluginId} v${plugin.version}`);
}

// ── 安装普通工具插件 ────────────────────────────────────────────
async function installPlugin(pluginIdOrSpec, onProgress) {
  const platform = detectPlatform();
  let pluginSpec;
  if (typeof pluginIdOrSpec === 'string') {
    const manifest = await getRemoteManifest();
    const plugin = manifest.plugins && manifest.plugins[pluginIdOrSpec];
    if (!plugin) throw new Error(`插件 ${pluginIdOrSpec} 不存在`);
    pluginSpec = { id: pluginIdOrSpec, manifest: plugin, platform };
  } else if (pluginIdOrSpec && typeof pluginIdOrSpec === 'object') {
    pluginSpec = {
      id: pluginIdOrSpec.id,
      manifest: pluginIdOrSpec.manifest,
      platform: pluginIdOrSpec.platform || platform,
    };
    if (!pluginSpec.id) throw new Error('installPlugin({ id }) missing id');
    if (!pluginSpec.manifest) throw new Error(`installPlugin(${pluginSpec.id}) missing manifest`);
  } else {
    throw new Error('installPlugin expects a pluginId string or { id, manifest } spec');
  }

  const { id: pluginId, manifest: plugin } = pluginSpec;

  if (Array.isArray(plugin.platform) && plugin.platform.length > 0 && !plugin.platform.includes(platform)) {
    throw new Error(`插件不支持当前平台 ${platform}（声明 ${plugin.platform.join(', ')}）`);
  }

  if (plugin.kind === 'runtime' || plugin.type === 'runtime') {
    return installRuntime(pluginId, plugin, pluginSpec.platform, onProgress);
  }
  if (plugin.type === 'figcode-card' || plugin.type === 'figcode-data') {
    return installFigcodePack(pluginId, plugin, pluginSpec.platform, onProgress);
  }
  if (plugin.type === 'content-plugin') {
    return installContentPlugin(pluginId, plugin, pluginSpec.platform, onProgress);
  }

  const isBuiltIn = !!plugin._builtIn;
  const pluginDir = path.join(PLUGINS_DIR, pluginId);
  fs.mkdirSync(PLUGINS_DIR, { recursive: true });

  if (isBuiltIn) {
    const srcDir = path.join(BUILT_IN_PLUGINS_DIR, pluginId);
    if (!fs.existsSync(srcDir)) throw new Error(`内置插件源目录不存在: ${srcDir}`);
    console.log(`[plugin] copying built-in ${pluginId} from ${srcDir}`);
    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    copyDirSync(srcDir, pluginDir);
  } else {
    const { artifact } = selectArtifact(plugin, pluginSpec.platform);
    assertAllowedUrl(artifact.url);
    assertArtifactChecksumDeclared('plugin', pluginId, pluginSpec.platform, artifact);

    const zipPath = path.join(PLUGINS_DIR, `${pluginId}-${plugin.version}.zip`);
    console.log(`[plugin] downloading ${pluginId} from ${artifact.url}`);
    await downloadFile(artifact.url, zipPath, onProgress);

    if (artifact.sha256) {
      const actualHash = await streamingSha256(zipPath);
      const expected = String(artifact.sha256).replace(/^sha256:/i, '').trim().toLowerCase();
      if (actualHash !== expected) {
        try { fs.unlinkSync(zipPath); } catch {}
        const e = new Error(`SHA-256 mismatch for ${pluginId}`);
        e.code = 'CHECKSUM_MISMATCH';
        e.expected = expected;
        e.actual = actualHash;
        throw e;
      }
    }

    if (fs.existsSync(pluginDir)) fs.rmSync(pluginDir, { recursive: true, force: true });
    await extractZipFile(zipPath, pluginDir);
    try { fs.unlinkSync(zipPath); } catch {}

    const entries = fs.readdirSync(pluginDir);
    if (entries.length === 1 && fs.statSync(path.join(pluginDir, entries[0])).isDirectory() && !fs.existsSync(path.join(pluginDir, 'plugin.json'))) {
      const nested = path.join(pluginDir, entries[0]);
      for (const e of fs.readdirSync(nested)) {
        fs.renameSync(path.join(nested, e), path.join(pluginDir, e));
      }
      fs.rmdirSync(nested);
    }

    if (typeof artifact.sizeBytes === 'number' && artifact.sizeBytes > 0) {
      const actualSize = dirSize(pluginDir);
      if (actualSize > 0 && Math.abs(actualSize - artifact.sizeBytes) > artifact.sizeBytes * 0.1) {
        console.warn(`[plugin] ${pluginId} unpacked size ${actualSize} differs from artifact.sizeBytes ${artifact.sizeBytes}`);
      }
    }
  }

  const metaPath = path.join(pluginDir, 'plugin.json');
  if (!fs.existsSync(metaPath)) throw new Error('plugin.json 不存在: ' + metaPath);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  console.log(`[plugin] read plugin.json: id=${meta.id} lang=${meta.language}`);

  const toolDefinitionPath = path.join(pluginDir, 'tool-definition.json');
  const { inspectPluginSources } = require(path.join(SHARED_BACKEND_DIR, 'plugin-sdk'));
  const sdkReport = inspectPluginSources({
    sources: [{ type: 'development', root: PLUGINS_DIR }],
    normalizeManifest: pluginLoader.normalizePluginManifest,
  });
  const pluginIssues = sdkReport.diagnostics.filter(
    (issue) => issue.pluginId === pluginId && issue.severity === 'error',
  );
  if (!fs.existsSync(toolDefinitionPath) || pluginIssues.length > 0) {
    throw new Error(`插件契约校验失败: ${pluginIssues.map((issue) => issue.code).join(', ') || 'tool_definition_missing'}`);
  }

  const language = meta.language;
  if (meta.runtime && meta.runtime[language]) {
    console.log(`[plugin] checking runtime ${language} >= ${meta.runtime[language]}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    if (!executor.checkRuntimeVersion(meta.runtime[language])) {
      throw new Error(`需要 ${language} >= ${meta.runtime[language]}，当前版本不满足`);
    }
  }

  if (meta.builtAgainst && meta.builtAgainst[language]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    if (typeof executor.checkBuiltAgainst === 'function') {
      const req = meta.builtAgainst[language];
      const result = executor.checkBuiltAgainst(req);
      if (!result.ok) {
        throw new Error(`插件需要 ${language} ${req} 编译的包，当前是 ${result.current}`);
      }
    }
  }

  const pkgDir = path.join(pluginDir, 'packages', language);
  if (fs.existsSync(pkgDir)) {
    console.log(`[plugin] installing packages from ${pkgDir}`);
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    executor.installPackages(pkgDir);
  }

  if (meta.packages && meta.packages[language]) {
    const { getExecutor } = require(path.join(SHARED_BACKEND_DIR, 'executors'));
    const executor = getExecutor(language);
    for (const pkgName of Object.keys(meta.packages[language])) {
      if (!executor.checkPackageInstalled(pkgName)) {
        console.warn(`[plugin] 包 ${pkgName} 安装后检查失败（可能需要重启）`);
      }
    }
  }

  registerPluginInServer(pluginDir, meta);

  const scriptFingerprint = pluginLoader.computePluginFingerprint(
    { ...meta, pluginDir, scriptPath: path.join(pluginDir, 'scripts') },
    fs.existsSync(path.join(pluginDir, 'tool-definition.json'))
      ? JSON.parse(fs.readFileSync(path.join(pluginDir, 'tool-definition.json'), 'utf8'))
      : null,
  );
  addInstalledPlugin({
    id: pluginId,
    version: plugin.version,
    installedAt: new Date().toISOString(),
    platform,
    language,
    builtIn: isBuiltIn,
    scriptFingerprint,
  });

  console.log(`[plugin] installed: ${pluginId} v${plugin.version}${isBuiltIn ? ' (built-in)' : ''}`);
}

// ════════════════════════════════════════════════════════════════
// Public API — 21 exports preserved verbatim
// ════════════════════════════════════════════════════════════════

module.exports = {
  getInstalledPlugins,
  getRemoteManifest,
  installPlugin,
  uninstallPlugin,
  checkUpdates,
  loadAllPlugins,
  detectPlatform,
  getRuntimeStatus,
  PLUGINS_DIR,
  RUNTIMES_DIR,
  listAllContentPlugins,
  listContentPluginDocs,
  readContentPluginDoc,
  // Week 2 per-platform schema helpers
  PLATFORM_IDS,
  ALLOWED_RUNTIME_HOSTS,
  normalizeRemotePluginEntry,
  selectArtifact,
  assertAllowedUrl,
  validateManifest,
  streamingSha256,
  assertArtifactChecksumDeclared,
  dirSize,
  // Re-exported internals for orchestration / test-hooks
  saveInstalledPlugins,
  addInstalledPlugin,
  removeInstalledPlugin,
  installRuntime,
  installContentPlugin,
  installFigcodePack,
  uninstallRuntime,
  removePackage,
  getBuiltInManifest,
  registerContentPlugin,
  unregisterContentPlugin,
  registerPluginInServer,
  extractZipFile,
  downloadFile,
  copyDirSync,
  getFixRPathsScript,
  SHARED_BACKEND_DIR,
  PROJECT_ROOT,
  INSTALLED_FILE,
  BUILT_IN_PLUGINS_DIR,
  MANIFEST_URL,
};

// (No unused imports to suppress — re-exports above reach the public API
//  surface for callers via require('./plugin-manager').)
