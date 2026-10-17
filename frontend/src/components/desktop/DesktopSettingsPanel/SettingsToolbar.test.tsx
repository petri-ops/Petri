import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsToolbar } from './SettingsToolbar';

afterEach(cleanup);

describe('SettingsToolbar', () => {
  it('输入即回调，计数显示命中/总数', () => {
    const onQueryChange = vi.fn();
    render(
      <SettingsToolbar query="" onQueryChange={onQueryChange} resultCount={10} totalCount={10} />,
    );
    fireEvent.change(screen.getByTestId('settings-search-input'), { target: { value: '快捷键' } });
    expect(onQueryChange).toHaveBeenCalledWith('快捷键');
    expect(screen.getByTestId('settings-search-count').textContent).toContain('10 个分区');
  });

  it('有查询时显示命中数；无重置能力时不渲染重置按钮', () => {
    render(
      <SettingsToolbar query="快捷键" onQueryChange={() => {}} resultCount={1} totalCount={10} />,
    );
    expect(screen.getByTestId('settings-search-count').textContent).toContain('命中 1 / 10');
    expect(screen.queryByTestId('settings-reset-section')).toBeNull();
  });

  it('传入 onReset 才出现重置按钮，点击回调一次', () => {
    const onReset = vi.fn();
    render(
      <SettingsToolbar
        query=""
        onQueryChange={() => {}}
        resultCount={10}
        totalCount={10}
        resetLabel="恢复「快捷键」默认"
        onReset={onReset}
      />,
    );
    const button = screen.getByTestId('settings-reset-section');
    expect(button.textContent).toContain('恢复「快捷键」默认');
    fireEvent.click(button);
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
