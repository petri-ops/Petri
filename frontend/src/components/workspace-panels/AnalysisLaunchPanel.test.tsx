import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalysisLaunchPanel } from './AnalysisLaunchPanel';
import type { CatalogTool } from '@/lib/tool-catalog';

const baseTool = (overrides: Partial<CatalogTool> = {}): CatalogTool => ({
  id: 'deseq2',
  title: 'DESeq2 差异分析',
  subtitle: '',
  description: '差异表达分析',
  category: '转录组',
  language: 'r',
  type: 'analysis-plugin',
  version: '1.0.0',
  inputs: [
    { id: 'counts', label: 'counts 矩阵', type: 'file', required: true },
    { id: 'coldata', label: '样本信息表', type: 'file', required: true },
    { id: 'design', label: '设计因子', type: 'text', required: false, default: 'condition' },
    { id: 'padj_cutoff', label: 'padj 阈值', type: 'number', required: false, default: 0.05 },
  ],
  outputs: [],
  demoDataUrl: null,
  ...overrides,
} as unknown as CatalogTool);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** BLOCK-148 测试用 tree 响应形状（与后端 files.js recursive=1 契约同构）。 */
const TREE_EXTENSIONS = ['.csv', '.tsv', '.txt', '.rds', '.rda', '.xlsx', '.h5', '.hdf5', '.gz'];

function jsonResponse(body: unknown): Response {
  return { ok: true, json: () => Promise.resolve(body) } as unknown as Response;
}

describe('AnalysisLaunchPanel 展开态（BLOCK-131 / BIO-5 P2 输入契约投影表单）', () => {
  it('expands a tool into a parameter form projected from its input contract', () => {
    const onLaunch = vi.fn();
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    // 文件输入（required）以工作区文件引用形态呈现
    expect(screen.getByText(/counts 矩阵（必填）/)).toBeTruthy();
    expect(screen.getAllByText(/必填/).length).toBeGreaterThanOrEqual(2);
    // 数值/文本参数有输入框且带默认值
    const padj = screen.getByLabelText<HTMLInputElement>('padj 阈值');
    expect(padj.value).toBe('0.05');
    const design = screen.getByLabelText<HTMLInputElement>('设计因子');
    expect(design.value).toBe('condition');
  });

  it('launch composes an explicit prompt carrying the chosen parameters', () => {
    const onLaunch = vi.fn();
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    const padj = screen.getByLabelText('padj 阈值');
    fireEvent.change(padj, { target: { value: '0.01' } });
    fireEvent.click(screen.getByRole('button', { name: '按以上参数运行' }));
    expect(onLaunch).toHaveBeenCalledTimes(1);
    const arg = onLaunch.mock.calls[0][0] as { id: string };
    const prompt = onLaunch.mock.calls[0][1] as string | undefined;
    expect(arg.id).toBe('deseq2');
    expect(prompt).toContain('padj_cutoff=0.01');
    expect(prompt).toContain('counts=<选择文件>');
    expect(prompt).toContain('coldata=<选择文件>');
  });

  it('collapses back and plain 运行 keeps the legacy one-line prompt path', () => {
    const onLaunch = vi.fn();
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    fireEvent.click(screen.getByRole('button', { name: '收起' }));
    fireEvent.click(screen.getByRole('button', { name: '运行' }));
    const prompt = onLaunch.mock.calls[0][1] as string | undefined;
    expect(prompt).toBeUndefined();
  });

  it('file inputs enumerate workspace csv files for explicit selection', () => {
    const onLaunch = vi.fn();
    const files = [{ path: 'counts.csv', name: 'counts.csv' }, { path: 'coldata.csv', name: 'coldata.csv' }];
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} workspaceFiles={files} />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBe(2);
    fireEvent.change(selects[0], { target: { value: 'counts.csv' } });
    fireEvent.change(selects[1], { target: { value: 'coldata.csv' } });
    fireEvent.click(screen.getByRole('button', { name: '按以上参数运行' }));
    const prompt = onLaunch.mock.calls[0][1] as string | undefined;
    expect(prompt).toContain('counts=counts.csv');
    expect(prompt).toContain('coldata=coldata.csv');
  });
});

describe('BLOCK-148 #11 表单下拉可达性（白名单单源 + 子目录 + path 消歧）', () => {
  it('tree?recursive=1 拉取：白名单外（.md）不列，白名单内（.xlsx）与子目录文件可选，value 为完整 path', async () => {
    const fetchMock = vi.fn((_url: string) => Promise.resolve(jsonResponse({
      ok: true,
      entries: [
        { name: 'counts.csv', type: 'file', path: 'counts.csv' },
        { name: 'notes.md', type: 'file', path: 'notes.md' },
        { name: 'table.xlsx', type: 'file', path: 'sub/table.xlsx' },
      ],
      total: 3,
      truncated: false,
      inputExtensions: TREE_EXTENSIONS,
    })));
    vi.stubGlobal('fetch', fetchMock);
    const onLaunch = vi.fn();
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} projectId="p148" />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    const select = (await screen.findAllByRole('combobox'))[0];
    await waitFor(() => {
      expect(Array.from(select.querySelectorAll('option')).some((o) => o.value === 'counts.csv')).toBe(true);
    });
    const options = Array.from(select.querySelectorAll('option'));
    // 请求形态：recursive=1（子目录可达）
    expect(String(fetchMock.mock.calls[0][0])).toContain('recursive=1');
    // 白名单单源：.md 不列；.xlsx（上传面允许）可选
    expect(options.some((o) => o.value === 'notes.md')).toBe(false);
    expect(options.some((o) => o.value === 'sub/table.xlsx')).toBe(true);
    // value = 完整 path；显示名带相对目录
    expect(options.some((o) => o.textContent === 'sub/table.xlsx')).toBe(true);
  });

  it('同名不同目录以 path 消歧：两个同名文件=两个不同 value；选中后 prompt 携带 path', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({
      ok: true,
      entries: [
        { name: 'counts.csv', type: 'file', path: 'counts.csv' },
        { name: 'counts.csv', type: 'file', path: 'demo-data/deseq2/counts.csv' },
      ],
      total: 2,
      truncated: false,
      inputExtensions: TREE_EXTENSIONS,
    }))));
    const onLaunch = vi.fn();
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={onLaunch} projectId="p148b" />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    const select = (await screen.findAllByRole('combobox'))[0];
    await waitFor(() => {
      const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
      expect(values.filter((v) => v === 'counts.csv').length).toBe(1);
      expect(values.filter((v) => v === 'demo-data/deseq2/counts.csv').length).toBe(1);
    });
    fireEvent.change(select, { target: { value: 'demo-data/deseq2/counts.csv' } });
    fireEvent.click(screen.getByRole('button', { name: '按以上参数运行' }));
    const prompt = onLaunch.mock.calls[0][1] as string | undefined;
    expect(prompt).toContain('counts=demo-data/deseq2/counts.csv');
  });
});

describe('BLOCK-148 #12 demo 一键载入（demoDataUrl 契约消费）', () => {
  const encoder = new TextEncoder();

  function stubDemoFlow(entriesByCall: Array<Array<{ name: string; type: string; path: string }>>) {
    const uploads: Array<{ toPath: string; dataB64: string; offset: number }> = [];
    let treeCalls = 0;
    const fetchMock = vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes('/tree?recursive=1')) {
        treeCalls += 1;
        const entries = entriesByCall[Math.min(treeCalls - 1, entriesByCall.length - 1)] || [];
        return Promise.resolve(jsonResponse({ ok: true, entries, total: entries.length, truncated: false, inputExtensions: TREE_EXTENSIONS }));
      }
      if (url.endsWith('/tools/demo/deseq2')) {
        return Promise.resolve(jsonResponse({ ok: true, toolId: 'deseq2', files: [{ name: 'demo-counts.csv', type: 'table' }], source: 'plugin' }));
      }
      if (url.includes('/tools/demo-data/deseq2/demo-counts.csv')) {
        return Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(encoder.encode('gene,cond\nA,1\n').buffer) } as unknown as Response);
      }
      if (url.includes('/fs/upload')) {
        uploads.push(JSON.parse(init?.body ?? '{}') as { toPath: string; dataB64: string; offset: number });
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return { uploads, fetchMock };
  }

  it('demoDataUrl 工具：点「用示例数据试跑」→ demo 文件落工作区（demo-data/<toolId>/）且下拉可选', async () => {
    const { uploads } = stubDemoFlow([
      [],
      [{ name: 'demo-counts.csv', type: 'file', path: 'demo-data/deseq2/demo-counts.csv' }],
    ]);
    const onLaunch = vi.fn();
    render((
      <AnalysisLaunchPanel
        tools={[baseTool({ demoDataUrl: '/demo-data/deseq2-demo' })]}
        loading={false}
        onLaunch={onLaunch}
        projectId="p148-demo"
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '用示例数据试跑' }));
    // 载入完成提示（demo 文件 → fs/upload → tree 刷新）
    await screen.findByText(/已载入 1 个示例文件/);
    // 分片写通道携带完整目标路径
    expect(uploads.length).toBeGreaterThan(0);
    expect(uploads[0].toPath).toBe('demo-data/deseq2/demo-counts.csv');
    expect(uploads[0].offset).toBe(0);
    expect(typeof uploads[0].dataB64).toBe('string');
    // 落盘后下拉可选（#11 联动）
    const select = (await screen.findAllByRole('combobox'))[0];
    await waitFor(() => {
      expect(Array.from(select.querySelectorAll('option')).some((o) => o.value === 'demo-data/deseq2/demo-counts.csv')).toBe(true);
    });
  });

  it('无 demoDataUrl 的工具不渲染 demo 载入入口', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(jsonResponse({ ok: true, entries: [], inputExtensions: TREE_EXTENSIONS }))));
    render(<AnalysisLaunchPanel tools={[baseTool()]} loading={false} onLaunch={vi.fn()} projectId="p148-none" />);
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    await screen.findAllByRole('combobox');
    expect(screen.queryByRole('button', { name: '用示例数据试跑' })).toBeNull();
  });

  it('demo 清单为空 → 诚实提示「未提供示例数据」，不发上传', async () => {
    const uploads: string[] = [];
    let treeCalls = 0;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: { body?: string }) => {
      if (url.includes('/tree?recursive=1')) {
        treeCalls += 1;
        return Promise.resolve(jsonResponse({ ok: true, entries: [], inputExtensions: TREE_EXTENSIONS }));
      }
      if (url.endsWith('/tools/demo/deseq2')) {
        return Promise.resolve(jsonResponse({ ok: true, toolId: 'deseq2', files: [], source: 'none' }));
      }
      if (url.includes('/fs/upload')) {
        uploads.push(init?.body ?? '');
        return Promise.resolve(jsonResponse({ ok: true }));
      }
      return Promise.resolve(jsonResponse({ ok: true }));
    }));
    render((
      <AnalysisLaunchPanel
        tools={[baseTool({ demoDataUrl: '/demo-data/deseq2-demo' })]}
        loading={false}
        onLaunch={vi.fn()}
        projectId="p148-empty"
      />
    ));
    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    fireEvent.click(await screen.findByRole('button', { name: '用示例数据试跑' }));
    await screen.findByText('该工具未提供示例数据');
    expect(uploads.length).toBe(0);
    expect(treeCalls).toBe(1);
  });
});
