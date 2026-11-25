/**
 * item 40 HK-01 — 设置页语音独立成区（红绿先行）。
 * 开工令 msg_4a53c55da784：core 新增 speech 分区、ChannelPreferencePanel 精简四块迁入独立页、
 * 删检索/OCR 两块 UI、深链+搜索第二真相源同步、REST 面原样。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../../../..');
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8');

describe('item 40 HK-01 语音独立成区', () => {
  it('①左栏 core 6 组含 speech，「能力」组 groups=models+speech', () => {
    const types = read('frontend/src/components/desktop/DesktopSettingsPanel/types.ts');
    expect(types).toMatch(/\| 'speech'/);
    expect(types).toMatch(/id: 'speech', label: '语音', description: '本地模型 \/ 转写与朗读'/);
    expect(types).toMatch(/icon: 'mic'/);
    const nav = read('frontend/src/components/desktop/DesktopSettingsPanel/SettingsNav.tsx');
    expect(nav).toMatch(/\{ label: '能力', ids: \['models', 'speech'\] \}/);
    const navTest = read('frontend/src/components/desktop/DesktopSettingsPanel/SettingsNav.test.tsx');
    expect(navTest).toMatch(/\['models', 'speech', 'appearance', 'desktop', 'usage', 'maintenance'\]/);
  });

  it('②深链 ?section=speech 合法且旧值不变', () => {
    const types = read('frontend/src/components/desktop/DesktopSettingsPanel/types.ts');
    // speech 是 SETTINGS_SECTIONS 合法值 → normalizeInitialSection 原样返回；旧映射保留
    expect(types).toMatch(/id: 'speech', label: '语音'/);
    expect(types).toMatch(/section === 'general' \|\| section === 'diagnostics'/);
  });

  it('③models 页不再挂 ChannelPreferencePanel，speech 页挂之且四块在、检索/OCR 两块不在', () => {
    const panel = read('frontend/src/components/desktop/DesktopSettingsPanel.tsx');
    expect(panel).toMatch(/activeSection === 'speech' && <ChannelPreferencePanel \/>/);
    const modelsBlock = panel.slice(panel.indexOf("activeSection === 'models' && ("), panel.indexOf("activeSection === 'network'") >= 0 ? panel.length : panel.length);
    expect(modelsBlock.slice(0, 3000)).not.toContain('<ChannelPreferencePanel />');
    const cp = read('frontend/src/components/desktop/DesktopSettingsPanel/sections/ChannelPreferencePanel.tsx');
    for (const block of ['语音渠道', 'ASR 语言', '本地模型', 'Whisper', 'TTS 声音']) {
      expect(cp).toContain(block);
    }
    expect(cp).not.toMatch(/联网检索后端|OCR 渠道|web-access|ocr-access/);
    expect(cp).not.toMatch(/aria-expanded=\{open\}|▾/); // 去外层折叠
  });

  it('④搜索索引第二真相源同步 speech，双向相等门保持', () => {
    const search = read('frontend/src/lib/settingsSearch.ts');
    expect(search).toMatch(/\| 'speech'/);
    expect(search).toMatch(/id: 'speech',[\s\S]{0,300}(Whisper|SenseVoice)/);
    expect(search).not.toMatch(/id: 'models'[\s\S]{0,300}检索后端/);
    const test = read('frontend/src/lib/settingsSearch.test.ts');
    expect(test).toMatch(/逐项相等/);
  });

  it('⑤web-access/ocr-access REST 面原样（零 UI 改动不碰后端）', () => {
    const routes = read('core/petri-server/routes/runtime-config.js');
    expect(routes).toMatch(/\/api\/web-access/);
    expect(routes).toMatch(/\/api\/ocr-access/);
  });
});
