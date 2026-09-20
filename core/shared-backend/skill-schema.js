/**
 * BioF3 Desktop Skill Schema Validator
 * 
 * Implements JSON Schema validation for Skill Manifests following the contract
 * defined in docs/skills-schema.md. Uses native JSON Schema without external
 * dependencies.
 * 
 * @module skill-schema
 * @version 1.0.0
 */

/**
 * @typedef {Object} ValidationError
 * @property {string} path - JSON path to the invalid field (e.g., "parameters.optional.method")
 * @property {string} message - Human-readable error message
 * @property {string} code - Error code for programmatic handling
 * @property {*} [value] - The invalid value
 */

/**
 * @typedef {Object} ValidationResult
 * @property {boolean} valid - Whether validation passed
 * @property {ValidationError[]} errors - List of validation errors
 */

/**
 * @typedef {Object} ParameterSchema
 * @property {string} type - Parameter type: "select" | "number" | "string" | "boolean" | "file"
 * @property {string[]} [options] - Options for select type
 * @property {*} [default] - Default value
 * @property {number} [min] - Minimum for number type
 * @property {number} [max] - Maximum for number type
 * @property {number} [step] - Step for number type
 * @property {string} [accept] - Accepted file extensions for file type
 * @property {string} [pattern] - Regex pattern for string type
 * @property {string} description - Parameter description
 */

/**
 * Supported parameter types
 * @enum {string}
 */
const PARAM_TYPES = {
  SELECT: 'select',
  NUMBER: 'number',
  STRING: 'string',
  BOOLEAN: 'boolean',
  FILE: 'file'
};

/**
 * Supported source types
 * @enum {string}
 */
const SOURCE_TYPES = ['built-in', 'installed', 'marketplace'];

/**
 * Supported output types
 * @enum {string}
 */
const OUTPUT_TYPES = ['plot', 'table', 'text', 'json', 'html', 'log', 'file'];

/**
 * Error codes for validation errors
 * @enum {string}
 */
const ERROR_CODES = {
  MISSING_REQUIRED: 'MISSING_REQUIRED_FIELD',
  INVALID_TYPE: 'INVALID_TYPE',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_VALUE: 'INVALID_VALUE',
  INVALID_CONSTRAINT: 'INVALID_CONSTRAINT',
  INVALID_VERSION: 'INVALID_VERSION',
  PATTERN_MISMATCH: 'PATTERN_MISMATCH',
  UNKNOWN_FIELD: 'UNKNOWN_FIELD',
  EMPTY_ARRAY: 'EMPTY_ARRAY',
  OUT_OF_RANGE: 'OUT_OF_RANGE'
};

/**
 * Semantic version regex pattern
 * @type {RegExp}
 */
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/**
 * kebab-case regex pattern
 * @type {RegExp}
 */
const KEBAB_CASE_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Category pattern (domain/subdomain format)
 * @type {RegExp}
 */
const CATEGORY_PATTERN = /^[a-z][a-z0-9]*\/[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Internationalized error messages
 * @type {Map<string, Record<string, string>>}
 */
const I18N_MESSAGES = new Map([
  ['en', {
    [ERROR_CODES.MISSING_REQUIRED]: 'Missing required field: {field}',
    [ERROR_CODES.INVALID_TYPE]: 'Invalid type for {field}: expected {expected}, got {actual}',
    [ERROR_CODES.INVALID_FORMAT]: 'Invalid format for {field}: {value}',
    [ERROR_CODES.INVALID_VALUE]: 'Invalid value for {field}: {value}',
    [ERROR_CODES.INVALID_CONSTRAINT]: 'Constraint violation for {field}: {constraint}',
    [ERROR_CODES.INVALID_VERSION]: 'Invalid semantic version: {value}',
    [ERROR_CODES.PATTERN_MISMATCH]: '{field} does not match required pattern: {pattern}',
    [ERROR_CODES.UNKNOWN_FIELD]: 'Unknown field: {field}',
    [ERROR_CODES.EMPTY_ARRAY]: '{field} must not be empty',
    [ERROR_CODES.OUT_OF_RANGE]: '{field} value {value} is out of range [{min}, {max}]'
  }],
  ['zh', {
    [ERROR_CODES.MISSING_REQUIRED]: '缺少必填字段: {field}',
    [ERROR_CODES.INVALID_TYPE]: '{field} 类型错误: 期望 {expected}，实际 {actual}',
    [ERROR_CODES.INVALID_FORMAT]: '{field} 格式错误: {value}',
    [ERROR_CODES.INVALID_VALUE]: '{field} 值无效: {value}',
    [ERROR_CODES.INVALID_CONSTRAINT]: '{field} 约束违规: {constraint}',
    [ERROR_CODES.INVALID_VERSION]: '无效的语义化版本: {value}',
    [ERROR_CODES.PATTERN_MISMATCH]: '{field} 不符合要求的格式: {pattern}',
    [ERROR_CODES.UNKNOWN_FIELD]: '未知字段: {field}',
    [ERROR_CODES.EMPTY_ARRAY]: '{field} 不能为空数组',
    [ERROR_CODES.OUT_OF_RANGE]: '{field} 值 {value} 超出范围 [{min}, {max}]'
  }]
]);

/**
 * Current locale for error messages
 * @type {string}
 */
let currentLocale = 'en';

/**
 * Skill Manifest JSON Schema definition
 * @type {Object}
 */
const SKILL_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://biof3.desktop/schemas/skill-manifest-v1.json',
  title: 'BioF3 Skill Manifest',
  description: 'Schema for BioF3 Desktop Skill Manifest definitions',
  type: 'object',
  required: [
    'skillManifestVersion',
    'id',
    'name',
    'version',
    'description',
    'category',
    'source',
    'plugins'
  ],
  properties: {
    skillManifestVersion: {
      type: 'integer',
      const: 1,
      description: 'Manifest version, must be 1'
    },
    id: {
      type: 'string',
      pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
      description: 'Unique skill identifier in kebab-case'
    },
    name: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
      description: 'Human-readable skill name'
    },
    version: {
      type: 'string',
      pattern: SEMVER_PATTERN.source.slice(1, -1),
      description: 'Semantic version (major.minor.patch)'
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 2000,
      description: 'Detailed description, supports Markdown'
    },
    category: {
      type: 'string',
      pattern: CATEGORY_PATTERN.source.slice(1, -1),
      description: 'Category in domain/subdomain format'
    },
    tags: {
      type: 'array',
      items: {
        type: 'string',
        pattern: '^[a-z][a-z0-9-]*$'
      },
      uniqueItems: true,
      description: 'Tags for search and filtering'
    },
    source: {
      type: 'string',
      enum: SOURCE_TYPES,
      description: 'Skill source: built-in, installed, or marketplace'
    },
    capabilities: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: 'Required environment capabilities'
    },
    plugins: {
      type: 'object',
      required: ['required'],
      properties: {
        required: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'Required plugin IDs'
        },
        optional: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional plugin IDs'
        }
      },
      additionalProperties: false
    },
    workflows: {
      type: 'object',
      properties: {
        default: {
          type: 'string',
          description: 'Default workflow ID'
        },
        variants: {
          type: 'array',
          items: { type: 'string' },
          description: 'Alternative workflow variants'
        }
      },
      additionalProperties: false
    },
    prompts: {
      type: 'object',
      properties: {
        system: {
          type: 'string',
          description: 'System prompt with template variables'
        },
        user_templates: {
          type: 'array',
          items: { type: 'string' },
          description: 'User prompt templates with {var} placeholders'
        }
      },
      additionalProperties: false
    },
    parameters: {
      type: 'object',
      properties: {
        required: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required parameter names'
        },
        optional: {
          type: 'object',
          additionalProperties: {
            type: 'object',
            required: ['type', 'description'],
            properties: {
              type: {
                type: 'string',
                enum: Object.values(PARAM_TYPES)
              },
              options: {
                type: 'array',
                items: {},
                description: 'Options for select type'
              },
              default: {},
              min: {
                type: 'number',
                description: 'Minimum value for number type'
              },
              max: {
                type: 'number',
                description: 'Maximum value for number type'
              },
              step: {
                type: 'number',
                description: 'Step value for number type'
              },
              accept: {
                type: 'string',
                description: 'Accepted file extensions for file type'
              },
              pattern: {
                type: 'string',
                description: 'Regex pattern for string type'
              },
              description: {
                type: 'string'
              }
            }
          },
          description: 'Optional parameter definitions'
        }
      },
      additionalProperties: false
    },
    recovery_strategies: {
      type: 'array',
      items: {
        type: 'object',
        required: ['when', 'do', 'fallback', 'recoverable'],
        properties: {
          when: {
            type: 'string',
            description: 'Failure condition identifier'
          },
          description: {
            type: 'string',
            description: 'Human-readable failure description'
          },
          do: {
            type: 'string',
            description: 'Recovery action to attempt'
          },
          fallback: {
            type: 'string',
            description: 'Fallback action if recovery fails'
          },
          recoverable: {
            type: 'boolean',
            description: 'Whether this failure is recoverable'
          }
        },
        additionalProperties: false
      },
      description: 'Recovery strategies for common failure modes'
    },
    outputs: {
      type: 'object',
      properties: {
        primary: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'label'],
            properties: {
              id: { type: 'string' },
              type: {
                type: 'string',
                enum: OUTPUT_TYPES
              },
              label: { type: 'string' },
              description: { type: 'string' },
              format: { type: 'string' },
              columns: {
                type: 'array',
                items: { type: 'string' }
              },
              dpi: { type: 'integer' },
              requires_plugin: { type: 'string' }
            },
            additionalProperties: false
          },
          description: 'Primary output artifacts'
        },
        secondary: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'type', 'label'],
            properties: {
              id: { type: 'string' },
              type: {
                type: 'string',
                enum: OUTPUT_TYPES
              },
              label: { type: 'string' },
              description: { type: 'string' },
              format: { type: 'string' },
              columns: {
                type: 'array',
                items: { type: 'string' }
              },
              requires_plugin: { type: 'string' }
            },
            additionalProperties: false
          },
          description: 'Secondary/optional output artifacts'
        }
      },
      additionalProperties: false
    },
    metadata: {
      type: 'object',
      properties: {
        author: { type: 'string' },
        license: { type: 'string' },
        source: { type: 'string' },
        created: { type: 'string', format: 'date' },
        updated: { type: 'string', format: 'date' },
        compatibility: {
          type: 'object',
          properties: {
            min_app_version: { type: 'string' },
            platform: {
              type: 'array',
              items: {
                type: 'string',
                enum: ['macos-arm64', 'macos-x64', 'windows-x64']
              }
            }
          },
          additionalProperties: false
        }
      },
      additionalProperties: false
    }
  },
  additionalProperties: false
};

/**
 * SkillSchema class for validating and processing Skill Manifests
 * 
 * @example
 * const validator = new SkillSchema();
 * const result = validator.validate(manifest);
 * if (!result.valid) {
 *   console.error('Validation failed:', result.errors);
 * }
 */
class SkillSchema {
  /**
   * Create a new SkillSchema instance
   * @param {Object} options - Configuration options
   * @param {string} [options.locale='en'] - Locale for error messages
   */
  constructor(options = {}) {
    this.locale = options.locale || currentLocale;
    this.errors = [];
  }

  /**
   * Get the complete JSON Schema definition
   * @returns {Object} The JSON Schema object
   */
  getSchema() {
    return JSON.parse(JSON.stringify(SKILL_SCHEMA));
  }

  /**
   * Set the locale for error messages
   * @param {string} locale - Locale code ('en' or 'zh')
   */
  setLocale(locale) {
    if (I18N_MESSAGES.has(locale)) {
      this.locale = locale;
    }
  }

  /**
   * Format an error message with variable substitution
   * @param {string} code - Error code
   * @param {Object} vars - Variables to substitute
   * @returns {string} Formatted message
   * @private
   */
  _formatMessage(code, vars = {}) {
    const messages = I18N_MESSAGES.get(this.locale) || I18N_MESSAGES.get('en');
    let message = messages[code] || messages[Object.values(ERROR_CODES)[0]];
    
    for (const [key, value] of Object.entries(vars)) {
      message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
    }
    
    return message;
  }

  /**
   * Add a validation error
   * @param {string} path - JSON path to the error
   * @param {string} code - Error code
   * @param {Object} vars - Variables for message formatting
   * @param {*} [value] - Invalid value
   * @private
   */
  _addError(path, code, vars = {}, value = undefined) {
    this.errors.push({
      path,
      code,
      message: this._formatMessage(code, vars),
      ...(value !== undefined && { value })
    });
  }

  /**
   * Clear accumulated errors
   * @private
   */
  _clearErrors() {
    this.errors = [];
  }

  /**
   * Validate a Skill Manifest
   * @param {Object} manifest - The skill manifest to validate
   * @returns {ValidationResult} Validation result with errors array
   */
  validate(manifest) {
    this._clearErrors();

    if (!manifest || typeof manifest !== 'object') {
      this._addError('', ERROR_CODES.INVALID_TYPE, {
        expected: 'object',
        actual: typeof manifest
      });
      return { valid: false, errors: this.errors };
    }

    this._validateVersion(manifest);
    this._validateId(manifest.id);
    this._validateName(manifest.name);
    this._validateVersionField(manifest.version);
    this._validateDescription(manifest.description);
    this._validateCategory(manifest.category);
    this._validateSource(manifest.source);
    this._validateTags(manifest.tags);
    this._validatePlugins(manifest.plugins);
    this._validateCapabilities(manifest.capabilities);
    this._validateWorkflows(manifest.workflows);
    this._validatePrompts(manifest.prompts);
    this._validateParameters(manifest.parameters);
    this._validateRecoveryStrategies(manifest.recovery_strategies);
    this._validateOutputs(manifest.outputs);
    this._validateMetadata(manifest.metadata);
    this._validateUnknownFields(manifest);

    return {
      valid: this.errors.length === 0,
      errors: this.errors
    };
  }

  /**
   * Validate manifest version
   * @param {Object} manifest
   * @private
   */
  _validateVersion(manifest) {
    if (manifest.skillManifestVersion === undefined) {
      this._addError('skillManifestVersion', ERROR_CODES.MISSING_REQUIRED, {
        field: 'skillManifestVersion'
      });
    } else if (manifest.skillManifestVersion !== 1) {
      this._addError('skillManifestVersion', ERROR_CODES.INVALID_VALUE, {
        field: 'skillManifestVersion',
        value: manifest.skillManifestVersion
      });
    }
  }

  /**
   * Validate skill ID (kebab-case)
   * @param {string} id
   * @private
   */
  _validateId(id) {
    if (!id) {
      this._addError('id', ERROR_CODES.MISSING_REQUIRED, { field: 'id' });
    } else if (!KEBAB_CASE_PATTERN.test(id)) {
      this._addError('id', ERROR_CODES.PATTERN_MISMATCH, {
        field: 'id',
        pattern: 'kebab-case'
      }, id);
    }
  }

  /**
   * Validate skill name
   * @param {string} name
   * @private
   */
  _validateName(name) {
    if (!name) {
      this._addError('name', ERROR_CODES.MISSING_REQUIRED, { field: 'name' });
    } else if (typeof name !== 'string' || name.length === 0) {
      this._addError('name', ERROR_CODES.INVALID_TYPE, {
        field: 'name',
        expected: 'non-empty string',
        actual: typeof name
      });
    }
  }

  /**
   * Validate semantic version
   * @param {string} version
   * @private
   */
  _validateVersionField(version) {
    if (!version) {
      this._addError('version', ERROR_CODES.MISSING_REQUIRED, { field: 'version' });
    } else if (!SEMVER_PATTERN.test(version)) {
      this._addError('version', ERROR_CODES.INVALID_VERSION, { value: version });
    }
  }

  /**
   * Validate description
   * @param {string} description
   * @private
   */
  _validateDescription(description) {
    if (!description) {
      this._addError('description', ERROR_CODES.MISSING_REQUIRED, {
        field: 'description'
      });
    } else if (typeof description !== 'string') {
      this._addError('description', ERROR_CODES.INVALID_TYPE, {
        field: 'description',
        expected: 'string',
        actual: typeof description
      });
    }
  }

  /**
   * Validate category (domain/subdomain format)
   * @param {string} category
   * @private
   */
  _validateCategory(category) {
    if (!category) {
      this._addError('category', ERROR_CODES.MISSING_REQUIRED, {
        field: 'category'
      });
    } else if (!CATEGORY_PATTERN.test(category)) {
      this._addError('category', ERROR_CODES.PATTERN_MISMATCH, {
        field: 'category',
        pattern: 'domain/subdomain'
      }, category);
    }
  }

  /**
   * Validate source field
   * @param {string} source
   * @private
   */
  _validateSource(source) {
    if (!source) {
      this._addError('source', ERROR_CODES.MISSING_REQUIRED, { field: 'source' });
    } else if (!SOURCE_TYPES.includes(source)) {
      this._addError('source', ERROR_CODES.INVALID_VALUE, {
        field: 'source',
        value: source
      });
    }
  }

  /**
   * Validate tags array
   * @param {string[]} tags
   * @private
   */
  _validateTags(tags) {
    if (tags !== undefined) {
      if (!Array.isArray(tags)) {
        this._addError('tags', ERROR_CODES.INVALID_TYPE, {
          field: 'tags',
          expected: 'array',
          actual: typeof tags
        });
      } else {
        tags.forEach((tag, index) => {
          if (typeof tag !== 'string' || !/^[a-z][a-z0-9-]*$/.test(tag)) {
            this._addError(`tags[${index}]`, ERROR_CODES.INVALID_VALUE, {
              field: `tags[${index}]`,
              value: tag
            });
          }
        });
      }
    }
  }

  /**
   * Validate plugins section
   * @param {Object} plugins
   * @private
   */
  _validatePlugins(plugins) {
    if (!plugins) {
      this._addError('plugins', ERROR_CODES.MISSING_REQUIRED, { field: 'plugins' });
      return;
    }

    if (!plugins.required) {
      this._addError('plugins.required', ERROR_CODES.MISSING_REQUIRED, {
        field: 'plugins.required'
      });
    } else if (!Array.isArray(plugins.required) || plugins.required.length === 0) {
      this._addError('plugins.required', ERROR_CODES.EMPTY_ARRAY, {
        field: 'plugins.required'
      });
    } else {
      plugins.required.forEach((id, index) => {
        if (typeof id !== 'string' || id.length === 0) {
          this._addError(`plugins.required[${index}]`, ERROR_CODES.INVALID_VALUE, {
            field: `plugins.required[${index}]`,
            value: id
          });
        }
      });
    }

    if (plugins.optional !== undefined) {
      if (!Array.isArray(plugins.optional)) {
        this._addError('plugins.optional', ERROR_CODES.INVALID_TYPE, {
          field: 'plugins.optional',
          expected: 'array',
          actual: typeof plugins.optional
        });
      }
    }
  }

  /**
   * Validate capabilities array
   * @param {string[]} capabilities
   * @private
   */
  _validateCapabilities(capabilities) {
    if (capabilities !== undefined) {
      if (!Array.isArray(capabilities)) {
        this._addError('capabilities', ERROR_CODES.INVALID_TYPE, {
          field: 'capabilities',
          expected: 'array',
          actual: typeof capabilities
        });
      }
    }
  }

  /**
   * Validate workflows section
   * @param {Object} workflows
   * @private
   */
  _validateWorkflows(workflows) {
    if (workflows !== undefined) {
      if (typeof workflows !== 'object') {
        this._addError('workflows', ERROR_CODES.INVALID_TYPE, {
          field: 'workflows',
          expected: 'object',
          actual: typeof workflows
        });
      } else {
        if (workflows.default !== undefined && typeof workflows.default !== 'string') {
          this._addError('workflows.default', ERROR_CODES.INVALID_TYPE, {
            field: 'workflows.default',
            expected: 'string',
            actual: typeof workflows.default
          });
        }
        if (workflows.variants !== undefined) {
          if (!Array.isArray(workflows.variants)) {
            this._addError('workflows.variants', ERROR_CODES.INVALID_TYPE, {
              field: 'workflows.variants',
              expected: 'array',
              actual: typeof workflows.variants
            });
          }
        }
      }
    }
  }

  /**
   * Validate prompts section
   * @param {Object} prompts
   * @private
   */
  _validatePrompts(prompts) {
    if (prompts !== undefined) {
      if (typeof prompts !== 'object') {
        this._addError('prompts', ERROR_CODES.INVALID_TYPE, {
          field: 'prompts',
          expected: 'object',
          actual: typeof prompts
        });
      } else {
        if (prompts.system !== undefined && typeof prompts.system !== 'string') {
          this._addError('prompts.system', ERROR_CODES.INVALID_TYPE, {
            field: 'prompts.system',
            expected: 'string',
            actual: typeof prompts.system
          });
        }
        if (prompts.user_templates !== undefined) {
          if (!Array.isArray(prompts.user_templates)) {
            this._addError('prompts.user_templates', ERROR_CODES.INVALID_TYPE, {
              field: 'prompts.user_templates',
              expected: 'array',
              actual: typeof prompts.user_templates
            });
          } else {
            prompts.user_templates.forEach((template, index) => {
              if (typeof template !== 'string') {
                this._addError(`prompts.user_templates[${index}]`, ERROR_CODES.INVALID_TYPE, {
                  field: `prompts.user_templates[${index}]`,
                  expected: 'string',
                  actual: typeof template
                });
              }
            });
          }
        }
      }
    }
  }

  /**
   * Validate parameters section
   * @param {Object} parameters
   * @private
   */
  _validateParameters(parameters) {
    if (parameters !== undefined) {
      if (typeof parameters !== 'object') {
        this._addError('parameters', ERROR_CODES.INVALID_TYPE, {
          field: 'parameters',
          expected: 'object',
          actual: typeof parameters
        });
        return;
      }

      if (parameters.required !== undefined) {
        if (!Array.isArray(parameters.required)) {
          this._addError('parameters.required', ERROR_CODES.INVALID_TYPE, {
            field: 'parameters.required',
            expected: 'array',
            actual: typeof parameters.required
          });
        }
      }

      if (parameters.optional !== undefined) {
        if (typeof parameters.optional !== 'object') {
          this._addError('parameters.optional', ERROR_CODES.INVALID_TYPE, {
            field: 'parameters.optional',
            expected: 'object',
            actual: typeof parameters.optional
          });
        } else {
          this._validateParameterDefinitions(parameters.optional);
        }
      }
    }
  }

  /**
   * Validate parameter definitions
   * @param {Object} optionalParams
   * @private
   */
  _validateParameterDefinitions(optionalParams) {
    for (const [name, param] of Object.entries(optionalParams)) {
      const path = `parameters.optional.${name}`;

      if (!param.type) {
        this._addError(`${path}.type`, ERROR_CODES.MISSING_REQUIRED, {
          field: `${path}.type`
        });
        continue;
      }

      if (!Object.values(PARAM_TYPES).includes(param.type)) {
        this._addError(`${path}.type`, ERROR_CODES.INVALID_VALUE, {
          field: `${path}.type`,
          value: param.type
        });
      }

      if (param.type === PARAM_TYPES.SELECT) {
        if (!param.options || !Array.isArray(param.options)) {
          this._addError(`${path}.options`, ERROR_CODES.MISSING_REQUIRED, {
            field: `${path}.options`
          });
        }
        if (param.default !== undefined && param.options && !param.options.includes(param.default)) {
          this._addError(`${path}.default`, ERROR_CODES.INVALID_VALUE, {
            field: `${path}.default`,
            value: param.default
          });
        }
      }

      if (param.type === PARAM_TYPES.NUMBER) {
        if (param.min !== undefined && param.max !== undefined && param.min > param.max) {
          this._addError(`${path}`, ERROR_CODES.INVALID_CONSTRAINT, {
            field: path,
            constraint: `min (${param.min}) > max (${param.max})`
          });
        }
        if (param.default !== undefined) {
          if (typeof param.default !== 'number') {
            this._addError(`${path}.default`, ERROR_CODES.INVALID_TYPE, {
              field: `${path}.default`,
              expected: 'number',
              actual: typeof param.default
            });
          } else if (param.min !== undefined && param.default < param.min) {
            this._addError(`${path}.default`, ERROR_CODES.OUT_OF_RANGE, {
              field: `${path}.default`,
              value: param.default,
              min: param.min,
              max: param.max
            });
          } else if (param.max !== undefined && param.default > param.max) {
            this._addError(`${path}.default`, ERROR_CODES.OUT_OF_RANGE, {
              field: `${path}.default`,
              value: param.default,
              min: param.min,
              max: param.max
            });
          }
        }
      }

      if (param.type === PARAM_TYPES.STRING && param.pattern) {
        try {
          new RegExp(param.pattern);
        } catch {
          this._addError(`${path}.pattern`, ERROR_CODES.INVALID_FORMAT, {
            field: `${path}.pattern`,
            value: param.pattern
          });
        }
      }
    }
  }

  /**
   * Validate recovery strategies
   * @param {Object[]} strategies
   * @private
   */
  _validateRecoveryStrategies(strategies) {
    if (strategies !== undefined) {
      if (!Array.isArray(strategies)) {
        this._addError('recovery_strategies', ERROR_CODES.INVALID_TYPE, {
          field: 'recovery_strategies',
          expected: 'array',
          actual: typeof strategies
        });
        return;
      }

      strategies.forEach((strategy, index) => {
        const path = `recovery_strategies[${index}]`;

        if (!strategy.when) {
          this._addError(`${path}.when`, ERROR_CODES.MISSING_REQUIRED, {
            field: `${path}.when`
          });
        }
        if (!strategy.do) {
          this._addError(`${path}.do`, ERROR_CODES.MISSING_REQUIRED, {
            field: `${path}.do`
          });
        }
        if (!strategy.fallback) {
          this._addError(`${path}.fallback`, ERROR_CODES.MISSING_REQUIRED, {
            field: `${path}.fallback`
          });
        }
        if (strategy.recoverable === undefined) {
          this._addError(`${path}.recoverable`, ERROR_CODES.MISSING_REQUIRED, {
            field: `${path}.recoverable`
          });
        }
      });
    }
  }

  /**
   * Validate outputs section
   * @param {Object} outputs
   * @private
   */
  _validateOutputs(outputs) {
    if (outputs !== undefined) {
      if (typeof outputs !== 'object') {
        this._addError('outputs', ERROR_CODES.INVALID_TYPE, {
          field: 'outputs',
          expected: 'object',
          actual: typeof outputs
        });
        return;
      }

      if (outputs.primary !== undefined) {
        if (!Array.isArray(outputs.primary)) {
          this._addError('outputs.primary', ERROR_CODES.INVALID_TYPE, {
            field: 'outputs.primary',
            expected: 'array',
            actual: typeof outputs.primary
          });
        } else {
          this._validateOutputItems(outputs.primary, 'outputs.primary');
        }
      }

      if (outputs.secondary !== undefined) {
        if (!Array.isArray(outputs.secondary)) {
          this._addError('outputs.secondary', ERROR_CODES.INVALID_TYPE, {
            field: 'outputs.secondary',
            expected: 'array',
            actual: typeof outputs.secondary
          });
        } else {
          this._validateOutputItems(outputs.secondary, 'outputs.secondary');
        }
      }
    }
  }

  /**
   * Validate output items
   * @param {Object[]} items
   * @param {string} basePath
   * @private
   */
  _validateOutputItems(items, basePath) {
    items.forEach((item, index) => {
      const path = `${basePath}[${index}]`;

      if (!item.id) {
        this._addError(`${path}.id`, ERROR_CODES.MISSING_REQUIRED, {
          field: `${path}.id`
        });
      }
      if (!item.type) {
        this._addError(`${path}.type`, ERROR_CODES.MISSING_REQUIRED, {
          field: `${path}.type`
        });
      } else if (!OUTPUT_TYPES.includes(item.type)) {
        this._addError(`${path}.type`, ERROR_CODES.INVALID_VALUE, {
          field: `${path}.type`,
          value: item.type
        });
      }
      if (!item.label) {
        this._addError(`${path}.label`, ERROR_CODES.MISSING_REQUIRED, {
          field: `${path}.label`
        });
      }
    });
  }

  /**
   * Validate metadata section
   * @param {Object} metadata
   * @private
   */
  _validateMetadata(metadata) {
    if (metadata !== undefined) {
      if (typeof metadata !== 'object') {
        this._addError('metadata', ERROR_CODES.INVALID_TYPE, {
          field: 'metadata',
          expected: 'object',
          actual: typeof metadata
        });
      }
    }
  }

  /**
   * Check for unknown fields in manifest
   * @param {Object} manifest
   * @private
   */
  _validateUnknownFields(manifest) {
    const knownFields = new Set(Object.keys(SKILL_SCHEMA.properties));
    
    for (const field of Object.keys(manifest)) {
      if (!knownFields.has(field) && field !== 'skillManifestVersion') {
        this._addError(field, ERROR_CODES.UNKNOWN_FIELD, { field });
      }
    }
  }

  /**
   * Validate parameter values against parameter schema
   * @param {Object} params - Parameter values to validate
   * @param {Object} paramSchema - Parameter schema definition
   * @returns {ValidationResult} Validation result
   */
  validateParameters(params, paramSchema) {
    this._clearErrors();

    if (!paramSchema) {
      return { valid: true, errors: [] };
    }

    const requiredParams = paramSchema.required || [];
    const optionalParams = paramSchema.optional || {};
    
    // Build a map of all parameter names
    const allParamNames = new Set([
      ...requiredParams,
      ...Object.keys(optionalParams)
    ]);

    // Check required parameters
    for (const paramName of requiredParams) {
      if (params[paramName] === undefined) {
        this._addError(`parameters.${paramName}`, ERROR_CODES.MISSING_REQUIRED, {
          field: paramName
        });
      }
    }

    // Validate provided parameters
    for (const [name, value] of Object.entries(params)) {
      const path = `parameters.${name}`;

      // Check for unknown parameters
      if (!allParamNames.has(name)) {
        this._addError(path, ERROR_CODES.UNKNOWN_FIELD, { field: name });
        continue;
      }

      // Get schema for this parameter (from optional definitions)
      const schema = optionalParams[name];
      
      if (schema) {
        this._validateParameterValue(path, name, value, schema);
      }
    }

    return {
      valid: this.errors.length === 0,
      errors: this.errors
    };
  }

  /**
   * Validate a single parameter value
   * @param {string} path - JSON path
   * @param {string} name - Parameter name
   * @param {*} value - Value to validate
   * @param {Object} schema - Parameter schema
   * @private
   */
  _validateParameterValue(path, name, value, schema) {
    switch (schema.type) {
      case PARAM_TYPES.SELECT:
        if (schema.options && !schema.options.includes(value)) {
          this._addError(path, ERROR_CODES.INVALID_VALUE, {
            field: name,
            value
          }, value);
        }
        break;

      case PARAM_TYPES.NUMBER:
        if (typeof value !== 'number') {
          this._addError(path, ERROR_CODES.INVALID_TYPE, {
            field: name,
            expected: 'number',
            actual: typeof value
          }, value);
        } else {
          if (schema.min !== undefined && value < schema.min) {
            this._addError(path, ERROR_CODES.OUT_OF_RANGE, {
              field: name,
              value,
              min: schema.min,
              max: schema.max
            }, value);
          }
          if (schema.max !== undefined && value > schema.max) {
            this._addError(path, ERROR_CODES.OUT_OF_RANGE, {
              field: name,
              value,
              min: schema.min,
              max: schema.max
            }, value);
          }
        }
        break;

      case PARAM_TYPES.STRING:
        if (typeof value !== 'string') {
          this._addError(path, ERROR_CODES.INVALID_TYPE, {
            field: name,
            expected: 'string',
            actual: typeof value
          }, value);
        } else if (schema.pattern) {
          try {
            if (!new RegExp(schema.pattern).test(value)) {
              this._addError(path, ERROR_CODES.PATTERN_MISMATCH, {
                field: name,
                pattern: schema.pattern
              }, value);
            }
          } catch {
            // Pattern validation already done in schema validation
          }
        }
        break;

      case PARAM_TYPES.BOOLEAN:
        if (typeof value !== 'boolean') {
          this._addError(path, ERROR_CODES.INVALID_TYPE, {
            field: name,
            expected: 'boolean',
            actual: typeof value
          }, value);
        }
        break;

      case PARAM_TYPES.FILE:
        if (typeof value !== 'string') {
          this._addError(path, ERROR_CODES.INVALID_TYPE, {
            field: name,
            expected: 'string (file path)',
            actual: typeof value
          }, value);
        }
        break;
    }
  }

  /**
   * Apply default values to a manifest
   * @param {Object} manifest - The skill manifest
   * @returns {Object} Manifest with defaults applied
   */
  applyDefaults(manifest) {
    if (!manifest) return manifest;

    const result = JSON.parse(JSON.stringify(manifest));

    if (result.tags === undefined) {
      result.tags = [];
    }

    if (result.capabilities === undefined) {
      result.capabilities = [];
    }

    if (result.plugins?.optional === undefined) {
      result.plugins = result.plugins || {};
      result.plugins.optional = [];
    }

    if (result.workflows === undefined) {
      result.workflows = { default: 'default', variants: [] };
    }

    if (result.parameters === undefined) {
      result.parameters = { required: [], optional: {} };
    } else {
      if (result.parameters.required === undefined) {
        result.parameters.required = [];
      }
      if (result.parameters.optional === undefined) {
        result.parameters.optional = {};
      }

      // Apply defaults to optional parameters
      for (const [name, schema] of Object.entries(result.parameters.optional)) {
        if (schema.default !== undefined && result.parameters[name] === undefined) {
          result.parameters[name] = schema.default;
        }
      }
    }

    if (result.recovery_strategies === undefined) {
      result.recovery_strategies = [];
    }

    if (result.outputs === undefined) {
      result.outputs = { primary: [], secondary: [] };
    } else {
      if (result.outputs.primary === undefined) {
        result.outputs.primary = [];
      }
      if (result.outputs.secondary === undefined) {
        result.outputs.secondary = [];
      }
    }

    if (result.metadata === undefined) {
      result.metadata = {};
    }

    return result;
  }
}

/**
 * Validate a skill manifest (convenience function)
 * @param {Object} manifest - The skill manifest to validate
 * @param {Object} [options] - Validation options
 * @param {string} [options.locale='en'] - Locale for error messages
 * @returns {ValidationResult} Validation result
 */
function validateSkillManifest(manifest, options = {}) {
  const validator = new SkillSchema(options);
  return validator.validate(manifest);
}

/**
 * Apply defaults to a skill manifest (convenience function)
 * @param {Object} manifest - The skill manifest
 * @returns {Object} Manifest with defaults applied
 */
function applySkillDefaults(manifest) {
  const validator = new SkillSchema();
  return validator.applyDefaults(manifest);
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SkillSchema,
    validateSkillManifest,
    applySkillDefaults,
    PARAM_TYPES,
    SOURCE_TYPES,
    OUTPUT_TYPES,
    ERROR_CODES
  };
}

