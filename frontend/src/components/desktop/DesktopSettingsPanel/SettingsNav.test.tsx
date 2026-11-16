import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsNav } from './SettingsNav';
import { SETTINGS_SECTIONS, type SettingsSection } from './types';

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

describe('SettingsNav 高级分组默认态', () => {
  it('当前在核心分区时，高级分组默认展开（advanced 项直接可见）', () => {
    renderNav('appearance');
    const toggle = screen.getByRole('button', { name: /高级/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // 高级分区「运行时与诊断」的 label 应直接可见（默认未折叠）
    expect(screen.getByText('运行时与诊断')).toBeTruthy();
  });

  it('用户可手动收起高级分组，收起后 advanced 项隐藏', () => {
    renderNav('appearance');
    const toggle = screen.getByRole('button', { name: /高级/ });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('运行时与诊断')).toBeNull();
  });

  it('选中高级分区本身时同样展开，不因深链进入而折叠', () => {
    renderNav('diagnostics');
    const toggle = screen.getByRole('button', { name: /高级/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
  });
});
