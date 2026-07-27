import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { restoreResultEditProgressEvents } from './copilotClient';
import { compactStageConclusion, ResultEditProgressList } from './SimpleChat';

afterEach(cleanup);

describe('compactStageConclusion', () => {
  it('keeps only the first public conclusion sentence', () => {
    expect(compactStageConclusion(
      '好，计划已确认，5 个步骤全部待执行。现在开始第 1 步：表达矩阵质控。'
    )).toBe('计划已确认，5 个步骤全部待执行。');
  });

  it('removes conversational acknowledgement prefixes', () => {
    expect(compactStageConclusion('好的，文件确认就绪。接下来运行质控。'))
      .toBe('文件确认就绪。');
  });

  it('bounds unusually long conclusions', () => {
    expect(compactStageConclusion('结论' + '很长'.repeat(200), 20)).toHaveLength(20);
    expect(compactStageConclusion('结论' + '很长'.repeat(200), 20)).toMatch(/…$/u);
  });
});

describe('P4R-3 persisted ResultEdit progress', () => {
  it('restores SQLite message meta and renders only public phases plus a bounded terminal conclusion', () => {
    const events = restoreResultEditProgressEvents([
      {
        resultEditProgressVersion: 1, sequence: 1, changeSetId: '',
        stage: 'intent', status: 'completed', publicPhase: 'understand_intent', publicPhaseLabel: '理解意图',
      },
      {
        resultEditProgressVersion: 1, sequence: 2, changeSetId: '',
        stage: 'failed', status: 'terminal', reason: 'agent_run_failed: private provider detail',
      },
    ]);
    render(React.createElement(ResultEditProgressList, { events }));
    expect(screen.getByText('理解意图')).toBeTruthy();
    expect(screen.getByText('修改未完成')).toBeTruthy();
    expect(document.body.textContent).not.toContain('private provider detail');
    expect(document.body.textContent).not.toContain('intent');
  });
});
