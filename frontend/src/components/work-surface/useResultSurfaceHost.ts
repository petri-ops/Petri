import React from 'react';
import type { ToolJob } from '@/lib/project-types';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';
import type { ResultSurfaceMode } from '@/components/result-studio/resultSurface';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { resolveResultSurfaceHost } from '@/components/result-studio/resultSurfaceHost';
import { usePackResultData } from '@/lib/workSurface/packResultData';
import { shouldDowngradeToCore, usePackTabData } from '@/lib/workSurface/usePackTabData';
import { fetchArtifactInteraction } from '@/lib/result-studio-interaction-client';
import { getApiPrefix } from '@/lib/env';

interface ArtifactIdentity {
  revisionId: string;
  revisionOrdinal: number | null;
  artifactFamilyId: string | null;
  changeSetId: string | null;
  artifactId: string | null;
}

// BLOCK-252 — pack 面接管后身份水化的一次性缓存：跨宿主重挂/多实例去重，
// 避免「设置 → 被空投影清空 → 再设置」的请求反馈环。模块级而非实例级，
// 右栏 keep-alive 栈切换 tab 不会让同一 artifact 重新取数。
const hydratedArtifactIdentities = new Map<string, ArtifactIdentity>();
const inflightArtifactIdentities = new Map<string, Promise<void>>();

/**
 * BLOCK-334 — 结果宿主的 pack 解析簇（自 CenterPanel 原样平移）：
 * pack 结果面 / tab 级接管解析、取数失败回落核心、以及 pack 接管后 revision
 * 身份的只读水化。宿主只消费返回值，不再各自复制这组判定。
 */
export function useResultSurfaceHost(input: {
  packResultSurfaces: WorkSurfaceDescriptor[];
  activeArtifact: ActiveArtifact | null;
  setActiveArtifact: (artifact: ActiveArtifact | null) => void;
  activeJob: ToolJob | null;
  projectId: string | undefined;
  mode: ResultSurfaceMode;
  changeSetId: string | null;
}) {
  const { packResultSurfaces, activeArtifact, setActiveArtifact, activeJob, projectId, mode, changeSetId } = input;
  const resultSurfaceHost = resolveResultSurfaceHost(packResultSurfaces ?? [], activeArtifact, mode);
  // BLOCK-236 — tab 级接管：取数失败即回落核心（不渲染空白 iframe）
  const packTabState = usePackTabData(
    resultSurfaceHost.tab,
    {
      projectId,
      jobId: activeJob?.id,
      revisionId: activeArtifact?.revisionId,
      changeSetId,
    },
    getApiPrefix(),
  );
  const downgradeToCore = shouldDowngradeToCore(resultSurfaceHost.tab, packTabState);
  const packResultData = usePackResultData(resultSurfaceHost.source === 'pack' ? activeArtifact : null);

  // BLOCK-252 — pack 接管 result body（或切到 code/compare/history）后核心
  // ResultArtifactShell 可能不再挂载/丢选中态，交互清单的 revision/family 水化会丢失；
  // 这里在缺版本时补一次只读投影，否则 pack tab 与历史面板都拿不到 revisionId。
  const packIdentityJobId = activeJob && activeArtifact && !activeArtifact.revisionId ? activeJob.id : null;
  const packIdentityArtifactName = packIdentityJobId ? activeArtifact?.name ?? null : null;
  const packIdentityKey = packIdentityJobId && packIdentityArtifactName
    ? `${packIdentityJobId}\0${packIdentityArtifactName}` : null;
  React.useEffect(() => {
    if (!packIdentityKey || !packIdentityJobId || !packIdentityArtifactName || !activeArtifact) return undefined;
    const apply = (identity: ArtifactIdentity) => {
      // 异步返回时 artifact 可能已切换；身份只能落到当初请求的那个产物上。
      if (!activeArtifact
        || activeArtifact.jobId !== packIdentityJobId
        || activeArtifact.name !== packIdentityArtifactName) return;
      setActiveArtifact({
        ...activeArtifact,
        revisionId: identity.revisionId,
        revisionOrdinal: identity.revisionOrdinal,
        artifactFamilyId: identity.artifactFamilyId,
        changeSetId: identity.changeSetId,
        artifactId: identity.artifactId,
      });
    };
    const cached = hydratedArtifactIdentities.get(packIdentityKey);
    if (cached) {
      apply(cached);
      return undefined;
    }
    let cancelled = false;
    const pending = inflightArtifactIdentities.get(packIdentityKey) || (async () => {
      const response = await fetchArtifactInteraction({
        language: 'r', jobId: packIdentityJobId, artifact: packIdentityArtifactName,
      });
      const revision = response.revision || {};
      const manifest = response.manifest;
      const revisionId = typeof revision.revisionId === 'string' ? revision.revisionId : manifest.revisionId;
      if (!revisionId) throw new Error('revision_identity_missing');
      hydratedArtifactIdentities.set(packIdentityKey, {
        revisionId,
        revisionOrdinal: typeof revision.revisionOrdinal === 'number' ? revision.revisionOrdinal : null,
        artifactFamilyId: typeof revision.artifactFamilyId === 'string'
          ? revision.artifactFamilyId : manifest.artifactFamilyId ?? null,
        changeSetId: typeof revision.changeSetId === 'string' ? revision.changeSetId : null,
        artifactId: manifest.artifactId ?? null,
      });
    })().finally(() => { inflightArtifactIdentities.delete(packIdentityKey); });
    inflightArtifactIdentities.set(packIdentityKey, pending);
    void pending.then(() => {
      if (cancelled) return;
      const identity = hydratedArtifactIdentities.get(packIdentityKey);
      if (identity) apply(identity);
    }).catch(() => null);
    return () => { cancelled = true; };
  }, [packIdentityKey, packIdentityJobId, packIdentityArtifactName, activeArtifact, setActiveArtifact]);

  return { resultSurfaceHost, packTabState, downgradeToCore, packResultData };
}
