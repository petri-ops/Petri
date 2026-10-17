/**
 * BLOCK-199 P1 — 配置键注册表（shared-config/config-schema.js）的契约测（离线·零网络）。
 *
 * 钉住地基的四件事，任一失守即红：
 *  ① 注册表自身诚实：键唯一、族存在、必填字段齐、类型在已知集合内，且**每个 env 别名都必须
 *     真实出现在源码里**（防注册表写出不存在的幽灵变量——BLOCK-195 幽灵锚点同族毛病）；
 *  ② 优先级模型逐族与现状一致（拆前基线 block199-config-compat 是同组证据，两处不得互斥）；
 *  ③ 未知键语义单源=**读侧产诊断不抛错、写侧据此拒绝**（消灭 P0 测绘发现的"读静默丢/写 throw"分裂）；
 *  ④ 共享层纯度：不得 require 后端模块或任何第三方校验库（R4/R5 落位理由的兑现，新依赖默认拒）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_PATH = path.join(ROOT, 'core', 'packages', 'shared-config', 'config-schema.js');
const schema = require(SCHEMA_PATH);

// 'object' 自 BLOCK-199 就在类型注释里声明，但 validateValue 直到 BLOCK-203 W4a P5 才真正实现；
// 'array' 是 P5 为集合条目（mcp-servers.args）新增的"原样通过"型（只做浅层容器判断）。
const KNOWN_TYPES = new Set(['boolean', 'number', 'string', 'object', 'array']);

/** 收集全仓源码文本（只扫 js/ts/tsx/mjs，跳过 node_modules 与构建产物）用于别名真实性核验。 */
function collectSources() {
  const skip = new Set(['node_modules', 'dist', 'build', '.git', 'acceptance', 'coverage', '.petri-dev-user-data', '.petri-test-user-data']);
  const out = [];
  const walk = (dir) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) { walk(full); continue; }
      if (!/\.(js|mjs|cjs|ts|tsx)$/.test(item.name)) continue;
      out.push(full);
    }
  };
  walk(ROOT);
  return out;
}

test('注册表自检：键唯一、族存在、字段齐、类型合法', () => {
  const seen = new Set();
  for (const entry of schema.CONFIG_KEYS) {
    assert.ok(entry.key && typeof entry.key === 'string', '每个键必须有 key');
    assert.equal(seen.has(entry.key), false, `重复键 ${entry.key}`);
    seen.add(entry.key);
    assert.ok(schema.CONFIG_FAMILIES[entry.family], `${entry.key} 引用了不存在的族 ${entry.family}`);
    assert.ok(KNOWN_TYPES.has(entry.type), `${entry.key} 类型 ${entry.type} 不在已知集合`);
    assert.equal(typeof entry.mutable, 'boolean', `${entry.key} 必须显式声明 mutable`);
    assert.ok(['settings', 'none'].includes(entry.ui), `${entry.key} 的 ui 面必须显式登记（漂移门据此判缺口）`);
    assert.ok(Array.isArray(entry.envKeys), `${entry.key} envKeys 必须是数组`);
    assert.ok(Array.isArray(entry.aliases), `${entry.key} aliases 必须是数组`);
  }
  assert.ok(schema.CONFIG_KEYS.length >= 12, `注册表条目数异常（${schema.CONFIG_KEYS.length}）`);
});

test('每个 env 别名都必须真实存在于源码中（防注册表写出不存在的幽灵环境变量）', () => {
  const declared = new Set();
  for (const entry of schema.CONFIG_KEYS) for (const envKey of entry.envKeys) declared.add(envKey);
  assert.ok(declared.size >= 6, '注册表应至少登记六个 env 别名');
  const found = new Set();
  for (const file of collectSources()) {
    if (found.size === declared.size) break;
    const text = fs.readFileSync(file, 'utf8');
    for (const envKey of declared) {
      if (!found.has(envKey) && text.includes(envKey)) found.add(envKey);
    }
  }
  for (const envKey of declared) {
    assert.ok(found.has(envKey), `注册表声明的 ${envKey} 在源码里根本不会出现（幽灵别名）`);
  }
});

test('优先级模型逐族照现状：env 先于文件，且不发明新的层', () => {
  assert.deepEqual(schema.CONFIG_LAYERS, ['override', 'env', 'file', 'default']);
  assert.deepEqual(schema.CONFIG_FAMILIES['feature-flags'].precedence, ['env', 'file', 'default']);
  assert.deepEqual(schema.CONFIG_FAMILIES['decision-points'].precedence, ['env', 'file', 'registry']);
  assert.deepEqual(schema.CONFIG_FAMILIES['generation'].precedence, ['env', 'file']);
  assert.deepEqual(schema.CONFIG_FAMILIES['cost-cap'].precedence, ['env', 'file']);
  assert.equal(schema.resolve('feature-flags', { env: false, file: true, defaults: true }).layer, 'env', 'env 必须赢文件');
  assert.equal(schema.resolve('feature-flags', { env: null, file: false, defaults: true }).value, false, '无 env 时文件赢默认');
  assert.equal(schema.resolve('feature-flags', { env: undefined, file: undefined, defaults: true }).value, true);
  assert.equal(schema.resolve('generation', { env: undefined, file: 0.3 }).value, 0.3, 'generation 无默认层（loop 内置缺省不进本表，现状）');
  assert.throws(() => schema.resolve('nope-family', {}), /config_family_unknown/);
});

test('env 文本三态解析照现状：feature-flags 认 true/false，decision-points 只认 1/0', () => {
  assert.deepEqual(schema.resolveEnvEntry('feature-flags', 'true'), { layer: 'env', value: true });
  assert.deepEqual(schema.resolveEnvEntry('feature-flags', '0'), { layer: 'env', value: false });
  assert.equal(schema.resolveEnvEntry('feature-flags', 'yes'), null, '非真值字面量不干预（回落文件/默认）');
  assert.equal(schema.resolveEnvEntry('decision-points', 'true'), null, '决策接点现状只认 1/0');
  assert.deepEqual(schema.resolveEnvEntry('decision-points', '1'), { layer: 'env', value: true });
  assert.deepEqual(schema.resolveEnvEntry('cost-cap', '12.5'), { layer: 'env', value: 12.5 });
  assert.equal(schema.resolveEnvEntry('cost-cap', 'abc'), null);
});

test('值校验：类型、区间、取整与小数位归一化', () => {
  const temp = schema.findKeyEntry('generation.temperature');
  assert.equal(schema.validateValue(temp, 3).ok, false);
  assert.equal(schema.validateValue(temp, 3).code, schema.DIAGNOSTIC_CODES.OUT_OF_RANGE);
  assert.equal(schema.validateValue(temp, '0.4').normalized, 0.4, 'env 字符串数值应被接受');
  const max = schema.findKeyEntry('generation.maxTokens');
  assert.equal(schema.validateValue(max, 512.9).normalized, 512, '向下取整（现状口径）');
  assert.equal(schema.validateValue(max, 100).code, schema.DIAGNOSTIC_CODES.OUT_OF_RANGE, '下限 256 防物理截断');
  const cap = schema.findKeyEntry('cost.capCny');
  assert.equal(schema.validateValue(cap, '12.3456').normalized, 12.35, '两位小数取整');
  assert.equal(schema.validateValue(cap, 0).code, schema.DIAGNOSTIC_CODES.OUT_OF_RANGE, '0 视为未配置');
  const flag = schema.findKeyEntry('flag.session_compaction');
  assert.equal(schema.validateValue(flag, 'true').code, schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, '布尔键不接受字符串');
  assert.equal(schema.validateValue(flag, true).ok, true);
  assert.equal(schema.validateValue(null, 1).code, schema.DIAGNOSTIC_CODES.UNKNOWN_KEY, '查不到键=unknown-key 而非崩');
});

test('未知键语义单源：读侧产诊断不抛错，写侧据 code 拒绝', () => {
  const diags = schema.diagnoseObject('feature-flags', { session_compaction: 'yes', ghost_flag: true }, (family, p) => schema.findEntryByPath(family, p));
  assert.equal(diags.length, 2, '类型不符 + 未知键各一条');
  const codes = diags.map((d) => d.code).sort();
  assert.deepEqual(codes, [schema.DIAGNOSTIC_CODES.TYPE_MISMATCH, schema.DIAGNOSTIC_CODES.UNKNOWN_KEY]);
  assert.ok(diags.every((d) => d.path && d.family && d.message), '诊断必须可寻址可解释（本地可审计面）');
  // 读侧宽松：整坨未知键不得抛错（旧文件里已有的未知键不能炸启动）
  assert.doesNotThrow(() => schema.diagnoseObject('generation', { totallyUnknown: 1 }, () => null));
});

test('第一族接线对账：注册表与 feature-flags helper 零漂移（P5 漂移门首例）', () => {
  const flags = require(path.join(ROOT, 'core', 'petri-server', 'helpers', 'feature-flags.js'));
  const registryPaths = schema.CONFIG_KEYS.filter((e) => e.family === 'feature-flags').map((e) => e.path).sort();
  assert.deepEqual(registryPaths, Object.keys(flags.FLAG_DEFAULTS).sort(), '注册表键集合必须与 helper 的开关集完全一致');
  for (const p of registryPaths) {
    const entry = schema.CONFIG_KEYS.find((e) => e.family === 'feature-flags' && e.path === p);
    assert.deepEqual(entry.envKeys, [flags.FLAG_META[p].env], `${p} 的 env 别名两处必须同源`);
    assert.equal(typeof flags.FLAG_DEFAULTS[p], 'boolean');
  }
  // 接线后行为仍须与 schema 口径一致：env 强制档不得被文件或默认翻盘
  for (const [literal, expected] of [['1', true], ['0', false], ['true', true], ['false', false]]) {
    assert.equal(flags.resolveFlag('session_compaction', { [flags.FLAG_META.session_compaction.env]: literal }), expected, `env=${literal}`);
  }
});

test('共享层纯度：不 require 后端/第三方，且无校验库依赖', () => {
  const src = fs.readFileSync(SCHEMA_PATH, 'utf8');
  assert.equal(/\brequire\s*\(/.test(src), false, 'shared-config 层不得 require 任何东西（后端事实由适配器注入）');
  assert.equal(/from ['"]node:/.test(src), false, '共享层不得依赖 Node 内建（前端也要能用）');
  const rootDeps = Object.keys({ ...require(path.join(ROOT, 'package.json')).dependencies, ...require(path.join(ROOT, 'package.json')).devDependencies });
  for (const banned of ['zod', 'ajv', 'joi', 'yup', 'valibot']) assert.equal(rootDeps.includes(banned), false, `${banned} 不应被引入（新依赖默认拒）`);
  const pkgPath = path.join(ROOT, 'core', 'packages', 'shared-config', 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.equal(Object.keys(pkg.dependencies || {}).length, 0, '共享层不得自带依赖');
  }
});
