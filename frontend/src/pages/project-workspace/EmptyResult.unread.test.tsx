// UI-446 加映 v3 — 工作台空态「审阅」磁贴圆点（红绿先行：先于实现落盘）。
// 用户抓真：「+」按钮亮了，但空态磁贴/菜单里的审阅入口没有信号——每个入口都要亮。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyResult } from './EmptyResult';

vi.mock('@/components/icons/Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

afterEach(cleanup);

describe('EmptyResult 审阅磁贴圆点（UI-446 加映 v3）', () => {
  it('reviewDot=true → 审阅磁贴渲染圆点', () => {
    render(<EmptyResult reviewDot onOpenReview={() => {}} />);
    expect(screen.getByTestId('review-tile-dot')).toBeTruthy();
  });

  it('reviewDot 缺省 → 不渲染', () => {
    render(<EmptyResult onOpenReview={() => {}} />);
    expect(screen.queryByTestId('review-tile-dot')).toBeNull();
  });

  it('其余磁贴不受影响（不误挂圆点）', () => {
    render(<EmptyResult reviewDot onOpenReview={() => {}} onOpenFiles={() => {}} />);
    expect(screen.queryByTestId('files-tile-dot')).toBeNull();
    expect(screen.getByText('文件')).toBeTruthy();
  });
});
