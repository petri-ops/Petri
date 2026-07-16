# BioF3 MCP Server

让任意 MCP 客户端（Claude Desktop / Cursor / GPT / 任意 agent）通过标准 Model Context Protocol 调用 BioF3 插件工具进行生信分析。

## 架构

```
任意 MCP 客户端（Claude Desktop / Cursor / GPT / 任意 agent）
      │  JSON-RPC 2.0 over stdio
      ▼
mcp/server.js（标准 MCP server，纯协议层，零依赖）
      │  直接函数调用
      ▼
mcp/registry.js（已有，listTools / callTool）
      │
      ├─ R 插件 → Rscript 执行（deseq2 / go-kegg / gsea / ...）
      └─ Python 插件 → py-server HTTP API（spatial / scvi / ...）
```

### 设计原则

- **纯协议层**：零业务逻辑，所有工具执行委托给 `registry.js`
- **零外部依赖**：纯 Node.js 内置模块，避免 ESM/CJS 冲突
- **图片自动内嵌**：PNG 结果自动转为 `image` content block（base64），让视觉模型直接看图
- **排除单细胞步骤**：只暴露插件工具（单细胞平台后期清理为单独插件）
- **跳过重操作审批**：MCP 直连场景，用户显式调用，无需拦截

## 快速开始

### 1. Claude Desktop

编辑配置文件（macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "biof3": {
      "command": "node",
      "args": ["/Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/core/r-server/mcp/server.js"]
    }
  }
}
```

重启 Claude Desktop，即可在对话中调用所有 BioF3 插件工具。

### 2. Cursor

在 Settings → MCP 中添加：

```json
{
  "mcpServers": {
    "biof3": {
      "command": "node",
      "args": ["/Users/zhangdiandian/Documents/1.WorkDir/BioF3-workspace/core/r-server/mcp/server.js"]
    }
  }
}
```

### 3. 命令行测试

```bash
# 列出所有可用工具
npm run mcp:list

# 手动发送 JSON-RPC 消息测试
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}' | node r-server/mcp/server.js
```

## 协议细节

### 支持的 MCP 方法

| 方法 | 说明 |
|------|------|
| `initialize` | 握手，返回 server 信息和能力 |
| `ping` | 心跳 |
| `tools/list` | 列出所有可用插件工具 |
| `tools/call` | 执行指定工具 |

### 工具列表格式

`tools/list` 返回的每个工具包含：

```json
{
  "name": "deseq2",
  "description": "DESeq2 差异表达分析...",
  "inputSchema": {
    "type": "object",
    "properties": { ... },
    "required": [ ... ]
  }
}
```

### 工具调用返回格式

`tools/call` 返回 `content` 数组，可能包含：

| content block 类型 | 说明 |
|---|---|
| `text` | JSON summary（工具名、jobDir、输出文件列表、manifest） |
| `text` | CSV 结果预览（前 50 行） |
| `image` | PNG 图片（base64，最多 6 张，每张 ≤5MB） |

### 错误处理

- 工具执行失败：`isError: true` + 错误信息 text block
- 未知工具：`isError: true` + "unknown_tool" 提示
- 脚本超时（>300s）：`isError: true` + 超时提示

## 可用工具列表

### R 插件（17 个）

| 工具 ID | 说明 |
|---------|------|
| `deseq2` | DESeq2 差异表达分析 |
| `go-kegg` | GO/KEGG 富集分析 |
| `gsea` | GSEA 基因集富集分析 |
| `km-survival` | KM 生存分析 |
| `lasso-cox` | LASSO Cox 预后 Signature |
| `bindea-immune` | 免疫浸润评估（ssGSEA） |
| `wgcna` | WGCNA 共表达网络 |
| `complexheatmap` | 复杂热图 |
| `cellchat` | 细胞通讯分析 |
| `seurat-standard` | Seurat 标准流程 |
| `maftools-mutation` | 突变景观图 |
| `ml-feature-select` | ML 特征选择 |
| `ml-classifier` | ML 分类器对比 |
| `rsf-survival` | Random Survival Forest |
| `shap-explain` | SHAP 可解释性 |
| `consensus-cluster` | Consensus Clustering |
| `mo-mofa` | MOFA2 多组学因子分析 |
| `mo-snf` | SNF 相似性网络融合 |

### Python 插件（5 个已实现）

| 工具 ID | 说明 |
|---------|------|
| `spatial-standard` | 空间转录组标准流程 |
| `spatial-svg` | 空间 SVG 可视化 |
| `spatial-deconv` | 空间反卷积 |
| `spatial-lr` | 空间配受体分析 |
| `ml-scvi-annotate` | scVI 单细胞类型注释 |

## 环境要求

- Node.js >= 18
- R >= 4.5（R 插件需要，含 Bioconductor 包）
- Python >= 3.10（Python 插件需要，含 scanpy/scvi 等）
- BioF3 R 容器或本地 R 环境已安装所需包

## 文件结构

```
mcp/
├── server.js        # 标准 MCP stdio server（零依赖，JSON-RPC 2.0）
├── registry.js      # 工具注册表（已有，listTools / callTool）
└── README.md        # 本文档
```

## FAQ

**Q: 为什么不用 `@modelcontextprotocol/sdk`？**
A: 该 SDK 是 ESM 模块，与 BioF3 的 CommonJS 项目冲突。手写 JSON-RPC 2.0 over stdio 仅 462 行，零依赖，更稳定。

**Q: MCP 直连时重操作需要审批吗？**
A: 不需要。审批机制是 web Copilot UX 专属（防止用户误触耗时操作）。MCP 直连场景下用户显式调用工具，无需拦截。

**Q: 图片怎么返回？**
A: PNG 结果自动转为 `image` content block（base64），最多 6 张，每张 ≤5MB。超出限制的图片只列出文件路径，不内嵌。

**Q: 支持远程连接吗？**
A: v1 仅支持 stdio（本地）。v2 计划加 HTTP/SSE 传输层，支持远程 agent 连接。

**Q: 如何添加新工具？**
A: 使用脚手架：`./scripts/scaffold-plugin.sh <id> --title "标题"`，详见插件开发规范。
