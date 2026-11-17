import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsNav } from '../SettingsNav';
import { normalizeInitialSection, SETTINGS_SECTIONS, type SettingsSection } from '../types';
import { SETTINGS_SEARCH_INDEX } from '@/lib/settingsSearch';
import { DiagnosticsFold } from './DiagnosticsFold';

afterEach(cleanup);

describe('UI-704 加映五 — 诊断归位维护', () => {
  it('旧深链 ?section=diagnostics 归一到 maintenance，不再产生独立分区', () => {
    expect(normalizeInitialSection('diagnostics')).toBe('maintenance');
    expect(SETTINGS_SECTIONS.some((item) => item.id === 'diagnostics')).toBe(false);
  });

  it('搜索索引移除独立 diagnostics 条目，但关键词并入 maintenance', () => {
    expect(SETTINGS_SEARCH_INDEX.some((row) => (row.id as string) === 'diagnostics')).toBe(false);
    const maintenance = SETTINGS_SEARCH_INDEX.find((row) => row.id === 'maintenance');
    expect(maintenance).toBeTruthy();
    for (const keyword of ['诊断', '日志', '运行时', '进程', 'runtime']) {
      expect(maintenance!.keywords).toContain(keyword);
    }
  });

  it('高级导航展开后不再出现「运行时与诊断」', () => {
    const ids = new Set<SettingsSection>(SETTINGS_SECTIONS.map((item) => item.id));
    render(<SettingsNav visibleSectionIds={ids} activeSection="maintenance" onSelect={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /高级/ }));
    expect(screen.queryByText('运行时与诊断')).toBeNull();
  });

  it('诊断折叠块默认收起，深链标记可打开，且内容不删', () => {
    const { unmount } = render(
      <DiagnosticsFold><div data-testid="diag-child">服务状态</div></DiagnosticsFold>
    );
    const fold = screen.getByTestId('diagnostics-fold') as HTMLDetailsElement;
    expect(fold.open).toBe(false);
    expect(fold.contains(screen.getByTestId('diag-child'))).toBe(true);
    unmount();
    render(<DiagnosticsFold open><div data-testid="diag-child">服务状态</div></DiagnosticsFold>);
    expect((screen.getByTestId('diagnostics-fold') as HTMLDetailsElement).open).toBe(true);
  });
});
