#!/usr/bin/env node
// ============================================================
// IPC Channel Catalog Validator Gate
//
// SUB-15.2 PHASE 2 — IPC catalog + plugin manifest schema
//
// Purpose:
//   1. Static-scan Electron IPC handlers (PHASE 1)
//   2. Validate plugin manifest schema against built-in plugins
//   3. Payload shape basic type checks (no ajv / zod — UR-4)
//
// Usage:
//   node scripts/validate-ipc-catalog.mjs
//   node scripts/validate-ipc-catalog.mjs --json
//   node scripts/validate-ipc-catalog.mjs --write-catalog
//   node scripts/validate-ipc-catalog.mjs --manifest-only
//   node scripts/validate-ipc-catalog.mjs --all
// ============================================================

import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { resolve, join } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const ROOT = resolve(__dirname, "..");

// ─── Regex patterns ────────────────────────────────────────────────────────────
// Matches: ipcMain.handle("channel", ...) or ipcMain.handle('channel', ...)
const RE_MAIN_HANDLE = /ipcMain\.handle\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;
// Matches: ipcMain.on("channel", ...)
const RE_MAIN_ON = /ipcMain\.on\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;
// Matches: mainWindow.webContents.send(...) — main→renderer push.
// The channel may be a string literal on the first line, or buried inside
// a ternary / conditional expression (e.g. updater:update-available vs
// updater:update-not-available). We extract ALL string literals from the
// send() call body and treat each as a channel.
// group(1) = first string literal found inside the parentheses.
const RE_MAIN_SEND = /webContents\.send\s*\(\s*([\s\S]*?)\)(?=\s*;|$)/g;
// Secondary: extract all quoted strings from a send-call body (handles ternaries)
const RE_SEND_CHANNEL = /['"`]([^'"`]+)['"`]/g;
// Matches: mainWindow.send(channel, payload) — secondary helper wrappers.
// Also captures channels passed as first arg to named send helpers.
const RE_SEND_HELPER = /send(?:TerminalEvent|SkillEvent|ProgressEvent|DataEvent)?\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;
// Matches: ipcRenderer.invoke("channel", ...) or ipcRenderer.invoke('channel', ...)
const RE_PRELOAD_INVOKE = /ipcRenderer\.invoke\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;
// Matches: ipcRenderer.on("channel", ...)
const RE_PRELOAD_ON = /ipcRenderer\.on\s*\(\s*['"`]([^'"`]+)['"`]\s*,/g;

// ─── Self-written validators (UR-4: no ajv / zod) ───────────────────────────

/**
 * Validate channel name format.
 * @param {string} channel
 * @returns {{ ok: boolean, error?: string }}
 */
function checkChannelName(channel) {
  if (typeof channel !== "string" || channel.length === 0) {
    return { ok: false, error: "channel must be a non-empty string" };
  }
  if (channel.length > 200) {
    return { ok: false, error: `channel name too long (${channel.length} > 200)` };
  }
  if (/\s/.test(channel)) {
    return { ok: false, error: "channel name must not contain whitespace" };
  }
  return { ok: true };
}

// ─── Plugin Manifest Schema Validation (PL-001 style — self-written, no ajv/zod) ──

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
const SHA256_RE = /^[a-f0-9]{64}$/;
const ID_RE = /^[a-z][a-z0-9_-]*$/;

/**
 * Validate a single plugin manifest object.
 * Returns array of issue strings (empty = valid).
 * @param {object} manifest
 * @returns {string[]}
 */
function validatePluginManifest(manifest) {
  const issues = [];

  if (!manifest || typeof manifest !== 'object') {
    return ['plugin manifest must be a non-null object'];
  }

  // Required fields
  for (const field of PLUGIN_REQUIRED_FIELDS) {
    if (manifest[field] === undefined || manifest[field] === null) {
      issues.push(`required field "${field}" is missing or null`);
    }
  }

  // id
  if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
    issues.push('id must be a non-empty string');
  } else if (!ID_RE.test(manifest.id)) {
    issues.push(`id "${manifest.id}" must match /^[a-z][a-z0-9_-]*$/`);
  }

  // pluginManifestVersion
  if (typeof manifest.pluginManifestVersion !== 'number') {
    issues.push('pluginManifestVersion must be a number');
  } else if (!Number.isInteger(manifest.pluginManifestVersion) || manifest.pluginManifestVersion < 1) {
    issues.push(`pluginManifestVersion must be a positive integer (got ${manifest.pluginManifestVersion})`);
  }

  // title
  if (typeof manifest.title !== 'string' || manifest.title.trim().length === 0) {
    issues.push('title must be a non-empty string');
  }

  // version (semver)
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) {
    issues.push(`version "${manifest.version}" must be a semver-like string (e.g. "1.0.0")`);
  }

  // language
  if (typeof manifest.language !== 'string' || !VALID_LANGUAGES.includes(manifest.language)) {
    issues.push(`language "${manifest.language}" must be one of: ${VALID_LANGUAGES.join(', ')}`);
  }

  // status (optional, but if present must be valid)
  if (manifest.status !== undefined && !VALID_STATUSES.includes(manifest.status)) {
    issues.push(`status "${manifest.status}" must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // sourcePolicy (optional)
  if (manifest.sourcePolicy !== undefined && !VALID_SOURCE_POLICIES.includes(manifest.sourcePolicy)) {
    issues.push(`sourcePolicy "${manifest.sourcePolicy}" must be one of: ${VALID_SOURCE_POLICIES.join(', ')}`);
  }

  // packages
  if (manifest.packages !== undefined) {
    if (typeof manifest.packages !== 'object' || Array.isArray(manifest.packages)) {
      issues.push('packages must be a non-array object (e.g. { r: { pkg: "ver" } })');
    } else {
      for (const [lang, pkgs] of Object.entries(manifest.packages)) {
        if (!VALID_LANGUAGES.includes(lang)) {
          issues.push(`packages.${lang}: invalid language key (not in ${VALID_LANGUAGES.join(', ')})`);
        } else if (typeof pkgs !== 'object' || Array.isArray(pkgs)) {
          issues.push(`packages.${lang} must be an object mapping package name to version string`);
        } else {
          for (const [pkg, ver] of Object.entries(pkgs)) {
            if (typeof pkg !== 'string' || pkg.length === 0) {
              issues.push(`packages.${lang}: package name must be a non-empty string`);
            }
            if (typeof ver !== 'string' || ver.length === 0) {
              issues.push(`packages.${lang}.${pkg}: version must be a non-empty string`);
            }
          }
        }
      }
    }
  }

  // runtime
  if (manifest.runtime !== undefined) {
    if (typeof manifest.runtime !== 'object' || Array.isArray(manifest.runtime)) {
      issues.push('runtime must be a non-array object (e.g. { r: ">=4.4.0" })');
    } else {
      for (const [lang, ver] of Object.entries(manifest.runtime)) {
        if (!VALID_LANGUAGES.includes(lang)) {
          issues.push(`runtime.${lang}: invalid language key`);
        }
        if (typeof ver !== 'string' || ver.length === 0) {
          issues.push(`runtime.${lang}: version constraint must be a non-empty string`);
        }
      }
    }
  }

  // builtAgainst
  if (manifest.builtAgainst !== undefined) {
    if (typeof manifest.builtAgainst !== 'object' || Array.isArray(manifest.builtAgainst)) {
      issues.push('builtAgainst must be a non-array object');
    } else {
      for (const [key, val] of Object.entries(manifest.builtAgainst)) {
        if (typeof val !== 'string' || val.length === 0) {
          issues.push(`builtAgainst.${key}: version must be a non-empty string`);
        }
      }
    }
  }

  // platform / supportedPlatforms
  for (const field of ['platform', 'supportedPlatforms']) {
    if (manifest[field] !== undefined) {
      if (!Array.isArray(manifest[field])) {
        issues.push(`${field} must be an array`);
      } else {
        for (const p of manifest[field]) {
          if (!VALID_PLATFORM_IDS.includes(p)) {
            issues.push(`${field}: invalid platform "${p}" (must be one of: ${VALID_PLATFORM_IDS.join(', ')})`);
          }
        }
      }
    }
  }

  // platformSupport (optional — detailed per-platform)
  if (manifest.platformSupport !== undefined) {
    if (typeof manifest.platformSupport !== 'object' || Array.isArray(manifest.platformSupport)) {
      issues.push('platformSupport must be a non-array object');
    } else {
      for (const [platformId, support] of Object.entries(manifest.platformSupport)) {
        if (!VALID_PLATFORM_IDS.includes(platformId)) {
          issues.push(`platformSupport: invalid platformId "${platformId}"`);
        }
        if (typeof support !== 'object' || Array.isArray(support)) {
          issues.push(`platformSupport.${platformId}: must be an object`);
        } else {
          if (support.status !== undefined) {
            const validStatuses = ['supported', 'planned', 'unsupported', 'deprecated'];
            if (!validStatuses.includes(support.status)) {
              issues.push(`platformSupport.${platformId}.status "${support.status}" must be one of: ${validStatuses.join(', ')}`);
            }
          }
        }
      }
    }
  }

  // requiresBundle / requiresBundleVersion
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

/**
 * Scan all plugin.json files in a directory tree.
 * Returns array of { path, manifest, issues }.
 * @param {string} rootDir
 * @returns {{ path: string, manifest: object, issues: string[] }[]}
 */
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
        let raw;
        try {
          raw = readFileSync(fullPath, 'utf8');
          parsed = JSON.parse(raw);
        } catch (err) {
          parseError = err.message;
          parsed = null;
        }
        const issues = parseError
          ? [`JSON parse error: ${parseError}`]
          : validatePluginManifest(parsed);
        const rel = fullPath.replace(rootDir + '/', '').replace(/\\/g, '/');
        results.push({ path: rel, manifest: parsed, issues });
      }
    }
  }

  walk(rootDir);
  return results;
}

// ─── Payload Shape Basic Type Checks (self-written, no ajv/zod) ──────────────

const KNOWN_PAYLOAD_TYPES = Object.freeze([
  'null', 'boolean', 'number', 'integer', 'string', 'array', 'object',
]);

/**
 * Infer the expected JS type from a schema value description string.
 * Returns a JS typeof string or 'unknown'.
 * @param {string} typeStr
 * @returns {string}
 */
function inferJsType(typeStr) {
  switch (typeStr) {
    case 'null': return 'object';
    case 'boolean': return 'boolean';
    case 'number': return 'number';
    case 'integer': return 'number';
    case 'string': return 'string';
    case 'array': return 'object';
    case 'object': return 'object';
    default: return 'unknown';
  }
}

/**
 * Basic type check for an IPC payload against an inferred schema.
 * Returns { ok, errors } where errors is array of string.
 *
 * This is a shallow type check — it detects obvious type mismatches
 * in payload objects without introducing zod/ajv. Supports top-level
 * type checks and nested property validation.
 *
 * @param {*} value
 * @param {{ type: string, minimum?: number, maximum?: number, enum?: string[], required?: string[], properties?: object, items?: object }} schema
 * @param {string} path
 * @returns {{ ok: boolean, errors: string[] }}
 */
function checkPayloadShape(value, schema, path = '<payload>') {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return { ok: true, errors: [] }; // no schema = skip
  }

  // Validate the top-level value against schema.type
  if (schema.type !== undefined) {
    const jsType = inferJsType(schema.type);
    if (jsType !== 'unknown') {
      if (schema.type === 'null') {
        if (value !== null) {
          errors.push(`${path}: expected null, got ${value === null ? 'null' : typeof value}`);
        }
      } else if (schema.type === 'integer') {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          errors.push(`${path}: expected integer, got ${typeof value} ${value}`);
        }
      } else if (typeof value !== jsType) {
        errors.push(`${path}: expected type ${schema.type}, got ${typeof value}`);
      }
    }
  }

  // Validate nested properties if schema has properties definition
  if (schema.properties && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const propValue = value[propName];
      const propPath = `${path}.${propName}`;
      // Check if required field is missing
      if (propValue === undefined && Array.isArray(schema.required) && schema.required.includes(propName)) {
        errors.push(`${propPath}: required field "${propName}" is missing`);
      }
      // Validate property value if present
      if (propValue !== undefined) {
        const propErrors = checkPayloadShape(propValue, propSchema, propPath);
        errors.push(...propErrors.errors);
      }
    }
  }

  if (schema.minimum !== undefined && typeof value === 'number') {
    if (value < schema.minimum) {
      errors.push(`${path}: value ${value} < minimum ${schema.minimum}`);
    }
  }

  if (schema.maximum !== undefined && typeof value === 'number') {
    if (value > schema.maximum) {
      errors.push(`${path}: value ${value} > maximum ${schema.maximum}`);
    }
  }

  if (schema.enum !== undefined && Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push(`${path}: value "${value}" not in enum [${schema.enum.join(', ')}]`);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Payload shape registry: maps channel prefix to expected schema hints.
 * This is used for static analysis of common IPC channel payload patterns.
 * Format: { prefix: { type: 'invoke'|'push', payloadHint: object } }
 */
const PAYLOAD_HINTS = Object.freeze({
  'window:': { type: 'push', payloadHint: { type: 'object' } },
  'app:': { type: 'invoke', payloadHint: { type: 'object' } },
  'plugin:': { type: 'invoke', payloadHint: { type: 'object' } },
  'file:': { type: 'invoke', payloadHint: { type: 'object' } },
  'runtime:': { type: 'invoke', payloadHint: { type: 'object' } },
  'backend:': { type: 'invoke', payloadHint: { type: 'object' } },
  'terminal:': { type: 'invoke', payloadHint: { type: 'object' } },
  'skill:': { type: 'invoke', payloadHint: { type: 'object' } },
  'diagnostic:': { type: 'invoke', payloadHint: { type: 'object' } },
  'data:': { type: 'invoke', payloadHint: { type: 'object' } },
  'ai:': { type: 'invoke', payloadHint: { type: 'object' } },
  'compute:': { type: 'invoke', payloadHint: { type: 'object' } },
  'updater:': { type: 'push', payloadHint: { type: 'object' } },
});

/**
 * Get payload hint for a channel name.
 * @param {string} channel
 * @returns {object|null}
 */
function getPayloadHint(channel) {
  for (const [prefix, hint] of Object.entries(PAYLOAD_HINTS)) {
    if (channel.startsWith(prefix)) return hint;
  }
  return null;
}

// ─── Line counting ─────────────────────────────────────────────────────────────

/**
 * Count lines (1-indexed) up to a byte offset in a string.
 * @param {string} str
 * @param {number} byteOffset
 * @returns {number}
 */
function countLines(str, byteOffset) {
  const prefix = str.slice(0, byteOffset);
  return prefix.split("\n").length;
}

// ─── File scanning helpers ────────────────────────────────────────────────────

/**
 * Scan a file's content for main-process IPC channel registrations.
 * Returns { handles, ons, sends }.
 * @param {string} filePath
 * @param {string} relativePath
 * @returns {{ handles: ChannelEntry[], ons: ChannelEntry[], sends: ChannelEntry[] }}
 */
function scanFile(filePath, relativePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { handles: [], ons: [], sends: [] };
  }

  const handles = [];
  const ons = [];
  const sends = [];
  let m;

  RE_MAIN_HANDLE.lastIndex = 0;
  while ((m = RE_MAIN_HANDLE.exec(content)) !== null) {
    handles.push({ channel: m[1], file: relativePath, line: countLines(content, m.index) });
  }

  RE_MAIN_ON.lastIndex = 0;
  while ((m = RE_MAIN_ON.exec(content)) !== null) {
    ons.push({ channel: m[1], file: relativePath, line: countLines(content, m.index) });
  }

  RE_MAIN_SEND.lastIndex = 0;
  while ((m = RE_MAIN_SEND.exec(content)) !== null) {
    // Extract all quoted string literals from the send() call body.
    // This handles cases like: send(flag ? "channel-a" : "channel-b")
    const body = m[1];
    const line = countLines(content, m.index);
    let sm;
    RE_SEND_CHANNEL.lastIndex = 0;
    while ((sm = RE_SEND_CHANNEL.exec(body)) !== null) {
      sends.push({ channel: sm[1], file: relativePath, line });
    }
  }

  // Also scan for named send-helper calls like sendTerminalEvent("channel", ...)
  // These are wrapper functions that ultimately call webContents.send internally.
  RE_SEND_HELPER.lastIndex = 0;
  while ((m = RE_SEND_HELPER.exec(content)) !== null) {
    sends.push({
      channel: m[1],
      file: relativePath,
      line: countLines(content, m.index),
    });
  }

  return { handles, ons, sends };
}

/**
 * Scan preload.js for renderer-process IPC channel calls.
 * Returns { invokes, ons }.
 * @param {string} filePath
 * @param {string} relativePath
 * @returns {{ invokes: ChannelEntry[], ons: ChannelEntry[] }}
 */
function scanPreload(filePath, relativePath) {
  let content;
  try {
    content = readFileSync(filePath, "utf8");
  } catch {
    return { invokes: [], ons: [] };
  }

  const invokes = [];
  const ons = [];
  let m;

  RE_PRELOAD_INVOKE.lastIndex = 0;
  while ((m = RE_PRELOAD_INVOKE.exec(content)) !== null) {
    invokes.push({ channel: m[1], file: relativePath, line: countLines(content, m.index) });
  }

  RE_PRELOAD_ON.lastIndex = 0;
  while ((m = RE_PRELOAD_ON.exec(content)) !== null) {
    ons.push({ channel: m[1], file: relativePath, line: countLines(content, m.index) });
  }

  return { invokes, ons };
}

// ─── Catalog building ─────────────────────────────────────────────────────────

/**
 * Build the full IPC catalog from source files.
 * @returns {IPCCatalog}
 */
function buildCatalog() {
  const mainHandles = [];
  const mainOns = [];
  const mainSends = [];

  // 1. Scan main.js
  const mainJs = join(ROOT, "src", "main.js");
  const mainResult = scanFile(mainJs, "src/main.js");
  mainHandles.push(...mainResult.handles);
  mainOns.push(...mainResult.ons);
  mainSends.push(...mainResult.sends);

  // 2. Scan src/main/*.js (SUB-15.1 extracted files)
  const mainDir = join(ROOT, "src", "main");
  try {
    for (const file of readdirSync(mainDir)) {
      if (!file.endsWith(".js")) continue;
      const result = scanFile(join(mainDir, file), `src/main/${file}`);
      mainHandles.push(...result.handles);
      mainOns.push(...result.ons);
      mainSends.push(...result.sends);
    }
  } catch {}

  // 3. Scan src/ipc/*.js (BLOCK-9.1 extracted handlers)
  const ipcDir = join(ROOT, "src", "ipc");
  try {
    for (const file of readdirSync(ipcDir)) {
      if (!file.endsWith(".js")) continue;
      const result = scanFile(join(ipcDir, file), `src/ipc/${file}`);
      mainHandles.push(...result.handles);
      mainOns.push(...result.ons);
      mainSends.push(...result.sends);
    }
  } catch {}

  // 4. Scan preload.js
  const preloadJs = join(ROOT, "src", "preload.js");
  const preloadResult = scanPreload(preloadJs, "src/preload.js");

  return {
    mainHandles,
    mainOns,
    mainSends,
    preloadInvokes: preloadResult.invokes,
    preloadOns: preloadResult.ons,
  };
}

// ─── Cross-referencing ────────────────────────────────────────────────────────

/**
 * Cross-reference main vs preload to determine channel categories:
 *
 * Bidirectional channel pairs:
 *   - invoke/invoke: main ipcMain.handle ↔ preload ipcRenderer.invoke (request/response)
 *   - push/listen:   main webContents.send ↔ preload ipcRenderer.on (main→renderer push)
 *
 * Shadow channels (main-only, no preload counterpart):
 *   - shadowHandle: main ipcMain.handle exists but preload has no ipcRenderer.invoke
 *   - shadowSend:   main webContents.send exists but preload has no ipcRenderer.on
 *   - shadowOn:     main ipcMain.on exists but preload has no ipcRenderer.on
 *
 * Orphan channels (ERROR — preload calls a channel that doesn't exist in main):
 *   - orphanInvoke: preload ipcRenderer.invoke but no matching main ipcMain.handle
 *   - orphanOn:     preload ipcRenderer.on but no matching main ipcMain.on / webContents.send
 *
 * @param {IPCCatalog} catalog
 * @returns {CrossRefResult}
 */
function crossRef(catalog) {
  const { mainHandles, mainOns, mainSends, preloadInvokes, preloadOns } = catalog;

  // Maps: channel → entry
  const mainHandleMap = new Map(mainHandles.map((h) => [h.channel, h]));
  const mainOnMap = new Map(mainOns.map((o) => [o.channel, o]));
  const mainSendMap = new Map(mainSends.map((s) => [s.channel, s]));
  const preloadInvokeMap = new Map(preloadInvokes.map((i) => [i.channel, i]));
  const preloadOnMap = new Map(preloadOns.map((o) => [o.channel, o]));

  const consistentPairs = [];     // { channel, main, preload, type }
  const shadowHandles = [];     // main handle, no preload invoke
  const shadowSends = [];      // main send, no preload on
  const shadowOns = [];         // main on, no preload on
  const orphanInvokes = [];     // preload invoke, no main handle
  const orphanOns = [];         // preload on, no main on / main send

  // ── 1. ipcMain.handle ↔ ipcRenderer.invoke ──────────────────────────────
  for (const [channel, mainEntry] of mainHandleMap) {
    if (preloadInvokeMap.has(channel)) {
      consistentPairs.push({
        channel,
        main: mainEntry,
        preload: preloadInvokeMap.get(channel),
        type: "invoke",
      });
    } else {
      shadowHandles.push(mainEntry);
    }
  }

  // ── 2. webContents.send ↔ ipcRenderer.on (push channels) ────────────────
  for (const [channel, mainEntry] of mainSendMap) {
    if (preloadOnMap.has(channel)) {
      consistentPairs.push({
        channel,
        main: mainEntry,
        preload: preloadOnMap.get(channel),
        type: "push/listen",
      });
    } else {
      shadowSends.push(mainEntry);
    }
  }

  // ── 3. ipcMain.on (listen-only) ↔ preload on ────────────────────────────
  // Note: ipcMain.on is rare (usually for window chrome events handled in
  // _window-ipc.js). These are cross-referenced against preload on.
  for (const [channel, mainEntry] of mainOnMap) {
    if (!preloadOnMap.has(channel)) {
      shadowOns.push(mainEntry);
    }
  }

  // ── 4. Orphan invokes: preload invoke has no main handle ──────────────────
  for (const [channel, preloadEntry] of preloadInvokeMap) {
    if (!mainHandleMap.has(channel)) {
      orphanInvokes.push(preloadEntry);
    }
  }

  // ── 5. Orphan ons: preload on has neither main send nor main on ───────────
  for (const [channel, preloadEntry] of preloadOnMap) {
    if (!mainSendMap.has(channel) && !mainOnMap.has(channel)) {
      orphanOns.push(preloadEntry);
    }
  }

  return { consistentPairs, shadowHandles, shadowSends, shadowOns, orphanInvokes, orphanOns };
}

// ─── Reporter ────────────────────────────────────────────────────────────────

/**
 * Emit structured console output.
 * @param {CrossRefResult} ref
 * @param {IPCCatalog} catalog
 */
function report(ref, catalog) {
  const { consistentPairs, shadowHandles, shadowSends, shadowOns, orphanInvokes, orphanOns } = ref;

  const totalMain = catalog.mainHandles.length + catalog.mainOns.length + catalog.mainSends.length;

  console.log(`[IPC-CATALOG] ${catalog.mainHandles.length} ipcMain.handle found`);
  console.log(`[IPC-CATALOG] ${catalog.mainOns.length} ipcMain.on found`);
  console.log(`[IPC-CATALOG] ${catalog.mainSends.length} webContents.send found`);
  console.log(`[IPC-CATALOG] ${catalog.preloadInvokes.length} ipcRenderer.invoke found`);
  console.log(`[IPC-CATALOG] ${catalog.preloadOns.length} ipcRenderer.on found`);
  console.log(`[IPC-CATALOG] ${totalMain} total main-side registrations`);
  console.log(`[IPC-CATALOG] ${consistentPairs.length} consistent pairs`);
  console.log(`[IPC-CATALOG] ${ref.shadowCount()} shadow channels (main-only, OK)`);
  console.log(`[IPC-CATALOG] ${ref.orphanCount()} orphan channels`);

  const shadowCount = shadowHandles.length + shadowSends.length + shadowOns.length;

  if (shadowHandles.length > 0) {
    console.log(`[IPC-CATALOG] Shadow handles (${shadowHandles.length}):`);
    for (const h of shadowHandles) {
      console.log(`[IPC-CATALOG]   ${h.channel} (${h.file}:${h.line})`);
    }
  }

  if (shadowSends.length > 0) {
    console.log(`[IPC-CATALOG] Shadow sends (${shadowSends.length}):`);
    for (const s of shadowSends) {
      console.log(`[IPC-CATALOG]   ${s.channel} (${s.file}:${s.line})`);
    }
  }

  if (shadowOns.length > 0) {
    console.log(`[IPC-CATALOG] Shadow on (${shadowOns.length}):`);
    for (const o of shadowOns) {
      console.log(`[IPC-CATALOG]   ${o.channel} (${o.file}:${o.line})`);
    }
  }

  if (orphanInvokes.length > 0) {
    console.log(`[IPC-CATALOG] FAIL: ${orphanInvokes.length} orphan invoke channels detected`);
    for (const o of orphanInvokes) {
      console.log(`[IPC-CATALOG]   - ${o.channel} (${o.file}:${o.line})`);
    }
  }

  if (orphanOns.length > 0) {
    console.log(`[IPC-CATALOG] FAIL: ${orphanOns.length} orphan on channels detected`);
    for (const o of orphanOns) {
      console.log(`[IPC-CATALOG]   - ${o.channel} (${o.file}:${o.line})`);
    }
  }

  if (ref.orphanCount() === 0) {
    console.log("[IPC-CATALOG] PASS");
  }
}

// ─── JSON catalog export ──────────────────────────────────────────────────────

/**
 * Build the machine-readable catalog JSON.
 * @param {CrossRefResult} ref
 * @param {IPCCatalog} catalog
 * @param {{ manifestResults?: object[], manifestErrors?: number }} [opts]
 * @returns {object}
 */
function buildCatalogJson(ref, catalog, opts = {}) {
  const { manifestResults = [], manifestErrors = 0 } = opts || {};
  const { consistentPairs, shadowHandles, shadowSends, shadowOns, orphanInvokes, orphanOns } = ref;

  /** @type {Record<string, object>} */
  const channels = {};

  for (const pair of consistentPairs) {
    channels[pair.channel] = {
      type: pair.type,
      main: { file: pair.main.file, line: pair.main.line },
      preload: { file: pair.preload.file, line: pair.preload.line },
      consistent: true,
    };
  }

  for (const h of shadowHandles) {
    channels[h.channel] = {
      type: "handle",
      main: { file: h.file, line: h.line },
      preload: null,
      consistent: false,
      shadowReason: "main ipcMain.handle with no preload ipcRenderer.invoke",
    };
  }

  for (const s of shadowSends) {
    channels[s.channel] = {
      type: "send",
      main: { file: s.file, line: s.line },
      preload: null,
      consistent: false,
      shadowReason: "main webContents.send with no preload ipcRenderer.on listener",
    };
  }

  for (const o of shadowOns) {
    channels[o.channel] = {
      type: "on",
      main: { file: o.file, line: o.line },
      preload: null,
      consistent: false,
      shadowReason: "main ipcMain.on with no preload counterpart",
    };
  }

  for (const o of orphanInvokes) {
    channels[o.channel] = {
      type: "invoke",
      main: null,
      preload: { file: o.file, line: o.line },
      consistent: false,
      orphanReason: "preload ipcRenderer.invoke with no main ipcMain.handle",
    };
  }

  for (const o of orphanOns) {
    channels[o.channel] = {
      type: "on",
      main: null,
      preload: { file: o.file, line: o.line },
      consistent: false,
      orphanReason: "preload ipcRenderer.on with no main webContents.send or ipcMain.on",
    };
  }

  const totalMain =
    catalog.mainHandles.length + catalog.mainOns.length + catalog.mainSends.length;

  return {
    version: "2.0",
    generated: new Date().toISOString().slice(0, 10),
    channels,
    summary: {
      totalMainRegistrations: totalMain,
      totalMainHandles: catalog.mainHandles.length,
      totalMainOns: catalog.mainOns.length,
      totalMainSends: catalog.mainSends.length,
      totalPreloadInvokes: catalog.preloadInvokes.length,
      totalPreloadOns: catalog.preloadOns.length,
      consistent: consistentPairs.length,
      shadow: ref.shadowCount(),
      orphan: ref.orphanCount(),
      pluginManifestCount: manifestResults.length,
      pluginManifestErrors: manifestErrors,
    },
    shadowChannels: [...shadowHandles, ...shadowSends, ...shadowOns]
      .map((e) => e.channel)
      .sort(),
    orphanChannels: [...orphanInvokes, ...orphanOns]
      .map((e) => e.channel)
      .sort(),
    pluginManifests: manifestResults,
  };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ channel: string, file: string, line: number }} ChannelEntry
 * @typedef {{ mainHandles: ChannelEntry[], mainOns: ChannelEntry[], mainSends: ChannelEntry[], preloadInvokes: ChannelEntry[], preloadOns: ChannelEntry[] }} IPCCatalog
 * @typedef {{ consistentPairs: object[], shadowHandles: ChannelEntry[], shadowSends: ChannelEntry[], shadowOns: ChannelEntry[], orphanInvokes: ChannelEntry[], orphanOns: ChannelEntry[], shadowCount: () => number, orphanCount: () => number }} CrossRefResult
 */

async function main() {
  const quiet = process.argv.includes("--json");
  const manifestOnly = process.argv.includes("--manifest-only");
  const all = process.argv.includes("--all");

  if (!quiet) console.log("[IPC-CATALOG] Scanning IPC channels...");

  const catalog = buildCatalog();
  const ref = crossRef(catalog);

  // Attach helper methods
  ref.shadowCount = () =>
    ref.shadowHandles.length + ref.shadowSends.length + ref.shadowOns.length;
  ref.orphanCount = () => ref.orphanInvokes.length + ref.orphanOns.length;

  // ── Plugin manifest validation (always runs, needed for JSON output) ───────────
  const builtInPluginsDir = join(ROOT, "resources", "built-in-plugins");
  const harnessDir = join(ROOT, "acceptance", "harness-plugin-prototype");
  const pluginScanResults = [];
  const allManifestIssues = [];

  for (const dir of [builtInPluginsDir, harnessDir]) {
    try {
      pluginScanResults.push(...scanPluginManifests(dir));
    } catch {}
  }

  for (const result of pluginScanResults) {
    if (result.issues.length > 0) {
      allManifestIssues.push({ path: result.path, issues: result.issues });
    }
  }

  // ── Payload shape analysis (static — no runtime required) ──────────────────────
  if (!manifestOnly) {
    const allChannels = [
      ...catalog.mainHandles.map(h => h.channel),
      ...catalog.mainSends.map(s => s.channel),
    ];
    const channelsWithPayloadHints = allChannels.filter(ch => getPayloadHint(ch) !== null);
    if (!quiet) {
      console.log(`[IPC-CATALOG] ${channelsWithPayloadHints.length} channels have payload shape hints`);
    }
  }

  // Write pure JSON (no logs) for machine consumption
  if (process.argv.includes("--json")) {
    const json = buildCatalogJson(ref, catalog, {
      manifestResults: pluginScanResults,
      manifestErrors: allManifestIssues.length,
    });
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  if (!quiet) {
    console.log(`[IPC-CATALOG] ${pluginScanResults.length} plugin manifest(s) scanned`);
    if (allManifestIssues.length === 0) {
      console.log("[IPC-CATALOG] MANIFEST: all plugins pass schema validation");
    } else {
      console.log(`[IPC-CATALOG] MANIFEST: ${allManifestIssues.length} plugin(s) with schema issues`);
      for (const err of allManifestIssues) {
        console.log(`[IPC-CATALOG] MANIFEST: ${err.issues.length} issue(s) in ${err.path}`);
        for (const issue of err.issues) {
          console.log(`[IPC-CATALOG]   - ${issue}`);
        }
      }
    }
  }

  if (manifestOnly) {
    // manifest-only mode: only report manifest results
    if (allManifestIssues.length > 0) {
      process.exit(1);
    }
    return;
  }

  report(ref, catalog);

  // Write catalog to docs/ipc-catalog.json
  if (process.argv.includes("--write-catalog")) {
    const json = buildCatalogJson(ref, catalog, {
      manifestResults: pluginScanResults,
      manifestErrors: allManifestIssues.length,
    });
    const outPath = join(ROOT, "docs", "ipc-catalog.json");
    writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`[IPC-CATALOG] Catalog written to docs/ipc-catalog.json`);
  }

  const hasOrphans = ref.orphanCount() > 0;

  if (hasOrphans) {
    console.log("[IPC-CATALOG] FAIL: orphan IPC channels detected");
    process.exit(1);
  }

  // Manifest errors are informational in default gate (not blocking).
  // Use --manifest-only for strict manifest validation.
  if (allManifestIssues.length > 0 && !quiet) {
    console.log(`[IPC-CATALOG] NOTE: ${allManifestIssues.length} plugin manifest(s) have schema issues (non-blocking; use --manifest-only to enforce)`);
  }
}

main().catch((err) => {
  console.error("[IPC-CATALOG] Unexpected error:", err);
  process.exit(1);
});
