# BioF3 R-Server 架构说明

> 最后更新: 2026-05-26

## 目录结构

```
/opt/biof3-r-server/
├── server.js              (1486 行) 主入口：Express 装配、auth、admin/upload/task 路由
├── agent-tools/           (2062 行) AI Agent 工具系统
│   ├── index.js           dispatchTool 路由 + re-export
│   ├── tool-defs.js       OpenAI 格式工具定义 (13 tools)
│   ├── learning.js        学习推荐/验证/复习工具
│   ├── query-tools.js     query / read_page / search
│   ├── act-tools.js       action 执行系统 (page check, ack, dispatch)
│   ├── plan-ui-tools.js   plan 管理 + UI 控制 acts
│   └── verify-dispatch.js verify_state 工具
├── helpers/               (2723 行) 纯逻辑模块（无路由）
│   ├── chat-summary.js    对话摘要 (Layer 2)
│   ├── user-facts.js      结构化用户事实 (Layer 3a)
│   ├── memory-vectors.js  向量检索 + DashScope embedding (Layer 3b)
│   ├── memory-privacy.js  隐私统计 + 数据清除
│   ├── site-snapshot.js   用户资源快照（项目/数据集/分析）
│   ├── docs-index.js      站点内容索引缓存
│   ├── conversations.js   多会话 + 自动标题 + 话题切换
│   ├── plans.js           Plan 步骤管理
│   ├── admin-gov.js       全局暂停控制
│   ├── ai-usage.js        AI 调用计量
│   ├── act-tool.js        agent_audit 表 + undo
│   ├── interpret.js       /api/ai/interpret 辅助（marker 查找 + prompt 构建）
│   ├── methods-export.js  Methods 段落 + PDF 报告 + R/Python 脚本导出
│   ├── system-prompt.js   buildSystemPrompt + ERROR_I18N + localizeToolResult
│   ├── llm-client.js      callDeepSeek (agent 版, 带 telemetry)
│   └── runtime.js         并发控制 + embedding 限流 + act registry
├── routes/                (2771 行) Express 路由模块（14 个）
│   ├── index.js           路由注册中心
│   ├── ai-chat.js         POST /api/ai/chat (SSE 流式)
│   ├── ai-agent.js        POST /api/ai/agent (多轮工具调用)
│   ├── ai-conversations.js  会话 CRUD
│   ├── ai-memory.js       facts/summary/memories/vectors
│   ├── ai-report.js       caption/methods/export-report/export-script
│   ├── ai-admin.js        管理员治理
│   ├── ai-plans.js        Plan CRUD
│   ├── ai-misc.js         settings/undo/docs-index/site-snapshot
│   ├── ai-progress.js     学习进度
│   ├── ai-review.js       复习队列
│   ├── analytics.js       页面统计
│   ├── tools.js           分析工具 (DESeq2 等)
│   └── feedback.js        用户反馈通道（匿名 OK + admin review）
├── task-manager.js        (508 行) 任务队列 + 执行引擎
├── task-scripts-gen/      (1240 行) R 脚本生成器（按分析类型）
│   ├── index.js           注册表
│   ├── scrna-standard.js  标准 scRNA-seq
│   ├── recluster.js       重聚类
│   ├── deg.js             差异表达
│   ├── enrichment.js      GO/KEGG 富集
│   ├── annotation.js      细胞注释
│   ├── integration.js     多样本整合
│   ├── trajectory.js      轨迹分析
│   ├── communication.js   细胞通讯
│   ├── cell-cycle.js      细胞周期
│   ├── doublet.js         双细胞检测
│   └── _load-code.js      共享 readRDS 加载代码
├── tool-scripts/          R 分析脚本（DESeq2 等在线工具用）
├── tool-demo-data/        Demo 输入数据
├── tool-demo-results/     Demo 结果文件
├── db.js                  SQLite 数据库 (better-sqlite3)
├── auth.js                JWT 认证
├── cache-manager.js       OSS 缓存管理
├── backup-manager.js      自动备份
├── _archive/              历史 patch 脚本 + 备份
└── biof3.db               SQLite 数据库文件
```

## 服务器架构

```
用户浏览器 (HTTPS)
    ↓
阿里云 ECS (biof3.com, port 22) — "aliyun"
    ├── nginx 容器 (biof3-nginx) — 反代 + 静态站
    │   ├── /opt/biof3-tutorial/current-site/  ← 前端 build 产物
    │   ├── /api/r/* → frp → Dell:3001/api/*
    │   └── /api/py/* → frp → Dell:3002/api/*
    ├── Halo CMS 容器
    └── Waline 评论容器
    ↓ frp 隧道
Dell 计算节点 (biof3.com, port 6022) — "dell"
    ├── Node.js R Server (pm2, port 3001)
    │   └── /opt/biof3-r-server/
    ├── Node.js Py Server (pm2, port 3002)
    │   └── /opt/biof3-py-server/
    ├── R Docker 容器 (omichub_react_backend_1)
    │   └── /app/data → /mnt/storage_16tb/omichub (共享卷)
    ├── /mnt/storage_16tb/omichub/biof3-tool-jobs/  ← 用户分析结果
    └── /etc/biof3.env  ← 环境变量 (OSS_AK, DEEPSEEK_API_KEY 等)
```

### SSH 配置 (~/.ssh/config)
```
Host aliyun    → biof3.com:22   (前端/nginx)
Host dell      → biof3.com:6022 (计算节点)
```

### 关键命令
```bash
# 部署前端
./deploy.sh --site

# 重启后端
ssh dell "set -a && source /etc/biof3.env && set +a && pm2 restart biof3-r-server"

# 推送后端文件
./deploy.sh --push r-server/xxx.js

# 查看日志
ssh dell "pm2 logs biof3-r-server --lines 30"
```

### 环境变量 (/etc/biof3.env on Dell)
- OSS_AK / OSS_SK — 阿里云 OSS
- DEEPSEEK_API_KEY — AI 对话
- DASHSCOPE_API_KEY — 向量 embedding
- JWT_SECRET — 用户认证
- INVITE_CODE — 注册邀请码



1. **模块间通信**：helpers 之间通过 `require` 直接引用；routes 通过 `require('../helpers/xxx')` 引用 helpers
2. **globalThis 桥**：部分 helpers 通过 `globalThis._biof3.xxx` 暴露给 routes（历史遗留，逐步迁移为直接 require）
3. **Express 路由优先级**：`routes/index.js` 在 server.js legacy 路由之前注册（first-match-wins）
4. **环境变量**：从 `/etc/biof3.env` 加载，通过 `set -a && source /etc/biof3.env && set +a` 后启动 pm2
5. **部署**：使用 `deploy.sh --push` 推送文件，自动备份 + 语法检查 + 重启

## 添加新分析工具

参考 `server-patches/tool-scripts/TOOL_DEV_STANDARD.md`，以 DESeq2 为模板。

## 添加新 AI 工具

1. 在 `agent-tools/tool-defs.js` 的 `TOOL_DEFS` 数组添加工具定义
2. 在对应的 `agent-tools/*.js` 文件添加 `tool_xxx` 函数
3. 在 `agent-tools/index.js` 的 `dispatchTool` switch 添加 case
