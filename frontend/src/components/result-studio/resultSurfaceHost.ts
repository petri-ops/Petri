import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { resolveResultSurface } from '@/lib/workSurface/registry';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';

/** BLOCK-236 — 模式 → pack 只读 tab 的映射（未列出的模式不参与 tab 级接管）。 */
const MODE_TO_PACK_TAB: Record<string, string> = {
  code: 'revisions-source',
  history: 'history',
  compare: 'compare',
};

export interface ResultSurfaceHostResolution {
  source: 'pack' | 'core-transitional';
  descriptor?: WorkSurfaceDescriptor;
  artifactKinds: string[];
  /** BLOCK-236 — 命中的只读 tab（无则 undefined，= 只接管模式主 body）。 */
  tab?: string;
  /** 回落原因（core-transitional 时给出，便于 DOM 标注与测试断言）。 */
  reason?: 'no_matching_surface' | 'tab_not_claimed' | 'no_tab_host_node';
}

/**
 * BLOCK-216 Q5 — 结果面 host 解析；BLOCK-236 扩展 tab 级接管。
 *
 * 规则（顺序固定，可解释）：
 * 1. 先按 `modes` 过滤出模式候选；
 * 2. 若当前模式映射到 pack tab（code→revisions-source / history→history）：
 *    - 候选里**声明了该 tab** 的 surface 才算命中，并把 `tab` 带出；
 *    - 没声明 → 回落核心，reason=`tab_not_claimed`（宁可不接管，也不给空 iframe）；
 * 3. 其余模式沿用 BLOCK-218 行为（只接管模式主 body）。
 */
export function resolveResultSurfaceHost(
  surfaces: readonly WorkSurfaceDescriptor[],
  artifact: Pick<ActiveArtifact, 'type' | 'semanticKind'> | null,
  mode: string = 'result'
): ResultSurfaceHostResolution {
  const artifactKinds = [artifact?.semanticKind, artifact?.type]
    .filter((kind): kind is string => typeof kind === 'string' && kind.length > 0);
  const candidates = surfaces.filter((surface) => (surface.modes ?? ['result']).includes(mode));
  const requestedTab = MODE_TO_PACK_TAB[mode];

  if (requestedTab) {
    const declaring = candidates.filter((surface) =>
      (surface.tabs ?? []).some((tab) => tab.id === requestedTab),
    );
    if (declaring.length === 0) {
      return { source: 'core-transitional', artifactKinds, reason: 'tab_not_claimed' };
    }
    const descriptor = resolveResultSurface({ surfaces: declaring }, { artifactKinds });
    return descriptor
      ? { source: 'pack', descriptor, artifactKinds, tab: requestedTab }
      : { source: 'core-transitional', artifactKinds, reason: 'no_matching_surface' };
  }

  const descriptor = resolveResultSurface({ surfaces: candidates }, { artifactKinds });
  return descriptor
    ? { source: 'pack', descriptor, artifactKinds }
    : { source: 'core-transitional', artifactKinds, reason: 'no_matching_surface' };
}
