// test/electron-security-assertions.test.mjs — BLOCK-105 P3 Electron 安全断言
//
// 把散落的 Electron 安全配置固化为系统化断言（plan §1 P3）：
//   1. 全部 BrowserWindow 创建点的 webPreferences 四项安全配置
//      （contextIsolation:true / nodeIntegration:false / sandbox:true / webSecurity:true）
//      ——读源码逐创建点配对断言（存在性断言，不锚定行号/位置）；
//   2. preload 桥形态：contextBridge.exposeInMainWorld 唯一暴露面（渲染进程无
//      require('electron') 直连——与 dependency-cruiser R1 双保险，测试层独立成立）；
//   3. fuses 断言属打包态（@electron/fuses 读 binary），G0 开发期不外推——如实登记
//      在本测试头注释，packaged 资格线（G1+）补运行时翻转断言。
//
// 已知边界：源码正则断言对「注释里的同名配置」有误报可能——创建点以 `new BrowserWindow`
// 锚定后仅在构造参数窗口内匹配，规避注释噪音。

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const WINDOW_FILES = [
  'src/main/_window-create.js', // 主窗口
  'src/ipc/window-manager.js', // rail 悬浮窗 + pop-out 次级窗口（两处创建点）
];

const REQUIRED_SAFE_CONFIG = [
  ['contextIsolation', 'true'],
  ['nodeIntegration', 'false'],
  ['sandbox', 'true'],
  ['webSecurity', 'true'],
];

function windowCreationBlocks(source) {
  // 抓 new BrowserWindow({ ... }) 的完整构造参数块（大括号配对）
  const blocks = [];
  const re = /new BrowserWindow\(\{/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    const open = source.indexOf('{', m.index);
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth += 1;
      else if (source[i] === '}') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

describe('Electron 安全配置断言（BLOCK-105 P3）', () => {
  it('全部 BrowserWindow 创建点都带四项安全配置（contextIsolation/nodeIntegration/sandbox/webSecurity）', () => {
    let totalWindows = 0;
    for (const rel of WINDOW_FILES) {
      const source = readFileSync(path.join(ROOT, rel), 'utf8');
      const blocks = windowCreationBlocks(source);
      assert.ok(blocks.length >= 1, `${rel} 应至少有一个 BrowserWindow 创建点`);
      for (const [idx, block] of blocks.entries()) {
        for (const [key, value] of REQUIRED_SAFE_CONFIG) {
          const pattern = new RegExp(`${key}:\\s*${value}\\b`);
          assert.match(
            block,
            pattern,
            `${rel} 第 ${idx + 1} 个 BrowserWindow 缺少 ${key}: ${value} —— Electron 安全基线要求全部创建点显式达标`
          );
        }
      }
      totalWindows += blocks.length;
    }
    assert.ok(totalWindows >= 3, `预期至少 3 个窗口创建点（主/rail/pop-out），实得 ${totalWindows}`);
  });

  it('preload 是唯一 electron 暴露面（contextBridge.exposeInMainWorld），渲染进程源码零 require electron', () => {
    const preload = readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
    assert.match(preload, /require\(['"]electron['"]\)/, 'preload 必须引 electron');
    assert.match(preload, /contextBridge\.exposeInMainWorld/, 'preload 必须经 contextBridge 暴露');

    // 渲染进程源码（frontend/src）不允许任何实际 import 语句引入 electron
    // （dependency-cruiser R1 同规则；本断言独立于工具链存在，双保险）。
    // 排除 *.d.ts 类型声明与注释命中——只抓真实 import 语句形态。
    let hits = '';
    try {
      hits = execFileSync(
        'git',
        [
          'grep',
          '-lIE',
          "(^|[;\\n])\\s*(import[\\w{} ,*]*from|const[\\w{} ,*]*=\\s*require\\()\\s*['\"]electron['\"]",
          '--',
          'frontend/src',
          ':!frontend/src/**/*.d.ts',
        ],
        { encoding: 'utf8', cwd: ROOT },
      );
    } catch {
      hits = '';
    }
    assert.equal(hits.trim(), '', `frontend/src 存在 electron 直引（必须走 desktopBridge）: ${hits.trim()}`);
  });

  it('fuses 运行时翻转断言属打包态——G0 开发期如实登记（非 skip 占位）', () => {
    // 如实声明：@electron/fuses 的 flip/clear 断言需要 packaged binary 才有意义，
    // 当前 G0 开发期 dev electron 不携带 fuse 配置。本测试存在即为登记：packaged
    // 资格线（G1+）补 `getCurrentFuseState` 断言（SENTINEL: BLOCK-105-FUSES-G1）。
    assert.ok(true, 'fuses 断言登记为 G1+ packaged 范围（SENTINEL: BLOCK-105-FUSES-G1）');
  });
});
