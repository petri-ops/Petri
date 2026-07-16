'use strict';

const fs = require('fs');
const path = require('path');

const PLUGIN_SDK_VERSION = 1;
const DIAGNOSTIC_VERSION = 1;
const SOURCE_PRIORITY = { builtin: 10, installed: 20, development: 30 };
const NON_TOOL_TYPES = new Set(['runtime', 'figcode-card', 'figcode-data', 'content-plugin']);
const LANGUAGES = new Set(['r', 'python']);
const ARTIFACT_TYPES = new Set(['plot', 'table', 'text', 'json', 'html', 'file', 'log']);

function diagnostic(code, severity, phase, context = {}) {
  return {
    pluginSdkDiagnosticVersion: DIAGNOSTIC_VERSION,
    code,
    severity,
    phase,
    sourceType: context.sourceType || null,
    pluginId: context.pluginId || null,
    path: context.path || null,
    field: context.field || null,
    message: context.message || code,
    suggestedFix: context.suggestedFix || null,
    recoverable: context.recoverable !== false,
  };
}

function readJson(filePath, context, diagnostics) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    diagnostics.push(
      diagnostic('plugin_json_invalid', 'error', 'parse', {
        ...context,
        path: filePath,
        message: `Cannot parse ${path.basename(filePath)}: ${error.message}`,
        suggestedFix: 'Fix the JSON syntax before registering the plugin.',
      })
    );
    return null;
  }
}

function childPluginDirs(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function installedPluginDirs(root, diagnostics) {
  const installedPath = path.join(root, 'installed.json');
  if (!fs.existsSync(installedPath)) return [];
  const installed = readJson(installedPath, { sourceType: 'installed' }, diagnostics);
  if (!Array.isArray(installed)) {
    diagnostics.push(
      diagnostic('installed_index_invalid', 'error', 'discover', {
        sourceType: 'installed',
        path: installedPath,
        message: 'installed.json must contain an array.',
      })
    );
    return [];
  }
  return installed
    .filter((item) => item && item.id && !NON_TOOL_TYPES.has(item.type))
    .map((item) => ({ dir: path.join(root, item.id), installed: item }));
}

function discoverPluginCandidates({ sources = [] } = {}) {
  const diagnostics = [];
  const candidates = [];

  for (const source of sources) {
    const sourceType = source && source.type;
    const root = source && source.root ? path.resolve(source.root) : null;
    if (!SOURCE_PRIORITY[sourceType]) {
      diagnostics.push(
        diagnostic('plugin_source_type_invalid', 'error', 'discover', {
          sourceType,
          path: root,
          message: `Unsupported plugin source type: ${sourceType || '(missing)'}`,
        })
      );
      continue;
    }
    if (!root || !fs.existsSync(root)) {
      if (source && source.required) {
        diagnostics.push(
          diagnostic('plugin_source_missing', 'error', 'discover', {
            sourceType,
            path: root,
            message: `Plugin source directory does not exist: ${root}`,
          })
        );
      }
      continue;
    }

    const entries =
      sourceType === 'installed'
        ? installedPluginDirs(root, diagnostics)
        : childPluginDirs(root).map((dir) => ({ dir, installed: null }));

    for (const entry of entries) {
      const pluginPath = path.join(entry.dir, 'plugin.json');
      const toolPath = path.join(entry.dir, 'tool-definition.json');
      const fallbackId = entry.installed?.id || path.basename(entry.dir);
      if (!fs.existsSync(pluginPath)) {
        diagnostics.push(
          diagnostic('plugin_manifest_missing', 'error', 'discover', {
            sourceType,
            pluginId: fallbackId,
            path: pluginPath,
            message: 'plugin.json is missing.',
          })
        );
        continue;
      }
      const plugin = readJson(pluginPath, { sourceType, pluginId: fallbackId }, diagnostics);
      if (!plugin) continue;
      if (NON_TOOL_TYPES.has(plugin.type)) continue;
      if (!fs.existsSync(toolPath)) {
        diagnostics.push(
          diagnostic('tool_definition_missing', 'error', 'discover', {
            sourceType,
            pluginId: plugin.id || fallbackId,
            path: toolPath,
            message: 'tool-definition.json is missing.',
          })
        );
        continue;
      }
      const toolDefinition = readJson(
        toolPath,
        {
          sourceType,
          pluginId: plugin.id || fallbackId,
        },
        diagnostics
      );
      if (!toolDefinition) continue;
      candidates.push({
        sourceType,
        sourceRoot: root,
        priority: SOURCE_PRIORITY[sourceType],
        pluginDir: entry.dir,
        pluginPath,
        toolPath,
        plugin: {
          ...plugin,
          pluginDir: entry.dir,
          scriptPath: path.join(entry.dir, 'scripts'),
          _installedFingerprint: entry.installed?.scriptFingerprint || null,
        },
        toolDefinition,
      });
    }
  }

  const selected = new Map();
  for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
    const pluginId =
      candidate.toolDefinition.id || candidate.plugin.id || path.basename(candidate.pluginDir);
    const previous = selected.get(pluginId);
    if (previous) {
      diagnostics.push(
        diagnostic('plugin_source_shadowed', 'warning', 'discover', {
          sourceType: previous.sourceType,
          pluginId,
          path: previous.pluginDir,
          message: `${previous.sourceType} plugin is shadowed by ${candidate.sourceType}.`,
          suggestedFix: 'Remove the duplicate source or change source precedence explicitly.',
        })
      );
    }
    selected.set(pluginId, candidate);
  }

  return {
    pluginSdkVersion: PLUGIN_SDK_VERSION,
    candidates: Array.from(selected.values()).sort((a, b) => {
      const aId = a.toolDefinition.id || a.plugin.id || '';
      const bId = b.toolDefinition.id || b.plugin.id || '';
      return aId.localeCompare(bId);
    }),
    diagnostics,
  };
}

function validateUnique(items, key, label, context, diagnostics) {
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const value = item && item[key];
    if (!value) continue;
    if (seen.has(value)) {
      diagnostics.push(
        diagnostic(`duplicate_${label}`, 'error', 'validate', {
          ...context,
          field: `${label}.${key}`,
          message: `duplicate ${label.replaceAll('_', ' ')} ${key} "${value}"`,
        })
      );
    }
    seen.add(value);
  }
}

function validatePluginCandidate(candidate, normalizeManifest) {
  const diagnostics = [];
  const pluginId = candidate.toolDefinition.id || candidate.plugin.id || null;
  const context = { sourceType: candidate.sourceType, pluginId, path: candidate.pluginDir };
  const manifest = normalizeManifest(candidate.plugin, candidate.toolDefinition);
  const requireField = (condition, code, field, message) => {
    if (!condition)
      diagnostics.push(diagnostic(code, 'error', 'validate', { ...context, field, message }));
  };

  requireField(
    !!manifest,
    'manifest_normalization_failed',
    null,
    'Plugin manifest could not be normalized.'
  );
  if (!manifest) return { ok: false, manifest: null, diagnostics };
  requireField(
    manifest.pluginManifestVersion === 1,
    'manifest_version_unsupported',
    'pluginManifestVersion',
    'pluginManifestVersion must be 1.'
  );
  requireField(
    manifest.id === candidate.plugin.id,
    'plugin_id_mismatch',
    'id',
    'plugin.json and normalized IDs must match.'
  );
  requireField(
    manifest.id === candidate.toolDefinition.id,
    'tool_id_mismatch',
    'id',
    'plugin.json and tool-definition.json IDs must match.'
  );
  requireField(
    typeof manifest.title === 'string' && manifest.title.length > 0,
    'plugin_title_missing',
    'title',
    'title is required.'
  );
  requireField(
    typeof manifest.version === 'string' && manifest.version.length > 0,
    'plugin_version_missing',
    'version',
    'version is required.'
  );
  requireField(
    LANGUAGES.has(manifest.language),
    'plugin_language_invalid',
    'language',
    'language must be r or python.'
  );
  requireField(
    Array.isArray(manifest.supportedPlatforms) && manifest.supportedPlatforms.length > 0,
    'supported_platforms_missing',
    'supportedPlatforms',
    'supportedPlatforms is required.'
  );
  requireField(
    Array.isArray(manifest.inputs) && manifest.inputs.length > 0,
    'plugin_inputs_missing',
    'inputs',
    'At least one input is required.'
  );
  requireField(
    Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0,
    'plugin_artifacts_missing',
    'artifacts',
    'At least one artifact is required.'
  );
  requireField(
    Array.isArray(manifest.failureModes) && manifest.failureModes.length > 0,
    'failure_modes_missing',
    'failureModes',
    'At least one failure mode is required.'
  );

  validateUnique(manifest.inputs, 'id', 'input', context, diagnostics);
  validateUnique(manifest.artifacts, 'id', 'artifact', context, diagnostics);
  validateUnique(
    candidate.toolDefinition.failureModes,
    'code',
    'failure_mode',
    context,
    diagnostics
  );

  for (const input of manifest.inputs || []) {
    requireField(
      typeof input.id === 'string' && input.id.length > 0,
      'input_id_missing',
      'inputs.id',
      'Each input requires an ID.'
    );
    requireField(
      typeof input.type === 'string' && input.type.length > 0,
      'input_type_missing',
      `inputs.${input.id}.type`,
      'Input type is required.'
    );
    if (input.type === 'file')
      requireField(
        typeof input.accept === 'string' && input.accept.length > 0,
        'file_accept_missing',
        `inputs.${input.id}.accept`,
        'File inputs must declare accept.'
      );
  }
  for (const artifact of manifest.artifacts || []) {
    requireField(
      ARTIFACT_TYPES.has(artifact.type),
      'artifact_type_invalid',
      `artifacts.${artifact.id}.type`,
      `Unsupported artifact type: ${artifact.type}`
    );
    requireField(
      typeof artifact.label === 'string' && artifact.label.length > 0,
      'artifact_label_missing',
      `artifacts.${artifact.id}.label`,
      'Artifact label is required.'
    );
  }
  for (const mode of manifest.failureModes || []) {
    requireField(
      typeof mode.code === 'string' && mode.code.length > 0,
      'failure_mode_code_missing',
      'failureModes.code',
      'Failure mode code is required.'
    );
    requireField(
      typeof mode.title === 'string' && mode.title.length > 0,
      'failure_mode_title_missing',
      `failureModes.${mode.code}.title`,
      'Failure mode title is required.'
    );
    requireField(
      typeof mode.suggestedFix === 'string' && mode.suggestedFix.length > 0,
      'failure_mode_fix_missing',
      `failureModes.${mode.code}.suggestedFix`,
      'suggestedFix is required.'
    );
    requireField(
      typeof mode.detect === 'string' && mode.detect.length > 0,
      'failure_mode_detect_missing',
      `failureModes.${mode.code}.detect`,
      'detect is required.'
    );
  }

  const scriptsDir = path.join(candidate.pluginDir, 'scripts');
  const extension = manifest.language === 'r' ? '.R' : '.py';
  const scripts = fs.existsSync(scriptsDir)
    ? fs.readdirSync(scriptsDir).filter((name) => name.endsWith(extension))
    : [];
  requireField(
    scripts.length > 0,
    'plugin_script_missing',
    'execution.scriptPath',
    `A ${extension} script is required.`
  );
  if (scripts.length > 1 && !scripts.includes(`${manifest.id}${extension}`)) {
    diagnostics.push(
      diagnostic('plugin_script_ambiguous', 'error', 'validate', {
        ...context,
        field: 'execution.scriptPath',
        message: `Multiple ${extension} scripts exist and none matches ${manifest.id}${extension}.`,
      })
    );
  }

  return { ok: !diagnostics.some((item) => item.severity === 'error'), manifest, diagnostics };
}

function inspectPluginSources({ sources = [], normalizeManifest } = {}) {
  if (typeof normalizeManifest !== 'function') throw new Error('normalizeManifest is required');
  const discovery = discoverPluginCandidates({ sources });
  const manifests = [];
  const candidates = [];
  const diagnostics = [...discovery.diagnostics];
  for (const candidate of discovery.candidates) {
    const validation = validatePluginCandidate(candidate, normalizeManifest);
    diagnostics.push(...validation.diagnostics);
    candidates.push({ ...candidate, manifest: validation.manifest, valid: validation.ok });
    if (validation.ok) manifests.push(validation.manifest);
  }
  return {
    pluginSdkVersion: PLUGIN_SDK_VERSION,
    ok: !diagnostics.some((item) => item.severity === 'error'),
    candidates,
    manifests,
    diagnostics,
    summary: {
      sourceCount: sources.length,
      candidateCount: candidates.length,
      validCount: manifests.length,
      errorCount: diagnostics.filter((item) => item.severity === 'error').length,
      warningCount: diagnostics.filter((item) => item.severity === 'warning').length,
    },
  };
}

module.exports = {
  PLUGIN_SDK_VERSION,
  DIAGNOSTIC_VERSION,
  SOURCE_PRIORITY,
  discoverPluginCandidates,
  validatePluginCandidate,
  inspectPluginSources,
};
