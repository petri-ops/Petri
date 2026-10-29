export const SCENE3D_VERSION = 'scene3d/v1';
export const SCENE3D_NODE_TYPES = Object.freeze(['box', 'cylinder', 'sphere', 'plane', 'group', 'mesh-reference'] as const);

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

export interface Scene3DSpec {
  version: 'scene3d/v1';
  units: 'mm';
  coordinateSystem: 'z-up-right-handed';
  parameters: Record<string, number>;
  nodes: Scene3DNode[];
  constraints?: Scene3DConstraint[];
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
      warnings.push(`节点 ${item.id} 为外部 mesh 引用；本视图只显示引用信息，请在结果面打开原文件。`);
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
