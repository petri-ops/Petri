/**
 * EVO-4 用户实测 bug 修复 HK-01：
 * ① 主窗报 better_sqlite3 ABI mismatch（主进程直开库）→ 改走后端 REST 转发；
 * ② 设置页 label/hint 竖排（trailing + 长路径文案挤压）→ 去 trailing + panel 宽度/断行约束。
 * 红（当前）：两处修复均未落 → 源级断言失败。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('EVO-4 bugfix ① — 主进程不直开 better-sqlite3，改走后端 REST', () => {
  const IPC = 'src/ipc/data-management.js';

  it('① IPC handler 不再 require migration-runner / better-sqlite3 构造器', () => {
    const s = read(IPC);
    assert.ok(!s.includes("require('../migration-runner')"), '不得在主进程取 DB 构造器（ABI 爆点）');
    assert.ok(!/new Database\(/.test(s), '不得在主进程直接开库');
  });

  it('② IPC handler 通过 fetch 调后端只读端点', () => {
    const s = read(IPC);
    assert.match(s, /fetch\(/);
    assert.match(s, /\/api\/harness\/lesson-evidence/);
    assert.match(s, /getBackendPort|R_SERVER_PORT/);
  });

  it('③ 后端新增 lesson-evidence 只读路由并挂载', () => {
    const route = read('core/petri-server/routes/lesson-evidence.js');
    assert.match(route, /app\.get\('\/api\/harness\/lesson-evidence'/);
    assert.match(route, /FROM lessons/);
    assert.match(route, /FROM incidents/);
    assert.ok(!/app\.(post|put|delete|patch)\(/.test(route), '只读端点无写入方法');
    const index = read('core/petri-server/routes/index.js');
    assert.match(index, /lesson-evidence/);
  });
});

describe('EVO-4 bugfix ② — 设置面板 label/hint 不再竖排', () => {
  const MAINT = 'frontend/src/components/desktop/DesktopSettingsPanel/MaintenanceSection.tsx';
  const CSS = 'frontend/src/components/desktop/DesktopSettingsPanel/sections/LessonEvidencePanel.module.css';

  it('④ 挂载去掉 trailing（panel 独占整行，不挤压文本列）', () => {
    const s = read(MAINT);
    // 精确取包含本 label 的那个 <SettingsField> 开标签（向前找最近的 <SettingsField，向后到 '>'）
    const labelPos = s.indexOf('Harness 自进化证据');
    const start = s.lastIndexOf('<SettingsField', labelPos);
    const openTag = s.slice(start, s.indexOf('>', labelPos) + 1);
    assert.ok(openTag.includes('Harness 自进化证据'), '定位到本面板的 SettingsField');
    assert.ok(!/\btrailing\b/.test(openTag), 'panel 挂载开标签不得含 trailing');
  });

  it('⑤ panel CSS 有 width/min-width 约束 + 长文案断行', () => {
    const s = read(CSS);
    assert.match(s, /width:\s*100%/);
    assert.match(s, /min-width:\s*0/);
    assert.match(s, /overflow-wrap:\s*anywhere|word-break:\s*break-word/);
  });
});
