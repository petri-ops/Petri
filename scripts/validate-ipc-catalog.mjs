#!/usr/bin/env node
// ============================================================
// IPC Channel Catalog Validator Gate
//
// SUB-15.2 PHASE 1 — IPC catalog automatic validation gate
//
// Purpose: Static-scan Electron IPC handlers across the codebase,
// detect channel inconsistencies, and exit non-zero on orphans.
//
// UR-4: Self-written validator — no ajv / zod / third-party schema libs
//
// Usage: node scripts/validate-ipc-catalog.mjs
// ============================================================

import { readFileSync, readdirSync, writeFileSync } from "fs";
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
 * @returns {object}
 */
function buildCatalogJson(ref, catalog) {
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
    version: "1.0",
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
    },
    shadowChannels: [...shadowHandles, ...shadowSends, ...shadowOns]
      .map((e) => e.channel)
      .sort(),
    orphanChannels: [...orphanInvokes, ...orphanOns]
      .map((e) => e.channel)
      .sort(),
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

  if (!quiet) console.log("[IPC-CATALOG] Scanning IPC channels...");

  const catalog = buildCatalog();
  const ref = crossRef(catalog);

  // Attach helper methods
  ref.shadowCount = () =>
    ref.shadowHandles.length + ref.shadowSends.length + ref.shadowOns.length;
  ref.orphanCount = () => ref.orphanInvokes.length + ref.orphanOns.length;

  // Write pure JSON (no logs) for machine consumption
  if (process.argv.includes("--json")) {
    const json = buildCatalogJson(ref, catalog);
    console.log(JSON.stringify(json, null, 2));
    return;
  }

  report(ref, catalog);

  // Write catalog to docs/ipc-catalog.json
  if (process.argv.includes("--write-catalog")) {
    const json = buildCatalogJson(ref, catalog);
    const outPath = join(ROOT, "docs", "ipc-catalog.json");
    writeFileSync(outPath, JSON.stringify(json, null, 2));
    console.log(`[IPC-CATALOG] Catalog written to docs/ipc-catalog.json`);
  }

  if (ref.orphanCount() > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[IPC-CATALOG] Unexpected error:", err);
  process.exit(1);
});
