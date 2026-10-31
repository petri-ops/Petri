import { getApiPrefix } from '@/components/copilot/copilotClient';
import type { MeshInputFormat } from './meshAssets';

/** SceneSpec 默认落盘路径（3D 工作台与编辑面板共用，勿在别处再写一遍字面量）。 */
export const DEFAULT_SCENE_PATH = 'model3d/scene.scene3d.json';

export interface MeshAssetInspection {
  ok: true;
  path: string;
  format: MeshInputFormat;
  bytes: number;
  sourceSha256: string;
  maxBytes: number;
}

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

export async function inspectMeshAsset(input: {
  projectId: string;
  path: string;
}): Promise<MeshAssetInspection> {
  const response = await fetch(`${getApiPrefix()}/model3d/asset/inspect`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(30_000),
  });
  return parse<MeshAssetInspection>(response);
}

export interface CadAssetImportResult {
  ok: true;
  asset: { id: string; name: string; path: string; sha256: string; bytes: number; format: string; sourcePath: string };
  node: { id: string; type: 'mesh-reference'; source: { path: string; sourceSha256: string }; label: string };
  provenance: Record<string, unknown>;
  cad: {
    sourceFormat: 'step' | 'iges';
    derivedFormat: 'glb' | 'stl';
    sourceSha256: string;
    derivedSha256: string;
    sourcePath: string;
    kernel: string | null;
    kernelVersion: string | null;
    [key: string]: unknown;
  };
}

export async function importCadAsset(input: {
  projectId: string;
  path: string;
  name?: string;
}): Promise<CadAssetImportResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/asset/import-cad`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(180_000),
  });
  return parse<CadAssetImportResult>(response);
}

export interface GeneratedModelAssetResult {
  ok: true;
  asset: { id: string; name: string; path: string; sha256: string; bytes: number; format: string; sourcePath: string };
  node: { id: string; type: 'mesh-reference'; source: { path: string; sourceSha256: string }; label: string };
  provenance: Record<string, unknown>;
  generation: {
    provider: string;
    model: string | null;
    taskId: string | null;
    usage: unknown;
    promptHash: string;
    glbSha256?: string;
    bytes?: number;
  };
}

export async function generateModelAsset(input: {
  projectId: string;
  prompt: string;
  name?: string;
}): Promise<GeneratedModelAssetResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/asset/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(360_000),
  });
  return parse<GeneratedModelAssetResult>(response);
}

export interface CadDrawingResult {
  ok: true;
  source: { path: string; format: string; sha256: string; bytes: number };
  svgPath: string;
  svgSha256: string;
  bytes: number;
  manifestPath: string;
  svgUrl: string | null;
  manifestUrl: string | null;
  summary: Record<string, unknown>;
  capabilities: { hiddenLineRemoval: boolean; dimensions: boolean; gdt: boolean; note: string };
}

export async function generateCadDrawing(input: {
  projectId: string;
  path: string;
  views?: string[];
  width?: number;
  height?: number;
  showHidden?: boolean;
}): Promise<CadDrawingResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/cad/drawing`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(180_000),
  });
  return parse<CadDrawingResult>(response);
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

interface GeometryFacts {
  objects: number | null;
  triangles: number | null;
  nonManifoldEdges: number | null;
  watertight: boolean;
  totalVolumeMm3: number | null;
  boundsMm: { x: number; y: number; z: number } | null;
}

export interface GeometryCompareResult {
  ok: true;
  schema: 'model3d-geometry-compare/v1';
  before: GeometryFacts;
  after: GeometryFacts;
  deltas: {
    objects: number | null;
    triangles: number | null;
    totalVolumeMm3: number | null;
    boundsMm: { x: number | null; y: number | null; z: number | null } | null;
  };
  changed: boolean;
  provider: { name: string; version: string | null };
}

export async function compareSceneGeometry(input: {
  projectId: string;
  before: unknown;
  after: unknown;
}): Promise<GeometryCompareResult> {
  const response = await fetch(`${getApiPrefix()}/model3d/scene/compare-geometry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(380_000),
  });
  return parse<GeometryCompareResult>(response);
}
