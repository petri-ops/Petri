import { describe, expect, it } from 'vitest';
import type { ToolActivityItem } from './toolActivity';
import {
  resolveToolSummaryPresentation,
  TOOL_SUMMARY_UNAVAILABLE_MESSAGE,
} from './toolSummaryPresentation';

function activity(
  status: ToolActivityItem['status'],
  name = 'run_tool'
): ToolActivityItem {
  return {
    key: `${name}:${status}`,
    name,
    status,
    actionLabel: '已运行',
    actionDetail: 'deseq2',
  };
}

describe('SimpleChat UX1H tool-summary presentation', () => {
  it('rewrites the actual conversationRunStore timeout snapshot after a successful tool', () => {
    const result = resolveToolSummaryPresentation({
      assistantContent: '⚠️ 请求超时',
      assistantError: true,
      statusMessage: undefined,
      toolActivities: [activity('success')],
    });

    expect(result).toEqual({
      content: TOOL_SUMMARY_UNAVAILABLE_MESSAGE,
      error: false,
      statusMessage: TOOL_SUMMARY_UNAVAILABLE_MESSAGE,
      summaryUnavailable: true,
    });
    expect(result.content).not.toContain('请求超时');
  });

  it('also handles providers that put the timeout in statusMessage', () => {
    expect(resolveToolSummaryPresentation({
      assistantContent: '',
      assistantError: true,
      statusMessage: 'upstream timeout',
      toolActivities: [activity('success')],
    }).content).toBe(TOOL_SUMMARY_UNAVAILABLE_MESSAGE);
  });

  it('does not hide a timeout when the tool failed', () => {
    expect(resolveToolSummaryPresentation({
      assistantContent: '⚠️ 请求超时',
      assistantError: true,
      toolActivities: [activity('error')],
    })).toMatchObject({
      content: '⚠️ 请求超时',
      error: true,
      summaryUnavailable: false,
    });
  });

  it('does not treat an unrelated successful helper as a completed ToolJob', () => {
    expect(resolveToolSummaryPresentation({
      assistantContent: '⚠️ 请求超时',
      assistantError: true,
      toolActivities: [activity('success', 'workspace_read')],
    })).toMatchObject({
      content: '⚠️ 请求超时',
      error: true,
      summaryUnavailable: false,
    });
  });

  it('does not hide a non-timeout model error after a successful tool', () => {
    expect(resolveToolSummaryPresentation({
      assistantContent: '⚠️ Model returned an invalid response',
      assistantError: true,
      toolActivities: [activity('success')],
    })).toMatchObject({
      content: '⚠️ Model returned an invalid response',
      error: true,
      summaryUnavailable: false,
    });
  });

  it('preserves successful assistant content', () => {
    expect(resolveToolSummaryPresentation({
      assistantContent: 'DESeq2 已完成，正式结果已打开。',
      assistantError: false,
      toolActivities: [activity('success')],
    })).toMatchObject({
      content: 'DESeq2 已完成，正式结果已打开。',
      error: false,
      summaryUnavailable: false,
    });
  });
});
