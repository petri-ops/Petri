'use strict';

/**
 * test/helpers/bash-resolver.cjs — BLOCK-512 P2（AUDIT-LOG 🟡 2026-10-20 根治项测试侧）。
 *
 * Windows 指挥席常见形态：PATH 里的 `bash` 解析到 WSL launcher
 * （`C:\...\WindowsApps\bash.exe`），它会把 `C:\Users\...` 脚本路径读成
 * `C:UsersAdmin...`（反斜杠被吃）→ No such file or directory → 整类测试假红。
 *
 * 处置（对齐工程通则「能自动完成的不让用户手动重试」）：
 *  1. PATH 解析到 WSL launcher 时，先尝试标准安装位的**显式 Git Bash 路径**
 *     （C:\Program Files\Git\bin\bash.exe 等），命中即用显式路径——零人工；
 *  2. 找不到 Git Bash → 返回带原因的 `ok:false`，调用方 `t.skip(reason)`——
 *     假红变**诚实 skip**（原因里带 PATH 前置口令，AUDIT-LOG 2026-10-20 条）。
 *
 * 检测逻辑全部可注入（platform/whichFn/existsFn），由 test/block512-bash-resolver.test.mjs
 * 钉住；macOS / 正常 Git Bash 环境行为不变（本机全绿为证据，Windows 实机验证属外部
 * 环境、如实登记不可达）。
 */

const { execFileSync } = require('node:child_process');

const GIT_BASH_ROOTS = [
  'C:\\Program Files\\Git',
  'C:\\Program Files (x86)\\Git',
];

function defaultWhich(name, platform) {
  const cmd = platform === 'win32' ? 'where' : 'which';
  try {
    const out = execFileSync(cmd, [name], { encoding: 'utf8' });
    const first = String(out).split(/\r?\n/).map((l) => l.trim()).filter(Boolean)[0];
    return first || null;
  } catch {
    return null;
  }
}

function isWslLauncherPath(resolved) {
  return /WindowsApps/i.test(String(resolved || ''));
}

function findGitBashTool(relPath, { platform, existsFn } = {}) {
  if (platform !== 'win32') return null;
  for (const root of GIT_BASH_ROOTS) {
    const candidate = `${root}\\${relPath}`;
    if (existsFn(candidate)) return candidate;
  }
  return null;
}

/**
 * 解析可用的 bash。
 * @returns {{ok:true, bashPath:string, note?:string} | {ok:false, reason:string}}
 */
function checkBash(deps = {}) {
  const platform = deps.platform || process.platform;
  const whichFn = deps.whichFn || ((name) => defaultWhich(name, platform));
  const existsFn = deps.existsFn || ((p) => {
    try { return require('node:fs').statSync(p).isFile(); } catch { return false; }
  });

  const resolved = whichFn('bash');
  if (!resolved) return { ok: false, reason: '测试前置缺失：PATH 上没有 bash（Windows 指挥席需 Git Bash，见 AUDIT-LOG 2026-10-20）' };
  if (platform === 'win32' && isWslLauncherPath(resolved)) {
    const explicit = findGitBashTool('bin\\bash.exe', { platform, existsFn });
    if (explicit) {
      return { ok: true, bashPath: explicit, note: `PATH bash 是 WSL launcher（${resolved}），已改用显式 Git Bash：${explicit}` };
    }
    return {
      ok: false,
      reason: `bash 解析到 WSL launcher（${resolved}）：它会把脚本路径读成 C:Users... 致整类假红（AUDIT-LOG 2026-10-20）。修复：跑测试前把 Git Bash 前置 PATH（PowerShell：$env:PATH="D:\\Program Files\\Git\\bin;"+$env:PATH）`,
    };
  }
  return { ok: true, bashPath: resolved };
}

module.exports = { checkBash, isWslLauncherPath, findGitBashTool, GIT_BASH_ROOTS };
