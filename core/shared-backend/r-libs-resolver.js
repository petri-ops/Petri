'use strict';

const fs = require('fs');
const path = require('path');

// Shared R_LIBS_USER resolver for plugin R scripts.
//
// Both the HTTP executor (core/r-server/helpers/tools-executor.js) and the MCP
// registry (core/r-server/mcp/registry.js) need to assemble the same three-tier
// R library search path before spawning Rscript for a plugin. This module is
// the single source of truth for that logic so the two call sites cannot drift
// (audit AUDIT-LOG §3 problem A: ~25 lines duplicated across both files).
//
// Priority (highest first):
//   1. Harness-provisioned capability bundle lib(s) declared via `requiresBundle`
//      — heavyweight Bioconductor packages that cannot ship inside the read-only
//      .app bundle (Stage 3 M1+, e.g. r-enrichment / r-wgcna).
//   2. Plugin-local packages/r (small deps bundled with the plugin).
//   3. R runtime install library (base packages).
//
// R_LIBS_USER is appended after the default .libPaths(), so the runtime base
// library remains available regardless.

// Warn at most once per process if capability-provisioning cannot be loaded,
// so a genuinely broken provisioning module is visible in logs without spamming
// every single tool run (audit AUDIT-LOG §3 problem B: silent catch {}).
let _warnedProvisioningUnavailable = false;

/**
 * Resolve provisioned capability bundle lib directories for a plugin.
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string}} pluginCfg
 * @returns {string[]} install dirs for ready bundles (empty when none / unavailable)
 */
function resolveProvisionedBundleLibs(pluginCfg) {
  if (!pluginCfg || !pluginCfg.requiresBundle) return [];
  let cp;
  try {
    cp = require('./capability-provisioning');
  } catch (e) {
    if (!_warnedProvisioningUnavailable) {
      _warnedProvisioningUnavailable = true;
      console.warn('[harness] capability provisioning unavailable:', e.message);
    }
    return [];
  }
  const bundles = Array.isArray(pluginCfg.requiresBundle)
    ? pluginCfg.requiresBundle
    : [pluginCfg.requiresBundle];
  const version = pluginCfg.requiresBundleVersion || '1.0.0';
  const dirs = [];
  for (const bundleId of bundles) {
    try {
      const ready = cp.checkCapabilityReady({ capabilityId: bundleId, version });
      if (ready.ready && ready.installDir) dirs.push(ready.installDir);
    } catch (e) {
      console.warn(`[harness] capability readiness check failed for ${bundleId}:`, e.message);
    }
  }
  return dirs;
}

/**
 * Build the R_LIBS_USER runEnv for a plugin R script, or null when no extra
 * library paths apply (in which case the caller should leave env unset and let
 * the runtime defaults stand).
 *
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string, pluginDir?: string}} pluginCfg
 * @returns {{[k:string]: string}|null} full runEnv (spread of process.env) or null
 */
function resolveRLibsForPlugin(pluginCfg) {
  const rLibsParts = [];

  // 1. Provisioned capability bundle lib(s).
  for (const dir of resolveProvisionedBundleLibs(pluginCfg)) rLibsParts.push(dir);

  // 2. Plugin-local packages/r.
  const pluginDir = pluginCfg && pluginCfg.pluginDir;
  if (pluginDir) {
    const pluginRPkgDir = path.join(pluginDir, 'packages', 'r');
    if (fs.existsSync(pluginRPkgDir)) rLibsParts.push(pluginRPkgDir);
  }

  // 3. R home library.
  const rHomeLib = path.join(process.env.BIOF3_R_HOME || '', 'library');
  if (fs.existsSync(rHomeLib)) rLibsParts.push(rHomeLib);

  if (rLibsParts.length === 0) return null;

  return {
    ...process.env,
    R_HOME: process.env.BIOF3_R_HOME || process.env.R_HOME,
    R_LIBS_USER: rLibsParts.join(':'),
  };
}

module.exports = {
  resolveRLibsForPlugin,
  resolveProvisionedBundleLibs,
};
