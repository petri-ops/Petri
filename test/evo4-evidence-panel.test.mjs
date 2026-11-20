/**
 * EVO-4 HK-01 — harness 证据前端面板的可执行合同（Node 侧源级断言）。
 * 红（当前）：data.lessonEvidence 通道未登记 / 面板文件缺席 → 断言失败。
 * 绿（实现后）：IPC 四处同步 + 面板只读数据面（零写入控件/零代签徽标）+ CSS 全 token。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('EVO-4 · IPC 通道四处同步（只读）', () => {
  it('① channels.js 登记 data.lessonEvidence', () => {
    const s = read('src/ipc/channels.js');
    assert.match(s, /lessonEvidence:\s*'data:lesson-evidence'/);
  });

  it('② preload.js 有真实 ipcRenderer.invoke 调用点（非注释）', () => {
    const s = read('src/preload.js');
    assert.match(s, /lessonEvidence:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('data:lesson-evidence'\)/);
  });

  it('③ data-management.js handler 用 CHANNELS 常量（无手写字面量）', () => {
    const s = read('src/ipc/data-management.js');
    assert.match(s, /ipcMain\.handle\(CHANNELS\.data\.lessonEvidence/);
    // R5 合规：经 shared-backend db-connection-policy 解析路径，不直接 require core/petri-server
    assert.ok(!/require\(['"][^'"]*core\/petri-server/.test(s), 'R5: 不得 require core/petri-server');
  });

  it('④ electron.d.ts 声明只读方法（无写入签名）', () => {
    const s = read('frontend/src/lib/electron.d.ts');
    assert.match(s, /lessonEvidence:\s*\(\)\s*=>\s*Promise</);
    const block = s.slice(s.indexOf('lessonEvidence:'), s.indexOf('lessonEvidence:') + 900);
    assert.ok(!/\b(write|upsert|apply|rollback)\s*\(/.test(block), '证据通道只读，不含写入方法');
  });
});

describe('EVO-4 · 前端面板只读数据面', () => {
  const PANEL = 'frontend/src/components/desktop/DesktopSettingsPanel/sections/LessonEvidencePanel.tsx';
  const CSS = 'frontend/src/components/desktop/DesktopSettingsPanel/sections/LessonEvidencePanel.module.css';
  const MAINT = 'frontend/src/components/desktop/DesktopSettingsPanel/MaintenanceSection.tsx';

  it('⑤ 面板文件在场且只读（无 button / 无写入方法）', () => {
    const s = read(PANEL);
    assert.match(s, /lessonEvidence\(\)/);
    assert.ok(!/<button|role=['"]button/.test(s), '零写入控件');
    assert.ok(!/lessonEvidence\.(write|upsert|apply|rollback)/.test(s), '零写入调用');
  });

  it('⑥ 面板无「已验证/已签名/通过」观感代签徽标', () => {
    const s = read(PANEL);
    assert.ok(!/已验证|已签名|verified|approved|通过验证/.test(s), '观感零代签');
  });

  it('⑦ 面板如实呈现失败/空态（不伪造曲线）', () => {
    const s = read(PANEL);
    assert.match(s, /读取失败|db busy|error/);
    assert.match(s, /暂无|reason|db-not-found/);
  });

  it('⑧ CSS 全 var(--petri-*) token，零字面量颜色/字号', () => {
    const s = read(CSS);
    const hex = s.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    const rgba = s.match(/rgba?\(/g) || [];
    const bareFontSize = s.match(/font-size:\s*\d+px/g) || [];
    assert.deepEqual({ hex, rgba, bareFontSize }, { hex: [], rgba: [], bareFontSize: [] });
    const vars = s.match(/var\(--[a-z-]+/g) || [];
    assert.ok(vars.every((v) => v.startsWith('var(--petri-')), '只允许 --petri-* token');
  });

  it('⑨ 面板挂载在 maintenance（不新增导航项/台账债）', () => {
    const s = read(MAINT);
    assert.match(s, /LessonEvidencePanel/);
  });
});
