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

/** item83 返工第4症：真实 3D 不总走 generate.model3d——
 *  owner 实测 GLB 来自 model3d_asset 导入（workspace-relative 描述符），
 *  降级路径则是 model3d_recipe（source.provider='local'）。两者都必须自动挂卡。 */
function model3dArtifactsFromResult(activity: ToolActivityItem): ChatArtifact[] | null {
  const raw = activity.resultData as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== 'object' || raw.ok === false) return null;
  const artifacts: ChatArtifact[] = [];
  const basename = (p: string) => p.split(/[\\/]/).pop() || p;

  if (activity.name === 'model3d_asset') {
    const asset = raw.asset as Record<string, unknown> | undefined;
    if (asset && typeof asset.path === 'string' && asset.path.endsWith('.glb')) {
      artifacts.push({
        name: typeof asset.name === 'string' && asset.name ? `${asset.name}.glb` : basename(asset.path),
        path: asset.path,
        sha256: typeof asset.sha256 === 'string' ? asset.sha256 : undefined,
        mime: 'model/gltf-binary',
        // 无 url：ChatArtifactCard 用 path + projectId 经 workspaceFileUrlFor 回退，不伪造受控读面。
        source: { provider: 'local', mode: 'model3d.asset', status: typeof asset.format === 'string' ? asset.format : 'glb' },
      });
    }
  }

  if (activity.name === 'model3d_recipe') {
    const source = raw.source as Record<string, unknown> | undefined;
    const render = raw.render as Record<string, unknown> | undefined;
    const outputs = Array.isArray(render?.outputs) ? render.outputs : [];
    for (const output of outputs) {
      const p = (output as Record<string, unknown>)?.path;
      if (typeof p !== 'string' || !p.endsWith('.glb')) continue;
      artifacts.push({
        name: basename(p),
        path: p,
        mime: 'model/gltf-binary',
        source: {
          provider: typeof source?.provider === 'string' ? source.provider : 'local',
          model: typeof source?.model === 'string' ? source.model : 'parametric-recipe',
          mode: typeof source?.mode === 'string' ? source.mode : 'local-approximation',
          status: typeof source?.status === 'string' ? source.status : 'approximation',
        },
      });
    }
  }
  return artifacts.length ? artifacts : null;
}

export function groupGeneratedActivities(activities: ToolActivityItem[]): GeneratedArtifactGroup[] {
  const groups = new Map<number, GeneratedArtifactGroup>();
  for (const activity of activities) {
    if (activity.status !== 'success') continue;
    const isGenerate = activity.name.startsWith('generate.');
    const isModel3d = activity.name === 'model3d_asset' || activity.name === 'model3d_recipe';
    if (!isGenerate && !isModel3d) continue;
    const artifacts = isGenerate
      ? generatedArtifactsFromResult(activity.resultData)
      : model3dArtifactsFromResult(activity);
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
