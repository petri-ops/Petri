import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const langs = require('../core/shared-backend/script-host-languages');

test('BLOCK-83 D10 language descriptors preserve historical presentation behaviour', () => {
  // 与历史三元表达式逐字等价：`lang === 'r' ? 'R' : 'py'`
  assert.equal(langs.scriptExtensionFor('r'), 'R');
  assert.equal(langs.scriptExtensionFor('python'), 'py');
  assert.equal(langs.scriptExtensionFor('julia'), 'py', '未知语言回落到历史默认 py');
  assert.equal(langs.scriptExtensionFor(null), 'py');

  // `lang === 'r' ? 'R' : lang === 'python' ? 'Python' : lang || ''`
  assert.equal(langs.interpreterLabel('r'), 'R');
  assert.equal(langs.interpreterLabel('python'), 'Python');
  assert.equal(langs.interpreterLabel('julia'), 'julia');
  assert.equal(langs.interpreterLabel(null), '');

  // `lang === 'r' ? 'Rscript' : lang === 'python' ? 'python' : '可执行文件'`
  assert.equal(langs.missingRuntimeCommandName('r'), 'Rscript');
  assert.equal(langs.missingRuntimeCommandName('python'), 'python');
  assert.equal(langs.missingRuntimeCommandName('julia'), '可执行文件');
});

test('BLOCK-83 D10 language registry validates descriptors and supports domain registration', () => {
  assert.throws(() => langs.registerScriptLanguage(null), /script_language_definition_required/);
  assert.throws(() => langs.registerScriptLanguage({ id: '' }), /script_language_id_required/);
  assert.throws(() => langs.registerScriptLanguage({ id: 'x' }), /script_language_extension_required/);

  // 领域包可注册自有语言（平台扩展面），注销后回落未知语义。
  langs.registerScriptLanguage({ id: 'julia', label: 'Julia', scriptExtension: 'jl', command: 'julia', runtimeKey: 'julia' });
  try {
    assert.equal(langs.scriptExtensionFor('julia'), 'jl');
    assert.equal(langs.interpreterLabel('julia'), 'Julia');
    assert.equal(langs.runtimeKeyFor('julia'), 'julia');
    assert.ok(langs.listScriptLanguages().includes('julia'));
  } finally {
    langs.unregisterScriptLanguage('julia');
  }
  assert.equal(langs.scriptExtensionFor('julia'), 'py', '注销后回落历史默认行为');
  assert.equal(langs.getScriptLanguage('julia'), null);
});

test('BLOCK-83 D10 runtime key mapping keeps the {r, python} readiness shape', () => {
  assert.equal(langs.runtimeKeyFor('r'), 'r');
  assert.equal(langs.runtimeKeyFor('python'), 'python');
  assert.equal(langs.runtimeKeyFor('julia'), 'julia');
  assert.equal(langs.runtimeKeyFor(null), null);
});
