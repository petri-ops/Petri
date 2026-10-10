import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRenameCase, mapLine } from '../scripts/block165-rename-codemod.mjs';

test('block165 大小写形状保持映射', () => {
  assert.equal(mapRenameCase('biof3'), 'petri');
  assert.equal(mapRenameCase('BioF3'), 'Petri');
  assert.equal(mapRenameCase('BIOF3'), 'PETRI');
  assert.equal(mapRenameCase('bioF3'), 'petri');
  assert.equal(mapRenameCase('gewu'), 'petri');
  assert.equal(mapRenameCase('Gewu'), 'Petri');
  assert.equal(mapRenameCase('GEWU'), 'PETRI');
});

test('block165 复合标识符路径映射', () => {
  const r = mapLine('require("../core/biof3-server/mcp/registry.js")');
  assert.equal(r.text, 'require("../core/petri-server/mcp/registry.js")');
  assert.equal(r.changed, true);
  const env = mapLine('process.env.BIOF3_LOCAL_DATA_DIR');
  assert.equal(env.text, 'process.env.PETRI_LOCAL_DATA_DIR');
  const css = mapLine('var(--gewu-text-muted)');
  assert.equal(css.text, 'var(--petri-text-muted)');
  const events = mapLine('window.gewuevents.dispatch("gewuevent:x")');
  assert.equal(events.text, 'window.petrievents.dispatch("petrievent:x")');
  const special = mapLine('git clone https://github.com/ShengXinF3/biof3-desktop.git');
  assert.equal(special.text, 'git clone https://github.com/petri-ops/Petri.git');
});

test('block165 幂等：二次施加零变化', () => {
  const sample = 'BioF3 Desktop（格物）uses core/biof3-server and --gewu-border tokens';
  const once = mapLine(sample);
  assert.equal(once.changed, true);
  const twice = mapLine(once.text);
  assert.equal(twice.changed, false);
  assert.equal(twice.text, once.text);
});

test('block165 行级标记豁免：台账条目行原样保留', () => {
  const line = '最后更新：2026-10-10（**BLOCK-165-PETRI-OSS-RENAME 启动：gewu/biof3→petri 记述保持**）';
  const r = mapLine(line);
  assert.equal(r.skippedMarker, true);
  assert.equal(r.text, line);
  assert.equal(r.changed, false);
});
