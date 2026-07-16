const fs = require('fs');
const path = require('path');

function getPythonExecutableCandidates(platform = process.platform) {
  return platform === 'win32'
    ? ['python.exe', 'python3.exe', 'python3.11.exe']
    : ['python3', 'python'];
}

function getPythonRuntimeExecutable(runtimeHome, platform = process.platform) {
  if (!runtimeHome) return null;
  const searchDirs = [runtimeHome, path.join(runtimeHome, 'bin'), path.join(runtimeHome, 'Scripts')];
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
  getPythonExecutableCandidates,
  getPythonRuntimeExecutable,
  getPythonSitePackagesDir,
};
