import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolActivityList } from './ToolActivityList';
import { groupToolActivities } from './toolActivity';
import assert from 'node:assert/strict';
import { gewuEvents } from '@/lib/events';
import { mergeToolResultActivity, summarizeToolCall, type ToolActivityItem } from './toolActivity';

function activity(
  status: ToolActivityItem['status'],
  overrides: Partial<ToolActivityItem> = {}
): ToolActivityItem {
  return {
    key: `${status}:1`,
    name: 'run_tool',
    status,
    actionLabel: '已运行',
    actionDetail: 'deseq2 --input counts.csv',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('ToolActivityList (UI-271 内联手风琴)', () => {
  it('renders the collapsed summary bar only by default', () => {
    render(<ToolActivityList activities={[activity('success')]} processingDurationMs={3900} />);
    expect(screen.getByText(/已完成 1 项/)).toBeTruthy();
    // UI-271 增补：摘要条显式携带任务耗时
    expect(screen.getByText(/耗时 3.9 s/)).toBeTruthy();
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
    expect(screen.getByRole('button', { name: '展开执行记录' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('expands inline on click, each row stays collapsed until clicked (UI-272 两级折叠)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', {
            key: 's1',
            output: { tail: 'R version 4.4.0\n', truncated: false },
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByText(/已完成 1 项/));
    // 展开手风琴：行头出现命令摘要 + 状态标签，但详情（输出）保持收起
    expect(screen.getByText('deseq2 --input counts.csv')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByText(/R version 4.4.0/)).toBeNull();

    // 点击该执行行展开详情
    fireEvent.click(screen.getByRole('button', { name: '展开执行详情 已运行' }));
    expect(screen.getByText(/R version 4.4.0/)).toBeTruthy();
    // UI-437 v5.11 — 展开体不再重复工具名行（行头已有「已运行 + 命令摘要」）
    expect(screen.queryByText('run_tool')).toBeNull();

    // 再次点击收起详情
    fireEvent.click(screen.getByRole('button', { name: '收起执行详情 已运行' }));
    expect(screen.queryByText(/R version 4.4.0/)).toBeNull();

    // 收起整个手风琴
    fireEvent.click(screen.getByText(/已完成 1 项/));
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
  });

  it('keeps a running group collapsed with a running summary (click-driven, no auto-expand)', () => {
    render(<ToolActivityList activities={[activity('running', { key: 'r1' })]} />);
    expect(screen.getByText(/正在处理 1\/1 项/)).toBeTruthy();
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
  });

  it('shows per-iteration reasoning rows before the matching tool, collapsed until clicked (UI-272)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', { key: 'a1', iteration: 2 }),
          activity('success', { key: 'a2', iteration: 2 }),
        ]}
        reasoningByIteration={{ 1: '第一轮先看目录', 2: '第二轮再改文件' }}
      />
    );
    fireEvent.click(screen.getByText(/已完成 2 项/));
    // 第 2 轮思考段只在该轮首个工具前出现一次，默认收起
    expect(screen.getAllByText('思考').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('第二轮再改文件')).toBeNull();

    // 展开第 2 轮思考（UI-437 加映：标签去轮次号后，按迭代序取第一个匹配按钮）
    const thinkButtons = screen.getAllByRole('button', { name: '展开 思考' });
    expect(thinkButtons.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(thinkButtons[0]);
    expect(screen.getByText('第二轮再改文件')).toBeTruthy();

    // 第 1 轮思考没有对应工具，补在末尾，同样默认收起
    expect(screen.queryByText('第一轮先看目录')).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: '展开 思考' }).slice(-1)[0]);
    expect(screen.getByText('第一轮先看目录')).toBeTruthy();
  });

  it('renders a changeDiff file row like the changes card and jumps to review on click (UI-273)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', {
            key: 'w1',
            actionLabel: '已修改',
            actionDetail: 'src/u273.ts',
            changeDiff: {
              added: 3,
              removed: 1,
              truncated: false,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  lines: [
                    { type: 'ctx', text: 'alpha' },
                    { type: 'del', text: 'beta' },
                    { type: 'add', text: 'beta2' },
                  ],
                },
              ],
            },
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByText(/已完成 1 项/));
    fireEvent.click(screen.getByRole('button', { name: '展开执行详情 已修改' }));

    // 文件行：路径 + ±统计（与工作区改动卡片同构）
    const fileRow = screen.getByRole('button', { name: /src\/u273\.ts \+3 −1/ });
    expect(fileRow.textContent).toContain('+3');
    expect(fileRow.textContent).toContain('−1');
    expect(fileRow.closest('.sc-tool-changediff')?.querySelector('.sc-tool-changediff-preview')).toBeTruthy();

    // 点击文件行 → 派发 reviewOpenFile 携带路径
    const seen: Array<{ filePath: string }> = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent<{ filePath: string }>).detail);
    };
    window.addEventListener(gewuEvents.reviewOpenFile, listener);
    try {
      fireEvent.click(fileRow);
    } finally {
      window.removeEventListener(gewuEvents.reviewOpenFile, listener);
    }
    expect(seen).toEqual([{ filePath: 'src/u273.ts' }]);
  });
});

describe('ToolActivityList (UI-383 常规只读折叠)', () => {
  it('groupToolActivities：连续只读成功项归并，非常规/迭代变化断开', () => {
    const read = (key: string, iteration?: number): ToolActivityItem => ({
      key,
      name: 'workspace_read',
      status: 'success',
      actionLabel: '已读取',
      actionDetail: 'a.md',
      iteration,
    });
    const failedRead: ToolActivityItem = { ...read('fail'), status: 'error' };
    const exec: ToolActivityItem = { ...read('exec'), name: 'workspace_exec', actionLabel: '已运行' };
    const groups = groupToolActivities([
      read('r1'), read('r2'), read('r3', 2), failedRead, read('r4', 2), exec, read('r5', 2),
    ]);
    assert.equal(groups.filter((g) => g.kind === 'routine').length, 4);
    // r1,r2 同为无迭代 → 一组；r3 带迭代 2 → 断开成新组
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[1].items[0].iteration, 2);
    assert.equal(groups[2].items[0].status, 'error');
  });

  it('折叠阈值 ≥3：少于 3 项的常规组保持逐条渲染', () => {
    const read = (key: string): ToolActivityItem => ({
      key, name: 'workspace_read', status: 'success', actionLabel: '已读取', actionDetail: 'a.md',
    });
    render(<ToolActivityList activities={[read('a'), read('b')]} />);
    fireEvent.click(screen.getByRole('button', { name: '展开执行记录' }));
    expect(screen.queryByText(/常规读取：/)).toBeNull();
    expect(screen.getAllByText(/a\.md/).length).toBe(2);
  });

  it('≥3 项连续只读折叠为汇总行，点击展开逐条', () => {
    const reads = ['a', 'b', 'c', 'd'].map((key) => ({
      key, name: 'workspace_read', status: 'success' as const, actionLabel: '已读取', actionDetail: `${key}.md`,
    }));
    render(<ToolActivityList activities={reads} />);
    fireEvent.click(screen.getByRole('button', { name: '展开执行记录' }));
    const summary = screen.getByText(/常规读取：读取 4 · 全部成功/);
    expect(summary).toBeTruthy();
    expect(screen.queryByText('a.md')).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('d.md')).toBeTruthy();
  });
});

describe('BLOCK-108 P3 Qoder 行形态（时间线模式 collapseWhenSettled）', () => {
  const execActivity = (overrides: Partial<ToolActivityItem> = {}): ToolActivityItem => ({
    key: 'exec-1',
    name: 'workspace_exec',
    status: 'success',
    actionLabel: '已运行',
    command: 'npm run docs:reconcile 2>&1 | tail -60',
    actionDetail: 'npm run docs:reconcile',
    output: { tail: 'zero manual review candidates\n', truncated: false },
    durationMs: 1200,
    ...overrides,
  });

  it('Q2 UI-437 v3：完成簇自动折叠为一行摘要（含需注意计数）；运行态「工作中」+ 单行最新事件', () => {
    const { rerender } = render(
      <ToolActivityList
        activities={[activity('success', { key: 'a' }), execActivity({ key: 'e' })]}
        collapseWhenSettled
      />
    );
    // 完成即折叠：头部一行摘要，明细默认隐藏
    expect(screen.getByText(/执行工具 2 次/)).toBeTruthy();
    expect(screen.queryByTestId('qoder-cluster-body')).toBeNull();

    rerender(
      <ToolActivityList
        activities={[
          activity('success', { key: 'a' }),
          activity('error', { key: 'b' }),
        ]}
        collapseWhenSettled
      />
    );
    expect(screen.getByText(/执行工具 2 次 · 1 项需注意/)).toBeTruthy();

    // 点簇头展开明细 → error 行可见（行级 ✕ 红字形）
    fireEvent.click(screen.getByText(/执行工具 2 次 · 1 项需注意/));
    expect(document.querySelectorAll('.sc-tool-qoder-row[data-status="error"]').length).toBe(1);

    rerender(<ToolActivityList activities={[activity('running', { key: 'r' })]} collapseWhenSettled showRunningStopwatch />);
    // 运行态 = ZCode「工作中 · 已运行 Ns」头部 + 单行最新事件
    expect(screen.getByText(/工作中 · 已运行/)).toBeTruthy();
    expect(screen.getAllByTestId('qoder-row-head').length).toBe(1);
  });

  it('Q3 统一单行：exec 行默认折叠（无终端块），无 routine 二级折叠', () => {
    const reads = ['a', 'b', 'c'].map((key) => activity('success', {
      key,
      name: 'workspace_read',
      actionLabel: '已读取',
      actionDetail: `${key}.md`,
    }));
    render(
      <ToolActivityList
        activities={[...reads, execActivity()]}
        collapseWhenSettled
      />
    );
    // v3 — 完成簇默认折叠，点簇头展开为单行流
    fireEvent.click(screen.getByText(/执行工具 4 次/));
    // exec 也只是单行：命令预览在，输出块不在
    expect(screen.getByText('终端命令 已运行')).toBeTruthy();
    expect(screen.getAllByText('npm run docs:reconcile 2>&1 | tail -60').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('tool-term-output')).toBeNull();
    // 无 routine 二级折叠：3 条读取逐条单行
    expect(screen.queryByText(/常规读取：/)).toBeNull();
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('c.md')).toBeTruthy();
  });

  it('Q4 点击展开：exec 行展开出命令+输出，再点击收起', () => {
    render(<ToolActivityList activities={[execActivity()]} collapseWhenSettled />);
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    fireEvent.click(screen.getByTestId('qoder-row-head'));
    expect(screen.getByTestId('tool-term-output')).toBeTruthy();
    expect(screen.getByTestId('tool-term-output').textContent).toContain('zero manual review candidates');
    fireEvent.click(screen.getByTestId('qoder-row-head'));
    expect(screen.queryByTestId('tool-term-output')).toBeNull();
  });

  it('Q5 思考入簇：「已思考」单行置顶，折叠预览 + 点击展开全文', async () => {
    render(
      <ToolActivityList
        activities={[execActivity()]}
        reasoningByIteration={{ 2: '先确认登记行再改文档\n第二行细节' }}
        collapseWhenSettled
      />
    );
    // UI-437 v5.6 — 思考行带短预览（64 字截断，单行省略），点击展开全文
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    expect(screen.getByText('已思考')).toBeTruthy();
    expect(screen.getByText(/先确认登记行再改文档/)).toBeTruthy();
    expect(screen.queryByText(/第二行细节/)).toBeNull();
    // UI-437 v5.16 — 思考行行级复制钮与工具行同款：复制全文（非预览截断）
    const writeText = vi.fn((text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const reasoningRow = screen.getByText('已思考').closest('.sc-tool-qoder-row') as HTMLElement;
    fireEvent.click(reasoningRow.querySelector('button[aria-label="复制该行内容"]') as HTMLElement);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe('先确认登记行再改文档\n第二行细节');
    fireEvent.click(screen.getByRole('button', { name: '展开 已思考' }));
    expect(screen.getByText(/第二行细节/)).toBeTruthy();
  });

  it('UI-431 P1 + UI-437 运行态单行：只渲染最新一条事件，点簇头展开全部轮次', () => {
    const mk = (key: string, iteration: number, detail: string): ToolActivityItem => ({
      key, name: 'workspace_exec', status: 'running', actionLabel: '已运行', actionDetail: detail, iteration,
    });
    render(
      <ToolActivityList
        activities={[mk('a1', 1, 'cmd-1'), mk('a2', 2, 'cmd-2')]}
        reasoningByIteration={{ 1: '第一轮思路', 2: '第二轮思路' }}
        collapseWhenSettled
      />
    );
    // UI-437 — 运行态只渲染最新一条事件单行（历史轮与思考行不堆叠）
    expect(screen.getByTestId('qoder-cluster-body')).toBeTruthy();
    expect(screen.getByText('cmd-2')).toBeTruthy();
    expect(screen.queryByText('cmd-1')).toBeNull();
    expect(screen.queryByText('第一轮思路')).toBeNull();
    expect(screen.queryByText('第二轮思路')).toBeNull();
    // 运行态头部 = 「工作中 · 已运行 Ns」+ 仅最新事件单行（历史轮收起，不可中途展开）
    expect(screen.getByText(/工作中 · 已运行/)).toBeTruthy();
    expect(screen.getByText('cmd-2')).toBeTruthy();
    expect(screen.queryByText('cmd-1')).toBeNull();
  });

  it('UI-431 P2 派发行：子智能体行参与当轮渲染，无快照时无计时', () => {
    render(
      <ToolActivityList
        activities={[{ key: 'spawn-1', name: 'spawn_agent', status: 'running', actionLabel: '已派发', agentRunId: 'child-1' }]}
        collapseWhenSettled
      />
    );
    // UI-437 — 运行态最新事件单行自动可见
    expect(screen.getByText('已派发')).toBeTruthy();
    // 无快照推送时不显示计时后缀
    expect(screen.getByText('已派发').textContent).toBe('已派发');
  });

  it('UI-437 v3 完成簇自动折叠为一行摘要；点簇头展开明细、再点收起', () => {
    const mk = (key: string, iteration: number, detail: string): ToolActivityItem => ({
      key, name: 'workspace_exec', status: 'success', actionLabel: '已运行', actionDetail: detail, iteration,
    });
    render(
      <ToolActivityList
        activities={[mk('a1', 1, 'cmd-1'), mk('a2', 2, 'cmd-2')]}
        collapseWhenSettled
      />
    );
    // 完成即折叠：摘要一行，明细隐藏
    expect(screen.queryByTestId('qoder-cluster-body')).toBeNull();
    // 点簇头 → 展开明细（cmd-1/cmd-2 逐行）；再点 → 收起
    fireEvent.click(screen.getByText(/执行工具 2 次/));
    expect(screen.getByText('cmd-1')).toBeTruthy();
    expect(screen.getByText('cmd-2')).toBeTruthy();
    fireEvent.click(screen.getByText(/执行工具 2 次/));
    expect(screen.queryByTestId('qoder-cluster-body')).toBeNull();
  });

  it('UI-437 写入行差异角标：changeDiff 渲染 +N / -M（零值侧省略）', () => {
    const write = (key: string, added: number, removed: number): ToolActivityItem => ({
      key, name: 'workspace_write', status: 'success',
      actionLabel: '已写入', actionDetail: 'demo.ts',
      changeDiff: { added, removed, hunks: [] },
    });
    render(
      <ToolActivityList activities={[write('w1', 130, 0), write('w2', 4, 2)]} collapseWhenSettled />
    );
    fireEvent.click(screen.getByText(/执行工具 2 次/));
    expect(screen.getByText('+130')).toBeTruthy();
    expect(screen.queryByText('-0')).toBeNull();
    expect(screen.getByText('+4')).toBeTruthy();
    expect(screen.getByText('-2')).toBeTruthy();
  });

  it('UI-430 合并簇内按迭代交错：每轮「已思考行 → 该轮工具行」（ZCode 参考形态）', () => {
    const mk = (key: string, iteration: number, name: string, label: string, detail: string): ToolActivityItem => ({
      key, name, status: 'success', actionLabel: label, actionDetail: detail, iteration,
    });
    render(
      <ToolActivityList
        activities={[
          mk('r1', 1, 'workspace_exec', '已运行', 'git status --short'),
          mk('r2', 2, 'workspace_read', '已读取', 'docs/AUDIT-LOG.md'),
        ]}
        reasoningByIteration={{ 1: '先看工作区状态', 2: '再看台账 diff' }}
        collapseWhenSettled
      />
    );
    // v3 — 完成簇默认折叠，点簇头展开；完成态思考行只留标签（预览不渲染）
    fireEvent.click(screen.getByText(/执行工具 2 次/));
    const thinkHeads = screen.getAllByRole('button', { name: '展开 已思考' });
    expect(thinkHeads.length).toBe(2);
    // 点开两行思考后，交错顺序仍为：思考(1) → 命令(1) → 思考(2) → 文件(2)
    thinkHeads.forEach((button) => fireEvent.click(button));
    const body = screen.getByTestId('qoder-cluster-body').textContent || '';
    expect(body.indexOf('先看工作区状态')).toBeGreaterThanOrEqual(0);
    expect(body.indexOf('先看工作区状态')).toBeLessThan(body.indexOf('git status --short'));
    expect(body.indexOf('git status --short')).toBeLessThan(body.indexOf('再看台账 diff'));
    expect(body.indexOf('再看台账 diff')).toBeLessThan(body.indexOf('docs/AUDIT-LOG.md'));
  });

  it('UI-430 单工具簇：折叠簇头携带该工具的一行摘要；零耗时不显示', () => {
    render(
      <ToolActivityList
        activities={[execActivity({ durationMs: 0 })]}
        collapseWhenSettled
      />
    );
    const head = screen.getByText(/执行工具 1 次/).textContent || '';
    expect(head).toContain('已运行 npm run docs:reconcile');
    expect(head).not.toContain('耗时');
    expect(head).not.toContain('0 ms');
  });

  it('UI-437 v5.4 未登记工具：参数摘要兜底（不再只剩工具名）', () => {
    expect(summarizeToolCall('query', { datasets: '项目文档' }).actionDetail)
      .toBe('query（datasets=项目文档）');
    expect(summarizeToolCall('todo_write', { todos: [{ id: 1 }] }).actionDetail)
      .toBe('todo_write（todos=[{"id":1}]）');
    expect(summarizeToolCall('plan', { op: 'create', draft: true }).actionDetail)
      .toBe('plan（op=create · draft=true）');
    // 无参数回退工具名
    expect(summarizeToolCall('query').actionDetail).toBe('query');
    // 已登记工具不受影响
    expect(summarizeToolCall('workspace_read', { path: 'src/a.ts' }).actionDetail).toBe('src/a.ts');
  });

  it('UI-437 v5.8 行级复制：点击复制钮写入该行可见内容', async () => {
    render(
      <ToolActivityList
        activities={[{
          key: 'ks-2', name: 'knowledge_search', status: 'success', actionLabel: '已调用',
          actionDetail: 'knowledge_search（spaceEnabled=false）',
          summary: 'spaceEnabled false · hits 0 条',
        }]}
        collapseWhenSettled
      />
    );
    const writeText = vi.fn((text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    // v3 语义：完成簇默认折叠，先点运行摘要行展开，行级复制钮才渲染
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    const btns = screen.getAllByRole('button', { name: '复制该行内容' });
    expect(btns.length).toBeGreaterThanOrEqual(1);
    fireEvent.click(btns[0]);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText.mock.calls[0][0]).toBe('knowledge_search（spaceEnabled=false） → spaceEnabled false · hits 0 条');
  });

  it('UI-437 v5.14 行级耗时只显示慢调用（≥1s）：毫秒级读数是噪声', () => {
    // 两行：快调用 76ms（隐藏）与慢调用 4.3s（保留诊断价值）
    render(
      <ToolActivityList
        activities={[
          { key: 'fast', name: 'knowledge_search', status: 'success', actionLabel: '已调用', durationMs: 76 },
          { key: 'slow', name: 'workspace_exec', status: 'success', actionLabel: '已运行', durationMs: 4300 },
        ]}
        collapseWhenSettled
      />
    );
    // v3 语义：完成簇默认折叠，先点运行摘要行展开行级明细
    fireEvent.click(screen.getByText(/执行工具 2 次/));
    const heads = screen.getAllByTestId('qoder-row-head').map((n) => n.textContent || '');
    expect(heads.some((t) => t.includes('76 ms'))).toBe(false);
    expect(heads.some((t) => t.includes('4.3 s'))).toBe(true);
  });

  it('UI-437 v5.6 合并方向：result 合并必须携带 resultData（running 项已存在时也不例外）', () => {
    const running: ToolActivityItem[] = [{
      // 运行时键规则 = callId（callKey），与 result 事件按 callId 关联
      key: 'call-ks-1', name: 'knowledge_search', status: 'running', actionLabel: '已调用',
    }];
    const resultEvent = {
      callId: 'call-ks-1',
      name: 'knowledge_search',
      toolResult: {
        callId: 'call-ks-1', tool: 'knowledge_search', status: 'success',
        durationMs: 3,
        data: { ok: true, spaceEnabled: false, hits: [], message: '知识空间未启用' },
      },
    };
    const merged = mergeToolResultActivity(running, resultEvent as never);
    // 方向回归：resultData 必须取本次结果，而非旧项的 undefined
    expect(merged[0].resultData).toEqual({ ok: true, spaceEnabled: false, hits: [], message: '知识空间未启用' });
  });

  it('UI-437 v5.11 展开体：直接渲染返回 JSON 框（无工具名行/无「返回」标题，行复制钮隐藏）', async () => {
    render(
      <ToolActivityList
        activities={[{
          key: 'si-1', name: 'system_info', status: 'success', actionLabel: '已查询',
          actionDetail: '系统环境',
          resultData: { os: 'Windows', shell: 'cmd.exe' },
        }]}
        collapseWhenSettled
      />
    );
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    // 展开前行级复制钮在（悬停显现）；点行头展开后隐藏（复制 affordance 归 JSON 框内钮）
    expect(screen.getAllByRole('button', { name: '复制该行内容' }).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByTestId('qoder-row-head'));
    // v5.11 — 无「返回」标题、无工具名行：展开体首个内容直接就是 JSON 本体
    expect(screen.queryByText('返回')).toBeNull();
    expect(document.querySelector('.sc-tool-activity-tool')).toBeNull();
    expect(screen.getByText(/"os": "Windows"/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制该行内容' })).toBeNull();

    // 复制按钮：悬浮于框内右上角，写剪贴板内容 = 返回 JSON 本体
    const writeText = vi.fn((text: string) => Promise.resolve());
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    const copyBtn = screen.getByRole('button', { name: '复制返回 JSON' });
    expect(copyBtn.closest('.sc-tool-resultdata-frame')).not.toBeNull();
    fireEvent.click(copyBtn);
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(JSON.parse(writeText.mock.calls[0][0])).toEqual({ os: 'Windows', shell: 'cmd.exe' });
  });

  it('UI-437 v5.5 行内组合：参数摘要 → 结果摘要；ok 样板不显示', () => {
    const { rerender } = render(
      <ToolActivityList
        activities={[{
          key: 'q9', name: 'query', status: 'success', actionLabel: '已调用',
          actionDetail: 'query（datasets=项目文档）',
          summary: 'datasets 0 条 · analyses 0 条',
        }]}
        collapseWhenSettled
      />
    );
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    // 簇头单工具摘要与行预览都携带参数摘要（≥2 处）；结果摘要以 → 连接出现在行上
    expect(screen.getAllByText(/query（datasets=项目文档）/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/→ datasets 0 条 · analyses 0 条/)).toBeTruthy();

    // summary='ok' 样板被过滤，不显示 → ok
    rerender(
      <ToolActivityList
        activities={[{
          key: 'q10', name: 'query', status: 'success', actionLabel: '已调用',
          actionDetail: 'query（datasets=项目文档）',
          summary: 'ok',
        }]}
        collapseWhenSettled
      />
    );
    expect(screen.queryByText(/→ ok/)).toBeNull();
  });

  it('UI-437 v5.3 输出预览兜底：actionDetail 为空的调用行显示输出尾首个非空行（ANSI 剥离）', () => {
    render(
      <ToolActivityList
        activities={[{
          key: 'q1', name: 'query', status: 'success', actionLabel: '已调用',
          output: { tail: '\n\u001b[32m[ 数据集 A ]\u001b[0m\n2 条记录\n', truncated: false },
        }]}
        collapseWhenSettled
      />
    );
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    expect(screen.getByText('[ 数据集 A ]')).toBeTruthy();
  });
});

describe('BLOCK-107 P2c 运行中秒表（showRunningStopwatch）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启用时按墙钟累计，且转终态后不再挂计时器', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    const { rerender } = render(
      <ToolActivityList activities={[activity('running')]} showRunningStopwatch />,
    );
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).not.toMatch(/已运行/);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).toMatch(/已运行 1\.0 s/);
    act(() => { vi.advanceTimersByTime(1500); });
    // 读数由 1 秒 interval 落点写入：推进 2.5 s 时最后一次 tick 在 2000 ms
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).toMatch(/已运行 2\.0 s/);

    // 终态：秒表消失，改显既有活动耗时，且 interval 已卸载（再推进不重渲染）
    rerender(<ToolActivityList activities={[activity('success', { durationMs: 4200 })]} showRunningStopwatch />);
    expect(screen.queryByText(/已运行 \d/)).toBeNull();
    expect(screen.getByText(/耗时 4\.2 s/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText(/耗时 4\.2 s/)).toBeTruthy();
  });

  it('默认不启用：既有摘要文本零变化（不挂计时器）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    render(<ToolActivityList activities={[activity('running')]} />);
    act(() => { vi.advanceTimersByTime(5000); });
    const text = screen.getByText(/正在处理 1\/1 项/).textContent || '';
    expect(text).not.toMatch(/已运行/);
  });
});
