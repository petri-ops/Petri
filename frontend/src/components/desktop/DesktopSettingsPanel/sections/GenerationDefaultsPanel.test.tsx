/**
 * 试用反馈③深化 HK-01（前端覆盖档）：GenerationDefaultsPanel 用意图选择替代裸滑杆。
 */
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GenerationDefaultsPanel } from './GenerationDefaultsPanel';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
afterEach(() => { cleanup(); fetchMock.mockReset(); });

describe('GenerationDefaultsPanel（意图覆盖档）', () => {
  it('加载已存意图并展示（老配置兼容映射）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'ok', generation: { intentPreset: 'creative' } }),
    });
    render(<GenerationDefaultsPanel />);
    const select = await screen.findByTestId<HTMLSelectElement>('generation-intent-preset');
    expect(select.value).toBe('creative');
  });

  it('选意图后保存写 intentPreset（不写裸 temperature 滑杆）', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'ok', generation: {} }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ status: 'ok' }) });
    render(<GenerationDefaultsPanel />);
    const select = await screen.findByTestId<HTMLSelectElement>('generation-intent-preset');
    fireEvent.change(select, { target: { value: 'precise' } });
    fireEvent.click(screen.getByTestId('generation-save'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const put = fetchMock.mock.calls[1][1] as { method: string; body: string };
    expect(put.method).toBe('PUT');
    expect(JSON.parse(put.body)).toEqual({ intentPreset: 'precise' });
    expect(screen.queryByTestId('generation-temperature')).toBeNull();
  });
});
