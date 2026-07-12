import { describe, expect, it } from 'vitest';
import {
  buildChainPrompt,
  getNextSteps,
  normalizeWorkflowToolId,
  type ResolvedJob,
} from './workflow-chains';

describe('workflow-chains', () => {
  it('returns the current built-in volcano recommendation for DESeq2', () => {
    const steps = getNextSteps('deseq2');
    expect(steps.some((step) => step.to === 'volcano-plot')).toBe(true);
  });

  it('builds prompts with resolved result references', () => {
    const job: ResolvedJob = {
      id: 'job_1',
      toolId: 'deseq2',
      resultFiles: [
        { name: 'deg_table.csv', url: '/results/deg_table.csv', type: 'table' },
      ],
    };
    const prompt = buildChainPrompt(
      {
        from: 'deseq2',
        to: 'volcano-plot',
        reason: '差异分析完成，可继续火山图',
        paramMap: { deg_table: '{file:deg_table}' },
      },
      job,
      'DESeq2'
    );

    expect(prompt).toContain('volcano-plot');
    expect(prompt).toContain('/results/deg_table.csv');
  });
});
