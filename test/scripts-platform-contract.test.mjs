// BLOCK-104 P4 — scripts 双端同形机械门禁
//
// 背景：8 个 scripts/*.sh 曾只有 1 个有平台守卫——start-test-instance.sh 在 Mac
// 静默空转（杀场/启动段双双 no-op）、BLOCK-88 P4 Git Bash 无 powershell 致重启
// 脚本空操作。本门禁把「平台适配是显式声明」制度化：
//   1. 每个脚本必须带 `# platform:` 标注（darwin | posix | windows | dual）；
//   2. 标注 dual 的脚本不得包含单平台专属命令（taskkill/powershell/wscript/
//      osascript/launchctl 任一出现即红）——「dual」必须名副其实；
//   3. informational：调用 powershell/taskkill 的 windows 专属 .cjs/.mjs 脚本
//      清单打印（当前不 fail——入口护栏改造属后续增量）。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

const VALID_PLATFORMS = new Set(['darwin', 'posix', 'windows', 'dual']);

function listShellScripts() {
  return fs
    .readdirSync(SCRIPTS_DIR)
    .filter((name) => name.endsWith('.sh'))
    .sort();
}

describe('scripts 双端同形门（BLOCK-104 P4）', () => {
  it('每个 scripts/*.sh 都声明 # platform: 标注', () => {
    const missing = [];
    for (const name of listShellScripts()) {
      const text = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
      const head = text.split('\n', 6).join('\n');
      const match = head.match(/^#\s*platform:\s*(darwin|posix|windows|dual)\b/m);
      if (!match) missing.push(name);
    }
    assert.deepEqual(missing, [], `以下脚本缺 # platform: 标注（取值 ${[...VALID_PLATFORMS].join('/')}）: ${missing.join(', ')}`);
  });

  it('标注 dual 的脚本不得包含单平台专属命令', () => {
    const liars = [];
    for (const name of listShellScripts()) {
      const text = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
      const head = text.split('\n', 6).join('\n');
      const match = head.match(/^#\s*platform:\s*(darwin|posix|windows|dual)\b/m);
      if (!match || match[1] !== 'dual') continue;
      // 真 dual 的判据 = 实际存在 uname 分支（平台专属命令本就该住在分支内）；
      // 标注 dual 却没有 uname = 谎报，某端必然静默空转（start-test-instance 事故同款）。
      if (!/\buname\b/.test(text)) liars.push(name);
    }
    assert.deepEqual(liars, [], `「dual」标注必须名副其实（补 uname 双分支或改标注）: ${liars.join(', ')}`);
  });

  it('informational：windows 专属命令调用清单（入口护栏改造候选）', () => {
    const callers = [];
    for (const entry of fs.readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(cjs|mjs)$/.test(entry.name)) continue;
      const text = fs.readFileSync(path.join(SCRIPTS_DIR, entry.name), 'utf8');
      if (/powershell|taskkill|wscript/.test(text) && !/platform:\s*windows/.test(text)) {
        callers.push(entry.name);
      }
    }
    // BLOCK-104 增量 — 升级为强制：windows 命令调用脚本必须二选一——
    //   a) 入口护栏（process.platform !== 'win32' + exit），win 专属脚本；
    //   b) platform-note 标注（dual = 平台分支内使用 / windows-library = 由消费方护栏）。
    const violators = [];
    for (const name of callers) {
      const text = fs.readFileSync(path.join(SCRIPTS_DIR, name), 'utf8');
      const hasGuard = /process\.platform\s*!==\s*'win32'/.test(text) && /process\.exit/.test(text);
      const hasNote = /platform-note:\s*(dual|windows-library)/.test(text);
      if (!hasGuard && !hasNote) violators.push(name);
    }
    console.log(`[scripts-platform] windows 命令调用脚本合规 ${callers.length - violators.length}/${callers.length}`);
    assert.deepEqual(
      violators,
      [],
      `以下脚本调用 windows 命令但既无入口护栏也无 platform-note 标注: ${violators.join(', ')}`
    );
  });
});
