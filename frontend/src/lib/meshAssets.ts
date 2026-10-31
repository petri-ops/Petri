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

// BLOCK-322 P4-04 — CAD 源文件镜像：值与 core/petri-server/helpers/cad-exchange.js 同源；
// 前端只做格式识别与上传前拦截，真实转换/拒绝语义在服务端。
const CAD_INPUT_FORMATS = Object.freeze(['step', 'stp', 'iges', 'igs'] as const);

export type CadInputFormat = 'step' | 'iges';

const CAD_INPUT_EXTENSIONS: string[] = CAD_INPUT_FORMATS.map((format) => `.${format}`);
export const CAD_INPUT_ACCEPT_ATTR = CAD_INPUT_EXTENSIONS.join(',');
export const MAX_CAD_BYTES = 128 * 1024 * 1024;

export function cadFormatForPath(value?: string | null): CadInputFormat | null {
  const extension = extensionOf(value);
  if (!(CAD_INPUT_FORMATS as readonly string[]).includes(extension)) return null;
  if (extension === 'stp') return 'step';
  if (extension === 'igs') return 'iges';
  return extension as CadInputFormat;
}

export function cadTooLargeMessage(): string {
  return `CAD 源文件超过 ${MAX_CAD_BYTES / (1024 * 1024)}MB 转换上限；请先简化模型或拆分装配。`;
}

// BLOCK-322 P2-03 — 基础色贴图镜像：格式白名单与上限与服务端 mesh-assets.js 同源，
// 逐值对账由 test/block322-mesh-format-single-source.test.mjs 守护。
const TEXTURE_INPUT_FORMATS = Object.freeze(['png', 'jpg', 'jpeg'] as const);

/** 工作区相对路径或文件名 → 受支持的贴图格式；不支持返回 null。 */
export function textureFormatForPath(value?: string | null): string | null {
  const extension = extensionOf(value);
  return (TEXTURE_INPUT_FORMATS as readonly string[]).includes(extension) ? extension : null;
}
