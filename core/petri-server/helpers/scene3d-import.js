'use strict';

/**
 * helpers/scene3d-import.js — BLOCK-460：sand3d GLB → SceneSpec v1(+joints) 归一器。
 *
 * L2 归一单源（charter §3.2：SceneSpec 是唯一场景真相，本模块只产出它的文档，
 * 不建第二套 IR）。语义依据 = BLOCK-459 探针实测（acceptance/block-459/PROBE-REPORT.md
 * §2/§3 与 scene-ir-v0-draft.md N1–N8 的 SceneSpec 变体）：
 *   - GLB 用 stdlib 解析 JSON chunk（零第三方依赖，探针 parse_glb.py 同逻辑的 Node 版）；
 *   - 关节节点（extras.s3d_joint）→ spec.joints[]；axis = 局部 +Y 经节点四元数变换到
 *     glTF 世界系，再转 z-up spec 系（glTF[x,y,z] → spec[x,-z,y] 的旋转映射）；
 *   - 单位：glTF mesh/translation 已是程序单位（SceneSpec=mm，直接同制）；关节 range 由
 *     导出层归一为 revolute=rad / prismatic=m，此处换算到场景制 deg/mm；
 *   - fail-closed：rest 校验（全部 value==0）不过、魔数不对、路径越界、mesh 资产超限
 *     一律拒绝整份文档并给诊断，不产出半份。
 * 零新 agent 工具/IPC：agent 经 run_cmd（guard-ack）调 runner 产出 GLB 后调本模块。
 */

const fs = require('node:fs');
const path = require('node:path');
const { sha256File } = require('./artifact-truth');
const { MAX_MESH_BYTES } = require('./mesh-assets');

const PRODUCER = 'sand3d';

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 解析 GLB 的 JSON chunk（stdlib only；魔数/版本/首 chunk 类型不对即 null）。 */
function parseGlbJson(buffer) {
  try {
    if (buffer.length < 20) return null;
    const magic = buffer.subarray(0, 4);
    if (!magic.equals(Buffer.from('glTF'))) return null;
    const version = buffer.readUInt32LE(4);
    if (version !== 2) return null;
    let offset = 12;
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.subarray(offset + 4, offset + 8);
    if (!chunkType.equals(Buffer.from('JSON'))) return null;
    if (chunkLength <= 0 || offset + 8 + chunkLength > buffer.length) return null;
    return JSON.parse(buffer.subarray(offset + 8, offset + 8 + chunkLength).toString('utf8'));
  } catch {
    return null;
  }
}

/** 四元数（x,y,z,w）作用于向量。 */
function quatApply(q, v) {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  // v' = v + w*t + cross(q.xyz, t)
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

/** glTF Y-up → spec z-up（右手系旋转映射：spec_x=gltf_x, spec_y=-gltf_z, spec_z=gltf_y）。 */
function gltfToSpecAxis(v) {
  const [x, y, z] = v;
  const out = [x, -z, y];
  const norm = Math.hypot(out[0], out[1], out[2]) || 1;
  // +0 归一：-z 在 z=0 时产出 -0，deepStrictEqual 会把 -0 与 0 判不等
  return out.map((component) => component / norm + 0);
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * 归一入口：读工作区内 GLB → SceneSpec v1(+joints)。
 * @param {object} input
 * @param {string} input.workspaceRoot 工作区绝对根（越界路径直接拒绝）
 * @param {string} input.glbRelativePath GLB 的工作区相对路径（.glb）
 * @param {string} input.programDigest sand3d 程序指纹（fingerprint 或程序 sha256，原样登记）
 * @param {string} [input.producerVersion] sand3d 版本（默认按探针口径 1.6.3）
 * @returns {{ok:true, scene:object, glbSha256:string, restPose:boolean, joints:number}
 *          |{ok:false, error:string, errors?:string[]}}
 */
function importSand3dGlb({ workspaceRoot, glbRelativePath, programDigest, producerVersion = '1.6.3' }) {
  const errors = [];
  const relative = String(glbRelativePath || '').trim().replace(/\\/g, '/');
  if (!relative.toLowerCase().endsWith('.glb')) return { ok: false, error: 'glb_format_unsupported' };
  const normalizedRelative = path.posix.normalize(relative);
  if (normalizedRelative.startsWith('../') || normalizedRelative.startsWith('/') || path.isAbsolute(normalizedRelative)) {
    return { ok: false, error: 'path_outside_workspace' };
  }
  const absolute = path.join(workspaceRoot, normalizedRelative);
  const resolvedRoot = path.resolve(workspaceRoot);
  if (!path.resolve(absolute).startsWith(resolvedRoot + path.sep)) {
    return { ok: false, error: 'path_outside_workspace' };
  }
  let buffer;
  try {
    const stat = fs.statSync(absolute);
    if (stat.size > MAX_MESH_BYTES) return { ok: false, error: 'asset_too_large' };
    buffer = fs.readFileSync(absolute);
  } catch {
    return { ok: false, error: 'asset_missing' };
  }
  const gltf = parseGlbJson(buffer);
  if (!gltf) return { ok: false, error: 'glb_parse_failed' };

  const nodes = Array.isArray(gltf.nodes) ? gltf.nodes : [];

  // rest 判据：所有关节 value 必须 === 0（首版只消费 rest 导出；posed 导出明确拒绝）
  let restPose = true;

  // 先收集节点名（关节引用解析需要）
  const nodeNames = nodes.map((node) => (typeof node?.name === 'string' ? node.name : null));
  const sceneJoints = [];

  nodes.forEach((node) => {
    const extras = node?.extras;
    const payload = extras && typeof extras === 'object' ? extras.s3d_joint : null;
    if (!payload || typeof payload !== 'object') return;
    const joint = {
      id: String(payload.name ?? '').trim(),
      child: nodeNames[node.children?.[0]] ?? null,
      parent: null, // 父节点名稍后由反向索引填（GLB 不存父指针）
      kind: String(payload.type ?? '').trim(),
    };
    if (Array.isArray(node.children) && node.children.length === 1 && typeof nodeNames[node.children[0]] === 'string') {
      joint.child = nodeNames[node.children[0]];
    } else {
      errors.push(`joint ${joint.id}: 关节节点必须恰有一个 children（子部件）`);
    }
    if (payload.value !== 0) restPose = false;

    if (joint.kind === 'floating') {
      // floating：无 axis/range（探针实测）
    } else {
      if (Array.isArray(payload.axis) && payload.axis.every(isFiniteNumber) && Array.isArray(node.rotation) && node.rotation.every(isFiniteNumber)) {
        // 局部 +Y 经关节节点旋转 → glTF 世界系 → spec z-up
        joint.axis = gltfToSpecAxis(quatApply(node.rotation, payload.axis));
      } else if (Array.isArray(payload.axis) && payload.axis.every(isFiniteNumber)) {
        // 无旋转（identity）：局部=glTF 世界系
        joint.axis = gltfToSpecAxis(payload.axis);
      } else {
        errors.push(`joint ${joint.id}: axis 缺失或非法`);
      }
      if (isFiniteNumber(payload.lower) && isFiniteNumber(payload.upper)) {
        // 导出层 revolute=rad / prismatic=m → 场景制 deg / mm
        const isRevolute = joint.kind === 'revolute';
        const scale = isRevolute ? RAD_TO_DEG : 1000;
        joint.range = {
          min: Math.round(payload.lower * scale * 1e6) / 1e6,
          max: Math.round(payload.upper * scale * 1e6) / 1e6,
        };
        if (joint.kind !== 'revolute' && joint.kind !== 'prismatic') {
          errors.push(`joint ${joint.id}: ${joint.kind} 不应携带 lower/upper`);
        }
      } else if (joint.kind === 'revolute' || joint.kind === 'prismatic') {
        errors.push(`joint ${joint.id}: ${joint.kind} 缺 lower/upper`);
      }
    }
    if (payload.mimic && typeof payload.mimic === 'object') {
      joint.follows = typeof payload.mimic.joint === 'string' ? payload.mimic.joint : null;
      joint.ratio = isFiniteNumber(payload.mimic.multiplier) ? payload.mimic.multiplier : null;
      if (!joint.follows || joint.ratio === null) errors.push(`joint ${joint.id}: mimic 缺 joint/multiplier`);
    }
    sceneJoints.push(joint);
  });

  // 反向索引填 parent：children 指向关节节点的那个节点就是父
  const jointNodeIndices = new Map();
  nodes.forEach((node, index) => {
    if (node?.extras?.s3d_joint) jointNodeIndices.set(index, node);
  });
  nodes.forEach((node) => {
    if (!Array.isArray(node.children)) return;
    for (const childIndex of node.children) {
      const jointNode = jointNodeIndices.get(childIndex);
      if (jointNode && typeof node.name === 'string') {
        const joint = sceneJoints.find((row) => row.id === jointNode.extras.s3d_joint.name);
        if (joint && joint.parent === null) joint.parent = node.name;
      }
    }
  });
  for (const joint of sceneJoints) {
    if (joint.parent === null) errors.push(`joint ${joint.id}: 未解析到父节点`);
    if (!joint.child) errors.push(`joint ${joint.id}: 未解析到子节点`);
  }
  if (!restPose) return { ok: false, error: 'not_rest_pose', errors: ['GLB 携带非零关节值（posed 导出）；首版只消费 rest 导出'] };

  const glbSha256 = sha256File(absolute);

  // kinematic addressing 节点（BLOCK-460）：joints 的 child/parent 引用的 GLB 内部部件
  // 必须以 spec 节点形式在场才能过 validateJoints 引用检查。装配根 = mesh-reference
  //（承载整装配视觉，逐件拆分留 P3）；其余命名非关节部件 = group（运动学体，无几何）。
  // SceneSpec 节点表是扁平的；GLB 层级信息由 joints[].parent/child + GLB 资产自身承载。
  const idPattern = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
  const rootNodeIndex = gltf.scenes?.[gltf.scene ?? 0]?.nodes?.[0];
  const specNodes = [];
  const seenIds = new Set();
  const jointChildIds = new Set(sceneJoints.map((joint) => joint.child).filter(Boolean));
  const jointParentIds = new Set(sceneJoints.map((joint) => joint.parent).filter(Boolean));
  nodes.forEach((node, index) => {
    if (!node || node.extras?.s3d_joint) return;
    const name = nodeNames[index];
    if (typeof name !== 'string' || !idPattern.test(name)) return; // 无名/非法名节点不建（关节不会引用）
    if (seenIds.has(name)) {
      errors.push(`GLB 节点名重复 ${name}`);
      return;
    }
    seenIds.add(name);
    const isReferencedByJoint = jointChildIds.has(name) || jointParentIds.has(name);
    const isRoot = index === rootNodeIndex;
    if (isRoot) {
      specNodes.push({
        id: name,
        type: 'mesh-reference',
        label: `sand3d 装配 ${name}`,
        source: { path: normalizedRelative, sourceSha256: glbSha256 },
      });
    } else if (isReferencedByJoint) {
      specNodes.push({ id: name, type: 'group', label: `sand3d 部件 ${name}` });
    }
    // 既非根也未被关节引用的装饰节点不进 spec（归一只登记运动学寻址所需的最小集合）
  });
  if (seenIds.size === 0 || !specNodes.some((node) => node.type === 'mesh-reference')) {
    errors.push(`GLB 缺少可寻址的装配根节点`);
  }
  // 确定性序：mesh-reference（主视觉）固定首位，group 运动学体按 GLB 迭代序跟随
  specNodes.sort((a, b) => (a.type === 'mesh-reference' ? -1 : 0) - (b.type === 'mesh-reference' ? -1 : 0));

  const scene = {
    version: 'scene3d/v1',
    units: 'mm',
    coordinateSystem: 'z-up-right-handed',
    parameters: {},
    nodes: specNodes,
    joints: sceneJoints,
    metadata: {
      provenance: {
        producer: PRODUCER,
        producerVersion,
        programDigest: String(programDigest ?? ''),
        glbSha256,
        exportedFrom: 'sand3d GLB extras.s3d_joint（BLOCK-459 实测 schema）',
        schemaNote: 'SceneSpec v1 additive joints；角度=deg、长度=mm（导出层 rad/m 已换算）',
      },
    },
  };

  if (errors.length > 0) return { ok: false, error: 'import_invalid', errors: [...new Set(errors)] };
  return { ok: true, scene, glbSha256, restPose, joints: sceneJoints.length };
}

module.exports = {
  importSand3dGlb,
  parseGlbJson,
  quatApply,
  gltfToSpecAxis,
  PRODUCER,
};
