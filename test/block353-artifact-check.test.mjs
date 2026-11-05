import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'dist', 'mac-arm64', 'Petri.app');
const RES = path.join(APP, 'Contents', 'Resources');
const HELPER = path.join(APP, 'Contents', 'Frameworks', 'Petri Helper.app', 'Contents', 'MacOS', 'Petri Helper');

// BLOCK-353 §5：产物必需路径存在性（构建后跑；dist 缺席=skip 如实登记）
const appBuilt = fs.existsSync(APP);

test('block353 产物结构：App/Helper/asar/native 模块/extraResources 必需路径', { skip: appBuilt ? false : 'dist/mac-arm64/Petri.app 不存在（先 npm run build:mac-arm64）' }, () => {
  const must = [
    'Contents/MacOS/Petri',
    'Contents/Frameworks/Electron Framework.framework',
    'Contents/Resources/app.asar',
    // native 模块（打包 Core 实际加载的 Electron-ABI 副本——布局随 afterPack 源状态：
    // 有的构建在 Resources 顶层另有副本，此处的 core 内副本为后端 require 的真实解算点）
    'Contents/Resources/core/petri-server/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    // extraResources（BLOCK-353 修复后必须包含 src/——打包后端 ../../src/main 相对 require 的解算点）
    'Contents/Resources/core/petri-server/server.js',
    'Contents/Resources/core/petri-server/node_modules/better-sqlite3',
    'Contents/Resources/core/shared-backend',
    'Contents/Resources/frontend/dist/index.html',
    'Contents/Resources/skills/coding-playbook/skill.json',
    'Contents/Resources/src/main/env-coordinator.js',
    'Contents/Resources/src/main/backend-proc-manager.js',
    // C-48：core 侧独有依赖（multer/busboy）必须并进解出树，否则 Files/Knowledge
    // 路由在打包态 fail-open 丢失（dev 侧这些包是存在的）。
    'Contents/Resources/node_modules/multer/package.json',
    'Contents/Resources/node_modules/busboy/package.json',
  ];
  for (const rel of must) {
    assert.ok(fs.existsSync(path.join(APP, rel)), `产物缺必需路径：${rel}`);
  }
});

test('block353 结构事实：构建主题记录 sourceCommit 与 g0 基线在场', { skip: appBuilt ? false : 'dist 不存在' }, () => {
  const subject = JSON.parse(fs.readFileSync(path.join(RES, 'g0-build-subject.json'), 'utf8'));
  assert.ok(subject.sourceCommit, 'g0-build-subject 缺 sourceCommit');
  assert.match(subject.sourceCommit, /^[0-9a-f]{40}$/, 'sourceCommit 非全量 sha');
});

test('block353 打包契约回归：主图（src/main + src 根模块 + ipc/plugin/database）不得保留静态 core 相对 require（C-48 根因类）', () => {
  const roots = ['src/main', 'src/ipc', 'src/plugin', 'src/database', 'src/telemetry-funnel.js', 'src/pack-lifecycle.js', 'src/plugin-manager.js'];
  const offenders = [];
  const scan = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) scan(full);
      else if (/\.js$/.test(e.name)) {
        const src = fs.readFileSync(full, 'utf8');
        for (const m of src.matchAll(/require\(['"](\.\.\/)+(?:core|packages)\//g)) {
          offenders.push(`${path.relative(ROOT, full)} :: ${m[0]}`);
        }
      }
    }
  };
  for (const r of roots) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) scan(abs);
    else if (fs.existsSync(abs)) {
      const src = fs.readFileSync(abs, 'utf8');
      for (const m of src.matchAll(/require\(['"](\.\.\/)+(?:core|packages)\//g)) offenders.push(`${r} :: ${m[0]}`);
    }
  }
  // 白名单：env-coordinator 的 _requireCore 兜底（try 相对 → catch resourcesPath，双态正确）
  const filtered = offenders.filter((o) => !o.includes('env-coordinator'));
  assert.deepEqual(filtered, [], `静态 core 相对 require 必须路由 resolveCore/兜底 helper：${filtered.join('；')}`);
});

// C-48 ③ / BLOCK-353 同类第二次：better-sqlite3 ABI 漂移会让打包后端 boot 崩，
// supervisor 30s 无限重启，GUI 侧表现为「窗口在、后端一直不起」且不报错。
// 机械判据 = 用产物内 Electron Helper 实测 dlopen，不靠文件哈希/时间戳猜 ABI。
test('block353 产物 ABI：后端 better-sqlite3 必须能被打包 Electron Helper 加载', {
  skip: appBuilt && fs.existsSync(HELPER) ? false : 'dist 或非 macOS 产物（ABI 实测不适用）',
}, () => {
  // 必须直接 require .node：require('better-sqlite3') 只加载 JS 壳，
  // addon 在 new Database() 内才 dlopen，会造出「测试绿 / 后端崩」的假绿。
  const nativeBinary = path.join(RES, 'core', 'petri-server', 'node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node');
  assert.ok(fs.existsSync(nativeBinary), `产物缺 better-sqlite3 原生二进制：${nativeBinary}`);
  try {
    execFileSync(HELPER, ['-e', `require(${JSON.stringify(nativeBinary)})`], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 20000,
    });
  } catch (e) {
    assert.fail(
      `打包后端 better-sqlite3 与打包 Electron ABI 不一致（ERR_DLOPEN_FAILED → 后端 boot 崩 + 无限重启）。`
      + `先跑 npx electron-builder install-app-deps 再构建：${String(e.stderr || e.message).slice(0, 500)}`,
    );
  }
});
