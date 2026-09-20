#!/usr/bin/env node
/**
 * mcp/server.js — BioF3 标准 MCP Server（stdio 传输）
 *
 * 让任意 MCP 客户端（Claude Desktop / Cursor / GPT / 任意 agent）
 * 通过标准 Model Context Protocol 调用 BioF3 插件工具进行生信分析。
 *
 * 协议：JSON-RPC 2.0 over stdio（零外部依赖）
 * 方法：initialize / tools/list / tools/call / ping
 *
 * 用法：
 *   node mcp/server.js                    # stdio 模式（Claude Desktop / Cursor）
 *
 * 配置示例（Claude Desktop claude_desktop_config.json）：
 *   {
 *     "mcpServers": {
 *       "biof3": {
 *         "command": "node",
 *         "args": ["/path/to/BioF3/core/biof3-server/mcp/server.js"]
 *       }
 *     }
 *   }
 *
 * 设计原则：
 *   - 纯协议层，零业务逻辑——所有工具执行委托给 registry.js
 *   - 零外部依赖（纯 Node.js 内置模块），避免 ESM/CJS 冲突
 *   - PNG 结果自动转为 image content block，让视觉模型直接看图
 *   - 排除单细胞步骤（后期清理为单独插件）
 *   - 跳过重操作审批（MCP 直连场景，用户显式调用）
 */

'use strict';

const path = require('path');
const fs = require('fs');

// ─── registry 加载 ───────────────────────────────────────────
// registry.js 已有 listTools() / callTool()，返回格式天然兼容 MCP
const registry = require(path.join(__dirname, 'registry.js'));

// ─── 常量 ────────────────────────────────────────────────────
const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'biof3';
const SERVER_VERSION = '1.0.0';

// 图片扩展名（自动转为 image content block）
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
// 单张图片最大 base64 体积（5MB，防止超大图撑爆上下文）
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// 最多返回的 image content blocks（防止 20 张图刷爆 token）
const MAX_IMAGE_BLOCKS = 6;
// 文本 summary 截断长度
const MAX_TEXT_LEN = 12000;

// ─── JSON-RPC 2.0 over stdio ─────────────────────────────────

/**
 * 从 stdin 逐行读取 JSON-RPC 消息。
 * MCP 协议：每条消息占一行（newline-delimited JSON）。
 */
function startStdioLoop() {
  let buffer = '';
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    // 按换行符分割（兼容 \n 和 \r\n）
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      if (line.trim()) {
        handleMessage(line);
      }
    }
  });

  process.stdin.on('end', () => {
    process.exit(0);
  });

  // 未捕获异常：返回 JSON-RPC error，不崩溃
  process.on('uncaughtException', (err) => {
    sendError(null, -32603, 'Internal error', { message: err.message });
  });
}

/**
 * 发送 JSON-RPC 响应到 stdout。
 */
function sendResponse(id, result) {
  const msg = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

/**
 * 发送 JSON-RPC 错误响应到 stdout。
 */
function sendError(id, code, message, data) {
  const msg = { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
  process.stdout.write(JSON.stringify(msg) + '\n');
}

// ─── MCP 方法处理 ────────────────────────────────────────────

/**
 * 核心消息分发。
 */
async function handleMessage(line) {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    sendError(null, -32700, 'Parse error');
    return;
  }

  const { id, method, params } = req;

  // 通知（无 id）——不需要响应
  if (id === undefined || id === null) {
    // initialized 通知：静默接受
    if (method === 'notifications/initialized') return;
    return;
  }

  try {
    switch (method) {
      case 'initialize':
        handleInitialize(id, params);
        break;
      case 'ping':
        sendResponse(id, {});
        break;
      case 'tools/list':
        await handleToolsList(id);
        break;
      case 'tools/call':
        await handleToolsCall(id, params);
        break;
      case 'resources/list':
        {
          const resources = registry.listIdeMcpResources
            ? registry.listIdeMcpResources()
            : [];
          sendResponse(id, { resources });
        }
        break;
      case 'resources/read':
        {
          if (!params || !params.uri) {
            sendError(id, -32602, 'Missing required param: uri');
            break;
          }
          const result = registry.readIdeMcpResource
            ? registry.readIdeMcpResource(params.uri)
            : { ok: false, error: 'ide resources not available' };
          // MCP 约定：resources/read 返回 contents[]，每个 item 含 uri + mimeType + text|blob
          if (result && result.ok) {
            sendResponse(id, {
              contents: [
                {
                  uri: result.uri || params.uri,
                  mimeType: result.mimeType || 'application/json',
                  text: result.text || '',
                },
              ],
            });
          } else {
            // 资源读取失败仍走错误码
            sendError(id, -32602, result && result.error ? result.error : 'resource read failed');
          }
        }
        break;
      case 'prompts/list':
        // 暂不实现 prompts
        sendResponse(id, { prompts: [] });
        break;
      default:
        sendError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    sendError(id, -32603, 'Internal error', { message: err.message });
  }
}

/**
 * initialize — MCP 握手
 */
function handleInitialize(id, _params) {
  sendResponse(id, {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {
      tools: { listChanged: false },
      resources: {},
      prompts: {},
    },
    serverInfo: {
      name: SERVER_NAME,
      version: SERVER_VERSION,
    },
  });
}

/**
 * tools/list — 列出所有可用工具
 * 过滤掉单细胞步骤，只暴露插件工具。
 */
async function handleToolsList(id) {
  const allTools = await registry.listTools();

  // 过滤：排除单细胞步骤（_isStep === true），只暴露插件工具
  // 同时剥离内部字段（_language / _outputs / _isStep 等），只保留 MCP 标准字段
  const MCP_FIELDS = new Set(['name', 'description', 'inputSchema']);
  const pluginTools = allTools
    .filter((t) => !t._isStep)
    .map((t) => {
      const clean = {};
      for (const key of MCP_FIELDS) {
        if (t[key] !== undefined) clean[key] = t[key];
      }
      return clean;
    });

  // MCP tools/list 返回格式：{ tools: [{name, description, inputSchema}] }
  sendResponse(id, { tools: pluginTools });
}

/**
 * tools/call — 执行工具
 * params: { name: string, arguments: object }
 */
async function handleToolsCall(id, params) {
  const toolName = params && params.name;
  const args = (params && params.arguments) || {};

  if (!toolName || typeof toolName !== 'string') {
    sendError(id, -32602, 'Invalid params: missing "name"');
    return;
  }

  // 调用 registry.callTool（跳过审批，MCP 直连场景）
  const result = await registry.callTool(toolName, args, { userId: 'mcp' });

  // 转换为标准 MCP content blocks
  const contentBlocks = convertToMcpContent(result);

  sendResponse(id, {
    content: contentBlocks,
    isError: result.isError || false,
  });
}

// ─── 结果转换 ────────────────────────────────────────────────

/**
 * 把 registry.callTool 的返回转换为 MCP content blocks。
 *
 * registry 返回：{ content: [{type:'text', text: JSON.stringify(summary)}], isError, _jobDir, toolJobId }
 * summary 包含：{ toolJobId, jobDir, outputDir, resultDir, outputs, files, manifest, stdout }
 *
 * 转换策略：
 *   1. 解析 summary JSON
 *   2. 文本摘要 → text block（截断防超 token）
 *   3. PNG 图片 → image block（base64，最多 MAX_IMAGE_BLOCKS 张）
 *   4. CSV/表数据 → text block（前 50 行预览）
 */
function convertToMcpContent(result) {
  const blocks = [];

  // 原始 content 透传（registry 返回的 text block）
  if (result.content && Array.isArray(result.content)) {
    for (const block of result.content) {
      if (block.type === 'text' && block.text) {
        // 尝试解析 summary JSON，提取结构化信息
        let summary = null;
        try {
          summary = JSON.parse(block.text);
        } catch {
          // 非 JSON 文本，直接透传
          blocks.push({ type: 'text', text: truncate(block.text, MAX_TEXT_LEN) });
          continue;
        }

        // 解析成功：构造精简文本摘要
        blocks.push({ type: 'text', text: buildTextSummary(summary) });

        // 从 summary 中提取图片
        const imageBlocks = extractImages(summary);
        blocks.push(...imageBlocks);

        // 从 summary 中提取 CSV 表预览
        const csvBlocks = extractCsvPreviews(summary);
        blocks.push(...csvBlocks);
      } else {
        blocks.push(block);
      }
    }
  }

  // 兜底：如果没有任何 block，返回空文本
  if (blocks.length === 0) {
    blocks.push({ type: 'text', text: '(无输出)' });
  }

  return blocks;
}

/**
 * 构造精简文本摘要（给 LLM 看的，不是原始 JSON dump）。
 */
function buildTextSummary(summary) {
  const lines = [];

  if (summary.toolJobId) lines.push(`## BioF3 分析结果 (jobId: ${summary.toolJobId})`);
  if (summary.jobDir) lines.push(`结果目录: ${summary.jobDir}`);
  lines.push('');

  // manifest 产物清单
  if (summary.outputs && summary.outputs.length > 0) {
    lines.push('### 产物清单');
    for (const out of summary.outputs) {
      const label = out.label || out.name || out.filename || '未命名';
      const type = out.type || 'file';
      const fpath = out.path || '';
      lines.push(`- [${type}] ${label}${fpath ? ` → ${fpath}` : ''}`);
    }
    lines.push('');
  }

  // 文件列表（manifest 之外的文件）
  if (summary.files && summary.files.length > 0) {
    const extra = summary.files.filter(
      (f) => !summary.outputs || !summary.outputs.some((o) => (o.filename || o.name) === f)
    );
    if (extra.length > 0) {
      lines.push('### 其他文件');
      lines.push(extra.map((f) => `- ${f}`).join('\n'));
      lines.push('');
    }
  }

  // manifest 原始数据（如果有 summary 字段）
  if (summary.manifest && summary.manifest.summary) {
    lines.push('### 分析摘要');
    lines.push('```');
    lines.push(typeof summary.manifest.summary === 'string'
      ? summary.manifest.summary
      : JSON.stringify(summary.manifest.summary, null, 2));
    lines.push('```');
    lines.push('');
  }

  // stdout 尾部（错误诊断用）
  if (summary.stdout) {
    lines.push('### 日志尾部');
    lines.push('```');
    lines.push(truncate(summary.stdout, 2000));
    lines.push('```');
  }

  return truncate(lines.join('\n'), MAX_TEXT_LEN);
}

/**
 * 从 summary 中提取 PNG 图片，转为 base64 image content blocks。
 */
function extractImages(summary) {
  const blocks = [];
  if (!summary.resultDir || !fs.existsSync(summary.resultDir)) return blocks;

  let imageFiles = [];

  // 优先从 manifest outputs 提取（有 label 信息）
  if (summary.outputs && summary.outputs.length > 0) {
    for (const out of summary.outputs) {
      const fname = out.filename || out.name;
      if (!fname) continue;
      const ext = path.extname(fname).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        imageFiles.push({ file: fname, label: out.label || out.name, path: out.path });
      }
    }
  }

  // 兜底：扫描 resultDir 下的图片文件
  if (imageFiles.length === 0 && summary.files) {
    for (const fname of summary.files) {
      const ext = path.extname(fname).toLowerCase();
      if (IMAGE_EXTS.has(ext)) {
        imageFiles.push({ file: fname, label: fname, path: path.join(summary.resultDir, fname) });
      }
    }
  }

  // 限制数量
  imageFiles = imageFiles.slice(0, MAX_IMAGE_BLOCKS);

  for (const img of imageFiles) {
    const imgPath = img.path || path.join(summary.resultDir, img.file);
    if (!fs.existsSync(imgPath)) continue;
    const data = fs.readFileSync(imgPath);
    if (data.length > MAX_IMAGE_BYTES) {
      // 超大图跳过，加文本提示
      blocks.push({
        type: 'text',
        text: `[图片过大已跳过: ${img.label} (${(data.length / 1024 / 1024).toFixed(1)}MB)]`,
      });
      continue;
    }
    const base64 = data.toString('base64');
    const ext = path.extname(img.file).toLowerCase().slice(1);
    const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    blocks.push({
      type: 'image',
      data: base64,
      mimeType,
    });
  }

  return blocks;
}

/**
 * 从 summary 中提取 CSV 文件，前 50 行预览作为 text block。
 */
function extractCsvPreviews(summary) {
  const blocks = [];
  if (!summary.resultDir || !fs.existsSync(summary.resultDir)) return blocks;

  let csvFiles = [];

  if (summary.outputs && summary.outputs.length > 0) {
    for (const out of summary.outputs) {
      const fname = out.filename || out.name;
      if (!fname) continue;
      if (out.type === 'table' || path.extname(fname).toLowerCase() === '.csv') {
        csvFiles.push({ file: fname, label: out.label || out.name, path: out.path });
      }
    }
  }

  // 限制 3 个 CSV 预览
  csvFiles = csvFiles.slice(0, 3);

  for (const csv of csvFiles) {
    const csvPath = csv.path || path.join(summary.resultDir, csv.file);
    if (!fs.existsSync(csvPath)) continue;
    const raw = fs.readFileSync(csvPath, 'utf8');
    const lines = raw.split('\n').slice(0, 51); // header + 50 rows
    const preview = lines.join('\n');
    blocks.push({
      type: 'text',
      text: `### ${csv.label} (前 50 行)\n\`\`\`csv\n${truncate(preview, 3000)}\n\`\`\``,
    });
  }

  return blocks;
}

// ─── 工具函数 ────────────────────────────────────────────────

/**
 * 截断文本到指定长度，末尾加省略号。
 */
function truncate(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen) + '\n... (已截断)';
}

// ─── 启动 ────────────────────────────────────────────────────

// stderr 日志（不干扰 stdout 的 JSON-RPC 流）
function log(msg) {
  process.stderr.write(`[biof3-mcp] ${msg}\n`);
}

log(`MCP Server starting (v${SERVER_VERSION}, protocol ${PROTOCOL_VERSION})`);
log(`Tools registry loaded: ${typeof registry.listTools === 'function' ? 'OK' : 'FAIL'}`);

startStdioLoop();
