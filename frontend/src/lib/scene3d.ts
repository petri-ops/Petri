import { meshFormatForPath } from './meshAssets';

export const SCENE3D_VERSION = 'scene3d/v1';
export const SCENE3D_NODE_TYPES = Object.freeze(['box', 'cylinder', 'sphere', 'plane', 'group', 'mesh-reference'] as const);

/** 展示侧兜底：绝对路径/盘符/空段/.. 一律不消费（写侧真值在服务端 scene3d.js）。 */
function isSafeRelativePath(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  const text = value.replace(/\\/g, '/');
  if (text.startsWith('/') || /^[A-Za-z]:/.test(text)) return false;
  return text.split('/').every((segment) => segment !== '..' && segment !== '');
}

export type Scene3DNodeType = (typeof SCENE3D_NODE_TYPES)[number];

export interface Scene3DConstraint {
  kind: 'align';
  a: string;
  b: string;
  axis: 'x' | 'y' | 'z';
}

export interface Scene3DNode {
  id: string;
  type: Scene3DNodeType;
  transform?: { position?: number[]; rotation?: number[] };
  dimensions?: Record<string, number | string>;
  material?: { color?: string; roughness?: number };
  source?: { path: string; sourceSha256: string };
  label?: string;
}

export interface Scene3DCamera {
  position: number[];
  target: number[];
  up?: number[];
  fovDeg?: number;
  projection?: 'perspective' | 'orthographic';
  orthoScaleMm?: number;
}

export interface Scene3DRenderSettings {
  width?: number;
  height?: number;
}

export interface Scene3DSpec {
  version: 'scene3d/v1';
  units: 'mm';
  coordinateSystem: 'z-up-right-handed';
  parameters: Record<string, number>;
  nodes: Scene3DNode[];
  constraints?: Scene3DConstraint[];
  camera?: Scene3DCamera;
  render?: Scene3DRenderSettings;
  metadata?: Record<string, unknown>;
}

export interface Scene3DViewNode extends Omit<Scene3DNode, 'dimensions'> {
  dimensions?: Record<string, number>;
}

export interface Scene3DView {
  scene: Scene3DSpec;
  nodes: Scene3DViewNode[];
  warnings: string[];
  stats: { nodes: number; parameters: number; constraints: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
}

function vector3(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length !== 3 || !value.every((item) => finite(item))) return null;
  return value;
}

/** BLOCK-322 P2-01 — 与后端 scene3d.js validateCamera 同判据（展示侧兜底）。 */
function validateCameraForView(raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push('camera 必须是对象');
    return;
  }
  const position = vector3(raw.position);
  const target = vector3(raw.target);
  if (!position) errors.push('camera.position 非法');
  if (!target) errors.push('camera.target 非法');
  if (position && target && position.every((value, index) => value === target[index])) {
    errors.push('camera 视线退化（position 与 target 重合）');
  }
  if (raw.up !== undefined) {
    const up = vector3(raw.up);
    if (!up || (up[0] === 0 && up[1] === 0 && up[2] === 0)) errors.push('camera.up 必须是非零三维向量');
    else if (position && target) {
      const forward = target.map((value, index) => value - position[index]);
      const cross = [
        up[1] * forward[2] - up[2] * forward[1],
        up[2] * forward[0] - up[0] * forward[2],
        up[0] * forward[1] - up[1] * forward[0],
      ];
      const forwardLength = Math.hypot(...forward);
      const upLength = Math.hypot(...up);
      if (forwardLength > 0 && upLength > 0 && Math.hypot(...cross) / (forwardLength * upLength) < 1e-9) {
        errors.push('camera.up 与视线共线，无法确定倾角');
      }
    }
  }
  if (raw.fovDeg !== undefined && (!finite(raw.fovDeg) || raw.fovDeg <= 1 || raw.fovDeg >= 179)) {
    errors.push('camera.fovDeg 须在 (1,179) 度之间');
  }
  const projection = raw.projection === undefined ? 'perspective' : raw.projection;
  if (projection !== 'perspective' && projection !== 'orthographic') errors.push('camera.projection 只支持 perspective/orthographic');
  if (projection === 'orthographic' && !(finite(raw.orthoScaleMm) && raw.orthoScaleMm > 0)) {
    errors.push('camera.orthoScaleMm 在正交投影下必填且须 >0');
  }
}

function validateRenderForView(raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push('render 必须是对象');
    return;
  }
  for (const key of ['width', 'height'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || (value as number) < 16 || (value as number) > 4096) {
      errors.push(`render.${key} 须是 16..4096 的整数`);
    }
  }
}

export function normalizeScene3DForView(raw: unknown): { ok: true; view: Scene3DView } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ['SceneSpec 必须是 JSON 对象'] };
  if (raw.version !== SCENE3D_VERSION) errors.push(`version 必须是 ${SCENE3D_VERSION}`);
  if (raw.units !== 'mm') errors.push('units 必须是 mm');
  if (raw.coordinateSystem !== 'z-up-right-handed') errors.push('coordinateSystem 必须是 z-up-right-handed');
  const parameters = isRecord(raw.parameters) ? raw.parameters : {};
  for (const [name, value] of Object.entries(parameters)) {
    if (!finite(value)) errors.push(`参数 ${name} 必须是有限数值`);
  }
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  if (rawNodes.length === 0) errors.push('nodes 必须是非空数组');
  const warnings: string[] = [];
  const seen = new Set<string>();
  const nodes: Scene3DViewNode[] = [];
  for (const [index, item] of rawNodes.entries()) {
    if (!isRecord(item) || typeof item.id !== 'string' || !item.id) {
      errors.push(`nodes[${index}] 缺少 id`);
      continue;
    }
    if (seen.has(item.id)) errors.push(`重复节点 id ${item.id}`);
    seen.add(item.id);
    if (!SCENE3D_NODE_TYPES.includes(item.type as Scene3DNodeType)) {
      errors.push(`nodes[${index}].type 不支持`);
      continue;
    }
    const dimensions: Record<string, number> = {};
    if (isRecord(item.dimensions)) {
      for (const [key, value] of Object.entries(item.dimensions)) {
        if (finite(value)) dimensions[key] = value;
        else if (typeof value === 'string' && finite(parameters[value])) dimensions[key] = parameters[value];
        else errors.push(`nodes[${index}].dimensions.${key} 引用无效`);
      }
    }
    if (item.type === 'group') {
      // no geometry
    } else if (item.type === 'mesh-reference') {
      const source = isRecord(item.source) ? item.source : null;
      const sourcePath = typeof source?.path === 'string' ? source.path : '';
      const sourceSha = typeof source?.sourceSha256 === 'string' ? source.sourceSha256 : '';
      if (!source || !isSafeRelativePath(sourcePath)) errors.push(`nodes[${index}].source.path 非法`);
      else if (!meshFormatForPath(sourcePath)) errors.push(`nodes[${index}] mesh_format_unsupported`);
      if (!/^[a-f0-9]{64}$/i.test(sourceSha)) errors.push('mesh_source_hash_required');
      warnings.push(`节点 ${item.id} 为外部 mesh 引用（${sourcePath || '—'}）；预览从项目工作区文件加载，导出按 sha256 锚定。`);
    } else {
      const required = item.type === 'sphere' ? ['radius']
        : item.type === 'cylinder' ? ['radius', 'height']
          : item.type === 'plane' ? ['width', 'height']
            : ['width', 'height', 'depth'];
      for (const key of required) {
        if (!finite(dimensions[key]) || dimensions[key] <= 0) errors.push(`nodes[${index}].dimensions.${key} 缺失/无效`);
      }
    }
    nodes.push({
      ...(item as unknown as Scene3DNode),
      dimensions,
    });
  }
  if (raw.camera !== undefined) validateCameraForView(raw.camera, errors);
  if (raw.render !== undefined) validateRenderForView(raw.render, errors);
  if (isRecord(raw.camera) && raw.camera.projection === 'orthographic') {
    warnings.push('相机声明为正交投影：导出按正交取景，预览端仍是透视相机（只对齐机位与目标，不假装投影一致）。');
  }
  if (errors.length > 0) return { ok: false, errors: [...new Set(errors)] };
  const scene: Scene3DSpec = {
    version: SCENE3D_VERSION,
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: Object.fromEntries(Object.entries(parameters).filter((entry): entry is [string, number] => finite(entry[1]))),
    nodes: rawNodes as Scene3DNode[],
    constraints: Array.isArray(raw.constraints)
      ? raw.constraints.filter((row): row is Scene3DConstraint => isRecord(row)
        && row.kind === 'align'
        && typeof row.a === 'string'
        && typeof row.b === 'string'
        && ['x', 'y', 'z'].includes(String(row.axis)))
      : [],
    ...(isRecord(raw.camera) ? { camera: raw.camera as unknown as Scene3DCamera } : {}),
    ...(isRecord(raw.render) ? { render: raw.render } : {}),
    metadata: isRecord(raw.metadata) ? raw.metadata : {},
  };
  return {
    ok: true,
    view: {
      scene,
      nodes,
      warnings,
      stats: {
        nodes: nodes.length,
        parameters: Object.keys(scene.parameters).length,
        constraints: scene.constraints?.length || 0,
      },
    },
  };
}

export function sampleScene3D(): Scene3DSpec {
  return {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: { width: 120, height: 40, depth: 80, wall: 2 },
    nodes: [
      {
        id: 'enclosure',
        type: 'box',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0] },
        dimensions: { width: 'width', height: 'height', depth: 'depth' },
        material: { color: '#4c78a8', roughness: 0.65 },
      },
      {
        id: 'port',
        type: 'cylinder',
        transform: { position: [60, 0, 0], rotation: [0, 90, 0] },
        dimensions: { radius: 6, height: 8 },
        material: { color: '#d29b42', roughness: 0.5 },
      },
    ],
    constraints: [],
    metadata: { title: 'NEXT-04A 示例外壳' },
  };
}
