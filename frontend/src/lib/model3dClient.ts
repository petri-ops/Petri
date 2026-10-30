import { getApiPrefix } from '@/components/copilot/copilotClient';

export interface Model3DCapability {
  status: 'ready' | 'unavailable';
  reason: string | null;
  version: string | null;
}

export async function fetchModel3DCapability(): Promise<Model3DCapability> {
  const response = await fetch(`${getApiPrefix()}/model3d/capability`, {
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null) as (Model3DCapability & { ok?: boolean; error?: string }) | null;
  if (!response.ok || !data) throw new Error((data && data.error) || `HTTP ${response.status}`);
  return data;
}

export type Model3DReviewView = 'front' | 'top' | 'side' | 'iso' | 'camera';

export interface Model3DAppliedConstraint {
  index: number;
  kind: string;
  a: string;
  b: string;
  axis: string;
  field: string;
  from: number;
  to: number;
  changed: boolean;
}

/**
 * BLOCK-322 P3-02b — 只读求值预览：参数引用与装配约束由服务端 `resolveSceneSpec` 烘进 transform
 * 后回传（同一函数即送 Blender 的那一份）。求值只在服务端发生，前端不重解=不建第二套求解器。
 */
export async function resolveModel3DScene(scene: unknown): Promise<{ scene: unknown; appliedConstraints: Model3DAppliedConstraint[] }> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/resolve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => null) as
    | { ok?: boolean; scene?: unknown; appliedConstraints?: Model3DAppliedConstraint[]; error?: string; errors?: string[] }
    | null;
  if (!response.ok || !data || data.ok !== true) {
    const reason = data?.errors?.[0] || data?.error || `HTTP ${response.status}`;
    throw new Error(reason);
  }
  return { scene: data.scene, appliedConstraints: data.appliedConstraints || [] };
}

interface Model3DReviewViewReport {
  view: Model3DReviewView;
  observations: string[];
  suspectedIssues: string[];
  uncertain: string[];
}

interface Model3DReviewVision {
  status: 'ready' | 'degraded' | 'unavailable';
  reason?: string | null;
  message?: string | null;
  model?: string | null;
  parseStatus?: 'structured' | 'unstructured';
  views?: Model3DReviewViewReport[];
  rawText?: string | null;
}

interface Model3DReviewMeshReport {
  objects?: number;
  vertices?: number;
  triangles?: number;
  nonManifoldEdges?: number;
  watertight?: boolean;
  volumesMm3?: Record<string, number>;
  [key: string]: unknown;
}

export interface Model3DReviewResult {
  ok: true;
  schema: 'model3d-review/v1';
  sceneHash: string;
  provider: { name: string; version: string | null };
  render: {
    outDir: string;
    report: {
      ok?: boolean;
      renders?: Record<string, string>;
      exports?: Record<string, string>;
      mesh?: Model3DReviewMeshReport;
      [key: string]: unknown;
    };
    outputs: Array<{ path: string; sha256: string; bytes: number }>;
  };
  vision: Model3DReviewVision;
}

export async function reviewModel3D(input: {
  projectId: string;
  scene: unknown;
  views?: Model3DReviewView[];
}): Promise<Model3DReviewResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      scene: input.scene,
      views: input.views,
    }),
    signal: AbortSignal.timeout(190_000),
  });
  const data = await response.json().catch(() => null) as
    | (Model3DReviewResult & { error?: string; message?: string | null })
    | null;
  if (!response.ok || !data || !data.ok) {
    throw new Error((data && (data.message || data.error)) || `HTTP ${response.status}`);
  }
  return data;
}
