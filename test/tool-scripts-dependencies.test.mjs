/**
 * tool-scripts-dependencies.test.mjs — BLOCK-58 门禁
 *
 * ① 静态断言：7 个内置 R 工具脚本零 install.packages（执行路径零联网安装）
 * ② 一致性校验：_dependencies.json（tools.packages ∪ runtimeProvided）覆盖
 *    全部脚本的 library()/requireNamespace() 引用（防清单与脚本漂移）
 * ③ checkToolDependencies：缺包清单 / 全就位放行 / 清单外脚本放行（checked:false）
 * ④ missingPackagesMessage 可行动指引文案
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SCRIPTS_DIR = path.join(ROOT, 'core', 'biof3-server', 'tool-scripts');

const R_TOOLS = [
  'consensus-cluster',
  'mo-snf',
  'shap-explain',
  'ml-classifier',
  'rsf-survival',
  'mo-mofa',
  'ml-feature-select',
];

// R base + recommended（随 R 分发，不依赖清单管）
const R_BASE_PACKAGES = new Set(['stats', 'utils', 'grDevices', 'graphics', 'methods', 'MASS', 'lattice', 'Matrix', 'nlme', 'nnet', 'spatial', 'splines']);

test('① 内置 R 工具脚本零 install.packages（执行路径零联网）', () => {
  for (const tool of R_TOOLS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, `${tool}.R`), 'utf-8');
    assert.ok(!src.includes('install.packages'), `${tool}.R 仍含 install.packages`);
    assert.ok(!src.includes('BiocManager::install'), `${tool}.R 仍含 BiocManager::install`);
  }
});

test('② _dependencies.json 覆盖全部脚本依赖引用（无漂移）', () => {
  const deps = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, '_dependencies.json'), 'utf-8'));
  const declared = new Set(Object.keys(deps.tools || {}).flatMap((id) => Object.keys(deps.tools[id].packages || {})));
  for (const pkg of deps.runtimeProvided || []) declared.add(pkg);

  for (const tool of R_TOOLS) {
    const src = fs.readFileSync(path.join(SCRIPTS_DIR, `${tool}.R`), 'utf-8');
    const refs = new Set();
    for (const m of src.matchAll(/(?:suppressMessages\(\s*)?(?:library|require)\(([A-Za-z0-9.]+)\s*\)/g)) {
      refs.add(m[1]);
    }
    for (const m of src.matchAll(/requireNamespace\("([A-Za-z0-9.]+)"/g)) {
      refs.add(m[1]);
    }
    // requireNamespace 在 fail-fast 段里引用 need_pkgs（vapply 形式不带字面量），无需特判
    for (const ref of refs) {
      if (R_BASE_PACKAGES.has(ref)) continue;
      if (ref === 'BiocManager') continue; // 安装器，脚本内已无其 install 调用
      assert.ok(
        declared.has(ref),
        `${tool}.R 引用了未声明的依赖: ${ref}（应加入 _dependencies.json 的 tools.${tool}.packages）`
      );
    }
  }
});

test('③ checkToolDependencies：缺失清单 / 全就位 / 清单外脚本', () => {
  const { checkToolDependencies } = require('../core/biof3-server/helpers/tool-dependencies.js');

  const missingSet = new Set(['SNFtool']);
  const partialExecutor = { checkPackageInstalled: (pkg) => !missingSet.has(pkg) };
  const fullExecutor = { checkPackageInstalled: () => true };

  // mo-snf: SNFtool + mclust → 缺 SNFtool
  const r1 = checkToolDependencies(partialExecutor, 'mo-snf.R');
  assert.deepEqual(r1, { checked: true, missing: ['SNFtool'] });

  // 全就位放行
  const r2 = checkToolDependencies(fullExecutor, 'mo-snf.R');
  assert.deepEqual(r2, { checked: true, missing: [] });

  // 清单外脚本（如插件脚本 deseq2.R）→ 不检查、放行
  const r3 = checkToolDependencies(partialExecutor, 'deseq2.R');
  assert.deepEqual(r3, { checked: false, missing: [] });

  // 坏 executor → 放行（脚本内 fail-fast 兜底）
  const r4 = checkToolDependencies(null, 'mo-snf.R');
  assert.equal(r4.checked, false);
});

test('④ missingPackagesMessage 含缺失清单与补装指引', () => {
  const { missingPackagesMessage } = require('../core/biof3-server/helpers/tool-dependencies.js');
  const msg = missingPackagesMessage('mo-snf', ['SNFtool', 'mclust']);
  assert.ok(msg.includes('SNFtool, mclust'));
  assert.ok(msg.includes('install-r-tool-dependencies.mjs --tool mo-snf'));
  assert.ok(!msg.includes('undefined'));
});
