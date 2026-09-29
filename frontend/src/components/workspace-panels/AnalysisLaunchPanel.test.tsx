import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  ...overrides,
} as unknown as CatalogTool);

afterEach(cleanup);

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
