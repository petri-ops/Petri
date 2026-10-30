// 外部 mesh 资产入链的前端契约镜像 —— 值与 core/petri-server/helpers/mesh-assets.js 同源，
// 逐值对账由 test/block322-mesh-format-single-source.test.mjs 机械守护（改一侧必红）。
// 这里只是渲染层可用的常量：写侧真值与拒绝语义始终在服务端。
export const MESH_INPUT_FORMATS = Object.freeze(['glb', 'gltf', 'stl', 'obj'] as const);

export type MeshInputFormat = (typeof MESH_INPUT_FORMATS)[number];

const MESH_INPUT_EXTENSIONS: string[] = MESH_INPUT_FORMATS.map((format) => `.${format}`);

/** <input accept> 用的逗号串（.glb,.gltf,.stl,.obj）。 */
export const MESH_INPUT_ACCEPT_ATTR = MESH_INPUT_EXTENSIONS.join(',');

export const MAX_MESH_BYTES = 64 * 1024 * 1024;
const MAX_MESH_MB = MAX_MESH_BYTES / (1024 * 1024);

function extensionOf(value?: string | null): string {
  const name = String(value || '').replace(/\\/g, '/').split('/').pop() || '';
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** 工作区相对路径或文件名 → 受支持格式；不支持返回 null。 */
export function meshFormatForPath(value?: string | null): MeshInputFormat | null {
  const extension = extensionOf(value);
  return (MESH_INPUT_FORMATS as readonly string[]).includes(extension)
    ? (extension as MeshInputFormat)
    : null;
}

export function meshTooLargeMessage(): string {
  return `外部 mesh 超过 ${MAX_MESH_MB}MB 入链上限；请先简化模型或拆分资产。`;
}
