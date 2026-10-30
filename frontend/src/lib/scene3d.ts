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

export type Scene3DConstraintKind = 'align' | 'distance' | 'angle';

export interface Scene3DConstraint {
  kind: Scene3DConstraintKind;
  a: string;
  b: string;
  axis: 'x' | 'y' | 'z';
  /** distance=mm（沿轴带符号）；angle=度（绕轴带符号）；align 不消费。 */
  value?: number;
}

export type Scene3DModifier =
  | { kind: 'bevel'; width: number; segments?: number }
  | { kind: 'array'; count: number; offset?: number[] }
  | { kind: 'boolean'; operation: 'union' | 'difference' | 'intersect'; target: string };

export interface Scene3DNode {
  id: string;
  type: Scene3DNodeType;
  transform?: { position?: number[]; rotation?: number[] };
  dimensions?: Record<string, number | string>;
  material?: { color?: string; roughness?: number };
  source?: { path: string; sourceSha256: string };
  modifiers?: Scene3DModifier[];
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

export type Scene3DLightKind = 'sun' | 'point' | 'spot' | 'area';
export type Scene3DEngine = 'workbench' | 'cycles';

export interface Scene3DLight {
  id: string;
  kind: Scene3DLightKind;
  energy: number;
  color?: string;
  position: number[];
  target?: number[];
  size?: number;
  spotDeg?: number;
}

export interface Scene3DEnvironment {
  background?: string;
  worldStrength?: number;
  samples?: number;
  engine?: Scene3DEngine;
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
  lights?: Scene3DLight[];
  environment?: Scene3DEnvironment;
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

/** BLOCK-322 P2-02 — 灯光/环境声明校验，判据与文案与后端 scene3d.js 同源（对账门守护）。 */
const LIGHT_KINDS: readonly string[] = ['sun', 'point', 'spot', 'area'];
const RENDER_ENGINES: readonly string[] = ['workbench', 'cycles'];
const MAX_LIGHTS = 16;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_.-]*$/;

function validateLightsForView(raw: unknown, errors: string[]): void {
  if (!Array.isArray(raw)) {
    errors.push('lights 必须是数组');
    return;
  }
  if (raw.length > MAX_LIGHTS) {
    errors.push(`灯光数量超限（≤${MAX_LIGHTS}）`);
    return;
  }
  const ids = new Set<string>();
  raw.forEach((item, index) => {
    const where = `lights[${index}]`;
    if (!isRecord(item)) {
      errors.push(`${where} 必须是对象`);
      return;
    }
    const id = typeof item.id === 'string' ? item.id : '';
    if (!id || !SAFE_ID.test(id)) errors.push(`${where}.id 非法`);
    else if (ids.has(id)) errors.push(`重复灯光 id ${id}`);
    else ids.add(id);
    if (!LIGHT_KINDS.includes(String(item.kind))) errors.push(`${where}.kind 只支持 sun/point/spot/area`);
    if (!finite(item.energy) || item.energy < 0 || item.energy > 1000) errors.push(`${where}.energy 须在 0..1000`);
    if (item.color !== undefined && !(typeof item.color === 'string' && HEX_COLOR.test(item.color))) errors.push(`${where}.color 非法`);
    if (!vector3(item.position)) errors.push(`${where}.position 非法`);
    if (item.target !== undefined && !vector3(item.target)) errors.push(`${where}.target 非法`);
    if (item.size !== undefined && (!finite(item.size) || item.size < 0)) errors.push(`${where}.size 非法`);
    if (item.spotDeg !== undefined
      && (!finite(item.spotDeg) || item.spotDeg <= 1 || item.spotDeg >= 179)) {
      errors.push(`${where}.spotDeg 须在 (1,179) 度之间`);
    }
  });
}

function validateEnvironmentForView(raw: unknown, errors: string[]): void {
  if (!isRecord(raw)) {
    errors.push('environment 必须是对象');
    return;
  }
  if (raw.background !== undefined && !(typeof raw.background === 'string' && HEX_COLOR.test(raw.background))) {
    errors.push('environment.background 须是 #rrggbb');
  }
  if (raw.worldStrength !== undefined
    && (!finite(raw.worldStrength) || raw.worldStrength < 0 || raw.worldStrength > 10)) {
    errors.push('environment.worldStrength 须在 0..10');
  }
  if (raw.samples !== undefined
    && (!Number.isInteger(raw.samples) || (raw.samples as number) < 1 || (raw.samples as number) > 128)) {
    errors.push('environment.samples 须是 1..128 的整数');
  }
  if (raw.engine !== undefined && (typeof raw.engine !== 'string' || !RENDER_ENGINES.includes(raw.engine))) {
    errors.push('environment.engine 只支持 workbench/cycles');
  }
}

/** BLOCK-322 P3-01 — 几何操作白名单镜像（判据与文案与后端 scene3d.js 同源）。 */
const MODIFIER_KINDS: readonly string[] = ['bevel', 'array', 'boolean'];
const BOOLEAN_OPERATIONS: readonly string[] = ['union', 'difference', 'intersect'];
const MODIFIER_FIELDS: Record<string, readonly string[]> = {
  bevel: ['kind', 'width', 'segments'],
  array: ['kind', 'count', 'offset'],
  boolean: ['kind', 'operation', 'target'],
};
const MAX_MODIFIERS = 8;

function validateModifiersForNode(item: Record<string, unknown>, index: number, errors: string[]): void {
  const nodeWhere = `nodes[${index}]`;
  if (item.modifiers === undefined) return;
  if (!Array.isArray(item.modifiers)) {
    errors.push(`${nodeWhere}.modifiers 必须是数组`);
    return;
  }
  if (item.modifiers.length === 0) errors.push(`${nodeWhere}.modifiers 不能为空数组`);
  if (item.modifiers.length > MAX_MODIFIERS) errors.push(`${nodeWhere}.modifiers 数量超限（≤${MAX_MODIFIERS}）`);
  item.modifiers.forEach((entry, position) => {
    const at = `${nodeWhere}.modifiers[${position}]`;
    if (!isRecord(entry)) {
      errors.push(`${at} 必须是对象`);
      return;
    }
    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (!MODIFIER_KINDS.includes(kind)) {
      errors.push(`${at}.kind 只支持 bevel/array/boolean`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!MODIFIER_FIELDS[kind].includes(key)) errors.push(`${at}.${key} 不在 ${kind} 白名单`);
    }
    if (kind === 'bevel') {
      if (!finite(entry.width) || entry.width <= 0 || entry.width > 100) errors.push(`${at}.width 须在 (0,100] mm`);
      if (entry.segments !== undefined
        && (!Number.isInteger(entry.segments) || (entry.segments as number) < 1 || (entry.segments as number) > 8)) {
        errors.push(`${at}.segments 须是 1..8 的整数`);
      }
    } else if (kind === 'array') {
      if (!Number.isInteger(entry.count) || (entry.count as number) < 1 || (entry.count as number) > 64) {
        errors.push(`${at}.count 须是 1..64 的整数`);
      }
      if (entry.offset !== undefined && !vector3(entry.offset)) errors.push(`${at}.offset 非法`);
    } else if (!BOOLEAN_OPERATIONS.includes(typeof entry.operation === 'string' ? entry.operation : '')) {
      errors.push(`${at}.operation 只支持 union/difference/intersect`);
    } else if (typeof entry.target !== 'string' || !SAFE_ID.test(entry.target)) {
      errors.push(`${at}.target 非法`);
    }
  });
}

/** boolean 目标须是「排在前面且已存在的节点」，且不能是自己（与后端同一顺序语义）。 */
function validateModifierReferencesForView(rawNodes: unknown[], errors: string[]): void {
  const firstIndexOf = new Map<string, number>();
  rawNodes.forEach((item, index) => {
    if (!isRecord(item) || typeof item.id !== 'string') return;
    if (!firstIndexOf.has(item.id)) firstIndexOf.set(item.id, index);
  });
  rawNodes.forEach((item, index) => {
    if (!isRecord(item) || !Array.isArray(item.modifiers) || typeof item.id !== 'string') return;
    item.modifiers.forEach((entry, position) => {
      if (!isRecord(entry) || entry.kind !== 'boolean' || typeof entry.target !== 'string' || !entry.target) return;
      const at = `nodes[${index}].modifiers[${position}]`;
      if (entry.target === item.id) {
        errors.push(`${at} 不能对节点自身做 boolean`);
        return;
      }
      const targetIndex = firstIndexOf.get(entry.target);
      if (targetIndex === undefined) errors.push(`boolean 目标 ${entry.target} 不是已存在节点`);
      else if (targetIndex >= index) errors.push(`boolean 目标 ${entry.target} 必须排在被操作节点之前`);
    });
  });
}

/** BLOCK-322 P3-02a — 装配约束白名单镜像（判据与文案与后端 scene3d.js 同源）。
 * 求值只在服务端 resolveSceneSpec 发生（唯一真值处），展示侧只校验能否安全求值。 */
const CONSTRAINT_KINDS: readonly string[] = ['align', 'distance', 'angle'];
const CONSTRAINT_AXES: readonly string[] = ['x', 'y', 'z'];
const CONSTRAINT_FIELDS: Record<string, readonly string[]> = {
  align: ['kind', 'a', 'b', 'axis'],
  distance: ['kind', 'a', 'b', 'axis', 'value'],
  angle: ['kind', 'a', 'b', 'axis', 'value'],
};
const MAX_CONSTRAINTS = 200;

function validateConstraintsForView(rawConstraints: unknown, nodeIds: Set<string>, errors: string[]): void {
  if (rawConstraints === undefined) return;
  if (!Array.isArray(rawConstraints)) {
    errors.push('constraints 必须是数组');
    return;
  }
  if (rawConstraints.length > MAX_CONSTRAINTS) {
    errors.push('约束数量超限');
    return;
  }
  rawConstraints.forEach((entry, index) => {
    const where = `constraints[${index}]`;
    if (!isRecord(entry)) {
      errors.push(`${where} 必须是对象`);
      return;
    }
    const kind = typeof entry.kind === 'string' ? entry.kind : '';
    if (!CONSTRAINT_KINDS.includes(kind)) {
      errors.push(`${where}.kind 只支持 align/distance/angle`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!CONSTRAINT_FIELDS[kind].includes(key)) errors.push(`${where}.${key} 不在 ${kind} 白名单`);
    }
    const a = typeof entry.a === 'string' ? entry.a : '';
    const b = typeof entry.b === 'string' ? entry.b : '';
    if (!SAFE_ID.test(a) || !SAFE_ID.test(b)) errors.push(`${where} 节点 id 非法`);
    else if (!nodeIds.has(a) || !nodeIds.has(b)) errors.push(`${where} 引用未知节点`);
    else if (a === b) errors.push(`${where} 不能约束自身`);
    if (!CONSTRAINT_AXES.includes(typeof entry.axis === 'string' ? entry.axis : '')) errors.push(`${where}.axis 非法`);
    if (kind !== 'align' && !finite(entry.value)) {
      errors.push(`${where}.value 必须是有限数值（${kind === 'distance' ? 'mm，可为负' : '度，可为负'}）`);
    }
  });
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
    validateModifiersForNode(item, index, errors);
    if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
      warnings.push(`节点 ${item.id} 带几何操作（${item.modifiers.map((modifier) => (isRecord(modifier) ? String(modifier.kind) : '?')).join('/')}）：预览显示未加工基元，倒角/布尔/阵列在构建导出时生效。`);
    }
    nodes.push({
      ...(item as unknown as Scene3DNode),
      dimensions,
    });
  }
  validateModifierReferencesForView(rawNodes, errors);
  validateConstraintsForView(raw.constraints, seen, errors);
  if (raw.camera !== undefined) validateCameraForView(raw.camera, errors);
  if (raw.render !== undefined) validateRenderForView(raw.render, errors);
  if (raw.lights !== undefined) validateLightsForView(raw.lights, errors);
  if (raw.environment !== undefined) validateEnvironmentForView(raw.environment, errors);
  if (isRecord(raw.camera) && raw.camera.projection === 'orthographic') {
    warnings.push('相机声明为正交投影：导出按正交取景，预览端仍是透视相机（只对齐机位与目标，不假装投影一致）。');
  }
  if (Array.isArray(raw.constraints) && raw.constraints.length > 0) {
    warnings.push('装配约束在服务端求值后烘进 transform（对齐/间距/角度在构建导出时生效）：预览未取回求值结果，按声明位置显示。');
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
        && CONSTRAINT_KINDS.includes(typeof row.kind === 'string' ? row.kind : ''))
      : [],
    ...(isRecord(raw.camera) ? { camera: raw.camera as unknown as Scene3DCamera } : {}),
    ...(isRecord(raw.render) ? { render: raw.render } : {}),
    ...(Array.isArray(raw.lights) ? { lights: raw.lights } : {}),
    ...(isRecord(raw.environment) ? { environment: raw.environment } : {}),
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
