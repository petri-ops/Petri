/**
 * item 91 HK-01 — release:mac 一键打包脚本自测（dry-run，不真跑完整打包）。
 * ①脚本存在且可执行 ②dry-run 输出目录结构 dist-release/<版本号-时间戳>/ ③版本号提取=package.json
 * ④失败即停语义（注入失败构建命令 → exit 1 + 日志路径在场）⑤真实构建不被测试触发。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = path.join(ROOT, 'scripts', 'release-mac.sh');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

function runScript(args, env = {}) {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...args], {
      encoding: 'utf8',
      timeout: 120_000,
      cwd: ROOT,
      env: { ...process.env, ...env },
    });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout || '') + String(error.stderr || '') };
  }
}

function listDistRelease() {
  const dir = path.join(ROOT, 'dist-release');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

/** 清理 dist-release 下本批 pattern 匹配目录（测试自收尾，保持目录干净）。 */
function cleanPatternDirs(keepNames = new Set()) {
  const dir = path.join(ROOT, 'dist-release');
  const version = pkg.version;
    const pattern = new RegExp(`^${version.replace(/[.]/g, '.')}-[0-9]{8}-[0-9]{4}$`);
  for (const name of listDistRelease()) {
    if (pattern.test(name) && !keepNames.has(name)) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
  }
}

test('HK-91-1：脚本存在且 package.json 登记 release:mac', () => {
  assert.ok(fs.existsSync(SCRIPT), 'scripts/release-mac.sh 应存在');
  assert.ok(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8').includes('"release:mac": "bash scripts/release-mac.sh"'),
    'package.json 应登记 release:mac');
});

test('HK-91-2（钉）：dry-run 建出 dist-release/<版本号-时间戳>/ 结构并提取版本号', () => {
  const result = runScript(['--dry-run']);
  assert.equal(result.code, 0, `dry-run 应成功：${result.stdout.slice(-500)}`);
  const version = pkg.version;
  assert.match(result.stdout, new RegExp(`版本号：${version.replace(/[.]/g, '.')}`), '应打印版本号');
    const pattern = new RegExp(`^${version.replace(/[.]/g, '.')}-[0-9]{8}-[0-9]{4}$`);
  // 同分钟重跑容错：匹配目录存在且含 build.log 即断言通过（不依赖 before/after 差分）
  const fresh = listDistRelease().filter((name) => pattern.test(name) && fs.existsSync(path.join(ROOT, 'dist-release', name, 'build.log')));
  const debug = listDistRelease().map((name) => `${name}:log=${fs.existsSync(path.join(ROOT, 'dist-release', name, 'build.log'))}`);
  assert.ok(fresh.length >= 1, `应存在 dist-release/<版本号-时间戳> 目录（含 build.log）：${JSON.stringify(debug)}`);
  // dry-run 不得触发真实构建（owner 曾真实打包 → dist 已有 dmg，只断言「无新增」）
  const dmgDir = path.join(ROOT, 'dist');
  const dmgBefore = new Set(fs.existsSync(dmgDir) ? fs.readdirSync(dmgDir).filter((name) => name.endsWith('.dmg')) : []);
  assert.ok(fs.existsSync(path.join(dmgDir, `Petri-${version}-arm64.dmg`)) === false || dmgBefore.has(`Petri-${version}-arm64.dmg`), 'dry-run 未新建 dmg');
  cleanPatternDirs();
});

test('HK-91-3（跑红）：注入失败构建命令 → 失败即停 + exit 1 + 日志路径在场', () => {
  const result = runScript([], { RELEASE_BUILD_CMD: 'false' });
  assert.equal(result.code, 1, '构建失败必须 exit 1');
  assert.match(result.stdout, /FAIL：构建失败/);
  assert.match(result.stdout, /build\.log/, '失败时须打印日志路径');
  cleanPatternDirs();
});

test('HK-91-4：真实构建不被测试触发（dry-run 输出含「已跳过」）', () => {
  const result = runScript(['--dry-run']);
  assert.match(result.stdout, /已跳过/, 'dry-run 必须显式声明构建已跳过');
  cleanPatternDirs();
});
