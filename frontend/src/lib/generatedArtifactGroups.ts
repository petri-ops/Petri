/**
 * item83 追加④：同一轮任务的生成产物聚合分组。
 * UI-430 会把相邻工具轮合并进一个 segment，所以必须直接按 activity.iteration 分组，
 * 不同轮次的产物各自成卡，不跨轮合并。
 */
import { generatedArtifactsFromResult } from '@/components/copilot/ChatArtifactCard';
import type { ChatArtifact } from '@/components/copilot/ChatArtifactCard';
import type { ToolActivityItem } from '@/components/copilot/toolActivity';

export interface GeneratedArtifactGroup {
  iteration: number;
  artifacts: ChatArtifact[];
  durationMs: number | null;
}

export function groupGeneratedActivities(activities: ToolActivityItem[]): GeneratedArtifactGroup[] {
  const groups = new Map<number, GeneratedArtifactGroup>();
  for (const activity of activities) {
    if (!activity.name.startsWith('generate.') || activity.status !== 'success') continue;
    const artifacts = generatedArtifactsFromResult(activity.resultData);
    if (!artifacts) continue;
    const iteration = typeof activity.iteration === 'number' ? activity.iteration : -1;
    const group = groups.get(iteration) || { iteration, artifacts: [], durationMs: null };
    group.artifacts.push(...artifacts);
    if (typeof activity.durationMs === 'number' && Number.isFinite(activity.durationMs)) {
      group.durationMs = (group.durationMs || 0) + activity.durationMs;
    }
    groups.set(iteration, group);
  }
  return [...groups.values()];
}
