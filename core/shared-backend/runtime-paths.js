const fs = require('fs');
const path = require('path');

function getRuntimeBinName(lang, platform = process.platform) {
  // Mirrors platform-compat.getRuntimeBinName — keep the two in sync.
  // On Windows the embedded R/Python ship as `Rscript.exe` / `python.exe`;
  // the suffix is required because existsSync() does not auto-resolve
  // extensionless names the way the shell's PATHEXT does.
  if (lang === 'r') return platform === 'win32' ? 'Rscript.exe' : 'Rscript';
  return platform === 'win32' ? 'python.exe' : 'python3';
}

function getPythonExecutableCandidates(platform = process.platform) {
  // Must stay in sync with platform-compat.getRuntimeBinCandidates for win32.
  // Covers the Store shim, python3.x aliases, and the `py.exe` launcher so a
  // user-installed Runtime dir (userData/runtimes/Python) is recognised across
  // Python 3.11–3.13 installs.
  return platform === 'win32'
    ? ['python.exe', 'python3.exe', 'python3.11.exe', 'python3.12.exe', 'python3.13.exe', 'py.exe']
    : ['python3', 'python'];
}

function getPythonRuntimeExecutable(runtimeHome, platform = process.platform) {
  if (!runtimeHome) return null;
  // Framework-style Python homes can contain a root-level `python` Mach-O
  // dylib with executable permission. It is not process-spawnable (ENOEXEC),
  // so prefer the actual launchers under bin/Scripts before legacy flat trees.
  const searchDirs = [path.join(runtimeHome, 'bin'), path.join(runtimeHome, 'Scripts'), runtimeHome];
  const candidates = getPythonExecutableCandidates(platform);
  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of candidates) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

function findExecutableOnPath(names, envPath = process.env.PATH || '') {
  const candidates = Array.isArray(names) ? names : [names];
  for (const dir of String(envPath).split(path.delimiter).filter(Boolean)) {
    for (const name of candidates) {
      const full = path.join(dir, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch {}
    }
  }
  return null;
}

function getPythonSitePackagesDir(runtimeHome) {
  if (!runtimeHome) return null;
  const candidates = [path.join(runtimeHome, 'Lib', 'site-packages'), path.join(runtimeHome, 'site-packages')];

  const libDir = path.join(runtimeHome, 'lib');
  if (fs.existsSync(libDir)) {
    try {
      for (const entry of fs.readdirSync(libDir, { withFileTypes: true })) {
        if (entry.isDirectory() && /^python\d+(?:\.\d+)?$/i.test(entry.name)) {
          candidates.push(path.join(libDir, entry.name, 'site-packages'));
        }
      }
    } catch {}
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

module.exports = {
  getRuntimeBinName,
  getPythonExecutableCandidates,
  getPythonRuntimeExecutable,
  getPythonSitePackagesDir,
  findExecutableOnPath,
};
