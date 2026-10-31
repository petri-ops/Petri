// ============================================================
// model3dAssetImport.ts — BLOCK-322 P1c：把外部 mesh 资产导成 SceneSpec 节点。
//
// 三步全走既有管道，不新增写面、不产生第二份真相：
//   1) lib/workspaceFileUpload 分片写入 model3d/assets/（同名不覆盖：资产不可变，换名新建）
//   2) POST /api/model3d/asset/inspect 由服务端从磁盘真实计算 sha256/字节，并按 mesh-assets 单源拒绝
//   3) POST /api/model3d/scene/apply 的 add_node 白名单操作写入 SceneSpec（乐观锁 + 修订历史在既有链路内）
// 前端不算哈希、不自报通过；Blender 构建时仍逐字节复验 sourceSha256。
// ============================================================
import {
  cadFormatForPath,
  cadTooLargeMessage,
  MAX_CAD_BYTES,
  MAX_MESH_BYTES,
  meshFormatForPath,
  meshTooLargeMessage,
  type MeshInputFormat,
} from './meshAssets';
import {
  applySceneOperations,
  DEFAULT_SCENE_PATH,
  generateModelAsset,
  importCadAsset,
  inspectMeshAsset,
  readSceneFile,
  type CadAssetImportResult,
  type GeneratedModelAssetResult,
} from './sceneEditClient';
import type { Scene3DNode, Scene3DSpec } from './scene3d';
import { isTargetAlreadyExists, uploadFileToWorkspace } from './workspaceFileUpload';

const ASSET_DIR = 'model3d/assets';
const MAX_NAME_ATTEMPTS = 20;

export interface ImportedMeshAssetNode {
  node: Scene3DNode;
  /** 导入后的 SceneSpec（服务端回写结果，供视图直接重载）。 */
  scene: unknown;
  path: string;
  format: MeshInputFormat;
  bytes: number;
  sourceSha256: string;
  scenePath: string;
}

function splitAssetName(fileName: string): { stem: string; ext: string } {
  const dot = fileName.lastIndexOf('.');
  const rawStem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const stem = (rawStem
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 48)) || 'asset';
  const ext = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
  return { stem, ext };
}

function uniqueNodeId(stem: string, scene: Scene3DSpec): string {
  const suffix = stem.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z]+/, '').slice(0, 40);
  const base = `asset-${suffix || 'mesh'}`;
  const taken = new Set((scene.nodes || []).map((node) => node.id));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}`;
}

export async function importMeshAssetAsNode(input: {
  projectId: string;
  file: File;
  scene: Scene3DSpec;
  scenePath?: string;
  reason?: string;
}): Promise<ImportedMeshAssetNode> {
  const { projectId, file, scene } = input;
  const scenePath = input.scenePath || DEFAULT_SCENE_PATH;
  const format = meshFormatForPath(file.name);
  if (!format) throw new Error(`不支持的外部 mesh 格式：${file.name}（SceneSpec 只接受 .glb/.gltf/.stl/.obj）`);
  if (file.size > MAX_MESH_BYTES) throw new Error(meshTooLargeMessage());

  const { stem, ext } = splitAssetName(file.name);
  let target = `${ASSET_DIR}/${stem}${ext}`;
  let uploaded = false;
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS && !uploaded; attempt += 1) {
    try {
      await uploadFileToWorkspace(projectId, target, file);
      uploaded = true;
    } catch (error) {
      if (!isTargetAlreadyExists(error)) throw error;
      target = `${ASSET_DIR}/${stem}-${attempt + 1}${ext}`;
    }
  }
  if (!uploaded) throw new Error(`${ASSET_DIR}/ 下同名资产已满 ${MAX_NAME_ATTEMPTS} 个，请先清理后再导入。`);

  const inspected = await inspectMeshAsset({ projectId, path: target });
  const node: Scene3DNode = {
    id: uniqueNodeId(stem, scene),
    type: 'mesh-reference',
    transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
    source: { path: inspected.path, sourceSha256: inspected.sourceSha256 },
    label: file.name,
  };

  // 能读到盘面哈希就带上乐观锁（冲突如实 409）；读不到=场景尚未落盘，按当前视图为基线写入。
  let expectedHash: string | null = null;
  try {
    expectedHash = (await readSceneFile(projectId, scenePath)).hash;
  } catch {
    expectedHash = null;
  }

  const applied = await applySceneOperations({
    projectId,
    path: scenePath,
    scene,
    operations: [{ op: 'add_node', node }],
    expectedHash,
    reason: input.reason || 'import_external_asset',
  });

  return {
    node,
    scene: applied.scene,
    path: inspected.path,
    format: inspected.format,
    bytes: inspected.bytes,
    sourceSha256: inspected.sourceSha256,
    scenePath,
  };
}

export interface ImportedCadAssetNode extends ImportedMeshAssetNode {
  cad: CadAssetImportResult['cad'];
  provenance: Record<string, unknown>;
}

/**
 * BLOCK-322 P4-04a — STEP/IGES 源文件先上传到 model3d/incoming，再由服务端转换并
 * 返回派生 mesh-reference；写入仍走既有 scene/apply add_node，前端不做几何转换。
 */
export async function importCadAssetAsNode(input: {
  projectId: string;
  file: File;
  scene: Scene3DSpec;
  scenePath?: string;
  reason?: string;
}): Promise<ImportedCadAssetNode> {
  const { projectId, file, scene } = input;
  const scenePath = input.scenePath || DEFAULT_SCENE_PATH;
  const format = cadFormatForPath(file.name);
  if (!format) throw new Error(`不支持的 CAD 格式：${file.name}（只接受 .step/.stp/.iges/.igs）`);
  if (file.size > MAX_CAD_BYTES) throw new Error(cadTooLargeMessage());

  const { stem, ext } = splitAssetName(file.name);
  let target = `model3d/incoming/${stem}${ext}`;
  let uploaded = false;
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS && !uploaded; attempt += 1) {
    try {
      await uploadFileToWorkspace(projectId, target, file);
      uploaded = true;
    } catch (error) {
      if (!isTargetAlreadyExists(error)) throw error;
      target = `model3d/incoming/${stem}-${attempt + 1}${ext}`;
    }
  }
  if (!uploaded) throw new Error(`model3d/incoming/ 下同名 CAD 源文件已满 ${MAX_NAME_ATTEMPTS} 个，请先清理后再导入。`);

  const imported = await importCadAsset({ projectId, path: target, name: file.name });
  let expectedHash: string | null = null;
  try {
    expectedHash = (await readSceneFile(projectId, scenePath)).hash;
  } catch {
    expectedHash = null;
  }
  const applied = await applySceneOperations({
    projectId,
    path: scenePath,
    scene,
    operations: [{ op: 'add_node', node: imported.node }],
    expectedHash,
    reason: input.reason || 'import_external_cad_asset',
  });

  return {
    node: imported.node,
    scene: applied.scene,
    path: imported.asset.path,
    format: imported.cad.derivedFormat,
    bytes: imported.asset.bytes,
    sourceSha256: imported.cad.sourceSha256,
    scenePath,
    cad: imported.cad,
    provenance: imported.provenance,
  };
}

export interface GeneratedModelAssetNode extends ImportedMeshAssetNode {
  generation: GeneratedModelAssetResult['generation'];
  provenance: Record<string, unknown>;
}

/**
 * BLOCK-322 P5-02 — 外部文生 3D 结果入链；服务端已完成生成与资产落盘，
 * 前端只走既有 scene/apply add_node，不在浏览器里二次处理几何。
 */
export async function generateModelAssetAsNode(input: {
  projectId: string;
  prompt: string;
  scene: Scene3DSpec;
  scenePath?: string;
  name?: string;
  reason?: string;
}): Promise<GeneratedModelAssetNode> {
  const { projectId, prompt, scene } = input;
  const scenePath = input.scenePath || DEFAULT_SCENE_PATH;
  const generated = await generateModelAsset({ projectId, prompt, name: input.name });
  let expectedHash: string | null = null;
  try {
    expectedHash = (await readSceneFile(projectId, scenePath)).hash;
  } catch {
    expectedHash = null;
  }
  const applied = await applySceneOperations({
    projectId,
    path: scenePath,
    scene,
    operations: [{ op: 'add_node', node: generated.node }],
    expectedHash,
    reason: input.reason || 'generate_external_asset',
  });
  return {
    node: generated.node,
    scene: applied.scene,
    path: generated.asset.path,
    format: 'glb',
    bytes: generated.asset.bytes,
    sourceSha256: generated.generation.glbSha256 || generated.asset.sha256,
    scenePath,
    generation: generated.generation,
    provenance: generated.provenance,
  };
}
