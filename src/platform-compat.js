function getNodeLocator(platform = process.platform) {
  return platform === 'win32' ? 'where' : 'which';
}

function getRuntimeBinCandidates(lang, platform = process.platform) {
  if (lang === 'r') {
    return platform === 'win32' ? ['Rscript.exe'] : ['Rscript', 'Rscript.exe'];
  }
  return platform === 'win32'
    ? ['python.exe', 'python3.exe', 'python3.11.exe']
    : ['python3', 'python'];
}

function getRuntimeBinName(lang, platform = process.platform) {
  if (lang === 'r') return platform === 'win32' ? 'Rscript.exe' : 'Rscript';
  return platform === 'win32' ? 'python.exe' : 'python3';
}

function getOpenShellPlan(cwd, platform = process.platform) {
  if (platform === 'darwin') {
    const escaped = cwd.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return {
      type: 'osascript',
      command: 'osascript',
      args: ['-e', `tell application "Terminal" to do script "cd \\"${escaped}\\"; clear"`],
      detached: true,
      stdio: 'ignore',
    };
  }
  if (platform === 'win32') {
    return {
      type: 'cmd',
      command: 'cmd.exe',
      args: ['/c', 'start', 'cmd', '/k', `cd /d "${cwd}"`],
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    };
  }
  return {
    type: 'terminal',
    candidates: ['x-terminal-emulator', 'gnome-terminal', 'konsole', 'xfce4-terminal'],
    args: ['--working-directory', cwd],
    detached: true,
    stdio: 'ignore',
  };
}

function getSessionShellSpec(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    return { shellPath: env.COMSPEC || 'cmd.exe', args: [] };
  }
  if (platform === 'darwin') {
    return { shellPath: env.SHELL || '/bin/zsh', args: ['-l'] };
  }
  return { shellPath: env.SHELL || '/bin/bash', args: ['-l'] };
}

module.exports = {
  getNodeLocator,
  getRuntimeBinCandidates,
  getRuntimeBinName,
  getOpenShellPlan,
  getSessionShellSpec,
};
