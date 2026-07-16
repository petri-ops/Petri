const path = require('path');

const EXECUTION_CONTEXT_VERSION = 1;

function normalizeSlashPath(value) {
  return (
    String(value || '')
      .replace(/\\/g, '/')
      .replace(/\/+$/, '') || '/'
  );
}

function normalizeExecutionMode({ mode, execMode, runMode } = {}) {
  if (['platform', 'api'].includes(String(runMode || '').toLowerCase())) return 'remote';
  const value = String(mode || execMode || '').toLowerCase();
  if (['docker', 'container'].includes(value)) return 'container';
  if (['remote', 'platform', 'api', 'worker'].includes(value)) return 'remote';
  if (value === 'local') return 'local';
  return 'local';
}

function createPathMapper({ localRoot, canonicalRoot = '/work/biof3' } = {}) {
  const resolvedLocalRoot = localRoot ? path.resolve(String(localRoot)) : null;
  const normalizedLocalRoot = resolvedLocalRoot ? normalizeSlashPath(resolvedLocalRoot) : null;
  const normalizedCanonicalRoot = normalizeSlashPath(canonicalRoot);

  function canonicalize(localPath) {
    if (!localPath) return null;
    const raw = normalizeSlashPath(localPath);
    if (raw === normalizedCanonicalRoot || raw.startsWith(normalizedCanonicalRoot + '/')) {
      return raw;
    }
    const resolved = normalizeSlashPath(path.resolve(String(localPath)));
    if (!normalizedLocalRoot) return resolved;
    if (resolved === normalizedLocalRoot) return normalizedCanonicalRoot;
    if (resolved.startsWith(normalizedLocalRoot + '/')) {
      return normalizeSlashPath(
        path.posix.join(normalizedCanonicalRoot, resolved.slice(normalizedLocalRoot.length + 1))
      );
    }
    return resolved;
  }

  return {
    localRoot: resolvedLocalRoot,
    canonicalRoot: normalizedCanonicalRoot,
    canonicalize,
  };
}

function runtimeReadiness({ runtime, runtimeCommand, runtimeReady } = {}) {
  return (
    runtimeReady ||
    (runtimeCommand
      ? { runtime: runtime || null, ready: true, command: runtimeCommand, reason: null }
      : {
          runtime: runtime || null,
          ready: false,
          command: null,
          reason: 'runtime command unavailable',
        })
  );
}

function createExecutionContext(options = {}) {
  const {
    jobId,
    toolId,
    platform,
    runtime,
    runtimeCommand,
    runtimeReady,
    workDir,
    jobDir,
    executionWorkDir,
    containerWorkDir,
    outputDir,
    resultDir,
    workerId,
    runMode,
    localRoot,
    canonicalRoot,
  } = options;
  const mode = normalizeExecutionMode(options);
  const mapper = createPathMapper({ localRoot, canonicalRoot });
  const localWorkDir = workDir || jobDir || null;
  const targetWorkDir =
    executionWorkDir ||
    (mode === 'local' ? localWorkDir : containerWorkDir || mapper.canonicalize(localWorkDir));
  const context = {
    executionContextVersion: EXECUTION_CONTEXT_VERSION,
    mode,
    adapter: {
      kind: mode,
      runMode: runMode || null,
      workerId: workerId || null,
    },
    platform: platform || null,
    jobId: jobId || null,
    toolId: toolId || null,
    runtime: runtime || null,
    runtimeReady: runtimeReadiness({ runtime, runtimeCommand, runtimeReady }),
    workDir: localWorkDir ? path.resolve(String(localWorkDir)) : null,
    canonicalWorkDir: mapper.canonicalize(localWorkDir),
    executionWorkDir: targetWorkDir ? normalizeSlashPath(targetWorkDir) : null,
  };
  if (outputDir) {
    context.outputDir = path.resolve(String(outputDir));
    context.canonicalOutputDir = mapper.canonicalize(outputDir);
  }
  if (resultDir) {
    context.resultDir = path.resolve(String(resultDir));
    context.canonicalResultDir = mapper.canonicalize(resultDir);
  }
  return { context, canonicalizePath: mapper.canonicalize, mapper };
}

function createTaskExecutionContext(task = {}, config = {}, runtime = null) {
  return createExecutionContext({
    jobId: task.taskId,
    toolId: task.type,
    platform: config.platform || process.platform,
    runtime,
    execMode: config.execMode,
    runMode: config.runMode,
    workerId: task.workerId || config.workerId,
    workDir: task.workDir,
    containerWorkDir: task.containerWorkDir,
    localRoot: config.tempDir,
    canonicalRoot: config.containerTempDir || '/work/biof3/tasks',
    runtimeReady: { runtime, ready: true, command: null, reason: null },
  }).context;
}

function attachExecutionMetadata(result = {}, context) {
  const enriched = { ...result, execution: context };
  const localRoot = context?.resultDir || context?.outputDir || context?.workDir;
  const canonicalRoot =
    context?.canonicalResultDir || context?.canonicalOutputDir || context?.canonicalWorkDir;
  for (const key of ['artifacts', 'outputs', 'files']) {
    if (!Array.isArray(enriched[key])) continue;
    enriched[key] = enriched[key].map((item) => {
      if (!item || typeof item !== 'object') return item;
      const filename = item.filename || item.name || item.path;
      if (!filename) return item;
      const name = path.basename(String(filename));
      return {
        ...item,
        path: item.path || (localRoot ? path.join(localRoot, name) : null),
        canonicalPath:
          item.canonicalPath ||
          (canonicalRoot ? normalizeSlashPath(path.posix.join(canonicalRoot, name)) : null),
      };
    });
  }
  return enriched;
}

module.exports = {
  EXECUTION_CONTEXT_VERSION,
  normalizeSlashPath,
  normalizeExecutionMode,
  createPathMapper,
  createExecutionContext,
  createTaskExecutionContext,
  attachExecutionMetadata,
};
