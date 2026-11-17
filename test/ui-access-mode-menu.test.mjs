import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'frontend/src/components/copilot/SimpleChat.tsx');

function accessMenuSource() {
  const src = fs.readFileSync(SRC, 'utf8');
  const start = src.indexOf('{accessMenuOpen && (');
  const end = src.indexOf('{!slimComposer && <PromptEnhanceControls', start);
  assert.ok(start >= 0 && end > start, 'access menu block not found');
  return src.slice(start, end);
}

test('UI-303 加映一 — 访问模式菜单只保留完全访问与计划模式', () => {
  const menu = accessMenuSource();
  assert.match(menu, /完全访问/);
  assert.match(menu, /计划模式/);
  assert.doesNotMatch(menu, /项目写/);
  assert.doesNotMatch(menu, /只读模式/);
  assert.doesNotMatch(menu, /setAccessMode\('workspace-write'\)/);
  assert.doesNotMatch(menu, /setAccessMode\('read'\)/);
  assert.equal((menu.match(/<button type="button"/g) || []).length, 2);
});
