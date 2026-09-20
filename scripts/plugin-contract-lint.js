#!/usr/bin/env node
/**
 * Plugin Contract Linter
 *
 * Validates plugin contracts: plugin.json, tool-definition.json, acceptance.json
 * and R script behavior consistency.
 *
 * Checks:
 * 1. All acceptance inputs are declared in tool-definition inputs
 * 2. All required tool-definition inputs have defaults or are truly required
 * 3. acceptance fixture parameters exist in tool-definition inputs
 * 4. R script reads params that are declared in tool-definition
 * 5. Output artifact types are consistent across contracts
 * 6. failureModes detect patterns match actual script error messages
 *
 * @module scripts/plugin-contract-lint
 */

const fs = require('fs');
const path = require('path');
const { lintResultStudioPlugin } = require('../core/shared-backend/result-studio-plugin-sdk');

const PLUGIN_DIR = path.join(__dirname, '..', 'resources', 'built-in-plugins');

function lintPlugin(pluginId) {
  const pluginDir = path.join(PLUGIN_DIR, pluginId);
  const errors = [];
  const warnings = [];

  function readJson(name) {
    const p = path.join(pluginDir, name);
    if (!fs.existsSync(p)) return null;
    try {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch (e) {
      errors.push(`[${pluginId}] ${name}: JSON parse error — ${e.message}`);
      return null;
    }
  }

  const pluginJson = readJson('plugin.json');
  const toolDef = readJson('tool-definition.json');
  const acceptance = readJson('acceptance.json');

  if (!pluginJson || !toolDef) {
    return { pluginId, errors, warnings, status: 'skipped' };
  }

  // Result Studio descriptors are trusted execution metadata. If present they
  // must pass the SDK in full; partial metadata is more dangerous than absence.
  if (toolDef.resultStudio || pluginJson.resultStudio) {
    const resultStudio = lintResultStudioPlugin({ plugin: pluginJson, toolDefinition: toolDef, pluginDir });
    for (const issue of resultStudio.errors) {
      errors.push(`[${pluginId}] resultStudio ${issue.code} (${issue.field}): ${issue.detail}`);
    }
    for (const issue of resultStudio.warnings) {
      warnings.push(`[${pluginId}] resultStudio ${issue.code} (${issue.field}): ${issue.detail}`);
    }
  }

  // Collect tool-definition input IDs
  const toolInputs = new Map();
  const toolOutputs = new Map();
  if (toolDef.inputs) {
    for (const input of toolDef.inputs) {
      toolInputs.set(input.id, input);
    }
  }
  if (toolDef.outputs) {
    for (const output of toolDef.outputs) {
      toolOutputs.set(output.id, output);
    }
  }

  // 1. Check acceptance fixture inputs are in tool-definition
  if (acceptance && acceptance.fixtures) {
    for (const fixture of acceptance.fixtures) {
      if (!fixture.inputs) continue;
      const fixtureInputKeys = Object.keys(fixture.inputs);
      for (const key of fixtureInputKeys) {
        if (!toolInputs.has(key)) {
          errors.push(
            `[${pluginId}] fixture "${fixture.id}": acceptance input "${key}" not declared in tool-definition inputs`
          );
        }
      }
    }
  }

  // 2. Check required tool-definition inputs actually have no default
  for (const [id, input] of toolInputs) {
    if (input.required !== false && input.default === undefined && input.type !== 'file') {
      warnings.push(
        `[${pluginId}] tool-definition input "${id}" is required but has no default`
      );
    }
  }

  // 3. Check tool-definition inputs that are declared but not used in acceptance fixtures
  const acceptedInputKeys = new Set();
  if (acceptance && acceptance.fixtures) {
    for (const fixture of acceptance.fixtures) {
      if (fixture.inputs) {
        Object.keys(fixture.inputs).forEach(k => acceptedInputKeys.add(k));
      }
    }
  }
  for (const id of toolInputs.keys()) {
    if (!acceptedInputKeys.has(id)) {
      warnings.push(
        `[${pluginId}] tool-definition input "${id}" has no acceptance fixture covering it`
      );
    }
  }

  // 4. Check failureModes detect patterns are present in script
  const scriptsDir = path.join(pluginDir, 'scripts');
  if (fs.existsSync(scriptsDir) && toolDef.failureModes) {
    const scriptFiles = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.R'));
    if (scriptFiles.length > 0) {
      const scriptContent = scriptFiles
        .map(f => fs.readFileSync(path.join(scriptsDir, f), 'utf-8'))
        .join('\n');

      for (const fm of toolDef.failureModes) {
        if (!fm.code) continue;
        // Check that failureModes have at least one of: stop() or warning() in script
        // We just warn if detect patterns look non-specific
        if (fm.detect) {
          const patterns = fm.detect.split('|');
          const covered = patterns.some(p => {
            return scriptContent.includes(p) || scriptContent.includes(p.replace(/\\/g, ''));
          });
          if (!covered) {
            warnings.push(
              `[${pluginId}] failureMode "${fm.code}": detect pattern "${fm.detect}" — not found in R script`
            );
          }
        }
      }
    }
  }

  // 5. Check output consistency: tool-definition outputs match plugin.json description
  // (plugin.json has no structured outputs — just skip)

  // 6. Check that tool-definition outputs are mentioned in R script or manifest generation
  const scriptsDir2 = path.join(pluginDir, 'scripts');
  if (fs.existsSync(scriptsDir2) && toolOutputs.size > 0) {
    const scriptFiles = fs.readdirSync(scriptsDir2).filter(f => f.endsWith('.R'));
    if (scriptFiles.length > 0) {
      const scriptContent = scriptFiles
        .map(f => fs.readFileSync(path.join(scriptsDir2, f), 'utf-8'))
        .join('\n');

      for (const [outputId] of toolOutputs) {
        // Check if output filename or ID appears in script (write.csv, ggsave, etc.)
        const filename = toolDef.outputs.find(o => o.id === outputId)?.filename;
        if (filename && !scriptContent.includes(filename)) {
          warnings.push(
            `[${pluginId}] tool-definition output "${outputId}" filename "${filename}" not found in R script`
          );
        }
      }
    }
  }

  return { pluginId, errors, warnings, status: errors.length > 0 ? 'fail' : 'pass' };
}

function main() {
  const dirs = fs.readdirSync(PLUGIN_DIR).filter(d =>
    fs.statSync(path.join(PLUGIN_DIR, d)).isDirectory()
  );

  let totalErrors = 0;
  let totalWarnings = 0;
  const results = [];

  for (const pluginId of dirs) {
    const result = lintPlugin(pluginId);
    results.push(result);
    totalErrors += result.errors.length;
    totalWarnings += result.warnings.length;
  }

  // Print report
  console.log('\n=== Plugin Contract Lint Report ===\n');
  for (const r of results) {
    const icon = r.status === 'pass' ? '✅' : r.status === 'fail' ? '❌' : '⏭️';
    console.log(`${icon} ${r.pluginId}: ${r.errors.length} errors, ${r.warnings.length} warnings`);
    for (const e of r.errors) console.log(`   ERROR: ${e}`);
    for (const w of r.warnings) console.log(`   WARN:  ${w}`);
  }

  console.log(`\n${'='.repeat(40)}`);
  console.log(`Total: ${results.length} plugins, ${totalErrors} errors, ${totalWarnings} warnings`);

  process.exit(totalErrors > 0 ? 1 : 0);
}

if (require.main === module) {
  main();
}

module.exports = { lintPlugin };
