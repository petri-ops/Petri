/**
 * Route registry — central mount point for all modular API routes.
 * Order matters: registered before legacy server.js endpoints, so
 * Express first-match-wins gives priority to modular versions.
 *
 * 每个路由模块独立 try/catch，一个失败不影响其他路由注册。
 */

module.exports = async function registerRoutes(app) {
  const routes = [
    ['Health', () => {
      const db = require('../db').getDatabase();
      const version = require('../package.json').version;
      app.get('/api/health', (_req, res) => {
        let dbOk = false;
        try {
          dbOk = Boolean(db.prepare('SELECT 1').get());
        } catch {}
        res.json({ status: 'ok', timestamp: new Date().toISOString(), version, db_ok: dbOk });
      });
    }],
    // Web-only 路由已移除（desktop 前端/copilot 不调用）：ai-report、ai-review、
    // analytics、admin-ops、admin-compute、admin-users、observability。
    // G0-RS-P4R baseline capture; self-disables unless PETRI_PERF_PROBE=1.
    ['Perf probe', () => require('./perf-probe')(app)],
    // BLOCK-223 — 退出摘要只读面（运行/排队 tool_jobs、pending 审批、运行中任务、后台进程）
    ['App activity', () => require('./app-activity')(app)],
    // BLOCK-229 — 电脑控制 sidecar 状态/探针（只读；不含控制动作）
    ['Computer use', () => require('./computer-use')(app)],
    // BLOCK-269 — 浏览器连接器 REST 面（与 agent 工具同源执行面 + action-result 回传）
    ['Browser connector', () => require('./browser-connector')(app)],
    ['AI conversations', () => require('./ai-conversations')(app)],
    ['AI memory', () => require('./ai-memory')(app)],
    ['AI admin', () => require('./ai-admin')(app)],
    ['AI plans', () => require('./ai-plans')(app)],
    ['AI misc', () => require('./ai-misc')(app)],
    ['Events bus', () => require('./events-bus')(app)],
    ['AI legacy', () => require('./ai-legacy')(app)],
    ['AI progress', () => require('./ai-progress')(app)],
    ['Data CRUD', () => { app.use('/api/data', require('../api-data')); }],
    ['Files', () => require('./files')(app)],
    ['SSH projects', () => require('./ssh-projects')(app)],
    ['Knowledge', () => require('./knowledge')(app)],
    ['Feature flags', () => require('./feature-flags')(app)],
    // BLOCK-200 P0-1：键位读写面（写侧过 shared-config 注册表守卫，拒则 400+diagnostics）
    ['Keymap', () => require('./keymap')(app)],
    // BLOCK-201 W2：设置全景导出/导入/按区重置（只覆盖注册表 6 族；凭据永不进导出）
    ['Config transfer', () => require('./config-transfer')(app)],
    // BLOCK-202 W3：网络代理与运行时策略（代理需重启生效；审批默认档位/并发深度/工具曝光）
    ['Runtime config', () => require('./runtime-config')(app)],
    // Must precede Harness: harness.js retains the legacy
    // GET /api/loop/:loopRunId catch-all, which would otherwise swallow
    // /runs, /session-summary, /iterations, /recovery, etc.
    ['AI Loop API', () => require('./ai-loop').registerAiLoopRoutes(app)],
    ['Harness', () => require('./harness')(app)],
    ['Tools', () => require('./tools')(app)],
    ['Result Studio', () => require('./result-studio')(app)],
    // NEXT-04A — 3D/Blender 只读能力探测（构建/渲染/导出仍走 agent tools）
    ['Model 3D', () => require('./model3d')(app)],
    ['Feedback', () => require('./feedback')(app)],
    // BLOCK-246 C13：速记板（用户资产旁路表；上限/清洗单源在 shared-backend/scratchpad-store）
    ['Scratchpad', () => require('./scratchpad')(app)],
    // BLOCK-256 Q7：目标 + 定时任务（goal 状态机/预算；schedule runner 复用 POST /api/ai/agent）
    ['Automation', () => require('./automation')(app)],
    // BLOCK-246 C4：逐条回复的赞/踩（模型质量信号；与 feedback 意见箱分表）
    ['Message ratings', () => require('./message-ratings')(app)],
    ['AI chat', () => require('./ai-chat')(app)],
    ['AI agent', () => require('./ai-agent')(app)],
    ['AI settings', () => require('./ai-settings-api').registerAiSettingsRoutes(app)],
    // BLOCK-70：手机远程同步管理面（桌面端本机 REST；移动面本体在 mobile-gateway 独立实例）。
    ['Mobile sync admin', () => require('./mobile-admin')(app)],
    // BLOCK-85：格物联邦协作节点管理面（指挥席侧；对端执行面本体在对端格物的 gateway）。
    ['Federation admin', () => require('./federation-admin')(app)],
    // BLOCK-86 L1：多端用户偏好（主题/字号/强调色服务端化——全端同步）。
    ['User prefs', () => require('./user-prefs')(app)],
    // BLOCK-166 P2：Gen UI widgetState 持久化（D4；桌面侧经 REST 读写——dev 主进程
    // 不进程内开 better-sqlite3，P0 prepare 的 REST 先例同款）。
    ['Gen UI widget state', () => require('./gen-ui')(app)],
    // BLOCK-87 L4：投影页面数据 HTTP 化（Skills 清单 / 已装插件——投影环境替代 IPC）。
    ['Projection data', () => require('./projection-data')(app)],
    // BLOCK-156 P2：MCP 客户端管理面（扩展中心 MCP 货架；连接与 agent 同进程）。
    // 挂载即异步拉起 autoConnect server（fire-and-forget，不阻塞 boot）。
    ['MCP client', () => {
      require('./mcp-client').registerMcpClientRoutes(app);
      void require('../mcp/client-manager').autoConnectConfigured().catch(() => {});
    }],
    // BLOCK-206（W7a）：子智能体 profile 读写面（声明式派发缺省）
    ['Subagent profiles', () => require('./subagent-profiles').registerSubagentProfileRoutes(app)],
    // BLOCK-207（W7b）：项目信任级读写面（accessMode 天花板 + 审计）
    ['Trust policy', () => require('./trust-policy').registerTrustPolicyRoutes(app)],
    // BLOCK-209（W7d）：外部 Agent 配置导入预览（只读、零写入）
    ['External agent import', () => require('./external-import').registerExternalImportRoutes(app)],
    // BLOCK-210（W7e）：留存/归档配置 + 迁移计划预览（不执行搬迁）
    ['Data retention', () => require('./data-retention').registerDataRetentionRoutes(app)],
  ];

  for (const [name, fn] of routes) {
    try {
      await fn();
    } catch (e) {
      console.warn(`[routes] ${name} failed: ${e && e.message}`);
    }
  }
};
