import { beforeEach, describe, expect, it, vi } from 'vitest';
import { importMeshAssetAsNode } from './model3dAssetImport';
import { DEFAULT_SCENE_PATH } from './sceneEditClient';
import { WorkspaceUploadError } from './workspaceFileUpload';
import type { Scene3DSpec } from './scene3d';

vi.mock('@/lib/workspaceFileUpload', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/workspaceFileUpload')>();
  return { ...actual, uploadFileToWorkspace: vi.fn() };
});

vi.mock('@/lib/sceneEditClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sceneEditClient')>();
  return {
    ...actual,
    inspectMeshAsset: vi.fn(),
    applySceneOperations: vi.fn(),
    readSceneFile: vi.fn(),
  };
});

const { uploadFileToWorkspace } = await import('@/lib/workspaceFileUpload');
const { inspectMeshAsset, applySceneOperations, readSceneFile } = await import('@/lib/sceneEditClient');

const SHA = 'b'.repeat(64);
const BASE_SCENE: Scene3DSpec = {
  version: 'scene3d/v1',
  units: 'mm',
  coordinateSystem: 'z-up-right-handed',
  parameters: { width: 120 },
  nodes: [{ id: 'enclosure', type: 'box', dimensions: { width: 'width', height: 40, depth: 80 } }],
  constraints: [],
  metadata: {},
};

function meshFile(name = 'enclosure.glb', size = 1024): File {
  return { name, size, type: '' } as File;
}

beforeEach(() => {
  vi.mocked(uploadFileToWorkspace).mockReset();
  vi.mocked(inspectMeshAsset).mockReset();
  vi.mocked(applySceneOperations).mockReset();
  vi.mocked(readSceneFile).mockReset();

  vi.mocked(inspectMeshAsset).mockResolvedValue({
    ok: true, path: 'model3d/assets/enclosure.glb', format: 'glb', bytes: 1024, sourceSha256: SHA, maxBytes: 64 * 1024 * 1024,
  });
  vi.mocked(applySceneOperations).mockResolvedValue({
    ok: true,
    path: DEFAULT_SCENE_PATH,
    beforeHash: 'c'.repeat(64),
    afterHash: 'd'.repeat(64),
    revision: null,
    diff: { beforeHash: '', afterHash: '', parameters: [], nodes: [], constraints: { added: [], removed: [] }, changed: false },
    scene: { ...BASE_SCENE, nodes: [...BASE_SCENE.nodes, { id: 'x', type: 'mesh-reference' }] },
  });
  vi.mocked(readSceneFile).mockResolvedValue({ scene: BASE_SCENE, hash: 'e'.repeat(64) });
});

describe('BLOCK-322 P1c 导入为场景节点', () => {
  it('走上传→预检→add_node 三段既有管道，sha 用服务端算出的值', async () => {
    const imported = await importMeshAssetAsNode({ projectId: 'p1', file: meshFile(), scene: BASE_SCENE });
    expect(uploadFileToWorkspace).toHaveBeenCalledWith('p1', 'model3d/assets/enclosure.glb', expect.anything());
    expect(inspectMeshAsset).toHaveBeenCalledWith({ projectId: 'p1', path: 'model3d/assets/enclosure.glb' });
    const applyInput = vi.mocked(applySceneOperations).mock.calls[0][0];
    expect(applyInput.path).toBe(DEFAULT_SCENE_PATH);
    expect(applyInput.expectedHash).toBe('e'.repeat(64));
    expect(applyInput.reason).toBe('import_external_asset');
    expect(applyInput.operations).toEqual([{
      op: 'add_node',
      node: {
        id: 'asset-enclosure',
        type: 'mesh-reference',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        source: { path: 'model3d/assets/enclosure.glb', sourceSha256: SHA },
        label: 'enclosure.glb',
      },
    }]);
    expect(imported.sourceSha256).toBe(SHA);
    expect(imported.node.id).toBe('asset-enclosure');
  });

  it('盘面无 SceneSpec 时不带乐观锁（新文件按当前视图为基线）', async () => {
    vi.mocked(readSceneFile).mockRejectedValue(new Error('scene_not_found'));
    await importMeshAssetAsNode({ projectId: 'p1', file: meshFile(), scene: BASE_SCENE });
    expect(vi.mocked(applySceneOperations).mock.calls[0][0].expectedHash).toBeNull();
  });

  it('格式不受支持或超上限：上传前即拒绝，零副作用', async () => {
    for (const file of [meshFile('notes.txt'), meshFile('big.glb', 64 * 1024 * 1024 + 1)]) {
      vi.mocked(uploadFileToWorkspace).mockClear();
      await expect(importMeshAssetAsNode({ projectId: 'p1', file, scene: BASE_SCENE })).rejects.toThrow();
      expect(uploadFileToWorkspace).not.toHaveBeenCalled();
    }
    expect(inspectMeshAsset).not.toHaveBeenCalled();
    expect(applySceneOperations).not.toHaveBeenCalled();
  });

  it('同名资产不覆盖：409 target_already_exists 后换名新建', async () => {
    vi.mocked(uploadFileToWorkspace)
      .mockRejectedValueOnce(new WorkspaceUploadError('目标已存在', 409, 'target_already_exists'));
    await importMeshAssetAsNode({ projectId: 'p1', file: meshFile(), scene: BASE_SCENE });
    const targets = vi.mocked(uploadFileToWorkspace).mock.calls.map((call) => call[1]);
    expect(targets).toEqual(['model3d/assets/enclosure.glb', 'model3d/assets/enclosure-2.glb']);
    expect(inspectMeshAsset).toHaveBeenCalledWith({ projectId: 'p1', path: 'model3d/assets/enclosure-2.glb' });
  });

  it('非冲突的上传错误直接上抛，不盲目换名', async () => {
    vi.mocked(uploadFileToWorkspace).mockRejectedValue(new WorkspaceUploadError('分片超过 96KB 上限', 400, null));
    await expect(importMeshAssetAsNode({ projectId: 'p1', file: meshFile(), scene: BASE_SCENE })).rejects.toThrow('分片超过 96KB 上限');
    expect(vi.mocked(uploadFileToWorkspace)).toHaveBeenCalledTimes(1);
  });

  it('节点 id 与既有节点冲突时自动避让；名称消毒后仍可读', async () => {
    const taken: Scene3DSpec = {
      ...BASE_SCENE,
      nodes: [...BASE_SCENE.nodes, { id: 'asset-enclosure', type: 'mesh-reference', source: { path: 'a.glb', sourceSha256: SHA } }],
    };
    await importMeshAssetAsNode({ projectId: 'p1', file: meshFile(), scene: taken });
    const operation = vi.mocked(applySceneOperations).mock.calls[0][0].operations[0] as { node: { id: string } };
    expect(operation.node.id).toBe('asset-enclosure-2');
  });

  it('中文与空格文件名归一为合法 id 与扩展名小写的工作区路径', async () => {
    vi.mocked(inspectMeshAsset).mockImplementation(({ path }) => Promise.resolve({
      ok: true, path, format: 'stl', bytes: 10, sourceSha256: SHA, maxBytes: 64 * 1024 * 1024,
    }));
    const imported = await importMeshAssetAsNode({ projectId: 'p1', file: meshFile('外壳 01.STL'), scene: BASE_SCENE });
    const target = vi.mocked(uploadFileToWorkspace).mock.calls[0][1];
    expect(target).toBe('model3d/assets/01.stl');
    const operation = vi.mocked(applySceneOperations).mock.calls[0][0].operations[0] as { node: { id: string; source: { path: string } } };
    expect(operation.node.id).toMatch(/^asset-[A-Za-z0-9._-]+$/);
    expect(operation.node.source.path).toBe(target);
    expect(imported.path).toBe(target);
  });
});
