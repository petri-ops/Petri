import type { ToolActivityItem } from './toolActivity';

export const TOOL_SUMMARY_UNAVAILABLE_MESSAGE = '✓ 工具已完成，AI 总结暂时不可用';

interface ToolSummaryPresentationInput {
  assistantContent: string;
  assistantError: boolean;
  statusMessage?: string;
  toolActivities?: ToolActivityItem[];
}

export interface ToolSummaryPresentation {
  content: string;
  error: boolean;
  statusMessage?: string;
  summaryUnavailable: boolean;
}

function isTimeoutMessage(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  return normalized.includes('超时') || normalized.includes('timeout');
}

export function resolveToolSummaryPresentation(
  input: ToolSummaryPresentationInput
): ToolSummaryPresentation {
  const toolSucceeded = input.toolActivities?.some(
    (activity) => activity.name === 'run_tool' && activity.status === 'success'
  ) === true;
  const summaryUnavailable = input.assistantError
    && toolSucceeded
    && (isTimeoutMessage(input.assistantContent) || isTimeoutMessage(input.statusMessage));

  if (!summaryUnavailable) {
    return {
      content: input.assistantContent,
      error: input.assistantError,
      statusMessage: input.statusMessage,
      summaryUnavailable: false,
    };
  }

  return {
    content: TOOL_SUMMARY_UNAVAILABLE_MESSAGE,
    error: false,
    statusMessage: TOOL_SUMMARY_UNAVAILABLE_MESSAGE,
    summaryUnavailable: true,
  };
}
