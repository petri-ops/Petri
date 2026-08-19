// Generate ipc-catalog.md from the JSON output of validate-ipc-catalog.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";

const ROOT = process.cwd();

// ── Inline plugin manifest schema validator (same logic as validate-ipc-catalog.mjs) ──

const PLUGIN_REQUIRED_FIELDS = Object.freeze([
  'id', 'title', 'version', 'language', 'pluginManifestVersion',
]);
const VALID_LANGUAGES = Object.freeze(['r', 'python', 'javascript', 'julia', 'bash']);
const VALID_STATUSES = Object.freeze(['canonical', 'experimental', 'deprecated', 'archived']);
const VALID_SOURCE_POLICIES = Object.freeze([
  'builtin-canonical', 'builtin-experimental', 'user-installed', 'remote',
]);
const VALID_PLATFORM_IDS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+/;
const ID_RE = /^[a-z][a-z0-9_-]*$/;

function validatePluginManifest(manifest) {
  const issues = [];
  if (!manifest || typeof manifest !== 'object') {
    return ['plugin manifest must be a non-null object'];
  }
  for (const field of PLUGIN_REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      issues.push(`required field "${field}" is missing or null`);
    }
  }
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    issues.push('id must be a non-empty string');
  } else if (!ID_RE.test(manifest.id)) {
    issues.push(`id "${manifest.id}" must match /^[a-z][a-z0-9_-]*$/`);
  }
  if (typeof manifest.pluginManifestVersion !== 'number') {
    issues.push('pluginManifestVersion must be a number');
  } else if (!Number.isInteger(manifest.pluginManifestVersion) || manifest.pluginManifestVersion < 1) {
    issues.push(`pluginManifestVersion must be a positive integer (got ${manifest.pluginManifestVersion})`);
  }
  if (typeof manifest.title !== 'string' || manifest.title.trim().length === 0) {
    issues.push('title must be a non-empty string');
  }
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    issues.push(`version "${manifest.version}" must be a semver-like string (e.g. "1.0.0")`);
  }
  if (typeof manifest.language !== 'string' || !VALID_LANGUAGES.includes(manifest.language)) {
    issues.push(`language "${manifest.language}" must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }
  if (manifest.status !== undefined && !VALID_STATUSES.includes(manifest.status)) {
    issues.push(`status "${manifest.status}" must be one of: ${VALID_STATUSES.join(', ')}`);
  }
  if (manifest.sourcePolicy !== undefined && !VALID_SOURCE_POLICIES.includes(manifest.sourcePolicy)) {
    issues.push(`sourcePolicy "${manifest.sourcePolicy}" must be one of: ${VALID_SOURCE_POLICIES.join(', ')}`);
  }
  for (const field of ['platform', 'supportedPlatforms']) {
    if (manifest[field] !== undefined) {
      if (!Array.isArray(manifest[field])) {
        issues.push(`${field} must be an array`);
      } else {
        for (const p of manifest[field]) {
          if (!VALID_PLATFORM_IDS.includes(p)) {
            issues.push(`${field}: invalid platform "${p}"`);
          }
        }
      }
    }
  }
  if (manifest.requiresBundle !== undefined) {
    if (typeof manifest.requiresBundle !== 'string' || manifest.requiresBundle.length === 0) {
      issues.push('requiresBundle must be a non-empty string');
    }
  }
  if (manifest.requiresBundleVersion !== undefined) {
    if (typeof manifest.requiresBundleVersion !== 'string' || !SEMVER_RE.test(manifest.requiresBundleVersion)) {
      issues.push('requiresBundleVersion must be a semver-like string');
    }
  }
  if (manifest.requiresBundle !== undefined && manifest.requiresBundleVersion === undefined) {
    issues.push('requiresBundle is set but requiresBundleVersion is missing');
  }
  return issues;
}

function scanPluginManifests(rootDir) {
  const results = [];
  function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (entry === 'plugin.json') {
        let parsed = null;
        let parseError = null;
        try {
          parsed = JSON.parse(readFileSync(fullPath, 'utf8'));
        } catch (err) {
          parseError = err.message;
        }
        const issues = parseError ? [`JSON parse error: ${parseError}`] : validatePluginManifest(parsed);
        const rel = fullPath.replace(rootDir + '/', '').replace(/\\/g, '/');
        results.push({ path: rel, manifest: parsed, issues });
      }
    }
  }
  walk(rootDir);
  return results;
}

// ── Run IPC catalog scan ──

const jsonStr = execSync("node scripts/validate-ipc-catalog.mjs --json", {
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
});

const json = JSON.parse(jsonStr);

// ── Scan plugin manifests ──

const builtInPluginsDir = join(ROOT, "resources", "built-in-plugins");
const harnessDir = join(ROOT, "acceptance", "harness-plugin-prototype");
const pluginResults = [];

for (const dir of [builtInPluginsDir, harnessDir]) {
  try {
    pluginResults.push(...scanPluginManifests(dir));
  } catch {}
}

// ── Build markdown ──

const md = [
  "# IPC Channel Catalog",
  "",
  `> Auto-generated by \`scripts/validate-ipc-catalog.mjs\` on ${json.generated}`,
  "",
  "## Summary",
  "",
  "| Metric | Count |",
  "|--------|-------|",
  `| Total main-side registrations | ${json.summary.totalMainRegistrations} |`,
  `| Consistent pairs | ${json.summary.consistent} |`,
  `| Shadow channels | ${json.summary.shadow} |`,
  `| Orphan channels | ${json.summary.orphan} |`,
  `| ipcMain.handle | ${json.summary.totalMainHandles} |`,
  `| ipcMain.on | ${json.summary.totalMainOns} |`,
  `| webContents.send | ${json.summary.totalMainSends} |`,
  `| ipcRenderer.invoke | ${json.summary.totalPreloadInvokes} |`,
  `| ipcRenderer.on | ${json.summary.totalPreloadOns} |`,
  "",
  "## Shadow Channels (main-only, OK)",
  "",
  json.shadowChannels.length
    ? json.shadowChannels.map((c) => `- \`${c}\``).join("\n")
    : "_None_",
  "",
  "## Orphan Channels (ERROR — must be 0)",
  "",
  json.orphanChannels.length
    ? json.orphanChannels.map((c) => `- \`${c}\``).join("\n")
    : "_None_",
  "",
  "## Plugin Manifest Schema Validation",
  "",
  `| Plugin | Issues |`,
  `|--------|--------|`,
  ...pluginResults.map((r) => {
    const badge = r.issues.length === 0 ? "✅ OK" : `❌ ${r.issues.length} issue(s)`;
    return `| \`${r.path}\` | ${badge} |`;
  }),
  "",
  pluginResults.length > 0 && pluginResults.some((r) => r.issues.length > 0)
    ? pluginResults
        .filter((r) => r.issues.length > 0)
        .map(
          (r) =>
            `### ${r.path}\n\n${r.issues.map((i) => `- ${i}`).join("\n")}`,
        )
        .join("\n\n")
    : "_All plugin manifests pass schema validation._",
  "",
  "## Machine-Readable Catalog",
  "",
  "```json",
  JSON.stringify(json, null, 2),
  "```",
  "",
].join("\n");

writeFileSync("docs/ipc-catalog.md", md, "utf8");
console.log("Written docs/ipc-catalog.md");
