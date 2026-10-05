/**
 * fetchCrossJobPinSnapshot — BLOCK-140 P1 第二刀：跨 job 钉住快照构建。
 *
 * 血缘节点「钉住」入口（LineageStrip 悬停小钮 / LineageGraph 右键）→ 宿主
 * （ResultArtifactShell）用本构建器按既有打开链同源数据源拉目标 job 结果：
 * /tools/status/{jobId}（与 ResultArtifactShell 结果拉取同款端点）→ 首选产物
 * → 视图级快照（ArtifactPinSnapshot）。文本/表格载荷在钉住时刻一次取足；
 * report/image 只留 url；副栏 ArtifactPinPane 渲染仍零取数（D1 不破）。
 * 请求失败/无结果/无产物 → null（诚实，不猜）。
 */

import { getApiPrefix, getToken } from '@/lib/authClient';
import { buildPreviewTable } from '@/lib/file-preview/buildPreviewTable';
import {
  classifyArtifact,
  pickPreferredArtifact,
  type ResultArtifactRecord,
} from '@/lib/result-manifest';
import { artifactName } from './ResultView/helpers';
import type { JobResultFile } from './ResultView/types';
import { formatPreviewText } from '@/lib/previewFileUtils';
import { resolveResultViewerAdapter } from '@/components/result-studio/resultSurface';
import type { ArtifactPinSnapshot } from './ArtifactPinPane';

const authHeaders = (): Record<string, string> => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export async function fetchCrossJobPinSnapshot({ toolJobId, lang }: {
  toolJobId: string;
  lang: 'r' | 'python';
}): Promise<ArtifactPinSnapshot | null> {
  try {
    const base = getApiPrefix(lang);
    const resp = await fetch(`${base}/tools/status/${encodeURIComponent(toolJobId)}`, {
      headers: authHeaders(),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { ok?: unknown; result?: { artifacts?: JobResultFile[]; files?: JobResultFile[] } | null };
    if (!data.ok || !data.result) return null;

    const files = data.result.artifacts || data.result.files || [];
    const buildTargetUrl = (name: string) => `${base}/tools/file/${encodeURIComponent(toolJobId)}/${encodeURIComponent(name)}`;
    const artifacts: ResultArtifactRecord[] = files.map((file) => ({
      name: artifactName(file),
      type: file.type,
      label: file.label || file.title,
      title: file.title,
      url: buildTargetUrl(artifactName(file)),
      preview: file.preview,
      download: file.download,
    }));
    if (artifacts.length === 0) return null;

    // 首选产物选择与 ResultArtifactShell 主区同规则（core 优先，报告兜底）
    const coreArtifacts = artifacts.filter((artifact) => classifyArtifact(artifact) !== 'report');
    const preferredPool = coreArtifacts.length > 0 ? coreArtifacts : artifacts;
    const preferred = pickPreferredArtifact(preferredPool, '') || preferredPool[0];
    if (!preferred) return null;

    const kind = classifyArtifact(preferred);
    const viewerAdapter = resolveResultViewerAdapter({ kind, fileName: preferred.name, preview: preferred.preview });
    const snapshot: ArtifactPinSnapshot = {
      jobId: toolJobId,
      artifactName: preferred.name,
      label: preferred.label || preferred.title || preferred.name,
      viewerAdapter,
      previewText: null,
      previewData: null,
      url: buildTargetUrl(preferred.name),
    };

    // 载荷一次取足（钉住动作=有限次取数；此后副栏离线渲染）
    if (viewerAdapter === 'table') {
      const fileResp = await fetch(snapshot.url, { headers: authHeaders() });
      if (fileResp.ok) {
        snapshot.previewData = buildPreviewTable(await fileResp.text(), preferred.name);
      }
    } else if (viewerAdapter === 'json' || viewerAdapter === 'text') {
      const fileResp = await fetch(snapshot.url, { headers: authHeaders() });
      if (fileResp.ok) {
        const text = await fileResp.text();
        if (preferred.name.toLowerCase().endsWith('.json')) {
          try {
            snapshot.previewText = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
            snapshot.previewText = formatPreviewText(preferred.name, text).slice(0, 12000);
          }
        } else {
          snapshot.previewText = formatPreviewText(preferred.name, text).slice(0, 12000);
        }
      }
    }
    return snapshot;
  } catch {
    return null;
  }
}
