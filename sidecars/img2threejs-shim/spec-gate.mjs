/**
 * sidecars/img2threejs-shim/spec-gate.mjs — BLOCK-469 / S5 img2threejs 借形封装首片。
 *
 * 借形（B-5 / U-3D-D5 ruled）：抽取 img2threejs 的**门禁范式**——
 *   script-enforce / fail-closed（strict gate 失败出 BLOCKED、不写 factory）/
 *   pass-gated（逐阶段解锁）/ per-region confidence（→evidence），
 * 落成一个纯 JS、零依赖、零 Python、零外部服务的受治理骨架。
 *
 * 不整包：不复制上游 ~90 Python 脚本、不装宿主目录、不引入 img2threejs 包；
 * 外部服务（hosted TRELLIS/Context7/SAM2/Depth Anything…）默认 deny，
 * 仅外部显式 allow-list（P5-a 确认位）才放行——本模块不提供任何 transport。
 *
 * 事实来源：acceptance/next-stage-super-blueprint-2026-11-17/IMG2THREEJS-EVALUATION.md §1.2/§2.1（只读）。
 */

export const PASSES = Object.freeze(['intake', 'spec', 'build', 'review', 'rig']);
// 模块内部常量（不导出——避免 knip 死代码面新增；仅 PASSES 是消费测试契约导出）。
const OBJECT_CLASSES = Object.freeze(['hard-surface', 'character', 'hybrid']);
const MIN_CONFIDENCE = 0.5;

const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * strict-quality gate（script-enforce）：校验 ObjectSculptSpec 形状的受治理子集。
 * 返回 { verdict:'pass'|'BLOCKED', factoryEmitted, diagnostics[] }；
 * 任何 fail-closed 一律 BLOCKED 且 factoryEmitted=false（不写 factory，不冒充成功）。
 */
export function evaluateSpecGate(spec) {
  const diagnostics = [];
  const blocked = (reason) => ({ verdict: 'BLOCKED', factoryEmitted: false, diagnostics: [...diagnostics, reason] });

  if (!isPlainObject(spec)) return blocked('spec 非对象（strict-quality fail-closed）');
  if (ownGet(spec, 'version') !== 1) return blocked('spec.version 必须为 1');
  if (!OBJECT_CLASSES.includes(ownGet(spec, 'objectClass'))) return blocked('objectClass 不在白名单');

  const tree = ownGet(spec, 'componentTree');
  if (!Array.isArray(tree) || tree.length === 0) return blocked('componentTree 必须是非空数组');
  const ids = new Set();
  for (const node of tree) {
    if (!isPlainObject(node)) return blocked('componentTree 节点非对象');
    const id = ownGet(node, 'id');
    if (typeof id !== 'string' || !id) return blocked('componentTree 节点缺 id');
    if (ids.has(id)) return blocked(`componentTree 重复 id: ${id}`);
    ids.add(id);
    const confidence = ownGet(node, 'confidence');
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
      return blocked(`节点 ${id} confidence 越界 [0,1]`);
    }
    if (confidence < MIN_CONFIDENCE) {
      diagnostics.push(`节点 ${id} confidence ${confidence} < ${MIN_CONFIDENCE}（低置信，需视觉审查）`);
      return blocked(diagnostics.at(-1));
    }
  }
  const materials = ownGet(spec, 'materials');
  if (!isPlainObject(materials) && !Array.isArray(materials)) return blocked('materials 必须为对象/数组形态');
  if (!isPlainObject(ownGet(spec, 'runtimeHierarchy'))) return blocked('runtimeHierarchy 缺失');
  const sockets = ownGet(spec, 'sockets');
  if (sockets !== undefined && !Array.isArray(sockets)) return blocked('sockets 必须为数组');
  const detail = ownGet(spec, 'detailInventory');
  if (detail !== undefined && !Array.isArray(detail)) return blocked('detailInventory 必须为数组');

  diagnostics.push('strict-quality gate pass（script-enforce）');
  return { verdict: 'pass', factoryEmitted: true, diagnostics };
}

/**
 * pass-gated 阶段状态机：仅允许 PASSES 顺序推进；跳阶/重复/未知 pass 一律 rejected。
 * 不修改入参（返回新 state），无副作用。
 */
export function advanceGate(state, pass) {
  if (!isPlainObject(state)) return { pass: null, rejected: true, reason: 'state 非对象' };
  const current = ownGet(state, 'pass');
  const from = PASSES.indexOf(current);
  const to = PASSES.indexOf(pass);
  if (from < 0 || to < 0) return { ...state, rejected: true, reason: '未知 pass' };
  if (to !== from + 1) return { ...state, rejected: true, reason: '跳阶或重复 pass' };
  return { ...state, pass, rejected: false, history: [...(Array.isArray(ownGet(state, 'history')) ? ownGet(state, 'history') : []), pass] };
}

/**
 * 外部服务默认关：未显式 externalServiceAllow 即 deny 一切外部服务；
 * 即便声明，只有 allow-list 命中才放行。本函数不建任何 transport（无网络面）。
 */
export function validateExternalServices(config) {
  const declared = Array.isArray(ownGet(config, 'externalServiceAllow'));
  const allow = declared ? ownGet(config, 'externalServiceAllow') : [];
  const external = Array.isArray(ownGet(config, 'external')) ? ownGet(config, 'external') : [];
  const diagnostics = [];
  // 默认关：未显式声明 allow-list 即 deny（allowed=false），即便无请求也保持关闭姿态。
  if (!declared) {
    diagnostics.push('外部服务默认关（未显式声明 externalServiceAllow，需 P5-a 确认）');
    return { allowed: false, diagnostics };
  }
  for (const svc of external) {
    const name = isPlainObject(svc) ? ownGet(svc, 'name') : String(svc);
    if (!allow.includes(name)) {
      diagnostics.push(`外部服务 ${name} 未在 allow-list（默认关，需 P5-a 确认）`);
      return { allowed: false, diagnostics };
    }
  }
  diagnostics.push('外部服务均命中显式 allow-list（P5-a 已确认）');
  return { allowed: true, diagnostics };
}
