/**
 * r-server/mcp/_validate-tool-args.js — 极简 JSON Schema 校验工具
 *
 * BLOCK-10-AUDIT-CLOSEOUT PHASE 3 / PL-001 实现：
 * - MCP callTool 入口在 _runPluginScript 之前调用 validateToolArgs(schema, args)
 * - 拒绝不符合 schema 的输入（含 required / type / minimum / maximum / enum）
 * - **不引入 ajv / zod 等第三方依赖**（按 BLOCK-10 阶段纪律）
 * - 错误统一格式：McpValidationError { ok, errors: [{ path, message, expected, actual }] }
 *
 * 演进路径：本极简 validator 覆盖 90% 工具插件的入参校验；后续工作包可替换为 Ajv 实现。
 */

'use strict';

class McpValidationError extends Error {
  constructor(toolName, errors) {
    const summary = errors
      .map((e) => `${e.path || '<root>'}: ${e.message}`)
      .join('; ');
    super(`mcp_input_validation_failed for tool "${toolName}": ${summary}`);
    this.name = 'McpValidationError';
    this.toolName = toolName;
    this.errors = errors;
  }
}

const TYPE_VALIDATORS = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && Number.isFinite(v),
  integer: (v) => typeof v === 'number' && Number.isInteger(v),
  boolean: (v) => typeof v === 'boolean',
  array: (v) => Array.isArray(v),
  object: (v) => v !== null && typeof v === 'object' && !Array.isArray(v),
  // 'file' / 'directory' 等自定义类型在 PL-001 阶段不严格校验，
  // 历史上 plugin 内部用 type: 'file' 描述（schema type 退化为 string）。
  null: (v) => v === null,
};

/**
 * 校验单个值是否符合子 schema（递归）
 * @param {*} value - 实际值
 * @param {object} schema - 子 schema
 * @param {string} path - 当前路径（用于错误信息）
 * @returns {Array<{path:string,message:string,expected?:any,actual?:any}>}
 */
function _validateValue(value, schema, path) {
  const errors = [];

  if (!schema || typeof schema !== 'object') {
    return errors; // 无 schema 约束 = 通透
  }

  // 1. type 校验
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const matched = types.some((t) => {
      const validator = TYPE_VALIDATORS[t];
      return validator ? validator(value) : false;
    });
    if (!matched) {
      errors.push({
        path,
        message: `expected type ${types.join(' | ')}, got ${_valueType(value)}`,
        expected: types,
        actual: _valueType(value),
      });
      // type 错则后续校验意义不大
      return errors;
    }
  }

  // 2. enum 校验
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.includes(value)) {
      errors.push({
        path,
        message: `value not in enum [${schema.enum.map((v) => JSON.stringify(v)).join(', ')}]`,
        expected: schema.enum,
        actual: value,
      });
    }
  }

  // 3. number / integer 边界
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({
        path,
        message: `value ${value} < minimum ${schema.minimum}`,
        expected: `>= ${schema.minimum}`,
        actual: value,
      });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({
        path,
        message: `value ${value} > maximum ${schema.maximum}`,
        expected: `<= ${schema.maximum}`,
        actual: value,
      });
    }
  }

  // 4. string 长度
  if (typeof value === 'string') {
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push({
        path,
        message: `string length ${value.length} < minLength ${schema.minLength}`,
        expected: `length >= ${schema.minLength}`,
        actual: value.length,
      });
    }
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength) {
      errors.push({
        path,
        message: `string length ${value.length} > maxLength ${schema.maxLength}`,
        expected: `length <= ${schema.maxLength}`,
        actual: value.length,
      });
    }
  }

  // 5. array items
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    value.forEach((item, idx) => {
      errors.push(..._validateValue(item, schema.items, `${path}[${idx}]`));
    });
  }

  // 6. object properties 递归
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    schema.properties &&
    typeof schema.properties === 'object'
  ) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    const additional = schema.additionalProperties;

    // required 字段检查
    for (const reqKey of required) {
      if (!(reqKey in value)) {
        errors.push({
          path: `${path}.${reqKey}`,
          message: `required field "${reqKey}" is missing`,
          expected: 'present',
          actual: undefined,
        });
      }
    }

    // properties 校验
    for (const [key, propSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        errors.push(..._validateValue(value[key], propSchema, `${path}.${key}`));
      }
    }

    // additionalProperties
    if (additional === false) {
      const allowedKeys = new Set(Object.keys(schema.properties));
      for (const key of Object.keys(value)) {
        if (!allowedKeys.has(key)) {
          errors.push({
            path: `${path}.${key}`,
            message: `unknown property "${key}" (additionalProperties: false)`,
            expected: `one of [${[...allowedKeys].join(', ')}]`,
            actual: key,
          });
        }
      }
    }
  }

  return errors;
}

function _valueType(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer';
  return typeof v;
}

/**
 * 主入口：校验 args 相对 schema 是否合规
 *
 * @param {string} toolName - 工具名（仅用于错误信息）
 * @param {object|null|undefined} schema - inputSchema（null/undefined 跳过校验）
 * @param {*} args - 实际入参
 * @returns {{ok:true} | {ok:false, errors:Array}}
 */
function validateToolArgs(toolName, schema, args) {
  // 容错：schema 缺失 / null 跳过校验（向后兼容）
  if (!schema || typeof schema !== 'object') {
    return { ok: true };
  }

  // args 缺省视为空对象
  const actualArgs = args == null ? {} : args;

  // args 必须本身是 object（除非法定 root schema 允许别的 type）
  if (typeof actualArgs !== 'object' || Array.isArray(actualArgs)) {
    return {
      ok: false,
      errors: [
        {
          path: '<root>',
          message: `expected arguments to be an object, got ${_valueType(actualArgs)}`,
          expected: 'object',
          actual: _valueType(actualArgs),
        },
      ],
    };
  }

  const errors = _validateValue(actualArgs, schema, '<root>');

  if (errors.length === 0) {
    return { ok: true };
  }
  return { ok: false, errors };
}

module.exports = {
  validateToolArgs,
  McpValidationError,
  // 暴露内部供测试
  _validateValue,
  _valueType,
};
