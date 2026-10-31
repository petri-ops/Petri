'use strict';

/**
 * helpers/scene3d.js — NEXT-04A SceneSpec v1 纯函数层。
 *
 * 单一源真相：SceneSpec 可 diff/校验/哈希/工作流；GLB/STL/OBJ 只是导出物。
 * 不执行任意 JS、不读网络、不做任意路径；渲染/导出由受控 provider 承担。
 */

const crypto = require('node:crypto');
const { meshFormatForPath, textureFormatForPath } = require('./mesh-assets');

const SCENE_VERSION = 'scene3d/v1';
const UNITS = new Set(['mm']);
const COORDINATE_SYSTEMS = new Set(['z-up-right-handed']);
const NODE_TYPES = new Set(['box', 'cylinder', 'sphere', 'plane', 'group', 'mesh-reference']);
// BLOCK-322 P2-02：灯种与引擎名的唯一声明处（Python 构建脚本与前端镜像由对账门逐值核对）。
const LIGHT_KINDS = new Set(['sun', 'point', 'spot', 'area']);
const RENDER_ENGINES = new Set(['workbench', 'cycles']);
// BLOCK-322 P3-01：几何操作白名单。求值只发生在 Blender（唯一执行器）；
// 预览端不参与建模，避免造出第二套几何内核（见 plan §4 红线 2）。
const MODIFIER_KINDS = new Set(['bevel', 'array', 'boolean']);
const BOOLEAN_OPERATIONS = new Set(['union', 'difference', 'intersect']);
const MODIFIER_FIELDS = {
  bevel: ['kind', 'width', 'segments'],
  array: ['kind', 'count', 'offset'],
  boolean: ['kind', 'operation', 'target'],
};
// BLOCK-322 P2-03 — 材质白名单。贴图走 helpers/mesh-assets 的资产单源（工作区相对路径 +
// sha256 锚定 + 大小上限），与 mesh-reference 同一执法口径；未声明的字段一律拒收，
// 免得「写了个 metalness 结果两边都不认」成为第三类静默失真。
const MATERIAL_FIELDS = ['color', 'roughness', 'metallic', 'emissive', 'baseColorTexture', 'densityKgM3'];
// BLOCK-322 P3-02a — 装配约束白名单。求值只发生在 resolveSceneSpec（唯一真值处），
// 结果烘进 transform 后交给 Blender；构建脚本与预览端都不再各自解一遍（红线 2）。
const CONSTRAINT_KINDS = new Set(['align', 'distance', 'angle', 'mate']);
const CONSTRAINT_AXES = new Set(['x', 'y', 'z']);
const MATE_FACES = Object.freeze(['+x', '-x', '+y', '-y', '+z', '-z']);
const MATE_FACE_SET = new Set(MATE_FACES);
const MATE_FACE_AXIS = {
  '+x': { axis: 'x', sign: 1 }, '-x': { axis: 'x', sign: -1 },
  '+y': { axis: 'y', sign: 1 }, '-y': { axis: 'y', sign: -1 },
  '+z': { axis: 'z', sign: 1 }, '-z': { axis: 'z', sign: -1 },
};
// RULING-04 第一切片：只对「无旋转、轴对齐的平面」做贴合；曲面/边/旋转/任意 B-rep 仍显式拒绝。
const MATE_PLANAR_FACES = Object.freeze({
  box: ['+x', '-x', '+y', '-y', '+z', '-z'],
  cylinder: ['+z', '-z'],
  plane: ['+z', '-z'],
});
const CONSTRAINT_FIELDS = {
  align: ['kind', 'a', 'b', 'axis'],
  distance: ['kind', 'a', 'b', 'axis', 'value'],
  angle: ['kind', 'a', 'b', 'axis', 'value'],
  mate: ['kind', 'a', 'b', 'aFace', 'bFace', 'offset'],
};
/** 每条约束只改写 b 的指定分量：align/distance/mate 定位置，angle 定姿态。 */
const CONSTRAINT_TARGET_FIELD = { align: 'position', distance: 'position', angle: 'rotation', mate: 'position' };
const AXIS_INDEX = { x: 0, y: 1, z: 2 };
const CONFLICT_TOLERANCE = 1e-9;
const LIMITS = Object.freeze({
  maxNodes: 500,
  maxParameters: 200,
  maxConstraints: 200,
  maxDimensionMm: 1_000_000,
  maxKeyLength: 80,
  maxResolutionPx: 4096,
  maxLights: 16,
  maxModifiers: 8,
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

/**
 * BLOCK-322 P3-01 — 节点级几何操作白名单校验（形状与参数）。
 * 引用合法性（boolean 目标必须是更早的已存在节点）在 validateSceneSpec 的二次遍历里查，
 * 与 constraints 同一手法：此处还不知道全量节点 id。
 */
function validateModifiers(node, index, errors) {
  const where = `nodes[${index}]`;
  if (node.modifiers === undefined) return;
  if (!Array.isArray(node.modifiers)) {
    errors.push(`${where}.modifiers 必须是数组`);
    return;
  }
  if (node.modifiers.length === 0) {
    errors.push(`${where}.modifiers 不能为空数组`);
    return;
  }
  if (node.modifiers.length > LIMITS.maxModifiers) errors.push(`${where}.modifiers 数量超限（≤${LIMITS.maxModifiers}）`);
  node.modifiers.forEach((modifier, position) => {
    const at = `${where}.modifiers[${position}]`;
    if (!isPlainObject(modifier)) {
      errors.push(`${at} 必须是对象`);
      return;
    }
    if (!MODIFIER_KINDS.has(modifier.kind)) {
      errors.push(`${at}.kind 只支持 bevel/array/boolean`);
      return;
    }
    for (const key of Object.keys(modifier)) {
      if (!MODIFIER_FIELDS[modifier.kind].includes(key)) errors.push(`${at}.${key} 不在 ${modifier.kind} 白名单`);
    }
    if (modifier.kind === 'bevel') {
      if (!finiteNumber(modifier.width) || modifier.width <= 0 || modifier.width > 100) {
        errors.push(`${at}.width 须在 (0,100] mm`);
      }
      if (modifier.segments !== undefined
        && (!Number.isInteger(modifier.segments) || modifier.segments < 1 || modifier.segments > 8)) {
        errors.push(`${at}.segments 须是 1..8 的整数`);
      }
    } else if (modifier.kind === 'array') {
      if (!Number.isInteger(modifier.count) || modifier.count < 1 || modifier.count > 64) {
        errors.push(`${at}.count 须是 1..64 的整数`);
      }
      if (modifier.offset !== undefined && !validateVector(modifier.offset)) errors.push(`${at}.offset 非法`);
    } else {
      if (!BOOLEAN_OPERATIONS.has(modifier.operation)) errors.push(`${at}.operation 只支持 union/difference/intersect`);
      if (!isSafeId(modifier.target)) errors.push(`${at}.target 非法`);
    }
  });
}

/**
 * BLOCK-322 P2-03 — 材质与基础色贴图声明校验。
 * 贴图与 mesh-reference 同执法口径：工作区相对路径 + 格式白名单（helpers/mesh-assets 单源）
 * + sha256 必填；越界即拒，不静默忽略（否则又是一类「写了但不生效」）。
 */
function validateMaterial(node, where, errors) {
  const material = node.material;
  if (material === undefined) return;
  if (!isPlainObject(material)) {
    errors.push(`${where}.material 必须是对象`);
    return;
  }
  for (const key of Object.keys(material)) {
    if (!MATERIAL_FIELDS.includes(key)) errors.push(`${where}.material.${key} 不在材质白名单`);
  }
  if (material.color !== undefined && !validateColor(material.color)) errors.push(`${where}.material.color 非法`);
  for (const key of ['roughness', 'metallic']) {
    if (material[key] !== undefined
      && (!finiteNumber(material[key]) || material[key] < 0 || material[key] > 1)) {
      errors.push(`${where}.material.${key} 须在 0..1`);
    }
  }
  if (material.emissive !== undefined && !validateColor(material.emissive)) errors.push(`${where}.material.emissive 非法`);
  if (material.densityKgM3 !== undefined
    && (!finiteNumber(material.densityKgM3) || material.densityKgM3 < 0.1 || material.densityKgM3 > 30000)) {
    errors.push(`${where}.material.densityKgM3 须在 0.1..30000`);
  }
  if (material.baseColorTexture === undefined) return;
  const texture = material.baseColorTexture;
  if (!isPlainObject(texture) || !isSafeRelativePath(texture.path)) errors.push(`${where}.material.baseColorTexture.path 非法`);
  else if (!textureFormatForPath(texture.path)) errors.push('texture_format_unsupported');
  if (!isPlainObject(texture) || !/^[a-f0-9]{64}$/i.test(String(texture.sourceSha256 || ''))) {
    errors.push('texture_source_hash_required');
  }
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
  validateMaterial(node, where, errors);
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
  validateModifiers(node, index, errors);
}

/**
 * BLOCK-322 P2-02 — 灯光与环境声明校验。
 *
 * 引擎策略由构建脚本按声明决定（实测：Blender 4.5.10 无头 Cycles CPU 640×480/8 采样 0.61s 可用，
 * EEVEE Next 无头走软件回退 13.3s 不可用）：未声明灯光/环境时仍是 BLENDER_WORKBENCH，
 * 声明后才切 CYCLES——否则「加了灯但灯不起作用」会被静默吞掉。
 */
function validateLight(light, index, errors, ids) {
  const where = `lights[${index}]`;
  if (!isPlainObject(light)) {
    errors.push(`${where} 必须是对象`);
    return;
  }
  if (!isSafeId(light.id)) errors.push(`${where}.id 非法`);
  else if (ids.has(light.id)) errors.push(`重复灯光 id ${light.id}`);
  else ids.add(light.id);
  if (!LIGHT_KINDS.has(light.kind)) errors.push(`${where}.kind 只支持 sun/point/spot/area`);
  if (!finiteNumber(light.energy) || light.energy < 0 || light.energy > 1000) errors.push(`${where}.energy 须在 0..1000`);
  if (light.color !== undefined && !validateColor(light.color)) errors.push(`${where}.color 非法`);
  if (!validateVector(light.position)) errors.push(`${where}.position 非法`);
  if (light.target !== undefined && !validateVector(light.target)) errors.push(`${where}.target 非法`);
  if (light.size !== undefined && (!finiteNumber(light.size) || light.size < 0)) errors.push(`${where}.size 非法`);
  if (light.spotDeg !== undefined && (!finiteNumber(light.spotDeg) || light.spotDeg <= 1 || light.spotDeg >= 179)) {
    errors.push(`${where}.spotDeg 须在 (1,179) 度之间`);
  }
}

function validateEnvironment(environment, errors) {
  if (!isPlainObject(environment)) {
    errors.push('environment 必须是对象');
    return;
  }
  if (environment.background !== undefined && !validateColor(environment.background)) {
    errors.push('environment.background 须是 #rrggbb');
  }
  if (environment.worldStrength !== undefined
    && (!finiteNumber(environment.worldStrength) || environment.worldStrength < 0 || environment.worldStrength > 10)) {
    errors.push('environment.worldStrength 须在 0..10');
  }
  if (environment.samples !== undefined
    && (!Number.isInteger(environment.samples) || environment.samples < 1 || environment.samples > 128)) {
    errors.push('environment.samples 须是 1..128 的整数');
  }
  if (environment.engine !== undefined && !RENDER_ENGINES.has(environment.engine)) {
    errors.push('environment.engine 只支持 workbench/cycles');
  }
}

/**
 * boolean 目标必须是「更早的已存在节点」：Blender 侧按节点顺序求值，后建的刀体不能
 * 给先建的节点当刀（顺序不确定 = 同一 SceneSpec 两次构建结果不同的隐患）。
 */
function validateModifierReferences(nodes, errors) {
  const firstIndexOf = new Map();
  nodes.forEach((node, index) => {
    const id = isPlainObject(node) && typeof node.id === 'string' ? node.id : null;
    if (id && !firstIndexOf.has(id)) firstIndexOf.set(id, index);
  });
  nodes.forEach((node, index) => {
    if (!isPlainObject(node) || !Array.isArray(node.modifiers)) return;
    node.modifiers.forEach((modifier, position) => {
      if (!isPlainObject(modifier) || modifier.kind !== 'boolean') return;
      const target = modifier.target;
      if (typeof target !== 'string' || !target) return;
      if (target === node.id) {
        errors.push(`nodes[${index}].modifiers[${position}] 不能对节点自身做 boolean`);
        return;
      }
      const targetIndex = firstIndexOf.get(target);
      if (targetIndex === undefined) errors.push(`boolean 目标 ${target} 不是已存在节点`);
      else if (targetIndex >= index) errors.push(`boolean 目标 ${target} 必须排在被操作节点之前`);
    });
  });
}

/**
 * BLOCK-322 P3-02a — 约束声明校验（形状与引用）。
 * 过约束（同一分量被定为两个不同值）要到 resolve 才知道，此处只保证能安全求值。
 */
function validateConstraints(constraints, nodesById, errors) {
  if (!Array.isArray(constraints)) {
    errors.push('constraints 必须是数组');
    return;
  }
  if (constraints.length > LIMITS.maxConstraints) {
    errors.push('约束数量超限');
    return;
  }
  constraints.forEach((constraint, index) => {
    const where = `constraints[${index}]`;
    if (!isPlainObject(constraint)) {
      errors.push(`${where} 必须是对象`);
      return;
    }
    if (!CONSTRAINT_KINDS.has(constraint.kind)) {
      errors.push(`${where}.kind 只支持 align/distance/angle/mate`);
      return;
    }
    for (const key of Object.keys(constraint)) {
      if (!CONSTRAINT_FIELDS[constraint.kind].includes(key)) errors.push(`${where}.${key} 不在 ${constraint.kind} 白名单`);
    }
    if (!isSafeId(constraint.a) || !isSafeId(constraint.b)) errors.push(`${where} 节点 id 非法`);
    else if (!nodesById.has(constraint.a) || !nodesById.has(constraint.b)) errors.push(`${where} 引用未知节点`);
    else if (constraint.a === constraint.b) errors.push(`${where} 不能约束自身`);
    if (constraint.kind === 'mate') {
      const aNode = nodesById.get(constraint.a);
      const bNode = nodesById.get(constraint.b);
      if (!MATE_FACE_SET.has(constraint.aFace) || !MATE_FACE_SET.has(constraint.bFace)) {
        errors.push(`${where} aFace/bFace 只支持 ${MATE_FACES.join('/')}`);
        return;
      }
      if (constraint.offset !== undefined && !finiteNumber(constraint.offset)) {
        errors.push(`${where}.offset 必须是有限数值（mm）`);
      }
      for (const [side, node, face] of [['a', aNode, constraint.aFace], ['b', bNode, constraint.bFace]]) {
        if (!node) continue;
        const faces = MATE_PLANAR_FACES[node.type];
        if (!faces) errors.push(`${where}.${side} 节点类型 ${node.type} 不支持 mate（平面特征表：box/cylinder/plane；sphere/其他类型属 v2b+ 扩展）`);
        else if (!faces.includes(face)) errors.push(`${where}.${side}Face ${face} 不是 ${node.type} 的可贴合平面`);
        // P3-03 v2a — 旋转平面贴合已支持（局→世合成 Rz·Ry·Rx 与 Blender 同源，探针定案）；
        // 仅曲面/边（v2c）与任意 B-rep 仍拒绝（MATE_PLANAR_FACES 白名单兜住）。
      }
      const aAxis = MATE_FACE_AXIS[constraint.aFace];
      const bAxis = MATE_FACE_AXIS[constraint.bFace];
      if (aAxis && bAxis && (aAxis.axis !== bAxis.axis || aAxis.sign !== -bAxis.sign)) {
        errors.push(`${where} mate 需要法向相反的同轴平面（${constraint.aFace}/${constraint.bFace}）`);
      }
      return;
    }
    if (!CONSTRAINT_AXES.has(constraint.axis)) errors.push(`${where}.axis 非法`);
    if (constraint.kind !== 'align' && !finiteNumber(constraint.value)) {
      errors.push(`${where}.value 必须是有限数值（${constraint.kind === 'distance' ? 'mm，可为负' : '度，可为负'}）`);
    }
  });
}

function validateMetadataTolerances(metadata, ids, errors) {
  if (!isPlainObject(metadata) || metadata.tolerances === undefined) return;
  const list = metadata.tolerances;
  if (!Array.isArray(list)) { errors.push('metadata.tolerances 必须是数组'); return; }
  if (list.length > 50) errors.push('metadata.tolerances 数量超限');
  list.slice(0, 50).forEach((row, index) => {
    const where = `metadata.tolerances[${index}]`;
    if (!isPlainObject(row)) { errors.push(`${where} 必须是对象`); return; }
    if (typeof row.nodeId !== 'string' || !ids.has(row.nodeId)) errors.push(`${where}.nodeId 不存在`);
    if (typeof row.feature !== 'string' || !row.feature.trim() || row.feature.length > 80) errors.push(`${where}.feature 非法`);
    for (const key of ['nominal', 'lower', 'upper']) {
      if (!finiteNumber(row[key])) errors.push(`${where}.${key} 须为有限数值`);
    }
    if (finiteNumber(row.lower) && finiteNumber(row.upper) && row.lower > row.upper) errors.push(`${where}.lower 不能大于 upper`);
    if (row.unit !== 'mm') errors.push(`${where}.unit 必须是 mm`);
  });
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
  const nodesById = new Map();
  if (Array.isArray(input.nodes)) input.nodes.forEach((node) => { if (isPlainObject(node) && isSafeId(node.id) && !nodesById.has(node.id)) nodesById.set(node.id, node); });
  if (input.constraints !== undefined) validateConstraints(input.constraints, nodesById, errors);
  validateMetadataTolerances(input.metadata, ids, errors);
  if (Array.isArray(input.nodes)) validateModifierReferences(input.nodes, errors);
  if (input.camera !== undefined) validateCamera(input.camera, errors);
  if (input.render !== undefined) validateRenderSettings(input.render, errors);
  if (input.lights !== undefined) {
    if (!Array.isArray(input.lights)) errors.push('lights 必须是数组');
    else if (input.lights.length > LIMITS.maxLights) errors.push(`灯光数量超限（≤${LIMITS.maxLights}）`);
    else {
      const lightIds = new Set();
      input.lights.forEach((light, index) => validateLight(light, index, errors, lightIds));
    }
  }
  if (input.environment !== undefined) validateEnvironment(input.environment, errors);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.includes('mesh_source_hash_required')) return { ok: false, error: 'mesh_source_hash_required', errors: uniqueErrors };
  if (uniqueErrors.includes('mesh_format_unsupported')) return { ok: false, error: 'mesh_format_unsupported', errors: uniqueErrors };
  if (uniqueErrors.includes('texture_source_hash_required')) return { ok: false, error: 'texture_source_hash_required', errors: uniqueErrors };
  if (uniqueErrors.includes('texture_format_unsupported')) return { ok: false, error: 'texture_format_unsupported', errors: uniqueErrors };
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

function componentOf(node, field, axisIndex) {
  const list = isPlainObject(node.transform) ? node.transform[field] : undefined;
  const value = Array.isArray(list) ? list[axisIndex] : undefined;
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function writeComponent(node, field, axisIndex, value) {
  if (!isPlainObject(node.transform)) node.transform = {};
  const list = Array.isArray(node.transform[field]) && node.transform[field].length === 3
    ? [...node.transform[field]]
    : [0, 0, 0];
  const before = typeof list[axisIndex] === 'number' && Number.isFinite(list[axisIndex]) ? list[axisIndex] : 0;
  list[axisIndex] = value;
  node.transform[field] = list;
  return before;
}

function mateHalfExtent(node, axis) {
  const dimensions = node && isPlainObject(node.dimensions) ? node.dimensions : {};
  const value = (key) => Number(dimensions[key]);
  if (node.type === 'box') {
    const byAxis = { x: value('width') / 2, y: value('depth') / 2, z: value('height') / 2 };
    return Number.isFinite(byAxis[axis]) ? byAxis[axis] : null;
  }
  if (node.type === 'cylinder') {
    const extent = axis === 'z' ? value('height') / 2 : value('radius');
    return Number.isFinite(extent) ? extent : null;
  }
  if (node.type === 'plane') {
    if (axis === 'z') return 0;
    const byAxis = { x: value('width') / 2, y: value('height') / 2 };
    return Number.isFinite(byAxis[axis]) ? byAxis[axis] : null;
  }
  return null;
}

// P3-03 v2a — 欧拉序探针定案（Blender 5.2.3 实测）：默认 rotation_mode='XYZ'，
// 矩阵合成 Rz·Ry·Rx（X 先转，列向量右乘）；euler 度 → 弧度。与前端求值器同源。
function rotationMatrixDeg(eulerDeg) {
  const [rx, ry, rz] = (Array.isArray(eulerDeg) ? eulerDeg : [0, 0, 0]).map((v) => (Number(v) || 0) * Math.PI / 180);
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  // Rz·Ry·Rx（列向量右乘；矩阵按行存储）
  return [
    [cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx],
    [sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx],
    [-sy, cy * sx, cy * cx],
  ];
}

function applyMatrix(m, v) {
  return [m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2], m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2], m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]];
}

/** 局部面心（半 extent × 面法向符号）。 */
function localFaceCenter(dimensions, face) {
  const meta = MATE_FACE_AXIS[face];
  if (!meta) return null;
  const half = { x: (Number(dimensions.width) || 0) / 2, y: (Number(dimensions.depth) || 0) / 2, z: (Number(dimensions.height) || 0) / 2 };
  const center = [0, 0, 0];
  center[AXIS_INDEX[meta.axis]] = half[meta.axis] * meta.sign;
  return { center, normalAxis: meta.axis, sign: meta.sign };
}

/** 旋转是否为零（逐分量）。 */
function rotationIsZero(node) {
  const rotation = node.transform && node.transform.rotation;
  return !Array.isArray(rotation) || rotation.every((value) => Number(value) === 0);
}

/** P3-03 v2a — 两平面的**世界法向**（面法向 = 局部法向经 Rz·Ry·Rx 合成）。 */
function worldFaceNormal(node, face) {
  if (rotationIsZero(node)) {
    const meta = MATE_FACE_AXIS[face];
    const v = [0, 0, 0];
    v[AXIS_INDEX[meta.axis]] = meta.sign;
    return { normal: v, axis: meta.axis, sign: meta.sign, rotated: false };
  }
  const meta = MATE_FACE_AXIS[face];
  const local = [0, 0, 0];
  local[AXIS_INDEX[meta.axis]] = meta.sign;
  const m = rotationMatrixDeg(node.transform && node.transform.rotation);
  const normal = applyMatrix(m, local).map((v) => Number(v.toFixed(9)));
  const axis = Math.abs(normal[0]) > 0.999 ? 'x' : Math.abs(normal[1]) > 0.999 ? 'y' : Math.abs(normal[2]) > 0.999 ? 'z' : null;
  return { normal, axis, sign: normal[axis === 'x' ? 0 : axis === 'y' ? 1 : 2] > 0 ? 1 : -1, rotated: true };
}

function applyMateConstraint({ constraint, index, anchor, target, decided, fail, applied }) {
  const aFace = MATE_FACE_AXIS[constraint.aFace];
  const bFace = MATE_FACE_AXIS[constraint.bFace];
  if (!aFace || !bFace) {
    fail('mate_face_incompatible', `constraint ${index}（mate）面标识非法（${constraint.aFace}/${constraint.bFace}）`);
    return;
  }
  // P3-03 v2a — 任一节点带旋转 → 局→世合成路径（世界法向校验 + 面点旋转求值 + 姿态写入）
  const aRotated = !rotationIsZero(anchor);
  const bRotated = !rotationIsZero(target);
  if (aRotated || bRotated) {
    return applyMateConstraintV2a({ constraint, index, anchor, target, decided, fail, applied, aFace, bFace, aRotated, bRotated });
  }
  if (aFace.axis !== bFace.axis || aFace.sign !== -bFace.sign) {
    fail('mate_face_incompatible', `constraint ${index}（mate）需要法向相反的同轴平面（${constraint.aFace}/${constraint.bFace}）`);
    return;
  }
  const aHalf = mateHalfExtent(anchor, aFace.axis);
  const bHalf = mateHalfExtent(target, bFace.axis);
  if (aHalf === null || bHalf === null) {
    fail('mate_dimensions_missing', `constraint ${index}（mate）的 ${constraint.b} 缺少可求值的尺寸`);
    return;
  }
  const normalAxis = aFace.axis;
  const normalIndex = AXIS_INDEX[normalAxis];
  const aFaceCoord = componentOf(anchor, 'position', normalIndex) + aHalf * aFace.sign;
  const offset = constraint.offset === undefined ? 0 : Number(constraint.offset);
  const targetValue = aFaceCoord + offset - bHalf * bFace.sign;
  const axes = ['x', 'y', 'z'].map((axis) => ({
    axis,
    index: AXIS_INDEX[axis],
    value: axis === normalAxis
      ? targetValue
      : componentOf(anchor, 'position', AXIS_INDEX[axis]),
  }));
  for (const item of axes) {
    const key = `${constraint.b}|position|${item.axis}`;
    const prior = decided.get(key);
    if (prior && Math.abs(prior.value - item.value) > CONFLICT_TOLERANCE) {
      fail('constraint_conflict', `constraint_conflict: ${constraint.b}.position.${item.axis} 已由 constraints[${prior.index}] 定为 ${prior.value}，constraints[${index}]（mate）要求 ${item.value}`);
      return;
    }
    if (Math.abs(item.value) > LIMITS.maxDimensionMm) {
      fail('constraint_out_of_range', `constraint_out_of_range: constraints[${index}]（mate）把 ${constraint.b}.position.${item.axis} 求值为 ${item.value}，超出 ±${LIMITS.maxDimensionMm}mm`);
      return;
    }
  }
  for (const item of axes) {
    const key = `${constraint.b}|position|${item.axis}`;
    if (!decided.has(key)) decided.set(key, { value: item.value, index });
    const from = writeComponent(target, 'position', item.index, item.value);
    applied.push({
      index,
      kind: 'mate',
      a: constraint.a,
      b: constraint.b,
      axis: item.axis,
      field: 'position',
      from,
      to: item.value,
      changed: Math.abs(from - item.value) > CONFLICT_TOLERANCE,
      aFace: constraint.aFace,
      bFace: constraint.bFace,
    });
  }
}

/**
 * P3-03 v2a — 带旋转节点的平面贴合求值（局→世合成 Rz·Ry·Rx，与 Blender 5.2.3 探针同源）。
 *
 * 语义：
 *   1. 两贴合面的世界法向经各自节点的 rotation 合成；法向必须相反（贴合定义，同 v1 但在世界系判）；
 *   2. 面点求值：a 面心（局→世，含 a 的 position 平移）与 b 面心（局→世）沿世界贴合法向对齐；
 *   3. b 的 rotation 改写为「使 b 贴合面世界法向 = −a 贴合面世界法向」的最小姿态：
 *      a 无旋转时=把 b 的贴合面法向转回 a 的轴对齐反方向（本刀只解轴对齐结果姿态，
 *      一般姿态合成=材料 §5 v2b 后续票）；a 也旋转时=保持 b.rotation 不变、只对位置（如实登记）。
 *   4. 未转一方按零旋转路径求值（与 v1 数值逐位一致——兼容锚①）。
 */
/** P3-03 v2a — 在 90° 欧拉组合（XYZ 序，三轴各 0/90/180/270）内枚举：
 * 找到使 face 的世界法向 = targetNormal 的最小姿态（改动量最小者）；找不到返回 null。 */
function solveRotationForFaceNormal(currentEuler, face, targetNormal) {
  const local = [0, 0, 0];
  const meta = MATE_FACE_AXIS[face];
  local[AXIS_INDEX[meta.axis]] = meta.sign;
  const steps = [0, 90, 180, 270];
  let best = null;
  let bestCost = Infinity;
  for (const dx of steps) for (const dy of steps) for (const dz of steps) {
    const euler = [dx, dy, dz];
    const m = rotationMatrixDeg(euler);
    const world = applyMatrix(m, local).map((v) => Number(v.toFixed(6)));
    if (!world.some((v, i) => Math.abs(v - targetNormal[i]) > 1e-6)) {
      const cost = euler.reduce((acc, v, i) => acc + Math.abs(v - (currentEuler[i] || 0)) * (i === 0 ? 1 : i === 1 ? 2 : 3), 0);
      if (cost < bestCost) { bestCost = cost; best = euler; }
    }
  }
  return best;
}

function applyMateConstraintV2a({ constraint, index, anchor, target, decided, fail, applied, aRotated, bRotated }) {
  const aWorld = worldFaceNormal(anchor, constraint.aFace);
  // v2a 姿态改写先于法向校验：贴合=两世界法向相反。a 无旋转 → 目标轴对齐；
  // 90° 欧拉组合可枚举（XYZ 序三轴 0/90/180/270 共 64 组合），找到使 b 贴合面
  // 世界法向 = −aWorld.normal 的最小姿态即改写（找不到 → mate_face_incompatible，
  // 一般姿态合成属 v2b 后续票，不静默伪造）。
  const originalBRotation = (target.transform && Array.isArray(target.transform.rotation) ? target.transform.rotation : [0, 0, 0]).map(Number);
  let bRotationFinal = [...originalBRotation];
  const bRotatedNow = bRotationFinal.some((v) => v !== 0);
  const aWorldForPose = aWorld;
  if (!aWorldForPose.axis) {
    fail('mate_face_incompatible', `constraint ${index}（mate）a 旋转后贴合面法向非轴对齐（${JSON.stringify(aWorldForPose.normal)}）——一般姿态合成属 v2b 后续票`);
    return;
  }
  const targetNormal = aWorldForPose.normal.map((v) => -v);
  if (bRotatedNow) {
    const solved = solveRotationForFaceNormal(bRotationFinal, constraint.bFace, targetNormal);
    if (solved === null) {
      fail('mate_face_incompatible', `constraint ${index}（mate）90° 欧拉组合内无可使贴合面法向对齐的姿态（目标 ${JSON.stringify(targetNormal)}）——一般姿态合成属 v2b 后续票`);
      return;
    }
    bRotationFinal = solved;
    target.transform.rotation = [...solved];
    applied.push({
      index,
      kind: 'mate',
      a: constraint.a,
      b: constraint.b,
      axis: 'x',
      field: 'rotation',
      from: originalBRotation,
      to: [...solved],
      changed: true,
      v2a: true,
      poseSolve: true,
    });
  }
  const bWorld = worldFaceNormal(target, constraint.bFace);
  if (!bWorld.axis) {
    fail('mate_face_incompatible', `constraint ${index}（mate）姿态改写后贴合面法向非轴对齐——一般姿态合成属 v2b 后续票`);
    return;
  }
  if (bWorld.axis !== aWorldForPose.axis || bWorld.sign !== -aWorldForPose.sign) {
    fail('mate_face_incompatible', `constraint ${index}（mate）世界法向须相反且同轴（a=${JSON.stringify(aWorldForPose.normal)} b=${JSON.stringify(bWorld.normal)}）`);
    return;
  }
  const normalAxis = aWorld.axis;
  const normalIndex = AXIS_INDEX[normalAxis];
  const dimsOf = (node) => (node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : {});
  const bDims = dimsOf(target);
  const offset = constraint.offset === undefined ? 0 : Number(constraint.offset);

  // a 面心世界坐标 = a.position + Ra·(局部面心)
  const aDims = dimsOf(anchor);
  const aLocal = localFaceCenter(aDims, constraint.aFace);
  const bLocal = localFaceCenter(bDims, constraint.bFace);
  if (!aLocal || !bLocal) {
    fail('mate_dimensions_missing', `constraint ${index}（mate）缺可求值尺寸`);
    return;
  }
  const aRot = aRotated ? rotationMatrixDeg(anchor.transform.rotation) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const bRot = bRotated ? rotationMatrixDeg(target.transform.rotation) : [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const aPos = (anchor.transform && Array.isArray(anchor.transform.position) ? anchor.transform.position : [0, 0, 0]).map(Number);
  const aFaceCenter = applyMatrix(aRot, aLocal.center).map((v, i) => v + aPos[i]);

  // b 的新姿态：贴合面世界法向 = −aWorld.normal。a 未转 → 目标=轴对齐反方向；
  // 最小姿态=清零/翻转 b 的 euler 使局部贴合面指对目标（本刀只解「目标为轴对齐」情形）。

  const newBRotation = (() => {
    if (!bRotated) return (target.transform.rotation || [0, 0, 0]).map(Number);
    // b 已旋转：若其贴合面局部法向 × 任一 90° 组合可达目标 → 用最小改动=目标轴对齐时的
    // 局部法向映射反推。本刀如实边界：非零旋转 b 的姿态保留原值、位置按原姿态求值——
    // 姿态改写的一般解（四元数最短弧）属 v2b 后续票，不静默伪造。
    const worldAfter = applyMatrix(bRot, [0, 0, 0]);
    void worldAfter;
    return (target.transform.rotation || [0, 0, 0]).map(Number);
  })();

  // b 面心世界坐标目标 = a 面心 + offset·(−法向)——沿贴合法向对齐
  const bFaceTarget = aFaceCenter.map((v, i) => (i === normalIndex ? v + offset * -aWorld.normal[i] : v));
  // b.position = bFaceTarget − Rb·(局部面心)
  const bNewPos = bFaceTarget.map((v, i) => v - applyMatrix(bRot, bLocal.center)[i]);

  const axes = ['x', 'y', 'z'].map((axis) => ({
    axis,
    index: AXIS_INDEX[axis],
    value: round6(bNewPos[AXIS_INDEX[axis]]),
  }));
  for (const item of axes) {
    const key = `${constraint.b}|position|${item.axis}`;
    const prior = decided.get(key);
    if (prior && Math.abs(prior.value - item.value) > CONFLICT_TOLERANCE) {
      fail('constraint_conflict', `constraint_conflict: ${constraint.b}.position.${item.axis} 已由 constraints[${prior.index}] 定为 ${prior.value}，constraints[${index}]（mate v2a）要求 ${item.value}`);
      return;
    }
    if (Math.abs(item.value) > LIMITS.maxDimensionMm) {
      fail('constraint_out_of_range', `constraint_out_of_range: constraints[${index}]（mate v2a）把 ${constraint.b}.position.${item.axis} 求值为 ${item.value}，超出 ±${LIMITS.maxDimensionMm}mm`);
      return;
    }
  }
  for (const item of axes) {
    const key = `${constraint.b}|position|${item.axis}`;
    if (!decided.has(key)) decided.set(key, { value: item.value, index });
    const from = writeComponent(target, 'position', item.index, item.value);
    applied.push({
      index,
      kind: 'mate',
      a: constraint.a,
      b: constraint.b,
      axis: item.axis,
      field: 'position',
      from,
      to: item.value,
      changed: Math.abs(from - item.value) > CONFLICT_TOLERANCE,
      aFace: constraint.aFace,
      bFace: constraint.bFace,
      v2a: true,
    });
  }
  // 姿态写入（本刀只写 a 无旋转 → b 对齐轴对齐反方向的情形；b 已旋转时姿态保留原值如实不写）
  if (!bRotated) {
    const from = (target.transform.rotation || [0, 0, 0]).map(Number);
    const to = aRotated ? from : [0, 0, 0];
    void newBRotation;
    const changed = to.some((v, i) => Math.abs(v - from[i]) > CONFLICT_TOLERANCE);
    if (changed) {
      if (!isPlainObject(target.transform)) target.transform = {};
      target.transform.rotation = [...to];
    }
    applied.push({
      index,
      kind: 'mate',
      a: constraint.a,
      b: constraint.b,
      axis: normalAxis,
      field: 'rotation',
      from,
      to,
      changed,
      v2a: true,
    });
  }
}

function round6(v) { return Number(v.toFixed(6)); }

/**
 * BLOCK-322 P3-02a — 单遍、按声明顺序求值装配约束，结果写回 b 的 transform。
 *
 * 参照面读的是「已求过约束的当前值」，所以 a→b→c 链会自然传递。同一分量被两条约束定为不同值
 * 即过约束：显式 constraint_conflict，不猜优先级也不静默取后值——静默取值的装配不可复现。
 * RULING-04 第一切片：mate 只支持无旋转 box/cylinder/plane 的轴对齐平面贴合（法向相反、
 * 面心对齐、沿法向 offset）；曲面/边/旋转/任意 B-rep 仍拒绝，不假装支持。
 */
function applyConstraints(scene) {
  const constraints = Array.isArray(scene.constraints) ? scene.constraints : [];
  const applied = [];
  const errors = [];
  let errorCode = null;
  const fail = (code, message) => {
    errors.push(message);
    if (!errorCode) errorCode = code;
  };
  const nodesById = new Map();
  for (const node of scene.nodes) {
    if (isPlainObject(node) && !nodesById.has(node.id)) nodesById.set(node.id, node);
  }
  const decided = new Map();
  constraints.forEach((constraint, index) => {
    const target = nodesById.get(constraint.b);
    const anchor = nodesById.get(constraint.a);
    if (!target || !anchor) return;
    if (constraint.kind === 'mate') {
      applyMateConstraint({ constraint, index, anchor, target, decided, fail, applied });
      return;
    }
    const field = CONSTRAINT_TARGET_FIELD[constraint.kind];
    const axis = AXIS_INDEX[constraint.axis];
    const to = componentOf(anchor, field, axis) + (constraint.kind === 'align' ? 0 : constraint.value);
    const key = `${constraint.b}|${field}|${constraint.axis}`;
    const prior = decided.get(key);
    if (prior && Math.abs(prior.value - to) > CONFLICT_TOLERANCE) {
      fail('constraint_conflict', `constraint_conflict: ${constraint.b}.${field}.${constraint.axis} 已由 constraints[${prior.index}] 定为 ${prior.value}，constraints[${index}]（${constraint.kind}）要求 ${to}`);
      return;
    }
    if (!prior) decided.set(key, { value: to, index });
    if (Math.abs(to) > LIMITS.maxDimensionMm) {
      fail('constraint_out_of_range', `constraint_out_of_range: constraints[${index}]（${constraint.kind}）把 ${constraint.b}.${field}.${constraint.axis} 求值为 ${to}，超出 ±${LIMITS.maxDimensionMm}mm`);
      return;
    }
    const from = writeComponent(target, field, axis, to);
    applied.push({
      index,
      kind: constraint.kind,
      a: constraint.a,
      b: constraint.b,
      axis: constraint.axis,
      field,
      from,
      to,
      changed: Math.abs(from - to) > CONFLICT_TOLERANCE,
    });
  });
  return { applied, errors, errorCode };
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
  const { applied, errors, errorCode } = applyConstraints(scene);
  if (errors.length > 0) return { ok: false, error: errorCode, errors: [...new Set(errors)] };
  return { ok: true, scene, stats: validated.stats, appliedConstraints: applied };
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
        if (!['transform', 'dimensions', 'material', 'label', 'modifiers'].includes(key)) return { ok: false, error: 'operation_not_allowed' };
      }
      Object.assign(node, changes);
    } else if (operation.op === 'add_node') {
      if (!isPlainObject(operation.node)) return { ok: false, error: 'operation_invalid' };
      if (nodeById().has(operation.node.id)) return { ok: false, error: 'duplicate_node_id' };
      base.nodes.push(clone(operation.node));
    } else if (operation.op === 'remove_node') {
      if (nodeById().size <= 1) return { ok: false, error: 'scene_requires_node' };
      base.nodes = base.nodes.filter((node) => node.id !== operation.id);
    } else if (operation.op === 'add_constraint') {
      // P3-03 v2b 第二票 — 约束创建操作：校验走 validateSceneSpec 同源单源
      // （mate 面白名单/法向相反/数值域全复用），不建第二校验真相。
      if (!isPlainObject(operation.constraint)) return { ok: false, error: 'operation_invalid' };
      base.constraints = Array.isArray(base.constraints) ? base.constraints : [];
      if (base.constraints.length >= (LIMITS.maxConstraints || 200)) return { ok: false, error: 'constraints_limit' };
      base.constraints.push(clone(operation.constraint));
      // v2b — 约束创建即求值（fail-closed）：不可解/冲突/越界的约束整个 apply 拒收，
      // 不落一个「存进去但装配不动」的死约束。校验=applyConstraints 同源单源。
      const evaluation = applyConstraints(base);
      if (evaluation.errorCode) {
        return { ok: false, error: evaluation.errorCode, message: evaluation.errors.join('; ') };
      }
      // 校验同源：validateSceneSpec 的 mate 面白名单/法向/旋转检查复用（不建第二校验真相）
      const validated = validateSceneSpec(base);
      if (!validated.ok) {
        return { ok: false, error: 'constraint_invalid', message: validated.errors.join('; ') };
      }
    } else if (operation.op === 'remove_constraint') {
      if (!Array.isArray(base.constraints)) return { ok: false, error: 'no_constraints' };
      const idx = base.constraints.findIndex((c) => isPlainObject(c) && c.id === operation.id);
      if (idx < 0) return { ok: false, error: 'constraint_not_found' };
      base.constraints.splice(idx, 1);
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
