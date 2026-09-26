// UI-446 v4 — 工作台空态「审阅」磁贴计数徽章（红绿先行：与 v3 圆点同位，升格为计数）。
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyResult } from './EmptyResult';

vi.mock('@/components/icons/Icon', () => ({
  Icon: ({ name }: { name: string }) => <i data-testid={`icon-${name}`} />,
}));

afterEach(cleanup);

describe('EmptyResult 审阅磁贴计数徽章（UI-446 v4）', () => {
  it('reviewCount>0 → 审阅磁贴渲染计数徽章', () => {
    render(<EmptyResult reviewCount={2} onOpenReview={() => {}} />);
    expect(screen.getByTestId('review-tile-count').textContent).toBe('2');
  });

  it('reviewCount 缺省/0 → 不渲染', () => {
    render(<EmptyResult onOpenReview={() => {}} />);
    expect(screen.queryByTestId('review-tile-count')).toBeNull();
    render(<EmptyResult reviewCount={0} onOpenReview={() => {}} />);
    expect(screen.queryByTestId('review-tile-count')).toBeNull();
  });

  it('其余磁贴不受影响（不误挂徽章）', () => {
    render(<EmptyResult reviewCount={2} onOpenReview={() => {}} onOpenFiles={() => {}} />);
    expect(screen.queryByTestId('files-tile-count')).toBeNull();
    expect(screen.getByText('文件')).toBeTruthy();
  });
});
