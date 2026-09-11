/**
 * dev-debug-scripts.test.mjs — dev 栈/实机编排脚本的护栏测试（回归→门禁）。
 *
 * 这些脚本不是产品代码，但它们的**坑是重复踩过的**（2026-09-11 BLOCK-77 P4 与
 * UI-341 实机期间各踩一次），按仓库「同类缺陷第二次出现即转机械门禁」规则，
 * 把判据固化在测试里：
 *   1. 重启 dev 栈必须注入 BIOF3_DB_PATH + BIOF3_LOCAL_DATA_DIR
 *      —— 不带则落默认空库（数据面失联，见 BLOCK-79 环境事实登记）。
 *   2. 禁止 `-WindowStyle Hidden` 启动 —— hidden 会让页面 visibilityState=hidden，
 *      Chromium 冻结视口（实测 949px）并跳过懒渲染，验收断言整体失真。
 *   3. 启动前必须清残留进程 —— detached backend 会逃逸 electron 树杀，占用 3001。
 *   4. 窗口拉宽用 Win32 SetWindowPos —— page 级 CDP 无 Browser.* 域（-32601），
 *      Emulation 覆盖在既有 dev 窗口上不生效。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('restart-dev-stack.sh 守住 DB 环境变量（否则落默认空库）', () => {
  const sh = read('scripts/restart-dev-stack.sh');
  assert.ok(sh.includes('BIOF3_DB_PATH'), '必须注入 BIOF3_DB_PATH');
  assert.ok(sh.includes('BIOF3_LOCAL_DATA_DIR'), '必须注入 BIOF3_LOCAL_DATA_DIR');
  assert.ok(
    sh.includes('.biof3-dev-user-data'),
    '数据面须指向 .biof3-dev-user-data（与 dev-electron 的 userData 一致）'
  );
});

test('restart-dev-stack.sh 禁止 Hidden 启动（会冻结视口并跳过懒渲染）', () => {
  const sh = read('scripts/restart-dev-stack.sh');
  assert.ok(
    !/-WindowStyle\s+Hidden/i.test(sh),
    '不得使用 -WindowStyle Hidden；应使用 Minimized（最小化控制台、GUI 正常）'
  );
  assert.ok(
    /-WindowStyle\s+Minimized/i.test(sh),
    '应以 -WindowStyle Minimized 启动'
  );
});

test('restart-dev-stack.sh 启动前清残留进程与端口', () => {
  const sh = read('scripts/restart-dev-stack.sh');
  assert.ok(/taskkill/i.test(sh), '必须先 taskkill 残留 electron（树杀）');
  assert.ok(/3001/.test(sh), '必须清理占用 3001 的僵尸 backend（detached 进程逃逸树杀）');
});

test('resize-electron-window.ps1 用 Win32 SetWindowPos 并保持 ASCII-only', () => {
  const ps = read('scripts/resize-electron-window.ps1');
  assert.ok(/SetWindowPos/.test(ps), '窗口尺寸必须走 Win32 SetWindowPos');
  assert.ok(
    /^[\x00-\x7F]*$/m.test(ps) && !/[\u4e00-\u9fff]/.test(ps),
    'PowerShell 5.1 对无 BOM 文件按 ANSI 解析，脚本必须 ASCII-only（中文注释会炸解析）'
  );
});
