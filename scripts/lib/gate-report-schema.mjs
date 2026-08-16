#!/usr/bin/env node
/**
 * scripts/lib/gate-report-schema.mjs — minimal JSON-Schema validator for `--report` outputs
 *
 * DOC-GOVERNANCE-GATES / GATES-2 (2026-08-16):
 *   shared by `scripts/docs-governance.mjs`, `scripts/check-ui-productization-audit.mjs`
 *   and `scripts/test-affected.mjs` to validate the JSON report payload against the
 *   schema in `docs/schemas/<gate>-report.schema.json` before it is written.
 *
 * The scripts themselves are pure-Node, eslint-free, no runtime deps. Ajv 6.x is
 * already a transitive devDep (and is imported here only when available); if the
 * package ever disappears, `validateReport` falls back to a built-in draft-07
 * subset validator that supports the minimal constructs used by the three
 * gate-report schemas (type, required, properties, additionalProperties: false,
 * const, enum, pattern, minimum, items, uniqueItems, format: date-time).
 *
 * Stable identifier: `resolveSchemaPath(scriptFile)` resolves the schema filesystem
 * path relative to the script. `validateReport(scriptFile, payload)` returns
 * `{valid: true} | {valid: false, errors: [...]}`. Callers MUST treat
 * validation failure as a classification conflict (exit 2) — the report stage
 * must not silently emit a malformed document.
 */
import fs from 'node:fs';
import path from 'node:path';

export const GATE_REPORT_SCHEMA_VERSION = 1;

const SCRIPT_NAME_TO_SCHEMA = Object.freeze({
  'scripts/docs-governance.mjs': 'docs/schemas/docs-governance-report.schema.json',
  'scripts/check-ui-productization-audit.mjs': 'docs/schemas/ui-audit-report.schema.json',
  'scripts/test-affected.mjs': 'docs/schemas/test-affected-report.schema.json',
});

export function resolveSchemaPath(scriptFile) {
  const normalised = path.posix.normalize(scriptFile.split(path.sep).join('/'));
  const rel = SCRIPT_NAME_TO_SCHEMA[normalised];
  if (!rel) {
    throw new Error(`[gate-report-schema] no schema binding for ${scriptFile}; expected one of: ${Object.keys(SCRIPT_NAME_TO_SCHEMA).join(', ')}`);
  }
  return path.resolve(path.dirname(scriptFile), '..', rel);
}

export function loadSchema(scriptFile) {
  const schemaPath = resolveSchemaPath(scriptFile);
  const source = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(source);
}

function loadAjv() {
  try {
    const ajvModule = require('ajv');
    const Ajv = typeof ajvModule === 'function' ? ajvModule : (ajvModule.default ?? ajvModule.Ajv ?? null);
    if (typeof Ajv !== 'function') return null;
    return new Ajv({ allErrors: true, strict: false });
  } catch {
    return null;
  }
}

const AJV = loadAjv();
const AJV_CACHE = new Map();

function getAjvValidator(schema) {
  if (!AJV) return null;
  const cached = AJV_CACHE.get(schema.$id);
  if (cached) return cached;
  const validate = AJV.compile(schema);
  AJV_CACHE.set(schema.$id, validate);
  return validate;
}

export function validateReport(scriptFile, payload) {
  const schema = loadSchema(scriptFile);
  const validator = getAjvValidator(schema);
  if (validator) {
    const ok = validator(payload);
    if (ok) return { valid: true };
    return {
      valid: false,
      errors: (validator.errors ?? []).map((err) => ({
        path: err.instancePath || '<root>',
        keyword: err.keyword,
        message: err.message,
        params: err.params ?? {},
      })),
    };
  }
  return { valid: fallBackValidate(schema, payload, '').length === 0, errors: fallBackValidate(schema, payload, '') };
}

/**
 * Minimal draft-07 subset validator. Supports the constructs used by the
 * three gate-report schemas:
 *   - type, const, enum
 *   - required, properties, additionalProperties (boolean only)
 *   - pattern, minimum, format: date-time
 *   - items (single schema), uniqueItems
 *   - $schema, $id, title, description (ignored)
 */
function fallBackValidate(schema, value, pointer, errors = []) {
  if (schema.const !== undefined) {
    if (!deepEqual(value, schema.const)) {
      errors.push({ path: pointer || '<root>', keyword: 'const', message: `must equal ${JSON.stringify(schema.const)}` });
      return errors;
    }
  }
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((candidate) => deepEqual(candidate, value))) {
      errors.push({ path: pointer || '<root>', keyword: 'enum', message: `must be one of ${JSON.stringify(schema.enum)}` });
      return errors;
    }
  }
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({ path: pointer || '<root>', keyword: 'type', message: `must be of type ${types.join(',')}` });
      return errors;
    }
  }
  if (typeof value === 'string' && schema.format === 'date-time') {
    if (Number.isNaN(Date.parse(value))) {
      errors.push({ path: pointer || '<root>', keyword: 'format', message: 'must be ISO-8601 date-time' });
    }
  }
  if (typeof value === 'string' && schema.pattern) {
    const re = new RegExp(schema.pattern);
    if (!re.test(value)) {
      errors.push({ path: pointer || '<root>', keyword: 'pattern', message: `must match ${schema.pattern}` });
    }
  }
  if (typeof value === 'number' && typeof schema.minimum === 'number') {
    if (value < schema.minimum) {
      errors.push({ path: pointer || '<root>', keyword: 'minimum', message: `must be >= ${schema.minimum}` });
    }
  }
  if (Array.isArray(schema.required) && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required) {
      if (!(key in value)) {
        errors.push({ path: pointer || '<root>', keyword: 'required', message: `missing required property "${key}"` });
      }
    }
  }
  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, subSchema] of Object.entries(schema.properties)) {
      if (key in value) {
        fallBackValidate(subSchema, value[key], `${pointer}/${escapePointer(key)}`, errors);
      }
    }
  }
  if (schema.additionalProperties === false && value && typeof value === 'object' && !Array.isArray(value)) {
    const allowed = new Set(Object.keys(schema.properties ?? {}));
    for (const key of Object.keys(value)) {
      if (!allowed.has(key)) {
        errors.push({ path: pointer || '<root>', keyword: 'additionalProperties', message: `unexpected property "${key}"` });
      }
    }
  }
  if (Array.isArray(value)) {
    if (schema.items) {
      value.forEach((item, index) => {
        fallBackValidate(schema.items, item, `${pointer}/${index}`, errors);
      });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set();
      for (const item of value) {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          errors.push({ path: pointer || '<root>', keyword: 'uniqueItems', message: 'array items must be unique' });
          break;
        }
        seen.add(key);
      }
    }
  }
  return errors;
}

function matchesType(value, type) {
  if (type === 'null') return value === null;
  if (type === 'string') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return false;
}

function escapePointer(segment) {
  return String(segment).replaceAll('~', '~0').replaceAll('/', '~1');
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      return a.every((item, index) => deepEqual(item, b[index]));
    }
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => keysB.includes(key) && deepEqual(a[key], b[key]));
  }
  return false;
}
