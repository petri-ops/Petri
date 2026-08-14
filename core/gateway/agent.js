/**
 * core/gateway/agent.js — Gateway Agent 封装
 *
 * Phase 2 产物：封装对 r-server/py-server 的调用，提供统一接口。
 *
 * 职责：
 * - 统一错误处理
 * - 统一响应格式
 * - 自动重试
 * - 断路器模式
 */

const http = require('http');
const https = require('https');

// Gateway 配置
const config = {
  gatewayUrl: process.env.GATEWAY_URL || 'http://127.0.0.1:3002',
  rServerUrl: process.env.R_SERVER_URL || 'http://127.0.0.1:3003',
  pyServerUrl: process.env.PY_SERVER_URL || 'http://127.0.0.1:3004',
  requestTimeout: parseInt(process.env.GATEWAY_TIMEOUT || '300000', 10),
};

// 断路器状态
const circuitBreakers = {
  rServer: { failures: 0, lastFailure: null, isOpen: false },
  pyServer: { failures: 0, lastFailure: null, isOpen: false },
};

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60000; // 1 minute

/**
 * 检查断路器状态
 * @param {string} service - 服务名称 ('rServer' | 'pyServer')
 * @returns {boolean} 是否允许请求
 */
function isCircuitOpen(service) {
  const cb = circuitBreakers[service];
  if (!cb.isOpen) return false;

  // 检查是否需要重置
  if (cb.lastFailure && Date.now() - cb.lastFailure > CIRCUIT_BREAKER_RESET_MS) {
    cb.isOpen = false;
    cb.failures = 0;
    console.log(`[gateway-agent] Circuit breaker reset for ${service}`);
    return false;
  }

  return true;
}

/**
 * 记录失败
 * @param {string} service - 服务名称
 */
function recordFailure(service) {
  const cb = circuitBreakers[service];
  cb.failures++;
  cb.lastFailure = Date.now();

  if (cb.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    cb.isOpen = true;
    console.warn(`[gateway-agent] Circuit breaker opened for ${service} after ${cb.failures} failures`);
  }
}

/**
 * 记录成功
 * @param {string} service - 服务名称
 */
function recordSuccess(service) {
  const cb = circuitBreakers[service];
  cb.failures = 0;
  cb.isOpen = false;
}

/**
 * HTTP 请求封装
 * @param {string} url - 请求 URL
 * @param {Object} options - 请求选项
 * @returns {Promise<Object>} 响应数据
 */
async function request(url, options = {}) {
  const { method = 'GET', body, headers = {}, timeout } = options;

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const protocol = urlObj.protocol === 'https:' ? https : http;

    const requestOptions = {
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
      path: urlObj.pathname + urlObj.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = protocol.request(requestOptions, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ status: res.statusCode, data: parsed });
          } else {
            reject(new GatewayError(res.statusCode, parsed.error || `HTTP ${res.statusCode}`, parsed));
          }
        } catch (e) {
          reject(new GatewayError(res.statusCode, 'Invalid JSON response', data));
        }
      });
    });

    req.on('error', (e) => reject(new GatewayError(0, e.message)));
    req.on('timeout', () => {
      req.destroy();
      reject(new GatewayError(0, 'Request timeout'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * Gateway 错误类
 */
class GatewayError extends Error {
  constructor(statusCode, message, details = null) {
    super(message);
    this.name = 'GatewayError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * 获取健康状态
 * @returns {Promise<Object>} 健康状态
 */
async function getHealth() {
  try {
    const result = await request(`${config.gatewayUrl}/health`);
    return result.data;
  } catch (e) {
    return {
      gateway: true,
      error: e.message,
    };
  }
}

/**
 * 列出所有工具
 * @param {Object} filter - 可选过滤条件
 * @returns {Promise<Array>} 工具列表
 */
async function listTools(filter = {}) {
  const query = filter.language ? `?language=${filter.language}` : '';
  const result = await request(`${config.gatewayUrl}/api/tools${query}`);
  return result.data.tools || [];
}

/**
 * 获取工具详情
 * @param {string} toolId - 工具 ID
 * @returns {Promise<Object|null>} 工具详情
 */
async function getTool(toolId) {
  try {
    const result = await request(`${config.gatewayUrl}/api/tools/${toolId}`);
    return result.data.tool || null;
  } catch (e) {
    if (e instanceof GatewayError && e.statusCode === 404) {
      return null;
    }
    throw e;
  }
}

/**
 * 执行工具
 * @param {string} toolId - 工具 ID
 * @param {Object} params - 工具参数
 * @param {Object} options - 执行选项
 * @returns {Promise<Object>} 执行结果
 */
async function executeTool(toolId, params = {}, options = {}) {
  const { retry = 1 } = options;

  let lastError;
  for (let attempt = 0; attempt <= retry; attempt++) {
    try {
      const result = await request(`${config.gatewayUrl}/api/execute`, {
        method: 'POST',
        body: { toolId, params },
        timeout: config.requestTimeout,
      });

      recordSuccess('rServer'); // 假设成功
      return result.data;
    } catch (e) {
      lastError = e;
      console.warn(`[gateway-agent] Tool execution attempt ${attempt + 1} failed: ${e.message}`);

      if (e instanceof GatewayError && e.statusCode >= 500) {
        recordFailure('rServer');
      }
    }
  }

  throw lastError;
}

/**
 * 直接调用 R Server（绕过 Gateway）
 * @param {string} endpoint - API 端点
 * @param {Object} body - 请求体
 * @returns {Promise<Object>} 响应
 */
async function callRServer(endpoint, body = null) {
  if (isCircuitOpen('rServer')) {
    throw new GatewayError(503, 'R Server temporarily unavailable (circuit breaker open)');
  }

  try {
    const result = await request(`${config.rServerUrl}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      body,
      timeout: config.requestTimeout,
    });

    recordSuccess('rServer');
    return result.data;
  } catch (e) {
    recordFailure('rServer');
    throw e;
  }
}

/**
 * 直接调用 Python Server（绕过 Gateway）
 * @param {string} endpoint - API 端点
 * @param {Object} body - 请求体
 * @returns {Promise<Object>} 响应
 */
async function callPyServer(endpoint, body = null) {
  if (isCircuitOpen('pyServer')) {
    throw new GatewayError(503, 'Python Server temporarily unavailable (circuit breaker open)');
  }

  try {
    const result = await request(`${config.pyServerUrl}${endpoint}`, {
      method: body ? 'POST' : 'GET',
      body,
      timeout: config.requestTimeout,
    });

    recordSuccess('pyServer');
    return result.data;
  } catch (e) {
    recordFailure('pyServer');
    throw e;
  }
}

/**
 * 批量获取服务状态
 * @returns {Promise<Object>} 所有服务状态
 */
async function getAllServiceStatus() {
  const [rServerHealth, pyServerHealth, gatewayHealth] = await Promise.all([
    request(`${config.rServerUrl}/api/health`).catch((e) => ({ status: 0, data: { error: e.message } })),
    request(`${config.pyServerUrl}/api/health`).catch((e) => ({ status: 0, data: { error: e.message } })),
    request(`${config.gatewayUrl}/health`).catch((e) => ({ status: 0, data: { error: e.message } })),
  ]);

  return {
    gateway: gatewayHealth.status === 200,
    rServer: rServerHealth.status === 200,
    pyServer: pyServerHealth.status === 200,
    details: {
      gateway: gatewayHealth.data,
      rServer: rServerHealth.data,
      pyServer: pyServerHealth.data,
    },
  };
}

/**
 * 获取断路器状态
 * @returns {Object} 断路器状态
 */
function getCircuitBreakerStatus() {
  return { ...circuitBreakers };
}

/**
 * 重置断路器
 * @param {string} service - 服务名称（可选，默认全部）
 */
function resetCircuitBreaker(service = null) {
  if (service && circuitBreakers[service]) {
    circuitBreakers[service] = { failures: 0, lastFailure: null, isOpen: false };
  } else {
    for (const key of Object.keys(circuitBreakers)) {
      circuitBreakers[key] = { failures: 0, lastFailure: null, isOpen: false };
    }
  }
}

module.exports = {
  GatewayError,
  getHealth,
  listTools,
  getTool,
  executeTool,
  callRServer,
  callPyServer,
  getAllServiceStatus,
  getCircuitBreakerStatus,
  resetCircuitBreaker,
  config,
};
