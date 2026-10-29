import { getApiPrefix } from '@/components/copilot/copilotClient';

export interface SceneRevisionSummary {
  revisionId: string;
  ordinal: number;
  hash: string;
  reason: string;
  createdAt: string;
}

export interface SceneDiff {
  beforeHash: string;
  afterHash: string;
  parameters: Array<{ name: string; before?: number; after?: number; status: 'added' | 'removed' | 'changed' }>;
  nodes: Array<{ id: string; status: 'added' | 'removed' | 'changed'; fields: string[] }>;
  constraints: { added: unknown[]; removed: unknown[] };
  changed: boolean;
}

export interface SceneApplyResult {
  ok: true;
  path: string;
  beforeHash: string;
  afterHash: string;
  revision: SceneRevisionSummary | null;
  diff: SceneDiff;
  scene: unknown;
}

function headers(): HeadersInit {
  return { 'Content-Type': 'application/json' };
}

async function parse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok || !data || (data as { ok?: boolean }).ok === false) {
    throw new Error((data && (data.message || data.error)) || `HTTP ${response.status}`);
  }
  return data;
}

export async function readSceneFile(projectId: string, path: string): Promise<{ scene: unknown; hash: string }> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/read`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ projectId, path }),
    signal: AbortSignal.timeout(15_000),
  });
  return parse<{ scene: unknown; hash: string }>(response);
}

export async function applySceneOperations(input: {
  projectId: string;
  path: string;
  scene?: unknown;
  operations: Array<Record<string, unknown>>;
  expectedHash?: string | null;
  reason?: string;
}): Promise<SceneApplyResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/apply`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
  return parse<SceneApplyResult>(response);
}

export async function listSceneRevisions(projectId: string, path: string): Promise<SceneRevisionSummary[]> {
  const query = new URLSearchParams({ projectId, path });
  const response = await fetch(`${getApiPrefix()}/model3d/scene/revisions?${query.toString()}`, {
    signal: AbortSignal.timeout(15_000),
  });
  const data = await parse<{ revisions: SceneRevisionSummary[] }>(response);
  return data.revisions;
}

export async function restoreSceneRevision(input: {
  projectId: string;
  path: string;
  revisionId: string;
}): Promise<{ beforeHash: string; afterHash: string; diff: SceneDiff }> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/restore`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(20_000),
  });
  return parse(response);
}

export async function diffSceneSpecs(before: unknown, after: unknown): Promise<SceneDiff> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/diff`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ before, after }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await parse<{ diff: SceneDiff }>(response);
  return data.diff;
}
