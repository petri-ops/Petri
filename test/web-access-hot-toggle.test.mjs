/**
 * conv 分析裁决①（owner msg_1d935cbef8a7）：联网开关修为立即生效——
 * 03:00 勾选后 03:06 仍 web_access_disabled：勾选是内存态、需另点保存；
 * 修复=checkbox onChange 直接 PUT enabled 字段（其余字段仍走保存按钮）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/DesktopSettingsPanel/sections/WebAccessPanel.tsx'), 'utf8');

function checkboxBlock() {
  const at = src.indexOf('data-testid="web-access-enabled"');
  assert.ok(at > -1, 'web-access-enabled checkbox 缺失');
  return src.slice(at, at + 320);
}

test('HK-01-1：enabled checkbox onChange 直接触发持久化（不再只 setForm）', () => {
  const block = checkboxBlock();
  assert.match(block, /onChange=\{\(event\) => void toggleEnabled/);
});

test('HK-01-2：toggleEnabled 直接 PUT web-access 且仅提交 enabled 字段', () => {
  const at = src.indexOf('const toggleEnabled');
  assert.ok(at > -1, 'toggleEnabled 函数缺失');
  const fn = src.slice(at, src.indexOf('\n  }, [applySnapshot]);', at));
  assert.match(fn, /method:\s*'PUT'/);
  assert.match(fn, /enabled:\s*checked/);
  assert.match(fn, /applySnapshot\(data\.webAccess\)/);
});
