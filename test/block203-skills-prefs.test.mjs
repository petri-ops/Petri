/**
 * BLOCK-203 W4a P3 — `skills-prefs` 落点收编 + schema「代码侧字段」语义契约测。
 *
 * 钉四件事：
 *  ① `owner:'code'` 的新语义：读侧**不报** READ_ONLY（否则 doctor 每次读盘都假警报），
 *     写侧**仍然拒绝**（不报 ≠ 可改）。这是 P3 开工前的机制前置，先测它再测落点。
 *  ② 落点消毒：脏条目**只丢该条**（一条坏记录不得让全部技能治理状态消失），未注册顶层键丢弃并报诊断。
 *  ③ 写入面不是 HTTP：IPC 走 `skills:set-disabled`，id 非法（含点/空白/斜杠）直接 `invalid_skill_id`
 *     —— 点路径 `disabled.<id>.at` 依赖 id 不含 `.`，否则会退化成"未知键"假警报。
 *  ④ 落点位置与 BLOCK-177 完全一致（`$PETRI_USER_DATA_DIR/skills-prefs.json`）；重置只清 disabled，
 *     **保留 uninstalledSources**（那是重装指针，不是用户设置）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const prefs = require(path.join(ROOT, 'core/shared-backend/skill-prefs.js'));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const lookup = (family, p) => schema.findEntryByPath(family, p);

/** 把落点指到临时目录（skill-prefs 每次调用都读 env，故 set/restore 即可）。 */
function withDataDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-skills-'));
  const previous = process.env.PETRI_USER_DATA_DIR;
  process.env.PETRI_USER_DATA_DIR = dir;
  try {
    return fn(dir);
  } finally {
    if (previous === undefined) delete process.env.PETRI_USER_DATA_DIR;
    else process.env.PETRI_USER_DATA_DIR = previous;
    rmSync(dir, { recursive: true, force: true });
  }
}

test('BLOCK-203 P3 — schema「代码侧字段」：读不报只读噪音，写仍然拒绝', () => {
  const codeOwned = lookup('skills-prefs', 'version');
  assert.equal(codeOwned.owner, 'code');
  assert.equal(codeOwned.mutable, false);

  const readDiagnostics = schema.diagnoseObject('skills-prefs', { version: 1 }, lookup);
  assert.deepEqual(readDiagnostics, [], '代码自写字段在读侧不得产生 READ_ONLY 噪音（doctor 会天天假警报）');
  // 带票据的真实形状（doctor 会把整份文件摊平后诊断）：时间戳与来源目录同样不许报只读
  const flattened = schema.flattenOneLevel({
    version: 1,
    disabled: { 'knap-x': { at: '2026-10-17T00:00:00.000Z', reason: '理由' } },
    uninstalledSources: { 'gone-skill': { sourceDir: '/tmp/x', at: '2026-10-17T00:00:00.000Z' } },
  });
  assert.deepEqual(schema.diagnoseObject('skills-prefs', flattened, lookup), [], '摊平后的真实形状不得产生任何读盘诊断');

  const write = schema.commitGuard('skills-prefs', { version: 9 }, lookup);
  assert.equal(write.ok, false, '不报 ≠ 可改：写侧必须仍然拒绝');
  assert.ok(write.diagnostics.some((d) => d.code === 'read-only'));

  // 对照：校准专属只读键（reasoning 里的非 mutable 键）读侧**仍然**要报——两条语义不能混成一个
  const calibrationOwned = schema.CONFIG_KEYS.find((e) => e.family === 'decision-points' && e.mutable === false);
  if (calibrationOwned) {
    const diagnostics = schema.diagnoseObject(calibrationOwned.family, { [calibrationOwned.path]: 1 }, lookup);
    assert.ok(diagnostics.some((d) => d.code === 'read-only'), '校准专属只读键的读侧报告不得被 owner:code 的豁免连带取消');
  }
});

test('BLOCK-203 P3 — 落点消毒：脏条目只丢该条 + 未注册顶层键丢弃并报诊断（不连坐整份文件）', () => {
  const { prefs: clean, diagnostics } = prefs.sanitizePrefs({
    version: 1,
    disabled: {
      'ok-skill': { at: '2026-10-17T00:00:00.000Z', reason: '测试' },
      'bad.id': { at: 'x' },
      'no-at': {},
    },
    uninstalledSources: { 'gone-skill': { sourceDir: '/tmp/x', at: 't' } },
    junkTopLevel: { whatever: true },
  });
  assert.deepEqual(Object.keys(clean.disabled), ['ok-skill'], '合法条目必须留下（不能因为别的条目脏就整份清空）');
  assert.deepEqual(clean.disabled['ok-skill'], { at: '2026-10-17T00:00:00.000Z', reason: '测试' });
  assert.deepEqual(Object.keys(clean.uninstalledSources), ['gone-skill']);
  assert.deepEqual(clean.junkTopLevel, undefined);
  const codes = diagnostics.map((d) => `${d.path}:${d.code}`);
  assert.ok(codes.includes('disabled.bad.id:not-allowed'));
  assert.ok(codes.includes('disabled.no-at.at:type-mismatch'));
  assert.ok(codes.includes('junkTopLevel:unknown-key'));
});

test('BLOCK-203 P3 — 落点位置不变 + 幂等停用 + id 形状 fail-closed', () => withDataDir((dir) => {
  assert.equal(prefs.getPrefsFilePath(), path.join(dir, 'skills-prefs.json'), '落点路径必须与 BLOCK-177 完全一致（W4b 才动根）');

  assert.deepEqual(prefs.setSkillDisabled('a.b', true), { ok: false, error: 'invalid_skill_id' });
  assert.deepEqual(prefs.setSkillDisabled('with space', true), { ok: false, error: 'invalid_skill_id' });
  assert.deepEqual(prefs.setSkillDisabled('', true), { ok: false, error: 'skill_id_required' });

  const first = prefs.setSkillDisabled('knap-x', true, '测试停用');
  assert.equal(first.ok, true);
  const at = prefs.loadPrefs().disabled['knap-x'].at;
  assert.ok(typeof at === 'string' && at.length > 0);

  // 幂等：重复停用不覆盖最初的 at/reason
  prefs.setSkillDisabled('knap-x', true);
  assert.equal(prefs.loadPrefs().disabled['knap-x'].at, at);
  assert.equal(prefs.loadPrefs().disabled['knap-x'].reason, '测试停用');

  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'skills-prefs.json'), 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.equal(onDisk.disabled['knap-x'].reason, '测试停用');
}));

test('BLOCK-203 P3 — 重置只清 disabled，保留 uninstalledSources（重装指针不是设置）', () => withDataDir(() => {
  prefs.setSkillDisabled('knap-x', true, '理由');
  prefs.recordUninstalledSource('gone-skill', '/tmp/source');
  const after = prefs.resetPrefs();
  assert.deepEqual(after.disabled, {}, '重置 = 治理覆盖层清空');
  assert.equal(after.uninstalledSources['gone-skill'].sourceDir, '/tmp/source', '重置不得丢掉重装指针');
}));

test('BLOCK-203 P3 — 导入侧：未知顶层键与非法 id 一律拒（整批事务，不部分成功）', () => {
  const { validatePrefs } = prefs;
  assert.deepEqual(validatePrefs({ version: 1, disabled: { 'ok-skill': { at: 't' } } }), []);

  const badId = validatePrefs({ disabled: { 'bad.id': { at: 't' } } });
  assert.ok(badId.some((d) => d.code === 'not-allowed'), '非法 id 必须进诊断');

  const unknownTop = validatePrefs({ theme: 'dark' });
  assert.ok(unknownTop.some((d) => d.code === 'unknown-key' && d.path === 'theme'));
});

test('BLOCK-203 P3 — 注册面：skills-prefs 族 5 键、无 env 层、写面在 IPC 而非 HTTP', () => {
  const keys = schema.CONFIG_KEYS.filter((e) => e.family === 'skills-prefs');
  assert.deepEqual(keys.map((e) => e.path).sort(), [
    'disabled.<id>.at',
    'disabled.<id>.reason',
    'uninstalledSources.<id>.at',
    'uninstalledSources.<id>.sourceDir',
    'version',
  ]);
  assert.deepEqual(schema.CONFIG_FAMILIES['skills-prefs'].precedence, ['file', 'default'], '该族无 env 层');
  assert.ok(keys.every((e) => e.ui === 'none'), '不是设置页可编辑项（Skills 页是治理面，不是设置面）');
  // 反向确认"无 HTTP 写面"这条声明没被后来的路由悄悄推翻
  const routesDir = path.join(ROOT, 'core/petri-server/routes');
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : (entry.name.endsWith('.js') ? [full] : []);
  });
  const offenders = walk(routesDir).filter((file) => read(path.relative(ROOT, file)).includes('setSkillDisabled'));
  assert.deepEqual(offenders, [], 'skills-prefs 声明为 IPC-only；routes/ 出现写入=真相变成两份');
});
