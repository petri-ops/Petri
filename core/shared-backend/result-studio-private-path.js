'use strict';

const fs = require('fs');
const path = require('path');

class ResultStudioPrivatePathError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'ResultStudioPrivatePathError';
    this.code = code;
    this.detail = detail;
  }
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function privatePathError(code, message, detail = null) {
  throw new ResultStudioPrivatePathError(code, message, detail);
}

function safeComponent(value) {
  const component = String(value == null ? '' : value);
  if (!component || component === '.' || component === '..'
      || component.includes('/') || component.includes('\\') || component.includes('\0')) {
    privatePathError(
      'private_path_component_invalid',
      'Result Studio private path contains an invalid component.',
      { component },
    );
  }
  return component;
}

function resolveWorkspaceAnchor(workspaceRoot) {
  let anchor;
  try {
    anchor = fs.realpathSync(path.resolve(String(workspaceRoot || '')));
  } catch (error) {
    privatePathError(
      'private_workspace_missing',
      'Result Studio workspace is unavailable.',
      { causeCode: error?.code || 'realpath_failed' },
    );
  }
  let stat;
  try {
    stat = fs.statSync(anchor);
  } catch (error) {
    privatePathError(
      'private_workspace_missing',
      'Result Studio workspace is unavailable.',
      { causeCode: error?.code || 'stat_failed' },
    );
  }
  if (!stat.isDirectory()) {
    privatePathError('private_workspace_not_directory', 'Result Studio workspace is not a directory.');
  }
  return anchor;
}

function inspectDirectoryComponent(anchor, parent, component, { create = false } = {}) {
  const name = safeComponent(component);
  const candidate = path.join(parent, name);
  if (!isContained(anchor, candidate) || !isContained(parent, candidate)) {
    privatePathError('private_path_escape', 'Result Studio private directory escaped its workspace anchor.');
  }

  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      privatePathError(
        'private_path_unavailable',
        'Result Studio private directory could not be inspected.',
        { component: name, causeCode: error?.code || 'lstat_failed' },
      );
    }
    if (!create) return null;
    try {
      // Deliberately avoid recursive mkdir: every component is created and
      // inspected independently so an existing link cannot be traversed.
      fs.mkdirSync(candidate);
    } catch (mkdirError) {
      if (mkdirError?.code !== 'EEXIST') {
        privatePathError(
          'private_path_create_failed',
          'Result Studio private directory could not be created.',
          { component: name, causeCode: mkdirError?.code || 'mkdir_failed' },
        );
      }
    }
    try {
      stat = fs.lstatSync(candidate);
    } catch (lstatError) {
      privatePathError(
        'private_path_create_failed',
        'Result Studio private directory could not be verified after creation.',
        { component: name, causeCode: lstatError?.code || 'lstat_failed' },
      );
    }
  }

  if (stat.isSymbolicLink()) {
    privatePathError(
      'private_path_symlink',
      'Result Studio private directories must not be symbolic links.',
      { component: name },
    );
  }
  if (!stat.isDirectory()) {
    privatePathError(
      'private_path_not_directory',
      'Result Studio private path component is not a directory.',
      { component: name },
    );
  }

  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    privatePathError(
      'private_path_unavailable',
      'Result Studio private directory could not be canonicalized.',
      { component: name, causeCode: error?.code || 'realpath_failed' },
    );
  }
  if (!isContained(anchor, canonical) || !isContained(parent, canonical)) {
    privatePathError(
      'private_path_escape',
      'Result Studio private directory escaped its canonical workspace anchor.',
      { component: name },
    );
  }
  return canonical;
}

function resolvePrivateDirectory(workspaceRoot, components, { create = false, allowMissing = false } = {}) {
  const anchor = resolveWorkspaceAnchor(workspaceRoot);
  if (!Array.isArray(components) || components.length === 0 || components[0] !== '.biof3') {
    privatePathError('private_path_component_invalid', 'Result Studio private paths must start at .biof3.');
  }
  let current = anchor;
  for (const component of components) {
    const inspected = inspectDirectoryComponent(anchor, current, component, { create });
    if (!inspected) {
      if (allowMissing) return null;
      privatePathError(
        'private_path_missing',
        'Result Studio private directory is missing.',
        { component: String(component) },
      );
    }
    current = inspected;
  }
  return current;
}

function ensurePrivateDirectory(workspaceRoot, components) {
  return resolvePrivateDirectory(workspaceRoot, components, { create: true });
}

function inspectPrivateDirectory(workspaceRoot, components, { allowMissing = false } = {}) {
  return resolvePrivateDirectory(workspaceRoot, components, { create: false, allowMissing });
}

function inspectPrivateEntry(
  workspaceRoot,
  components,
  { allowMissing = false, kind = 'any' } = {},
) {
  if (!Array.isArray(components) || components.length < 2 || components[0] !== '.biof3') {
    privatePathError('private_path_component_invalid', 'Result Studio private entry is invalid.');
  }
  const anchor = resolveWorkspaceAnchor(workspaceRoot);
  const parent = resolvePrivateDirectory(anchor, components.slice(0, -1));
  const leaf = safeComponent(components.at(-1));
  const candidate = path.join(parent, leaf);
  if (!isContained(anchor, candidate) || !isContained(parent, candidate)) {
    privatePathError('private_path_escape', 'Result Studio private entry escaped its workspace anchor.');
  }
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code === 'ENOENT' && allowMissing) return null;
    privatePathError(
      error?.code === 'ENOENT' ? 'private_path_missing' : 'private_path_unavailable',
      error?.code === 'ENOENT'
        ? 'Result Studio private entry is missing.'
        : 'Result Studio private entry could not be inspected.',
      { component: leaf, causeCode: error?.code || 'lstat_failed' },
    );
  }
  if (stat.isSymbolicLink()) {
    privatePathError(
      'private_path_symlink',
      'Result Studio private entries must not be symbolic links.',
      { component: leaf },
    );
  }
  if (kind === 'directory' && !stat.isDirectory()) {
    privatePathError('private_path_not_directory', 'Result Studio private entry is not a directory.', { component: leaf });
  }
  if (kind === 'file' && !stat.isFile()) {
    privatePathError('private_path_not_file', 'Result Studio private entry is not a regular file.', { component: leaf });
  }
  let canonical;
  try {
    canonical = fs.realpathSync(candidate);
  } catch (error) {
    privatePathError(
      'private_path_unavailable',
      'Result Studio private entry could not be canonicalized.',
      { component: leaf, causeCode: error?.code || 'realpath_failed' },
    );
  }
  if (!isContained(anchor, canonical) || !isContained(parent, canonical)) {
    privatePathError('private_path_escape', 'Result Studio private entry escaped its canonical workspace anchor.');
  }
  return { workspaceRoot: anchor, parent, path: canonical, stat };
}

function createPrivateFileExclusiveSync(workspaceRoot, components, data) {
  if (!Array.isArray(components) || components.length < 2) {
    privatePathError('private_path_component_invalid', 'Result Studio private file path is invalid.');
  }
  const anchor = resolveWorkspaceAnchor(workspaceRoot);
  const parent = resolvePrivateDirectory(anchor, components.slice(0, -1));
  const leaf = safeComponent(components.at(-1));
  const target = path.join(parent, leaf);
  if (!isContained(anchor, target) || !isContained(parent, target)) {
    privatePathError('private_path_escape', 'Result Studio private file escaped its workspace anchor.');
  }
  const noFollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
  let handle;
  try {
    handle = fs.openSync(
      target,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | noFollow,
      0o600,
    );
    fs.writeFileSync(handle, data);
  } catch (error) {
    privatePathError(
      error?.code === 'EEXIST' || error?.code === 'ELOOP'
        ? 'private_path_symlink_or_exists'
        : 'private_file_create_failed',
      'Result Studio private file could not be created exclusively.',
      { component: leaf, causeCode: error?.code || 'open_failed' },
    );
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
  }
  return inspectPrivateEntry(anchor, components, { kind: 'file' }).path;
}

function renamePrivateEntrySync(workspaceRoot, fromComponents, toComponents, { kind = 'any' } = {}) {
  const anchor = resolveWorkspaceAnchor(workspaceRoot);
  const source = inspectPrivateEntry(anchor, fromComponents, { kind });
  const targetParent = resolvePrivateDirectory(anchor, toComponents.slice(0, -1));
  const targetLeaf = safeComponent(toComponents.at(-1));
  const target = path.join(targetParent, targetLeaf);
  if (!isContained(anchor, target) || !isContained(targetParent, target)) {
    privatePathError('private_path_escape', 'Result Studio private rename target escaped its workspace anchor.');
  }
  if (inspectPrivateEntry(anchor, toComponents, { allowMissing: true }) !== null) {
    privatePathError('private_path_exists', 'Result Studio private rename target already exists.');
  }
  // Re-read both the source and destination parent immediately before the
  // mutation; callers must not rely on an earlier planning-time inspection.
  const currentSource = inspectPrivateEntry(anchor, fromComponents, { kind });
  const currentTargetParent = resolvePrivateDirectory(anchor, toComponents.slice(0, -1));
  if (currentSource.stat.dev !== source.stat.dev || currentSource.stat.ino !== source.stat.ino
      || currentTargetParent !== targetParent) {
    privatePathError('private_path_changed', 'Result Studio private path changed before rename.');
  }
  fs.renameSync(currentSource.path, target);
  return inspectPrivateEntry(anchor, toComponents, { kind }).path;
}

function renamePrivateDirectorySync(workspaceRoot, fromComponents, toComponents) {
  return renamePrivateEntrySync(workspaceRoot, fromComponents, toComponents, { kind: 'directory' });
}

function removePrivatePathSync(
  workspaceRoot,
  components,
  { recursive = false, force = false, kind = 'any' } = {},
) {
  const anchor = resolveWorkspaceAnchor(workspaceRoot);
  const inspected = inspectPrivateEntry(anchor, components, { allowMissing: force, kind });
  if (!inspected) return false;
  const current = inspectPrivateEntry(anchor, components, { kind });
  if (current.stat.dev !== inspected.stat.dev || current.stat.ino !== inspected.stat.ino) {
    privatePathError('private_path_changed', 'Result Studio private path changed before deletion.');
  }
  fs.rmSync(current.path, { recursive, force: false });
  return true;
}

module.exports = {
  ResultStudioPrivatePathError,
  resolveWorkspaceAnchor,
  ensurePrivateDirectory,
  inspectPrivateDirectory,
  inspectPrivateEntry,
  createPrivateFileExclusiveSync,
  renamePrivateEntrySync,
  renamePrivateDirectorySync,
  removePrivatePathSync,
};
