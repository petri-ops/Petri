/**
 * core/gateway/server.js — Backend Gateway 统一入口
 *
 * Phase 2 产物：作为所有后端服务的统一入口和协调层。
 *
 * 职责：
 * - 工具发现：GET /api/tools — 列出所有已注册工具
 * - 工具详情：GET /api/tools/:id — 获取工具详情
 * - 工具执行：POST /api/execute — 根据 language 路由到对应服务
 * - 健康检查：GET /health — 聚合所有后端服务状态
 *
 * 端口：3005（可通过环境变量 GATEWAY_PORT 配置）
 *
 * 路由规则：
 * - r-server: localhost:3003
 * - py-server: localhost:3004
 */

const express = require('express');
const http = require('http');
const path = require('path');

// Gateway 配置
const config = {
  port: parseInt(process.env.GATEWAY_PORT || '3005', 10),
  rServerUrl: process.env.R_SERVER_URL || 'http://127.0.0.1:3003',
  pyServerUrl: process.env.PY_SERVER_URL || 'http://127.0.0.1:3004',
  requestTimeout: parseInt(process.env.GATEWAY_TIMEOUT || '300000', 10), // 5min for tool execution
};

// 工具注册表
const toolRegistry = require('../shared-backend/tool-registry');

// Pipeline 执行器
const pipeline = require('./pipeline');

// ============================================================
// Express App
// ============================================================

const app = express();

// JSON body parser
app.use(express.json({ limit: '200mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health' && req.path !== '/api/health') {
      console.log(`[gateway] ${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// CORS headers
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// ============================================================
// Health Check — 聚合所有后端服务状态
// ============================================================

async function checkServiceHealth(url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch(`${url}/api/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return {
      ok: response.ok,
      status: response.status,
      data: await response.json().catch(() => null),
    };
  } catch (e) {
    return {
      ok: false,
      error: e.message || 'Connection failed',
    };
  }
}

app.get('/health', async (req, res) => {
  const [rServerHealth, pyServerHealth] = await Promise.all([
    checkServiceHealth(config.rServerUrl),
    checkServiceHealth(config.pyServerUrl),
  ]);

  const db = await checkDatabaseHealth();

  const health = {
    gateway: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      rServer: rServerHealth.ok ? { status: 'healthy', ...rServerHealth.data } : { status: 'unhealthy', error: rServerHealth.error },
      pyServer: pyServerHealth.ok ? { status: 'healthy', ...pyServerHealth.data } : { status: 'unhealthy', error: pyServerHealth.error },
      database: db,
    },
    tools: toolRegistry.getStats(),
  };

  const allHealthy = rServerHealth.ok && pyServerHealth.ok && db.status === 'healthy';
  res.status(allHealthy ? 200 : 503).json(health);
});

app.get('/api/health', (req, res) => {
  res.redirect('/health');
});

async function checkDatabaseHealth() {
  try {
    // 尝试访问 r-server 的数据库健康检查端点
    const response = await fetch(`${config.rServerUrl}/api/health`, {
      method: 'GET',
    });
    if (response.ok) {
      return { status: 'healthy' };
    }
    return { status: 'unhealthy', error: 'Database unreachable' };
  } catch (e) {
    return { status: 'unhealthy', error: e.message };
  }
}

// ============================================================
// Tool Registry Routes
// ============================================================

// GET /api/tools — 列出所有工具
app.get('/api/tools', (req, res) => {
  const { language } = req.query;
  const tools = toolRegistry.listTools(language ? { language } : {});

  res.json({
    status: 'ok',
    count: tools.length,
    tools,
    stats: toolRegistry.getStats(),
  });
});

// GET /api/tools/:id — 获取工具详情
app.get('/api/tools/:id', (req, res) => {
  const tool = toolRegistry.getTool(req.params.id);

  if (!tool) {
    return res.status(404).json({
      status: 'error',
      error: 'Tool not found',
      toolId: req.params.id,
    });
  }

  res.json({
    status: 'ok',
    tool,
  });
});

// ============================================================
// Tool Execution Routes
// ============================================================

// POST /api/execute — 执行工具（根据 language 路由）
app.post('/api/execute', async (req, res) => {
  const { toolId, params, language } = req.body;

  if (!toolId) {
    return res.status(400).json({
      status: 'error',
      error: 'Missing required field: toolId',
    });
  }

  // 从注册表获取工具信息
  const tool = toolRegistry.getTool(toolId);
  const targetLanguage = language || (tool ? tool.language : null);

  if (!targetLanguage) {
    return res.status(400).json({
      status: 'error',
      error: 'Unable to determine tool language',
    });
  }

  // 根据语言路由到对应服务
  const targetUrl = targetLanguage === 'python' ? config.pyServerUrl : config.rServerUrl;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeout);

    const response = await fetch(`${targetUrl}/api/tools/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        toolId,
        params,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const data = await response.json();

    res.status(response.status).json({
      ...data,
      _gateway: {
        routedTo: targetLanguage,
        toolId,
      },
    });
  } catch (e) {
    console.error(`[gateway] Tool execution failed: ${e.message}`);

    if (e.name === 'AbortError') {
      return res.status(504).json({
        status: 'error',
        error: 'Tool execution timed out',
        timeout: config.requestTimeout,
      });
    }

    res.status(502).json({
      status: 'error',
      error: `Failed to execute tool: ${e.message}`,
    });
  }
});

// ============================================================
// Pipeline Routes
// ============================================================

// POST /api/pipeline/execute — 执行 Pipeline
app.post('/api/pipeline/execute', async (req, res) => {
  const { steps, continueOnError } = req.body;

  if (!steps || !Array.isArray(steps) || steps.length === 0) {
    return res.status(400).json({
      status: 'error',
      error: 'Invalid pipeline request: steps must be a non-empty array',
    });
  }

  // 验证每个步骤
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (!step.toolId) {
      return res.status(400).json({
        status: 'error',
        error: `Step ${i} is missing required field: toolId`,
      });
    }
  }

  try {
    const result = await pipeline.executePipeline({
      steps,
      continueOnError: continueOnError === true,
    });

    res.json({
      status: 'ok',
      ...result,
    });
  } catch (error) {
    console.error(`[gateway] Pipeline execution failed: ${error.message}`);

    if (error instanceof pipeline.PipelineError) {
      return res.status(error.statusCode).json({
        status: 'error',
        error: error.message,
      });
    }

    res.status(500).json({
      status: 'error',
      error: `Pipeline execution failed: ${error.message}`,
    });
  }
});

// GET /api/pipeline/status/:id — 查询 Pipeline 执行状态
app.get('/api/pipeline/status/:id', (req, res) => {
  const status = pipeline.getPipelineStatus(req.params.id);

  if (!status) {
    return res.status(404).json({
      status: 'error',
      error: 'Pipeline not found',
      pipelineId: req.params.id,
    });
  }

  res.json({
    status: 'ok',
    pipeline: status,
  });
});

// GET /api/pipeline/list — 列出所有 Pipeline
app.get('/api/pipeline/list', (req, res) => {
  const pipelines = pipeline.listPipelines();
  res.json({
    status: 'ok',
    count: pipelines.length,
    pipelines,
  });
});

// POST /api/pipeline/cleanup — 清理已完成的 Pipeline
app.post('/api/pipeline/cleanup', (req, res) => {
  const maxRetain = parseInt(req.body.maxRetain || '100', 10);
  const result = pipeline.cleanupPipelines(maxRetain);
  res.json({
    status: 'ok',
    ...result,
  });
});

// ============================================================
// Proxy Routes — 透明代理到 r-server
// ============================================================

// 代理所有 /r-server/* 请求到 r-server
app.use('/r-server', createProxyMiddleware(config.rServerUrl));

// 代理所有 /py-server/* 请求到 py-server
app.use('/py-server', createProxyMiddleware(config.pyServerUrl));

function createProxyMiddleware(targetUrl) {
  return async (req, res) => {
    const targetPath = req.path;
    const targetEndpoint = `${targetUrl}${targetPath}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);

      const fetchOptions = {
        method: req.method,
        headers: {
          ...req.headers,
          host: new URL(targetUrl).host,
        },
        signal: controller.signal,
      };

      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        fetchOptions.body = JSON.stringify(req.body);
      }

      const response = await fetch(targetEndpoint, fetchOptions);
      clearTimeout(timeout);

      const data = await response.json().catch(() => null);

      res.status(response.status).json(data || { status: response.statusText });
    } catch (e) {
      console.error(`[gateway] Proxy failed: ${req.method} ${targetPath} -> ${e.message}`);
      res.status(502).json({
        status: 'error',
        error: `Proxy failed: ${e.message}`,
      });
    }
  };
}

// ============================================================
// Service Routes — 服务状态
// ============================================================

// GET /api/services — 列出所有服务
app.get('/api/services', async (req, res) => {
  const [rServerHealth, pyServerHealth] = await Promise.all([
    checkServiceHealth(config.rServerUrl),
    checkServiceHealth(config.pyServerUrl),
  ]);

  res.json({
    status: 'ok',
    services: [
      {
        name: 'r-server',
        url: config.rServerUrl,
        healthy: rServerHealth.ok,
        ...(rServerHealth.ok ? rServerHealth.data : { error: rServerHealth.error }),
      },
      {
        name: 'py-server',
        url: config.pyServerUrl,
        healthy: pyServerHealth.ok,
        ...(pyServerHealth.ok ? pyServerHealth.data : { error: pyServerHealth.error }),
      },
    ],
  });
});

// ============================================================
// Start Server
// ============================================================

const server = app.listen(config.port, '127.0.0.1', () => {
  console.log(`[gateway] BioF3 Backend Gateway started on port ${config.port}`);
  console.log(`[gateway]   Health:         http://localhost:${config.port}/health`);
  console.log(`[gateway]   Tools:          http://localhost:${config.port}/api/tools`);
  console.log(`[gateway]   Execute:        POST http://localhost:${config.port}/api/execute`);
  console.log(`[gateway]   Pipeline:       POST http://localhost:${config.port}/api/pipeline/execute`);
  console.log(`[gateway]   Pipeline Status: GET  http://localhost:${config.port}/api/pipeline/status/:id`);
  console.log(`[gateway]   R Server:       ${config.rServerUrl}`);
  console.log(`[gateway]   Py Server:      ${config.pyServerUrl}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`[gateway] Received ${signal}, shutting down...`);
  server.close(() => {
    console.log('[gateway] Server closed');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

module.exports = { app, server, config };
