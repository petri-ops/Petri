/**
 * 品牌图标全套集成（owner msg_22bba0ea1f99）：packaged 版 Resources 必须有 icons/ 目录
 * （resolveResource('icons',...) 在 packaged 下指向 process.resourcesPath/icons/）。
 * HK-01：afterPack 复制 icons/ 全套到 Resources + tray 候选文件在源目录存在。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const afterPack = fs.readFileSync(path.join(ROOT, 'build/afterPack.js'), 'utf8');
const shell = fs.readFileSync(path.join(ROOT, 'src/main/desktop-shell.js'), 'utf8');

test('HK-01-1：afterPack 复制 icons/ 到 Resources/icons（全套随包）', () => {
  assert.match(afterPack, /path\.join\(__dirname, ['"]\.\.['"], ['"]icons['"]\)/);
  assert.match(afterPack, /path\.join\(resourcesDir, ['"]icons['"]\)/);
  assert.match(afterPack, /cpSync\([^)]*iconsSrc[^)]*iconsDst/);
});

test('HK-01-2：tray 三候选文件在源目录就位（template 优先）', () => {
  for (const name of ['icon-tray-template.png', 'icon-tray.png', 'icon.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'icons', name)), `缺 icons/${name}`);
  }
  const at = shell.indexOf('const candidates');
  assert.ok(shell.slice(at, at + 140).indexOf('icon-tray-template.png') < shell.slice(at, at + 140).indexOf("'icon-tray.png'"));
});
