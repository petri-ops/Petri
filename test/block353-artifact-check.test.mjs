import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'dist', 'mac-arm64', 'Petri.app');
const RES = path.join(APP, 'Contents', 'Resources');

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
