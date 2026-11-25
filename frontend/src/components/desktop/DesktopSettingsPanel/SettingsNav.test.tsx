import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsNav } from './SettingsNav';
import { normalizeInitialSection, SETTINGS_SECTIONS, type SettingsSection } from './types';

afterEach(cleanup);

const allSectionIds = new Set<SettingsSection>(SETTINGS_SECTIONS.map((item) => item.id));

function renderNav(activeSection: SettingsSection = 'appearance') {
  const onSelect = vi.fn();
  render(
    <SettingsNav
      visibleSectionIds={allSectionIds}
      activeSection={activeSection}
      onSelect={onSelect}
    />,
  );
  return { onSelect };
}

describe('UI-704 + item 40 设置页 IA — 左栏 core 6 组 + 高级折叠', () => {
  it('core 6 组：模型接口/语音/外观/通知与桌面/用量与资源/数据与维护 常驻左栏', () => {
    const coreIds = SETTINGS_SECTIONS.filter((item) => item.tier === 'core').map((item) => item.id);
    expect(coreIds).toEqual(['models', 'speech', 'appearance', 'desktop', 'usage', 'maintenance']);
  });

  it('快捷键与联网与代理不在 core（高级折叠组内，搜索可达）', () => {
    renderNav('appearance');
    // 左栏直接可见的项数 = core 6 + 1 个高级折叠开关
    const navButtons = screen.getAllByRole('button').filter((b) => b.className.includes('petri-settings-nav__item'));
    expect(navButtons.length).toBe(6);
    expect(screen.queryByText('快捷键')).toBeNull();
    expect(screen.queryByText('联网与代理')).toBeNull();
    // 搜索可达：visibleSectionIds 含全部分区时，展开高级即可见
    fireEvent.click(screen.getByRole('button', { name: /高级/ }));
    expect(screen.getByText('快捷键')).toBeTruthy();
    expect(screen.getByText('联网与代理')).toBeTruthy();
  });

  it('高级分组默认收起（UI-704：导航极少 + 搜索兜底），手动展开后可见；诊断不再占导航', () => {
    renderNav('appearance');
    const toggle = screen.getByRole('button', { name: /高级/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('实验特性')).toBeTruthy();
    expect(screen.queryByText('运行时与诊断')).toBeNull();
  });

  it('旧深链 diagnostics 归一到 maintenance（诊断折叠块由面板自动展开）', () => {
    expect(normalizeInitialSection('diagnostics')).toBe('maintenance');
    renderNav('maintenance');
    expect(screen.getByText('数据与维护')).toBeTruthy();
    expect(screen.queryByText('运行时与诊断')).toBeNull();
  });

  it('深链归一：?section=general → maintenance（旧深链不失效）；其余 id 原样；非法值不产生未知分区', () => {
    expect(normalizeInitialSection('general')).toBe('maintenance');
    expect(normalizeInitialSection('network')).toBe('network');
    expect(normalizeInitialSection('keymap')).toBe('keymap');
    expect(normalizeInitialSection('models')).toBe('models');
    expect(normalizeInitialSection('made-up-section')).toBeUndefined();
    expect(normalizeInitialSection(undefined)).toBeUndefined();
  });

  it('配置迁移（原 general 分区）并入 maintenance：其 id 不再出现在导航列表', () => {
    expect(SETTINGS_SECTIONS.some((item) => item.id === 'general')).toBe(false);
    expect(SETTINGS_SECTIONS.some((item) => item.id === 'maintenance')).toBe(true);
  });
});
