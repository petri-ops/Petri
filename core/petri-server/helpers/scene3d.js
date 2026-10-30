'use strict';

/**
 * helpers/scene3d.js — NEXT-04A SceneSpec v1 纯函数层。
 *
 * 单一源真相：SceneSpec 可 diff/校验/哈希/工作流；GLB/STL/OBJ 只是导出物。
 * 不执行任意 JS、不读网络、不做任意路径；渲染/导出由受控 provider 承担。
 */

const crypto = require('node:crypto');
const { meshFormatForPath } = require('./mesh-assets');

const SCENE_VERSION = 'scene3d/v1';
const UNITS = new Set(['mm']);
const COORDINATE_SYSTEMS = new Set(['z-up-right-handed']);
const NODE_TYPES = new Set(['box', 'cylinder', 'sphere', 'plane', 'group', 'mesh-reference']);
const LIMITS = Object.freeze({
  maxNodes: 500,
  maxParameters: 200,
  maxConstraints: 200,
  maxDimensionMm: 1_000_000,
  maxKeyLength: 80,
  maxResolutionPx: 4096,
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function sha256(text) {
  return crypto.createHash('sha256').update(Buffer.from(String(text), 'utf8')).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= LIMITS.maxDimensionMm;
}

function isSafeId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= LIMITS.maxKeyLength
    && /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value);
}

function isSafeRelativePath(value) {
  const text = String(value || '').replace(/\\/g, '/');
  return Boolean(text)
    && !text.startsWith('/')
    && !/^[A-Za-z]:/.test(text)
    && !text.split('/').some((part) => part === '..' || part === '');
}

function validateVector(value) {
  return Array.isArray(value) && value.length === 3 && value.every(finiteNumber);
}

function validateColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function sameVector(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 3 && b.length === 3
    && a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/**
 * BLOCK-322 P2-01 — 声明相机：position/target 必填，up 非零，fov 在 (1,179)，
 * 正交投影必须给 orthoScaleMm。退化视线（position===target）直接拒绝，
 * 免得渲染阶段才发现「拍不到东西」。
 */
function validateCamera(camera, errors) {
  if (!isPlainObject(camera)) {
    errors.push('camera 必须是对象');
    return;
  }
  const hasPosition = validateVector(camera.position);
  const hasTarget = validateVector(camera.target);
  if (!hasPosition) errors.push('camera.position 非法');
  if (!hasTarget) errors.push('camera.target 非法');
  if (hasPosition && hasTarget && sameVector(camera.position, camera.target)) {
    errors.push('camera 视线退化（position 与 target 重合）');
  }
  if (camera.up !== undefined) {
    if (!validateVector(camera.up) || (camera.up[0] === 0 && camera.up[1] === 0 && camera.up[2] === 0)) {
      errors.push('camera.up 必须是非零三维向量');
    } else if (hasPosition && hasTarget) {
      const forward = camera.target.map((value, index) => value - camera.position[index]);
      const cross = [
        camera.up[1] * forward[2] - camera.up[2] * forward[1],
        camera.up[2] * forward[0] - camera.up[0] * forward[2],
        camera.up[0] * forward[1] - camera.up[1] * forward[0],
      ];
      const forwardLength = Math.hypot(...forward);
      const upLength = Math.hypot(...camera.up);
      if (forwardLength > 0 && upLength > 0 && Math.hypot(...cross) / (forwardLength * upLength) < 1e-9) {
        errors.push('camera.up 与视线共线，无法确定倾角');
      }
    }
  }
  if (camera.fovDeg !== undefined && (!finiteNumber(camera.fovDeg) || camera.fovDeg <= 1 || camera.fovDeg >= 179)) {
    errors.push('camera.fovDeg 须在 (1,179) 度之间');
  }
  const projection = camera.projection === undefined ? 'perspective' : camera.projection;
  if (!['perspective', 'orthographic'].includes(projection)) errors.push('camera.projection 只支持 perspective/orthographic');
  if (projection === 'orthographic') {
    if (!finiteNumber(camera.orthoScaleMm) || camera.orthoScaleMm <= 0) errors.push('camera.orthoScaleMm 在正交投影下必填且须 >0');
  } else if (camera.orthoScaleMm !== undefined && (!finiteNumber(camera.orthoScaleMm) || camera.orthoScaleMm <= 0)) {
    errors.push('camera.orthoScaleMm 非法');
  }
}

/** BLOCK-322 P2-01 — 渲染分辨率（不写则沿用提供方默认 800×600）。 */
function validateRenderSettings(render, errors) {
  if (!isPlainObject(render)) {
    errors.push('render 必须是对象');
    return;
  }
  for (const key of ['width', 'height']) {
    const value = render[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 16 || value > LIMITS.maxResolutionPx) {
      errors.push(`render.${key} 须是 16..${LIMITS.maxResolutionPx} 的整数`);
    }
  }
}

function validateParameterRef(value, parameters, errors, where) {
  if (typeof value === 'number') {
    if (!finiteNumber(value) || value <= 0) errors.push(`${where} 必须是 >0 的有限数值`);
    return;
  }
  if (typeof value === 'string' && Object.prototype.hasOwnProperty.call(parameters, value)) {
    return;
  }
  errors.push(`${where} 引用未知参数 ${String(value)}`);
}

function validateNode(node, index, parameters, ids, errors) {
  const where = `nodes[${index}]`;
  if (!isPlainObject(node)) {
    errors.push(`${where} 必须是对象`);
    return;
  }
  if (!isSafeId(node.id)) errors.push(`${where}.id 非法`);
  else if (ids.has(node.id)) errors.push(`重复节点 id ${node.id}`);
  else ids.add(node.id);
  if (!NODE_TYPES.has(node.type)) errors.push(`${where}.type 非法`);
  if (node.transform !== undefined) {
    if (!isPlainObject(node.transform)) errors.push(`${where}.transform 必须是对象`);
    else {
      if (node.transform.position !== undefined && !validateVector(node.transform.position)) errors.push(`${where}.transform.position 非法`);
      if (node.transform.rotation !== undefined && !validateVector(node.transform.rotation)) errors.push(`${where}.transform.rotation 非法`);
    }
  }
  if (node.material !== undefined) {
    if (!isPlainObject(node.material)) errors.push(`${where}.material 必须是对象`);
    else {
      if (node.material.color !== undefined && !validateColor(node.material.color)) errors.push(`${where}.material.color 非法`);
      if (node.material.roughness !== undefined
        && (!finiteNumber(node.material.roughness) || node.material.roughness < 0 || node.material.roughness > 1)) {
        errors.push(`${where}.material.roughness 须在 0..1`);
      }
    }
  }
  if (node.type === 'box') {
    for (const key of ['width', 'height', 'depth']) {
      if (!isPlainObject(node.dimensions) || node.dimensions[key] === undefined) errors.push(`${where}.dimensions.${key} 缺失`);
      else validateParameterRef(node.dimensions[key], parameters, errors, `${where}.dimensions.${key}`);
    }
  } else if (node.type === 'cylinder') {
    for (const key of ['radius', 'height']) {
      if (!isPlainObject(node.dimensions) || node.dimensions[key] === undefined) errors.push(`${where}.dimensions.${key} 缺失`);
      else validateParameterRef(node.dimensions[key], parameters, errors, `${where}.dimensions.${key}`);
    }
  } else if (node.type === 'sphere') {
    if (!isPlainObject(node.dimensions) || node.dimensions.radius === undefined) errors.push(`${where}.dimensions.radius 缺失`);
    else validateParameterRef(node.dimensions.radius, parameters, errors, `${where}.dimensions.radius`);
  } else if (node.type === 'plane') {
    for (const key of ['width', 'height']) {
      if (!isPlainObject(node.dimensions) || node.dimensions[key] === undefined) errors.push(`${where}.dimensions.${key} 缺失`);
      else validateParameterRef(node.dimensions[key], parameters, errors, `${where}.dimensions.${key}`);
    }
  } else if (node.type === 'mesh-reference') {
    if (!isPlainObject(node.source) || !isSafeRelativePath(node.source.path)) errors.push(`${where}.source.path 非法`);
    else if (!meshFormatForPath(node.source.path)) errors.push('mesh_format_unsupported');
    if (!isPlainObject(node.source) || !/^[a-f0-9]{64}$/i.test(String(node.source.sourceSha256 || ''))) {
      errors.push('mesh_source_hash_required');
    }
  }
}

function validateSceneSpec(input) {
  const errors = [];
  if (!isPlainObject(input)) return { ok: false, error: 'scene_invalid', errors: ['SceneSpec 必须是对象'] };
  if (input.version !== SCENE_VERSION) errors.push(`version 必须是 ${SCENE_VERSION}`);
  if (!UNITS.has(input.units)) errors.push('units 必须是 mm');
  if (!COORDINATE_SYSTEMS.has(input.coordinateSystem)) errors.push('coordinateSystem 必须是 z-up-right-handed');
  const parameters = isPlainObject(input.parameters) ? input.parameters : {};
  if (!isPlainObject(input.parameters)) errors.push('parameters 必须是对象');
  if (Object.keys(parameters).length > LIMITS.maxParameters) errors.push('参数数量超限');
  for (const [name, value] of Object.entries(parameters)) {
    if (!isSafeId(name)) errors.push(`参数名非法 ${name}`);
    if (!finiteNumber(value)) errors.push(`参数 ${name} 必须是有限数值`);
  }
  if (!Array.isArray(input.nodes) || input.nodes.length === 0) errors.push('nodes 必须是非空数组');
  if (Array.isArray(input.nodes) && input.nodes.length > LIMITS.maxNodes) errors.push('节点数量超限');
  const ids = new Set();
  if (Array.isArray(input.nodes)) input.nodes.forEach((node, index) => validateNode(node, index, parameters, ids, errors));
  if (input.constraints !== undefined) {
    if (!Array.isArray(input.constraints)) errors.push('constraints 必须是数组');
    else if (input.constraints.length > LIMITS.maxConstraints) errors.push('约束数量超限');
    else input.constraints.forEach((constraint, index) => {
      if (!isPlainObject(constraint)) {
        errors.push(`constraints[${index}] 必须是对象`);
        return;
      }
      if (constraint.kind !== 'align') errors.push(`constraints[${index}].kind 不支持`);
      if (!ids.has(constraint.a) || !ids.has(constraint.b)) errors.push(`constraints[${index}] 引用未知节点`);
      if (!['x', 'y', 'z'].includes(constraint.axis)) errors.push(`constraints[${index}].axis 非法`);
    });
  }
  if (input.camera !== undefined) validateCamera(input.camera, errors);
  if (input.render !== undefined) validateRenderSettings(input.render, errors);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.includes('mesh_source_hash_required')) return { ok: false, error: 'mesh_source_hash_required', errors: uniqueErrors };
  if (uniqueErrors.includes('mesh_format_unsupported')) return { ok: false, error: 'mesh_format_unsupported', errors: uniqueErrors };
  if (uniqueErrors.some((error) => /未知参数/.test(error))) return { ok: false, error: 'invalid_reference', errors: uniqueErrors };
  if (uniqueErrors.length > 0) return { ok: false, error: 'scene_invalid', errors: uniqueErrors };
  return {
    ok: true,
    scene: input,
    stats: {
      nodes: input.nodes.length,
      parameters: Object.keys(parameters).length,
      constraints: Array.isArray(input.constraints) ? input.constraints.length : 0,
      primitiveEstimate:
        input.nodes.filter((node) => ['box', 'cylinder', 'sphere', 'plane'].includes(node.type)).length,
    },
  };
}

function resolveDimension(value, parameters) {
  return typeof value === 'string' ? parameters[value] : value;
}

function resolveSceneSpec(input) {
  const validated = validateSceneSpec(input);
  if (!validated.ok) return { ok: false, ...validated };
  const scene = clone(input);
  const parameters = scene.parameters || {};
  for (const node of scene.nodes) {
    if (!node.dimensions) continue;
    node.dimensions = Object.fromEntries(
      Object.entries(node.dimensions).map(([key, value]) => [key, resolveDimension(value, parameters)])
    );
  }
  return { ok: true, scene, stats: validated.stats };
}

function canonicalGeometry(scene) {
  const geometry = { ...scene };
  delete geometry.metadata;
  return geometry;
}

function hashSceneSpec(input) {
  return sha256(stableStringify(canonicalGeometry(input)));
}

function applySceneOperations(input, operations) {
  const base = clone(input);
  if (!Array.isArray(operations) || operations.length === 0) return { ok: false, error: 'operations_required' };
  if (operations.length > 100) return { ok: false, error: 'operations_too_many' };
  const beforeHash = hashSceneSpec(base);
  const nodeById = () => new Map((base.nodes || []).map((node) => [node.id, node]));
  for (const operation of operations) {
    if (!isPlainObject(operation) || typeof operation.op !== 'string') return { ok: false, error: 'operation_invalid' };
    if (operation.op === 'set_parameter') {
      if (!isSafeId(operation.name) || !finiteNumber(operation.value)) return { ok: false, error: 'operation_invalid' };
      base.parameters = { ...(base.parameters || {}), [operation.name]: operation.value };
    } else if (operation.op === 'update_node') {
      const node = nodeById().get(operation.id);
      if (!node) return { ok: false, error: 'node_not_found' };
      const changes = isPlainObject(operation.changes) ? operation.changes : {};
      for (const key of Object.keys(changes)) {
        if (!['transform', 'dimensions', 'material', 'label'].includes(key)) return { ok: false, error: 'operation_not_allowed' };
      }
      Object.assign(node, changes);
    } else if (operation.op === 'add_node') {
      if (!isPlainObject(operation.node)) return { ok: false, error: 'operation_invalid' };
      if (nodeById().has(operation.node.id)) return { ok: false, error: 'duplicate_node_id' };
      base.nodes.push(clone(operation.node));
    } else if (operation.op === 'remove_node') {
      if (nodeById().size <= 1) return { ok: false, error: 'scene_requires_node' };
      base.nodes = base.nodes.filter((node) => node.id !== operation.id);
    } else if (operation.op === 'set_metadata') {
      if (!isPlainObject(operation.metadata)) return { ok: false, error: 'operation_invalid' };
      base.metadata = { ...(base.metadata || {}), ...operation.metadata };
    } else {
      return { ok: false, error: 'operation_not_allowed' };
    }
  }
  const resolved = resolveSceneSpec(base);
  if (!resolved.ok) return { ok: false, error: resolved.error, errors: resolved.errors };
  return {
    ok: true,
    scene: base,
    beforeHash,
    afterHash: hashSceneSpec(base),
  };
}

function buildExportManifest(input = {}) {
  return {
    schema: 'model3d-manifest/v1',
    generatedAt: new Date().toISOString(),
    sceneHash: input.sceneHash || null,
    taskSpecId: input.taskSpecId || null,
    workflowRunId: input.workflowRunId || null,
    recipeId: input.recipeId || null,
    recipeVersion: input.recipeVersion ?? null,
    provider: input.provider || null,
    providerVersion: input.providerVersion || null,
    inputHashes: input.inputHashes || {},
    validation: input.validation || null,
    outputs: Array.isArray(input.outputs) ? input.outputs : [],
  };
}

module.exports = {
  SCENE_VERSION,
  LIMITS,
  stableStringify,
  validateSceneSpec,
  resolveSceneSpec,
  hashSceneSpec,
  applySceneOperations,
  buildExportManifest,
};
