import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DesktopBehaviorPanelView } from './DesktopBehaviorPanel';

afterEach(cleanup);

describe('DesktopBehaviorPanelView', () => {
  it('两项开关展示当前偏好，切换时回传单项 patch', () => {
    const onChange = vi.fn();
    render(
      <DesktopBehaviorPanelView
        prefs={{ closeToTray: false, notifyOnTurnEnd: true }}
        onChange={onChange}
      />
    );
    const boxes = screen.getAllByRole<HTMLInputElement>('checkbox');
    expect(boxes).toHaveLength(2);
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(false);

    fireEvent.click(boxes[0]);
    expect(onChange).toHaveBeenCalledWith({ notifyOnTurnEnd: false });
    fireEvent.click(boxes[1]);
    expect(onChange).toHaveBeenCalledWith({ closeToTray: true });
  });

  it('同步失败可见（不假装已保存）', () => {
    render(
      <DesktopBehaviorPanelView
        prefs={{ closeToTray: true, notifyOnTurnEnd: true }}
        syncError="本机已生效，但未能同步到服务端"
        onChange={() => {}}
      />
    );
    expect(screen.getByTestId('desktop-behavior-sync-error').textContent).toContain('未能同步');
  });
});
