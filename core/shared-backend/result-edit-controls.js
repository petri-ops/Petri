'use strict';

/**
 * G0-RS-P4 — Schema 驱动的编辑控件投影与统一 Patch 归一化。
 *
 * 设计边界（不建第二条编辑链）：
 * - 控件**只**由插件 descriptor 的 `parameters` + `parameterImpacts` 投影而来，
 *   不为任何插件手写孤立结果页；descriptor 没声明的参数不会出现控件。
 * - 手动控件与 AI 意图产出**同一种** `parameterPatch`，随后都走既有
 *   `classifyParameterPatch → planResultEdit → ScientificChangeSet`，
 *   因此 validation / preview / compare / adopt / revert 只有一条路径。
 * - 影响分级只能由受信 descriptor 提升，不能被调用方降级；未知参数保守
 *   落到 `scientific_recompute`（由 result-edit-intent 负责），这里不猜。
 * - 越界或类型不符的值 fail-closed 拒绝，不静默 clamp 成"看起来成功"。
 *   R 脚本里的 clamp 是运行时最后防线，不是本层的借口。
 */

const {
  RESULT_EDIT_CLASSES,
  classifyParameterPatch,
} = require('./result-edit-intent');

const RESULT_EDIT_CONTROLS_VERSION = 1;

/** descriptor 声明的 impact → 控件分组。分组只影响呈现顺序与解释文案。 */
const CONTROL_GROUPS = Object.freeze({
  view: 'presentation',
  presentation: 'presentation',
  data: 'data',
  scientific: 'scientific',
  workflow: 'workflow',
});

const GROUP_ORDER = Object.freeze(['presentation', 'data', 'scientific', 'workflow']);

const GROUP_LABELS = Object.freeze({
  presentation: '外观与导出',
  data: '数据呈现',
  scientific: '科学参数',
  workflow: '方法与流程',
});

/** 控件类型只从 descriptor 的参数类型派生，不猜测语义。 */
const SUPPORTED_CONTROL_TYPES = Object.freeze(['number', 'text', 'select', 'color', 'boolean']);

/** 名称模式 → color 控件。仅影响输入部件，不改变 impact 或校验规则。 */
const COLOR_NAME_PATTERN = /(^|_)(color|colour|palette)(_|$)/i;
const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function diagnostic(code, message, detail = null) {
  return { code, message, ...(detail == null ? {} : { detail }) };
}

/**
 * 判定控件部件类型。
 *
 * `color` 是 `text` 的一个更严格子集：仍然是字符串参数，但必须是 #rrggbb，
 * 且 UI 可以给取色器。它不改变 impact，也不放宽校验。
 */
function resolveControlType(name, parameter) {
  const declared = trimmed(parameter && parameter.type);
  if (declared === 'select') return 'select';
  if (declared === 'number') return 'number';
  if (declared === 'boolean') return 'boolean';
  if (declared === 'text') {
    const defaultValue = parameter && parameter.default;
    if (COLOR_NAME_PATTERN.test(name) && (typeof defaultValue !== 'string' || HEX_COLOR_PATTERN.test(defaultValue))) {
      return 'color';
    }
    return 'text';
  }
  return null;
}

/**
 * 把插件 descriptor 投影成有界控件列表。
 *
 * 只有同时声明了 `parameters[name]` 与 `parameterImpacts[name]` 的参数才成为
 * 控件——缺 impact 的参数无法判断改动后果，让它可编辑等于默认它安全。
 *
 * @param {object} descriptor 已通过 Plugin SDK lint 的 resultStudio descriptor
 * @returns {{ controlsVersion: number, controls: Array, groups: Array, diagnostics: Array }}
 */
function buildEditControlSchema(descriptor) {
  const diagnostics = [];
  if (!descriptor || typeof descriptor !== 'object' || Array.isArray(descriptor)) {
    return {
      controlsVersion: RESULT_EDIT_CONTROLS_VERSION,
      controls: [],
      groups: [],
      diagnostics: [diagnostic('control_descriptor_missing', '插件没有可信的 Result Studio descriptor，无法生成参数控件。')],
    };
  }
  const parameters = descriptor.parameters && typeof descriptor.parameters === 'object' ? descriptor.parameters : {};
  const impacts = descriptor.parameterImpacts && typeof descriptor.parameterImpacts === 'object'
    ? descriptor.parameterImpacts
    : {};

  const controls = [];
  for (const name of Object.keys(parameters).sort()) {
    const parameter = parameters[name];
    const impact = trimmed(impacts[name]);
    if (!impact) {
      // 缺 impact 不是"默认安全"，而是不可编辑。
      diagnostics.push(diagnostic('control_impact_undeclared', `参数 ${name} 没有声明影响级别，因此不提供控件。`, { parameter: name }));
      continue;
    }
    const group = CONTROL_GROUPS[impact];
    if (!group) {
      diagnostics.push(diagnostic('control_impact_unknown', `参数 ${name} 的影响级别无法识别。`, { parameter: name, impact }));
      continue;
    }
    const controlType = resolveControlType(name, parameter);
    if (!controlType) {
      diagnostics.push(diagnostic('control_type_unsupported', `参数 ${name} 的类型不支持可视化编辑。`, { parameter: name }));
      continue;
    }
    const control = {
      name,
      controlType,
      impact,
      group,
      default: parameter && parameter.default !== undefined ? parameter.default : null,
      required: parameter && parameter.required === true,
    };
    if (controlType === 'number') {
      control.minimum = Number.isFinite(parameter.minimum) ? parameter.minimum : null;
      control.maximum = Number.isFinite(parameter.maximum) ? parameter.maximum : null;
    }
    if (controlType === 'select') {
      const options = Array.isArray(parameter.options)
        ? parameter.options.filter((option) => typeof option === 'string' && option.trim())
        : [];
      if (options.length === 0) {
        diagnostics.push(diagnostic('control_options_missing', `参数 ${name} 声明为选择项但没有可选值。`, { parameter: name }));
        continue;
      }
      control.options = options;
    }
    // 只有 presentation 分组才允许在 UI 上标注"不改变科学结论"。
    control.scientificallyNeutral = group === 'presentation';
    controls.push(control);
  }

  const groups = GROUP_ORDER
    .filter((group) => controls.some((control) => control.group === group))
    .map((group) => ({
      group,
      label: GROUP_LABELS[group],
      parameterNames: controls.filter((control) => control.group === group).map((control) => control.name),
    }));

  return { controlsVersion: RESULT_EDIT_CONTROLS_VERSION, controls, groups, diagnostics };
}

/**
 * 校验单个参数值是否符合 descriptor 契约。
 *
 * fail-closed：越界、类型不符、非法枚举值一律拒绝并说明原因，
 * 不做静默修正——静默修正会让用户以为改动生效了。
 */
function validateControlValue(control, value) {
  if (!control) return { ok: false, diagnostics: [diagnostic('control_unknown_parameter', '该参数不在插件声明的可编辑范围内。')] };
  const diagnostics = [];
  if (value === null || value === undefined) {
    return { ok: false, diagnostics: [diagnostic('control_value_required', `参数 ${control.name} 需要一个值。`, { parameter: control.name })] };
  }
  switch (control.controlType) {
    case 'number': {
      const numeric = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(numeric)) {
        diagnostics.push(diagnostic('control_value_not_number', `参数 ${control.name} 必须是数字。`, { parameter: control.name }));
        break;
      }
      if (control.minimum !== null && numeric < control.minimum) {
        diagnostics.push(diagnostic('control_value_below_minimum', `参数 ${control.name} 不能小于 ${control.minimum}。`, { parameter: control.name, minimum: control.minimum }));
      }
      if (control.maximum !== null && numeric > control.maximum) {
        diagnostics.push(diagnostic('control_value_above_maximum', `参数 ${control.name} 不能大于 ${control.maximum}。`, { parameter: control.name, maximum: control.maximum }));
      }
      if (diagnostics.length === 0) return { ok: true, diagnostics: [], value: numeric };
      break;
    }
    case 'select': {
      const normalized = trimmed(value);
      if (!control.options.includes(normalized)) {
        diagnostics.push(diagnostic('control_value_not_allowed', `参数 ${control.name} 只能是声明的可选值之一。`, { parameter: control.name, options: control.options }));
        break;
      }
      return { ok: true, diagnostics: [], value: normalized };
    }
    case 'color': {
      const normalized = trimmed(value);
      if (!HEX_COLOR_PATTERN.test(normalized)) {
        diagnostics.push(diagnostic('control_value_not_color', `参数 ${control.name} 必须是 #RRGGBB 形式的颜色。`, { parameter: control.name }));
        break;
      }
      return { ok: true, diagnostics: [], value: normalized.toLowerCase() };
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        diagnostics.push(diagnostic('control_value_not_boolean', `参数 ${control.name} 必须是布尔值。`, { parameter: control.name }));
        break;
      }
      return { ok: true, diagnostics: [], value };
    }
    case 'text': {
      if (typeof value !== 'string') {
        diagnostics.push(diagnostic('control_value_not_text', `参数 ${control.name} 必须是文本。`, { parameter: control.name }));
        break;
      }
      const normalized = value.trim();
      if (normalized.length > 200) {
        diagnostics.push(diagnostic('control_value_too_long', `参数 ${control.name} 超过 200 字符。`, { parameter: control.name }));
        break;
      }
      return { ok: true, diagnostics: [], value: normalized };
    }
    default:
      diagnostics.push(diagnostic('control_type_unsupported', `参数 ${control.name} 的类型不支持编辑。`, { parameter: control.name }));
  }
  return { ok: false, diagnostics };
}

/**
 * 把手动控件输入或 AI 提议归一化为同一个受信 patch。
 *
 * 两个来源共用本函数，因此不存在"AI 走一条校验、手动走另一条"的分叉。
 * `origin` 只用于审计与解释文案，不影响任何校验强度。
 *
 * @param {object} params
 * @param {object} params.descriptor 受信插件 descriptor
 * @param {object} params.proposedValues 参数名 → 值
 * @param {'manual'|'agent'} [params.origin]
 * @param {object} [params.currentValues] 当前生效参数，用于剔除无变化项
 * @returns {{ ok: boolean, patch: object, changed: Array, unchanged: Array, rejected: Array, diagnostics: Array, classification: object|null, origin: string }}
 */
function normalizeEditSubmission({
  descriptor,
  proposedValues = {},
  origin = 'manual',
  currentValues = {},
} = {}) {
  const normalizedOrigin = origin === 'agent' ? 'agent' : 'manual';
  const schema = buildEditControlSchema(descriptor);
  const byName = new Map(schema.controls.map((control) => [control.name, control]));
  const diagnostics = [];
  const patch = {};
  const changed = [];
  const unchanged = [];
  const rejected = [];

  const values = proposedValues && typeof proposedValues === 'object' && !Array.isArray(proposedValues)
    ? proposedValues
    : {};

  for (const name of Object.keys(values).sort()) {
    const control = byName.get(name);
    if (!control) {
      // 未声明参数不进 patch：既不静默丢弃也不假装接受，明确记为 rejected。
      rejected.push(name);
      diagnostics.push(diagnostic(
        'control_unknown_parameter',
        `参数 ${name} 不在插件声明的可编辑范围内，已拒绝。`,
        { parameter: name }
      ));
      continue;
    }
    const validated = validateControlValue(control, values[name]);
    if (!validated.ok) {
      rejected.push(name);
      diagnostics.push(...validated.diagnostics);
      continue;
    }
    const currentValue = Object.prototype.hasOwnProperty.call(currentValues, name) ? currentValues[name] : undefined;
    if (currentValue !== undefined && currentValue === validated.value) {
      unchanged.push(name);
      continue;
    }
    patch[name] = validated.value;
    changed.push(name);
  }

  // 分级永远由受信 descriptor 决定；调用方不能声明自己的 editClass。
  const classification = Object.keys(patch).length > 0
    ? classifyParameterPatch({
      proposedParameterPatch: patch,
      parameterImpactRules: descriptor && descriptor.parameterImpacts,
    })
    : null;

  return {
    ok: rejected.length === 0 && Object.keys(patch).length > 0,
    patch,
    changed,
    unchanged,
    rejected,
    diagnostics,
    classification,
    origin: normalizedOrigin,
  };
}

/**
 * 生成执行前的人类可读影响说明。
 *
 * 只陈述受信分级得出的后果，不承诺"很快"或"没有风险"。
 */
function explainEditImpact(classification, { affectedNodeIds = [] } = {}) {
  if (!classification) {
    return {
      editClass: null,
      headline: '没有需要执行的参数变化。',
      requiresJob: false,
      requiresScientificConfirmation: false,
      rerunsScience: false,
      affectedNodeCount: 0,
      parameterImpacts: [],
    };
  }
  const editClass = classification.editClass;
  const rerunsScience = editClass === 'scientific_recompute' || editClass === 'workflow_replan';
  const headline = editClass === 'presentation_rerender'
    ? '只改变结果的呈现方式，不重新计算科学结论。'
    : editClass === 'data_transform'
      ? '改变结果的数据呈现范围，需要重新生成该产物。'
      : editClass === 'scientific_recompute'
        ? '改变科学参数，需要重新计算并确认结论变化。'
        : editClass === 'workflow_replan'
          ? '改变方法或流程，需要重新规划下游步骤并确认。'
          : '仅查看，不产生新版本。';
  return {
    editClass,
    headline,
    requiresJob: classification.requiresJob === true,
    requiresScientificConfirmation: classification.requiresScientificConfirmation === true,
    rerunsScience,
    usedConservativeFallback: classification.usedConservativeFallback === true,
    affectedNodeCount: Array.isArray(affectedNodeIds) ? affectedNodeIds.length : 0,
    parameterImpacts: Array.isArray(classification.parameterImpacts) ? classification.parameterImpacts : [],
  };
}

module.exports = {
  RESULT_EDIT_CONTROLS_VERSION,
  RESULT_EDIT_CLASSES,
  CONTROL_GROUPS,
  GROUP_ORDER,
  GROUP_LABELS,
  SUPPORTED_CONTROL_TYPES,
  buildEditControlSchema,
  validateControlValue,
  normalizeEditSubmission,
  explainEditImpact,
};
