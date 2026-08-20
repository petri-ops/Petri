/**
 * Error message mapping configuration for user-friendly error display.
 * Maps technical error codes/messages to user-friendly messages with severity levels.
 */

export type ErrorSeverity = 'error' | 'warning' | 'info';

export interface ErrorMessageConfig {
  userMessage: string;
  severity: ErrorSeverity;
  showDetails: boolean;
}

export const ERROR_MESSAGES: Record<string, ErrorMessageConfig> = {
  // Network related
  NETWORK_ERROR: {
    userMessage: '网络连接失败，请检查网络设置',
    severity: 'warning',
    showDetails: true,
  },
  TIMEOUT: {
    userMessage: '请求超时，AI 响应时间过长，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },
  ECONNREFUSED: {
    userMessage: '无法连接到服务器，请确保应用已正确启动',
    severity: 'error',
    showDetails: true,
  },
  ENOTFOUND: {
    userMessage: '无法找到服务器地址，请检查网络连接',
    severity: 'error',
    showDetails: true,
  },
  ETIMEDOUT: {
    userMessage: '连接超时，请检查网络或稍后重试',
    severity: 'warning',
    showDetails: true,
  },

  // Authentication related
  AUTH_FAILED: {
    userMessage: '认证已过期，请重新登录',
    severity: 'error',
    showDetails: false,
  },
  UNAUTHORIZED: {
    userMessage: '无权限访问，请检查您的账户权限',
    severity: 'error',
    showDetails: false,
  },
  AUTHENTICATION_ERROR: {
    userMessage: '认证失败，请重新登录',
    severity: 'error',
    showDetails: false,
  },
  TOKEN_EXPIRED: {
    userMessage: '登录已过期，请重新登录',
    severity: 'error',
    showDetails: false,
  },
  INVALID_TOKEN: {
    userMessage: '认证信息无效，请重新登录',
    severity: 'error',
    showDetails: false,
  },

  // Rate limiting related
  RATE_LIMIT: {
    userMessage: '请求过于频繁，请稍后再试',
    severity: 'info',
    showDetails: false,
  },
  RATE_LIMIT_EXCEEDED: {
    userMessage: '请求频率超限，请稍后再试',
    severity: 'info',
    showDetails: false,
  },
  QUOTA_EXCEEDED: {
    userMessage: 'API 配额已用完，请明天再试或联系管理员',
    severity: 'error',
    showDetails: false,
  },
  QUOTA_LIMIT: {
    userMessage: '请求配额不足，请稍后再试',
    severity: 'error',
    showDetails: false,
  },

  // Server errors
  INTERNAL_ERROR: {
    userMessage: '服务暂时不可用，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  INTERNAL_SERVER_ERROR: {
    userMessage: '服务器内部错误，我们已收到报告，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  HTTP_500: {
    userMessage: '服务器遇到问题，我们已收到报告，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  HTTP_502: {
    userMessage: '网关错误，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },
  HTTP_503: {
    userMessage: '服务正在维护中，请稍后访问',
    severity: 'warning',
    showDetails: true,
  },
  HTTP_504: {
    userMessage: '网关超时，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },
  BAD_GATEWAY: {
    userMessage: '网关错误，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },
  SERVICE_UNAVAILABLE: {
    userMessage: '服务暂时不可用，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  GATEWAY_TIMEOUT: {
    userMessage: '网关超时，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },

  // Client errors
  INVALID_REQUEST: {
    userMessage: '请求格式有误，请尝试简化您的问题',
    severity: 'info',
    showDetails: true,
  },
  BAD_REQUEST: {
    userMessage: '请求无效，请检查输入内容',
    severity: 'info',
    showDetails: true,
  },
  CONTENT_TOO_LONG: {
    userMessage: '输入内容过长，请缩短后重试',
    severity: 'info',
    showDetails: false,
  },
  PAYLOAD_TOO_LARGE: {
    userMessage: '请求数据过大，请减少内容后重试',
    severity: 'info',
    showDetails: false,
  },
  CONTENT_LENGTH_LIMIT: {
    userMessage: '内容超出长度限制，请缩短后重试',
    severity: 'info',
    showDetails: false,
  },

  // Model/resource errors
  MODEL_NOT_FOUND: {
    userMessage: 'AI 模型不可用，请尝试选择其他模型',
    severity: 'error',
    showDetails: false,
  },
  MODEL_ERROR: {
    userMessage: 'AI 模型处理失败，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  CONTEXT_LENGTH_EXCEEDED: {
    userMessage: '对话上下文过长，请开始新对话',
    severity: 'info',
    showDetails: false,
  },
  MAX_TOKENS_EXCEEDED: {
    userMessage: '回复长度超限，请尝试简化问题',
    severity: 'info',
    showDetails: false,
  },

  // Task/workflow errors
  TASK_NOT_FOUND: {
    userMessage: '任务不存在或已过期',
    severity: 'error',
    showDetails: false,
  },
  TASK_CANCELLED: {
    userMessage: '任务已被取消',
    severity: 'info',
    showDetails: false,
  },
  TASK_TIMEOUT: {
    userMessage: '任务执行超时，请稍后重试',
    severity: 'warning',
    showDetails: true,
  },
  WORKFLOW_ERROR: {
    userMessage: '工作流程执行失败，请稍后重试',
    severity: 'error',
    showDetails: true,
  },

  // Tool execution errors
  TOOL_ERROR: {
    userMessage: '工具执行失败，请稍后重试',
    severity: 'error',
    showDetails: true,
  },
  TOOL_NOT_FOUND: {
    userMessage: '请求的工具不可用',
    severity: 'error',
    showDetails: false,
  },
  TOOL_PERMISSION_DENIED: {
    userMessage: '工具执行权限不足，请检查设置',
    severity: 'error',
    showDetails: false,
  },

  // Subscription/payment errors
  SUBSCRIPTION_REQUIRED: {
    userMessage: '当前操作需要订阅会员',
    severity: 'info',
    showDetails: false,
  },
  PAYMENT_REQUIRED: {
    userMessage: '账户余额不足，请充值后重试',
    severity: 'error',
    showDetails: false,
  },

  // Unknown error
  UNKNOWN: {
    userMessage: '发生未知错误，请重试或联系支持',
    severity: 'error',
    showDetails: true,
  },
  HARNESS_ERROR: {
    userMessage: '工具调用失败 —— 请检查参数或稍后重试',
    severity: 'error',
    showDetails: true,
  },
  HARNESS_PARAM_INVALID: {
    userMessage: '工具参数校验未通过 —— 请检查输入参数',
    severity: 'error',
    showDetails: true,
  },
  HARNESS_REPAIR_FAILED: {
    userMessage: '工具修复建议生成失败 —— 请改写请求后重试',
    severity: 'warning',
    showDetails: true,
  },
  PYTHON_WORKER_DOWN: {
    userMessage: 'Python 工作进程未就绪 —— 请打开「插件商店」安装 Python 运行时',
    severity: 'error',
    showDetails: true,
  },
  PYTHON_MODULE_MISSING: {
    userMessage: 'Python 依赖模块缺失 —— 请打开「插件商店」安装 Python 运行时',
    severity: 'error',
    showDetails: true,
  },
  PYTHON_EXECUTION_FAILED: {
    userMessage: 'Python 脚本执行失败 —— 请查看详情定位问题',
    severity: 'error',
    showDetails: true,
  },
  WORKER_CRASHED: {
    userMessage: '分析工作进程异常退出 —— 请重试或稍后重试',
    severity: 'error',
    showDetails: true,
  },
};

/**
 * Pattern matchers for error message classification.
 * Each entry contains a pattern to match against the error message
 * and the error code to map to.
 */
const ERROR_PATTERNS: Array<{ pattern: RegExp; code: string }> = [
  // Network errors
  { pattern: /network.*error|fetch.*fail|网络.*错误/i, code: 'NETWORK_ERROR' },
  { pattern: /timeout|timed?\s*out|超时/i, code: 'TIMEOUT' },
  { pattern: /econnrefused|connection\s*refused/i, code: 'ECONNREFUSED' },
  { pattern: /enotfound|dns|找不到.*服务器/i, code: 'ENOTFOUND' },
  { pattern: /etimedout|socket\s*timeout/i, code: 'ETIMEDOUT' },

  // Authentication errors
  { pattern: /auth.*fail|认证.*失败|登录.*失败/i, code: 'AUTH_FAILED' },
  { pattern: /unauthorized|未授权|无权限/i, code: 'UNAUTHORIZED' },
  { pattern: /token.*expir|token.*过期/i, code: 'TOKEN_EXPIRED' },
  { pattern: /invalid.*token|无效.*token/i, code: 'INVALID_TOKEN' },

  // Rate limiting
  { pattern: /rate\s*limit|频率.*限制/i, code: 'RATE_LIMIT' },
  { pattern: /quota.*exceed|配额.*超限/i, code: 'QUOTA_EXCEEDED' },
  { pattern: /too\s*many.*request/i, code: 'RATE_LIMIT' },

  // Server errors
  { pattern: /internal.*error|500/i, code: 'INTERNAL_ERROR' },
  { pattern: /502|bad\s*gateway/i, code: 'HTTP_502' },
  { pattern: /503|service.*unavailable|服务.*不可用/i, code: 'HTTP_503' },
  { pattern: /504|gateway.*timeout/i, code: 'GATEWAY_TIMEOUT' },

  // Client errors
  { pattern: /invalid.*request|bad.*request|无效.*请求/i, code: 'INVALID_REQUEST' },
  { pattern: /content.*too\s*long|内容.*过长/i, code: 'CONTENT_TOO_LONG' },
  { pattern: /payload.*too\s*large|数据.*过大/i, code: 'PAYLOAD_TOO_LARGE' },

  // Model errors
  { pattern: /model.*not\s*found|模型.*不存在/i, code: 'MODEL_NOT_FOUND' },
  { pattern: /context.*length.*exceed|上下文.*过长/i, code: 'CONTEXT_LENGTH_EXCEEDED' },
  { pattern: /max\s*token|token.*超限/i, code: 'MAX_TOKENS_EXCEEDED' },

  // Task errors
  { pattern: /task.*not\s*found|任务.*不存在/i, code: 'TASK_NOT_FOUND' },
  { pattern: /task.*cancel|任务.*取消/i, code: 'TASK_CANCELLED' },
  { pattern: /task.*timeout|任务.*超时/i, code: 'TASK_TIMEOUT' },

  // Tool errors
  { pattern: /tool.*error|工具.*错误/i, code: 'TOOL_ERROR' },
  { pattern: /tool.*not\s*found|工具.*不存在/i, code: 'TOOL_NOT_FOUND' },
  { pattern: /tool.*permission|工具.*权限/i, code: 'TOOL_PERMISSION_DENIED' },

  // Harness / tool execution
  { pattern: /harness|tool.*execution|tool.*exec|execute.*tool/i, code: 'HARNESS_ERROR' },
  { pattern: /参数.*校验|invalid.*param|param.*validation|param.*check/i, code: 'HARNESS_PARAM_INVALID' },
  { pattern: /修复建议|repair|harness.*repair/i, code: 'HARNESS_REPAIR_FAILED' },

  // Python runtime / worker (so users can see why scanpy / numpy failed
  // instead of a flat "发生未知错误")
  { pattern: /pyworker|python.*worker/i, code: 'PYTHON_WORKER_DOWN' },
  { pattern: /module.*not.*found|modulenotfounderror|模块.*不存在|没有.*模块/i, code: 'PYTHON_MODULE_MISSING' },
  { pattern: /python.*exec.*fail|python.*run.*fail|python.*runtime.*fail/i, code: 'PYTHON_EXECUTION_FAILED' },
  { pattern: /worker.*exited.*code|worker.*crash|worker.*restart/i, code: 'WORKER_CRASHED' },

  // Subscription errors
  { pattern: /subscription|会员.*需要|订阅/i, code: 'SUBSCRIPTION_REQUIRED' },
  { pattern: /payment|支付|充值|余额/i, code: 'PAYMENT_REQUIRED' },
];

/**
 * HTTP status codes mapping
 */
const HTTP_STATUS_CODES: Record<string, string> = {
  '400': 'BAD_REQUEST',
  '401': 'UNAUTHORIZED',
  '403': 'UNAUTHORIZED',
  '404': 'TASK_NOT_FOUND',
  '429': 'RATE_LIMIT',
  '500': 'HTTP_500',
  '502': 'HTTP_502',
  '503': 'HTTP_503',
  '504': 'GATEWAY_TIMEOUT',
};

/**
 * Classify an error based on its message and properties.
 * Returns the error code, mapped configuration, and technical details.
 */
export function classifyError(error: Error | string): {
  code: string;
  mapped: ErrorMessageConfig;
  technicalDetails?: string;
} {
  const errorMessage = typeof error === 'string' ? error : error.message || '';
  const errorStack = typeof error === 'string' ? undefined : error.stack;

  // Try to extract HTTP status code from error message
  const statusMatch = errorMessage.match(/\b([45]\d{2})\b/);
  if (statusMatch) {
    const statusCode = statusMatch[1];
    const mappedCode = HTTP_STATUS_CODES[statusCode];
    if (mappedCode && ERROR_MESSAGES[mappedCode]) {
      return {
        code: mappedCode,
        mapped: ERROR_MESSAGES[mappedCode],
        technicalDetails: errorStack,
      };
    }
  }

  // Try pattern matching
  for (const { pattern, code } of ERROR_PATTERNS) {
    if (pattern.test(errorMessage) && ERROR_MESSAGES[code]) {
      return {
        code,
        mapped: ERROR_MESSAGES[code],
        technicalDetails: errorStack,
      };
    }
  }

  // Return unknown error
  return {
    code: 'UNKNOWN',
    mapped: ERROR_MESSAGES.UNKNOWN,
    technicalDetails: errorStack,
  };
}

/**
 * Format an error for user display.
 * Returns structured error information for UI rendering.
 */
export function formatErrorForUser(error: Error | string): {
  code: string;
  userMessage: string;
  severity: ErrorSeverity;
  showDetails: boolean;
  technicalDetails?: string;
} {
  const { code, mapped, technicalDetails } = classifyError(error);
  return {
    code,
    userMessage: mapped.userMessage,
    severity: mapped.severity,
    showDetails: mapped.showDetails,
    technicalDetails,
  };
}
