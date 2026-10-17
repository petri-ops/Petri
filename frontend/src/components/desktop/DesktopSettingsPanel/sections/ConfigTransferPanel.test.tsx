import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigTransferPanel } from './ConfigTransferPanel';
import { exportConfigEnvelope, importConfigEnvelope } from '@/lib/configTransfer';
import { getBridge } from '@/lib/desktopBridge';

vi.mock('@/lib/configTransfer', () => ({
  exportConfigEnvelope: vi.fn(),
  importConfigEnvelope: vi.fn(),
}));
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: vi.fn(),
}));

const mockedExport = vi.mocked(exportConfigEnvelope);
const mockedImport = vi.mocked(importConfigEnvelope);
const mockedGetBridge = vi.mocked(getBridge);

beforeEach(() => {
  vi.clearAllMocks();
  mockedGetBridge.mockReturnValue({ saveTextFile: vi.fn().mockResolvedValue({ ok: true, path: '/tmp/config.json' }) } as never);
});

afterEach(cleanup);

describe('ConfigTransferPanel', () => {
  it('导出：调用导出接口并另存；提示里写明不含凭据', async () => {
    mockedExport.mockResolvedValue({
      format: 'petri-config',
      version: 1,
      families: { keymap: { bindings: {} }, reasoning: {} },
      excludes: [{ what: 'credentials', reason: 'never' }],
      envShadowed: [],
    });
    render(<ConfigTransferPanel />);
    fireEvent.click(screen.getByText('导出配置'));
    await waitFor(() => expect(mockedExport).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('config-transfer-notice').textContent).toContain('不含凭据'));
  });

  it('导出失败：错误进入诊断区，不静默吞掉', async () => {
    mockedExport.mockRejectedValue(new Error('后端连接失败'));
    render(<ConfigTransferPanel />);
    fireEvent.click(screen.getByText('导出配置'));
    await waitFor(() => expect(screen.getByTestId('config-transfer-diagnostics').textContent).toContain('后端连接失败'));
  });

  it('导入被拒绝：展示 diagnostics，不宣称成功', async () => {
    mockedImport.mockResolvedValue({
      ok: false,
      applied: [],
      diagnostics: [{ family: 'generation', path: 'temperature', code: 'out-of-range', message: '需 ≤ 2' }],
    });
    const file = { text: () => Promise.resolve(JSON.stringify({ format: 'petri-config', version: 1, families: {} })) } as unknown as File;
    render(<ConfigTransferPanel />);
    fireEvent.change(screen.getByTestId('config-import-input'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('config-transfer-diagnostics').textContent).toContain('需 ≤ 2'));
    expect(screen.getByTestId('config-transfer-notice').textContent).toContain('未写入任何配置');
  });

  it('导入成功：提示合并覆盖语义并通知父层刷新', async () => {
    mockedImport.mockResolvedValue({ ok: true, applied: ['keymap'], diagnostics: [] });
    const onChanged = vi.fn();
    const file = { text: () => Promise.resolve(JSON.stringify({ format: 'petri-config', version: 1, families: { keymap: { bindings: {} } } })) } as unknown as File;
    render(<ConfigTransferPanel onChanged={onChanged} />);
    fireEvent.change(screen.getByTestId('config-import-input'), { target: { files: [file] } });
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('config-transfer-notice').textContent).toContain('合并覆盖');
  });

  it('env 遮蔽时提示「导进去也不会生效」', async () => {
    mockedExport.mockResolvedValue({
      format: 'petri-config',
      version: 1,
      families: {},
      envShadowed: [{ family: 'generation', path: 'temperature', envKey: 'PETRI_LLM_TEMPERATURE', overrides: true }],
    });
    render(<ConfigTransferPanel />);
    fireEvent.click(screen.getByText('导出配置'));
    await waitFor(() => expect(screen.getByTestId('config-transfer-shadow').textContent).toContain('1 项'));
  });
});
