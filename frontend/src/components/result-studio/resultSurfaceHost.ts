import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { resolveResultSurface } from '@/lib/workSurface/registry';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';

export interface ResultSurfaceHostResolution {
  source: 'pack' | 'core-transitional';
  descriptor?: WorkSurfaceDescriptor;
  artifactKinds: string[];
}

/**
 * BLOCK-216 Q5 — 结果面 host 解析。
 * Q5 阶段：pack 有匹配 surface 就挂载；没有则保留核心 transitional 生信面。
 * P2b 才把生信结果页物理迁入 pack，并在这里切换 missing 空态。
 */
export function resolveResultSurfaceHost(
  surfaces: readonly WorkSurfaceDescriptor[],
  artifact: Pick<ActiveArtifact, 'type' | 'semanticKind'> | null
): ResultSurfaceHostResolution {
  const artifactKinds = [artifact?.semanticKind, artifact?.type]
    .filter((kind): kind is string => typeof kind === 'string' && kind.length > 0);
  const descriptor = resolveResultSurface({ surfaces: [...surfaces] }, { artifactKinds });
  return descriptor
    ? { source: 'pack', descriptor, artifactKinds }
    : { source: 'core-transitional', artifactKinds };
}
