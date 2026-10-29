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

export type Model3DReviewView = 'front' | 'top' | 'side' | 'iso';

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
