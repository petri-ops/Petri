/**
 * BLOCK-199 P3 — 写侧统一守卫 + 配置诊断出口的契约测（离线·零网络·不碰真实用户数据）。
 *
 * 规则成对钉住：**读不炸、写不进、遮蔽可见**。
 *  · 读侧宽松：落点文件里有未注册键只报告，不炸启动、不静默删除（旧文件兼容是红线）；
 *  · 写侧严格：提交非法/未知值一律拒绝并回结构化诊断（原先是静默丢键=用户以为保存了）；
 *  · env 遮蔽可见：设置页的值被环境变量盖住时，必须能被诊断出来（三个"改了不生效"缺陷的共同根因）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));

const lookup = (family, p) => schema.findEntryByPath(family, p);

test('commitGuard：未注册键与非法值都拒绝，合法值归一化后放行', () => {
  const ok = schema.commitGuard('generation', { temperature: '0.3', maxTokens: 512.9 }, lookup);
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.normalized, { temperature: 0.3, maxTokens: 512 });

  const bad = schema.commitGuard('generation', { temperature: 5 }, lookup);
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].code, schema.DIAGNOSTIC_CODES.OUT_OF_RANGE);
  assert.match(bad.diagnostics[0].message, /≤ 2/);

  const unknown = schema.commitGuard('generation', { nonsense: 1 }, lookup);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.diagnostics[0].code, schema.DIAGNOSTIC_CODES.UNKNOWN_KEY);
  assert.equal(Object.keys(unknown.normalized).length, 0, '被拒的键绝不进 normalized');
});

test('commitGuard：null 仍是清键语义；只读键一律拒绝', () => {
  const cleared = schema.commitGuard('generation', { temperature: null }, lookup);
  assert.equal(cleared.ok, true, '显式 null=清键，不得被守卫误拒');
  assert.equal(Object.keys(cleared.normalized).length, 0);

  const readOnlyLookup = () => ({ key: 'calibration.x', family: 'generation', type: 'number', mutable: false });
  const ro = schema.commitGuard('generation', { x: 0.5 }, readOnlyLookup);
  assert.equal(ro.ok, false);
  assert.equal(ro.diagnostics[0].code, schema.DIAGNOSTIC_CODES.READ_ONLY);
});

test('envShadowedKeys：算出"设置页的值正被 env 盖住"，并区分是否真的改动了生效值', () => {
  const shadowed = schema.envShadowedKeys('feature-flags', { session_compaction: false }, { PETRI_SESSION_COMPACTION: '1' }, lookup);
  assert.equal(shadowed.length, 1);
  assert.equal(shadowed[0].envKey, 'PETRI_SESSION_COMPACTION');
  assert.equal(shadowed[0].overrides, true, 'env 强制开 vs 文件关 → 生效值确被改动');

  const same = schema.envShadowedKeys('feature-flags', { session_compaction: true }, { PETRI_SESSION_COMPACTION: '1' }, lookup);
  assert.equal(same[0].overrides, false, '两边一致则只是遮蔽不是改值（仍应可见，但不算危害）');

  assert.deepEqual(schema.envShadowedKeys('feature-flags', { session_compaction: false }, { PETRI_SESSION_COMPACTION: 'yes' }, lookup), [], '不被承认的 env 字面量不构成遮蔽');
  assert.deepEqual(schema.envShadowedKeys('feature-flags', { ghost: true }, { PETRI_SESSION_COMPACTION: '1' }, lookup), [], '未注册键不报遮蔽');
});

test('saveGenerationDefaults：非法值抛结构化拒绝（不再静默丢键），合法值与清键照旧', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b199-writeguard-'));
  const prevDataDir = process.env.PETRI_LOCAL_DATA_DIR;
  const prevEnv = { t: process.env.PETRI_LLM_TEMPERATURE, m: process.env.PETRI_LLM_MAX_TOKENS };
  process.env.PETRI_LOCAL_DATA_DIR = sandbox;
  delete process.env.PETRI_LLM_TEMPERATURE;
  delete process.env.PETRI_LLM_MAX_TOKENS;
  try {
    const ai = require(path.join(ROOT, 'core/petri-server/helpers/ai-settings.js'));
    assert.deepEqual(ai.saveGenerationDefaults({ temperature: 0.3, maxTokens: 4096 }), { temperature: 0.3, maxTokens: 4096 });
    const onDisk = JSON.parse(fs.readFileSync(path.join(sandbox, 'ai-settings.json'), 'utf8'));
    assert.deepEqual(onDisk.generation, { temperature: 0.3, maxTokens: 4096 });

    assert.throws(
      () => ai.saveGenerationDefaults({ temperature: 9 }),
      (err) => err.code === 'config_value_rejected' && Array.isArray(err.diagnostics) && err.diagnostics[0].code === schema.DIAGNOSTIC_CODES.OUT_OF_RANGE,
    );
    const stillThere = JSON.parse(fs.readFileSync(path.join(sandbox, 'ai-settings.json'), 'utf8'));
    assert.deepEqual(stillThere.generation, { temperature: 0.3, maxTokens: 4096 }, '被拒写入不得改动既有已存值');

    assert.deepEqual(ai.saveGenerationDefaults({ temperature: null }), { maxTokens: 4096 }, 'null 清键语义保留');
  } finally {
    if (prevDataDir === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prevDataDir;
    if (prevEnv.t !== undefined) process.env.PETRI_LLM_TEMPERATURE = prevEnv.t; else delete process.env.PETRI_LLM_TEMPERATURE;
    if (prevEnv.m !== undefined) process.env.PETRI_LLM_MAX_TOKENS = prevEnv.m; else delete process.env.PETRI_LLM_MAX_TOKENS;
    try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
  }
});

test('config:doctor：未知键只报告不删、非法已存值预警、env 遮蔽点名、缺文件不炸', async () => {
  const { buildReport } = await import(pathToFileURL(path.join(ROOT, 'scripts/block199-config-doctor.mjs')).href);
  // 路径按平台拼接（Windows 上 path.join('/x', f) 会产 '\x\f'，写死正斜杠会让测试只在类 Unix 绿）
  const dir = path.join(os.tmpdir(), 'b199-doctor-none');
  const files = {
    [path.join(dir, 'feature-flags.json')]: { flags: { session_compaction: false, ghost_flag: true } },
    [path.join(dir, 'ai-settings.json')]: { generation: { temperature: 9, maxTokens: 4096 }, costCapCny: -1, provider: 'deepseek' },
    [path.join(dir, 'decision-config.json')]: { version: 1, points: { 'tool-route': { enabled: true, threshold: 2 } } },
  };
  const report = buildReport({
    readJson: (file) => {
      if (!files[file]) { const e = new Error('missing'); e.code = 'ENOENT'; throw e; }
      return JSON.parse(JSON.stringify(files[file]));
    },
    env: { PETRI_LOCAL_DATA_DIR: dir, PETRI_SESSION_COMPACTION: '1', PETRI_TASK_COST_CAP_CNY: undefined },
  });
  const unknownPaths = report.unknownKeys.map((d) => `${d.family}.${d.path}`).sort();
  assert.ok(unknownPaths.includes('feature-flags.ghost_flag'), `未注册键要点名：${unknownPaths.join(',')}`);
  const badCodes = report.invalidStoredValues.map((d) => `${d.family}:${d.path}`);
  assert.ok(badCodes.includes('generation:temperature'), '非法已存值要预警（下次写入会被拒）');
  assert.ok(badCodes.includes('cost-cap:costCapCny'), '≤0 的成本上限属非法');
  assert.ok(badCodes.includes('decision-points:tool-route.threshold'), '越界阈值要点名');
  const shadows = report.envShadowed.filter((s) => s.family === 'feature-flags');
  assert.equal(shadows.length, 1, 'env=1 盖住文件 false 必须报遮蔽');
  assert.equal(shadows[0].overrides, true);
  // BLOCK-203 W4a P6 语义变更（有意）：ai-settings 顶层未知键**要**点名——它会在下一次保存时
  // 被白名单丢弃，藏起来等于让"保存一次少一个键"不可见。但归属必须是 `ai-settings-root`，
  // 不能被误算成任何注册族的非法已存值（那是两件事：文件级垃圾 vs 族内值不合法）。
  assert.ok(!report.invalidStoredValues.some((d) => d.path === 'provider'), 'ai-settings 顶层非本族键不得被误报成 generation 的非法已存值');
  assert.ok(
    report.unknownKeys.some((d) => d.family === 'ai-settings-root' && d.path === 'provider'),
    `顶层未知键要点名（ai-settings-root）：${report.unknownKeys.map((d) => `${d.family}.${d.path}`).join(',')}`,
  );
  assert.ok(report.summary.unknownKeys >= 1 && report.summary.invalidStoredValues >= 3);
});

test('config:doctor：落点文件全缺失时只记 unreadable，不抛错（首启/干净机器可用）', async () => {
  const { buildReport } = await import(pathToFileURL(path.join(ROOT, 'scripts/block199-config-doctor.mjs')).href);
  const report = buildReport({
    readJson: () => { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; },
    env: { PETRI_LOCAL_DATA_DIR: '/nowhere' },
  });
  assert.equal(report.stores.length, 0);
  assert.ok(report.unreadable.length >= 3, `缺失落点要如实列出：${report.unreadable.length}`);
  assert.equal(report.summary.invalidStoredValues, 0);
});
