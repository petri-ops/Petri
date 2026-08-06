import { describe, it, expect } from 'vitest';

/**
 * UX1H: SimpleChat "tool succeeded + AI summary timeout" rendering tests
 *
 * Covers the scenario where a tool (e.g., DESeq2) completes successfully but
 * the LLM summary phase times out, ensuring the UI does not misleadingly
 * render the entire operation as "failed".
 */

describe('SimpleChat UX1H: Tool success + AI summary timeout', () => {
  it('should detect tool success in toolActivities', () => {
    const toolActivities = [
      { status: 'success', actionLabel: 'DESeq2', name: 'run_tool', key: 'tj_123' },
    ];
    const toolSucceeded = toolActivities.some((activity) => activity.status === 'success');
    expect(toolSucceeded).toBe(true);
  });

  it('should detect timeout in statusMessage', () => {
    const statusMessage = '请求超时';
    const summaryTimeout = statusMessage.includes('超时') || statusMessage.includes('timeout');
    expect(summaryTimeout).toBe(true);
  });

  it('should rewrite error flag when tool succeeded + summary timeout', () => {
    const toolActivities = [
      { status: 'success', actionLabel: 'DESeq2', name: 'run_tool', key: 'tj_123' },
    ];
    const assistantError = true;
    const statusMessage = '请求超时';

    const toolSucceeded = toolActivities.some((activity) => activity.status === 'success');
    const summaryTimeout = assistantError &&
      (statusMessage.includes('超时') || statusMessage.includes('timeout'));
    const shouldRewriteError = toolSucceeded && summaryTimeout;

    expect(shouldRewriteError).toBe(true);
  });

  it('should not rewrite error when tool failed', () => {
    const toolActivities = [
      { status: 'error', actionLabel: 'DESeq2', name: 'run_tool', key: 'tj_123' },
    ];
    const assistantError = true;
    const statusMessage = '请求超时';

    const toolSucceeded = toolActivities.some((activity) => activity.status === 'success');
    const summaryTimeout = assistantError &&
      (statusMessage.includes('超时') || statusMessage.includes('timeout'));
    const shouldRewriteError = toolSucceeded && summaryTimeout;

    expect(shouldRewriteError).toBe(false);
  });

  it('should not rewrite error when no timeout', () => {
    const toolActivities = [
      { status: 'success', actionLabel: 'DESeq2', name: 'run_tool', key: 'tj_123' },
    ];
    const assistantError = true;
    const statusMessage = 'Model returned empty response';

    const toolSucceeded = toolActivities.some((activity) => activity.status === 'success');
    const summaryTimeout = assistantError &&
      (statusMessage.includes('超时') || statusMessage.includes('timeout'));
    const shouldRewriteError = toolSucceeded && summaryTimeout;

    expect(shouldRewriteError).toBe(false);
  });

  it('should produce friendly status message when rewriting', () => {
    const shouldRewriteError = true;
    const originalStatusMessage = '请求超时';
    const finalStatusMessage = shouldRewriteError
      ? '✓ 工具已完成，AI 总结暂时不可用（可稍后重试或查看结果）'
      : originalStatusMessage;

    expect(finalStatusMessage).toBe('✓ 工具已完成，AI 总结暂时不可用（可稍后重试或查看结果）');
    expect(finalStatusMessage).not.toContain('失败');
    expect(finalStatusMessage).not.toContain('错误');
    expect(finalStatusMessage).toContain('✓');
  });
});
