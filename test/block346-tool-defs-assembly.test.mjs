'use strict';

/**
 * BLOCK-346 T2 — 工具定义汇编完备性契约。
 *
 * 立契背景（2026-11-04，含一次自我纠错）：
 *   矩阵首跑把 `tool-defs/goals.js` 判为「定义存在但未汇编」，据此立了 P1。
 *   实测证伪：`agent-orchestration.js:204` 有 `...require('./goals')`，三个 goal
 *   工具**一直在 TOOL_DEFS 里**（模型可见）。误报根因=审计脚本只扫 facade 的
 *   domainModules，没解析域文件内部的相对 require。
 *
 * 因此本契约不钉「文件必须被 facade 直接引用」（那会与域内 spread 的合法写法冲突），
 * 而钉**真正的不变量**：域目录下每个文件里的每个工具定义，都必须出现在 TOOL_DEFS 中
 * ——既能抓「文件被遗忘」，也能抓「文件被引用但定义没展开」。
 *
 * 注意：不 require registry.js（会连 DB），只用 facade + 各域文件。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const R_SERVER = path.resolve(__dirname, '..', 'core', 'petri-server');
const AGENT_TOOLS = path.join(R_SERVER, 'agent-tools');
const TOOL_DEFS_DIR = path.join(AGENT_TOOLS, 'tool-defs');
const FACADE = path.join(AGENT_TOOLS, 'tool-defs.js');
const require_ = createRequire(import.meta.url);

function loadFacade() {
  return require_(FACADE);
}

function domainFilesOnDisk() {
  return fs.readdirSync(TOOL_DEFS_DIR)
    .filter((f) => f.endsWith('.js'))
    .map((f) => path.basename(f, '.js'))
    .sort();
}

function defsOfDomain(domain) {
  const mod = require_(path.join(TOOL_DEFS_DIR, `${domain}.js`));
  return Array.isArray(mod) ? mod : [];
}

describe('工具定义汇编完备性（BLOCK-346 T2）', () => {
  test('域目录下每个文件的每个工具定义都必须出现在 TOOL_DEFS（防漏汇编）', () => {
    const { TOOL_DEFS } = loadFacade();
    const visible = new Set(TOOL_DEFS.map((t) => t && t.function && t.function.name));
    const missing = [];
    for (const domain of domainFilesOnDisk()) {
      for (const def of defsOfDomain(domain)) {
        const name = def && def.function && def.function.name;
        if (!name) continue;
        if (!visible.has(name)) missing.push(`${domain}:${name}`);
      }
    }
    assert.deepEqual(missing, [], `定义存在但模型看不到（未进 TOOL_DEFS）：${missing.join(', ')}`);
  });

  test('TOOL_DEFS 无重名（防重复汇编，如把含 spread 的域再显式加一遍）', () => {
    const { TOOL_DEFS } = loadFacade();
    const names = TOOL_DEFS.map((t) => t && t.function && t.function.name);
    const dupes = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))];
    assert.deepEqual(dupes, [], `工具名重复：${dupes.join(', ')}`);
  });

  test('facade 的 domainModules 不得引用不存在的域文件', () => {
    const onDisk = domainFilesOnDisk();
    const src = fs.readFileSync(FACADE, 'utf8');
    const declared = [...new Set([...src.matchAll(/require\('\.\/tool-defs\/([\w-]+)'\)/g)].map((m) => m[1]))];
    const dangling = declared.filter((d) => !onDisk.includes(d));
    assert.deepEqual(dangling, [], `domainModules 引用了不存在的域文件：${dangling.join(', ')}`);
  });

  test('每个工具定义都带 name 与 parameters（汇编不产生结构性破坏）', () => {
    const { TOOL_DEFS } = loadFacade();
    assert.ok(Array.isArray(TOOL_DEFS) && TOOL_DEFS.length > 0, 'TOOL_DEFS 为空');
    const noName = TOOL_DEFS.filter((t) => !(t && t.function && t.function.name)).length;
    assert.equal(noName, 0, '存在缺 function.name 的定义');
    const noParams = TOOL_DEFS.filter((t) => !(t.function && t.function.parameters)).map((t) => t.function.name);
    assert.deepEqual(noParams, [], `缺 parameters：${noParams.join(', ')}`);
  });

  test('DOMAIN_TOOL_DEFS 与 TOOL_DEFS 逐引用一致（域映射不漂移）', () => {
    const { TOOL_DEFS, DOMAIN_TOOL_DEFS } = loadFacade();
    const flat = Object.values(DOMAIN_TOOL_DEFS || {}).flat();
    assert.equal(flat.length, TOOL_DEFS.length, 'DOMAIN_TOOL_DEFS 展开长度与 TOOL_DEFS 不一致');
    for (const def of flat) {
      assert.ok(TOOL_DEFS.includes(def), `域映射含 TOOL_DEFS 之外的引用：${def && def.function && def.function.name}`);
    }
  });

  test('goals 三工具模型可见（2026-11-04 误报纠错的回归守卫，保持常绿）', () => {
    const { TOOL_DEFS } = loadFacade();
    const visible = new Set(TOOL_DEFS.map((t) => t && t.function && t.function.name));
    for (const name of ['create_goal', 'get_goal', 'update_goal']) {
      assert.ok(visible.has(name), `${name} 不在 TOOL_DEFS（模型不可见）`);
    }
  });
});
