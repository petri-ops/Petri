#!/usr/bin/env node
'use strict';

/**
 * scripts/item88-workbench-demo-seed.mjs — item 88 工作台总览活演示 seed（幂等 + --clean 可清）。
 *
 * 灌什么：
 *   A. wb_* 表：1 演示目标 + 5 子任务（状态机五态 accepted/running/blocked/needs-user/queued，
 *      任务书 spec_json 产物类型/验收标准/计量演示值，blocked 写明依赖①，needs-user 附咨询选项）。
 *      状态变更链经既有 workbench-state-machine.appendWorkbenchEvent 落 task_events（真 API）。
 *      ⚠️ 事实边界：wb_* 目前**无 store 写 API**（wave1 只有 schema+状态机），overview 也尚未读
 *      wb 表（wave2 零新数据）——INSERT 按 DDL 形状写入并如实标注，等 wave3 落 store 后迁移。
 *   B. loop_runs：1 primary + 5 subagent 演示 run（经既有 db.js persistLoopRun/updateLoopRunStatus
 *      真 API），挂专属演示会话——这是「项目总览」tab 目标树/协作图的**实际数据源**
 *      （useSubAgentTasksForConversation ← resume 自 loop_runs running 子代理）。
 *      loop 词汇无 blocked/needs-user/queued 五态投影，可见态=running/done（gap 已如实报 coordinator）。
 *
 * 用法：
 *   node scripts/item88-workbench-demo-seed.mjs                 # 灌入（默认 dev DB）
 *   node scripts/item88-workbench-demo-seed.mjs --db <path>     # 指定 DB（测试/自检用）
 *   node scripts/item88-workbench-demo-seed.mjs --clean         # 一键清除演示数据（只删 demo 前缀行）
 * 安全垫：写入前 db.backup() 到 <db>.bak（WAL 安全）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require_ = createRequire(import.meta.url);
const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const CLEAN = args.includes('--clean');
const DB_PATH = path.resolve(getArg('--db', path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db')));

// ── 演示数据常量（demo_ 前缀 = 清理边界）────────────────────────────
const DEMO = {
  projectId: 'demo_proj_workbench',
  goalId: 'demo_wb_goal_1',
  convTitle: '演示：产品宣传素材包',
  primaryLoop: 'demo_loop_primary',
  tasks: [
    {
      id: 'demo_wb_task_1', status: 'accepted', priority: 10,
      label: '①主视觉海报',
      spec: {
        产物类型: 'PNG 海报 ×3（1080×1920 / 1080×1080 / A4）',
        验收标准: ['三尺寸齐全且出血位正确', '品牌色 token 全部命中', '文案无错别字'],
        计量: { tokenUsed: 18400, costCny: 0.42, durationSec: 96 },
        咨询选项: null,
      },
    },
    {
      id: 'demo_wb_task_2', status: 'running', priority: 20,
      label: '②宣传短视频剪辑',
      spec: {
        产物类型: 'MP4 15s 竖版 ×1 + 封面帧',
        验收标准: ['时长 14–16s', '首帧含主视觉', 'BGM 音量 -14 LUFS'],
        计量: { tokenUsed: 9600, costCny: 0.31, durationSec: 48 },
        咨询选项: null,
      },
    },
    {
      id: 'demo_wb_task_3', status: 'blocked', priority: 30,
      label: '③落地页文案（依赖①主视觉定稿）',
      spec: {
        产物类型: '落地页文案 JSON（标题/三屏正文/CTA）',
        验收标准: ['主视觉定稿后才可开工', 'CTA 唯一且动词开头'],
        计量: { tokenUsed: 0, costCny: 0, durationSec: 0 },
        咨询选项: null,
      },
      dependencies: ['demo_wb_task_1'],
    },
    {
      id: 'demo_wb_task_4', status: 'needs-user', priority: 40,
      label: '④品牌口播稿（等你拍板语气）',
      spec: {
        产物类型: '口播稿 Markdown（60s 版本）',
        验收标准: ['语速 ≈240 字/分钟', '含一次品牌名口播'],
        计量: { tokenUsed: 3200, costCny: 0.08, durationSec: 12 },
        咨询选项: {
          question: '口播语气选哪种？',
          options: ['A. 亲和讲解（默认推荐）', 'B. 专业权威', 'C. 轻快种草'],
        },
      },
    },
    {
      id: 'demo_wb_task_5', status: 'queued', priority: 50,
      label: '⑤素材包打包上传',
      spec: {
        产物类型: 'ZIP 素材包 + 清单 README',
        验收标准: ['包含①②③④全部产物', 'README 列清单与 license'],
        计量: { tokenUsed: 0, costCny: 0, durationSec: 0 },
        咨询选项: null,
      },
    },
  ],
};

const nowIso = () => new Date().toISOString();

function openDb() {
  // 让 require 的 db.js（persistLoopRun 等 store API）解析到同一 DB 文件
  process.env.PETRI_DB_PATH = DB_PATH;
  if (!fs.existsSync(DB_PATH)) {
    console.error(`[demo-seed] DB 不存在：${DB_PATH}`);
    process.exit(3);
  }
  const db = new Database(DB_PATH);
  db.pragma('busy_timeout = 4000');
  return db;
}

async function backup(db) {
  const dest = `${DB_PATH}.bak`;
  try {
    await db.backup(dest);
    console.log(`[demo-seed] 备份完成 → ${dest}`);
  } catch (error) {
    console.error(`[demo-seed] 备份失败，中止（安全垫红线）：${error.message}`);
    process.exit(3);
  }
}

function ensureCompatSchema(db) {
  // tasks/task_events DDL 归 agent-task-store（模块加载期建 + 会 sweep 线上 running 任务
  // ——脚本绝不 require 它）。此处放同形防御 DDL：dev/owner 库已存在则 no-op。
  db.exec(`CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    params TEXT DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'running',
    created_at TEXT NOT NULL,
    finished_at TEXT,
    error TEXT,
    user_id TEXT,
    agent_status TEXT,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TEXT,
    max_retries INTEGER DEFAULT 0
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_task_events_task_seq ON task_events(task_id, seq)');
}

function seedClean(db) {
  ensureCompatSchema(db);
  const wipe = db.transaction(() => {
    db.prepare("DELETE FROM task_events WHERE task_id LIKE 'demo_wb_%' OR task_id = 'demo_agent_task_primary'").run();
    db.prepare("DELETE FROM wb_tasks WHERE id LIKE 'demo_wb_%'").run();
    db.prepare("DELETE FROM wb_goals WHERE id LIKE 'demo_wb_%'").run();
    db.prepare("DELETE FROM loop_runs WHERE loop_run_id LIKE 'demo_loop_%'").run();
    db.prepare("DELETE FROM tasks WHERE id = 'demo_agent_task_primary'").run();
    db.prepare("DELETE FROM copilot_messages WHERE conversation_id IN (SELECT id FROM copilot_conversations WHERE title = ?)").run(DEMO.convTitle);
    db.prepare('DELETE FROM copilot_conversations WHERE title = ?').run(DEMO.convTitle);
    db.prepare('DELETE FROM projects WHERE id = ?').run(DEMO.projectId);
  });
  wipe();
  const remaining = db.prepare("SELECT COUNT(*) c FROM wb_tasks WHERE id LIKE 'demo_wb_%'").get().c;
  console.log(`[demo-seed] --clean 完成：演示数据已清零（残留 wb 演示任务 ${remaining}）。备份仍在 ${DB_PATH}.bak`);
}

function seedInsert(db) {
  const { transitionRun, appendWorkbenchEvent } = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'workbench-state-machine.js'));
  ensureCompatSchema(db);
  const dbStore = require_(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const conversations = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'conversations.js'));
  // appendWorkbenchEvent/轨迹都落 task_events；该表 DDL 归 agent-task-store（模块加载期建，
  // 且其模块加载会 sweep 线上 running 任务——脚本绝不 require 它）。这里放同形防御性 DDL
  // + 唯一索引（dev 库已存在则 no-op）。
  db.exec(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS uq_task_events_task_seq ON task_events(task_id, seq)');

  const PRIMARY_TASK = 'demo_agent_task_primary';
  const USER_ID = 'local-user'; // auth.js LOCAL_USER.id——侧栏按 req.user.id 过滤， attempt1 误用 'local' 被藏

  const nextSeqStmt = db.prepare('SELECT COALESCE(MAX(seq),0) + 1 AS s FROM task_events WHERE task_id = ?');
  const emit = db.transaction((taskId, eventType, payload) => {
    const seq = nextSeqStmt.get(taskId).s;
    db.prepare('INSERT INTO task_events (task_id, seq, event_type, payload, created_at) VALUES (?,?,?,?,?)')
      .run(taskId, seq, eventType, JSON.stringify(payload), nowIso());
    return seq;
  });

  // 阶段1（本连接事务）：项目/会话/聊天消息/wb_*/轨迹事件。loop_runs 走阶段2 store API（独立连接）。
  const insert = db.transaction(() => {
    const nowMs = Date.now();
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(DEMO.projectId, DEMO.convTitle, nowMs, nowMs);

    // 演示会话（幂等：同名即复用）——user_id 必须是 auth LOCAL_USER.id，否则侧栏按用户过滤不可见
    let conv = db.prepare('SELECT id FROM copilot_conversations WHERE title = ?').get(DEMO.convTitle);
    if (!conv) {
      db.prepare('INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run('conv_demo_wb88', USER_ID, DEMO.convTitle, 'active', DEMO.projectId, 1, nowIso(), nowIso());
      conv = { id: 'conv_demo_wb88' };
    }
    const conversationId = conv.id;

    // 重灌幂等：演示事件链重置（事件是纯追加，重跑会翻倍）
    db.prepare("DELETE FROM task_events WHERE task_id = 'demo_agent_task_primary'").run();

    // 轨迹主任务（attempt2 ③）：trace 走 getLatestPrimaryTaskForConversation——
    // tasks 行 params.conversationId 绑会话，task_events 挂该 task id 即入轨迹时间轴。
    // status='done'：running 会被 fetchInFlightPrimaryTasks 捞走 → 聊天区挂「上次运行未正常结束」横幅
    // （attempt2 首验实测）。done 不进在途清单，trace 的 latest-primary 查询不过滤状态——两全。
    db.prepare(`INSERT INTO tasks (id, type, params, status, created_at, finished_at, user_id, agent_status)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET params=excluded.params, status='done', agent_status='done', finished_at=excluded.finished_at`)
      .run(PRIMARY_TASK, 'agent_loop',
        JSON.stringify({ conversationId, goalId: DEMO.goalId, demo: true, title: DEMO.convTitle }),
        'done', nowIso(), nowIso(), USER_ID, 'done');

    // ①任务下发（user 组）
    emit(PRIMARY_TASK, 'input_queued', {
      content: '【演示下发】制作产品宣传素材包：主视觉海报 / 宣传短视频 / 落地页文案 / 品牌口播稿 / 素材打包（五任务编排，演示数据）',
    });
    emit(PRIMARY_TASK, 'run_started', { status: 'started', message: '编排开始：5 个子任务入工作台' });

    // A. wb_* 目标 + 5 任务（schema DDL 形状；wb store API 尚不存在——脚本头注释已声明）
    db.prepare('INSERT INTO wb_goals (id, project_id, description, budget_cny, status, acceptance_json, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(DEMO.goalId, DEMO.projectId, '演示数据，可一键清除——产品宣传素材包（海报/视频/文案/口播/打包）', 12.5, 'active',
        JSON.stringify({ 验收标准: ['五任务全部 delivered 后 accepted', '素材齐全且 README 清单完整'] }), nowIso());

    const chainByStatus = {
      accepted: ['confirm', 'queue', 'start', 'review', 'accept'],
      running: ['confirm', 'queue', 'start'],
      blocked: ['confirm', 'queue', 'start', 'block'],
      'needs-user': ['confirm', 'queue', 'start', 'needs-user'],
      queued: ['confirm', 'queue'],
    };
    for (const task of DEMO.tasks) {
      db.prepare('INSERT INTO wb_tasks (id, goal_id, spec_json, status, worker_task_id, priority, dependencies_json, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET spec_json=excluded.spec_json, status=excluded.status, dependencies_json=excluded.dependencies_json')
        .run(task.id, DEMO.goalId, JSON.stringify(task.spec), task.status, null, task.priority,
          JSON.stringify(task.dependencies || []), nowIso());
      // 状态链经真 API 落 task_events（挂主任务 id → 轨迹时间轴可见；payload 带子任务名）
      const chain = chainByStatus[task.status] || [];
      let state = 'draft';
      for (const event of chain) {
        const step = transitionRun(state, event);
        if (!step.ok) throw new Error(`状态链断：${task.id} ${state}+${event}（${step.error}）`);
        appendWorkbenchEvent({ db, taskId: PRIMARY_TASK, from: state, to: step.state, event, payload: { wbTask: task.label } });
        state = step.state;
      }
      if (state !== task.status) throw new Error(`状态机终态不符：${task.id} 期望 ${task.status} 实际 ${state}`);
      // ②执行过程（text 组，每子任务一条摘要）
      emit(PRIMARY_TASK, 'agent_progress', { content: `${task.label}：状态 ${task.status}（${(task.spec.产物类型 || '').split('（')[0]}）` });
    }

    // ③工具调用样例（tool 组）
    emit(PRIMARY_TASK, 'tool_call', { name: 'workspace_write', args: { path: 'campaign/README.md', created: true } });
    emit(PRIMARY_TASK, 'tool_call', { name: 'workspace_exec', args: { command: 'zip -r campaign/素材包.zip campaign/*' } });
    emit(PRIMARY_TASK, 'tool_call', { name: 'read_image', args: { path: 'campaign/poster-1080x1920.png' } });

    // ④计量（system 组）
    const tokenUsed = DEMO.tasks.reduce((sum, task) => sum + (task.spec.计量?.tokenUsed || 0), 0);
    const costCny = DEMO.tasks.reduce((sum, task) => sum + (task.spec.计量?.costCny || 0), 0);
    emit(PRIMARY_TASK, 'usage', { usage: { prompt_tokens: Math.round(tokenUsed * 0.6), completion_tokens: Math.round(tokenUsed * 0.4), total_cost_cny: costCny } });

    emit(PRIMARY_TASK, 'done', { status: 'done', message: '演示编排收尾：素材包就绪（演示数据）' });

    return { conversationId, PRIMARY_TASK };
  });

  const { conversationId } = insert();

  // 阶段2：loop_runs（真 store API，db.js 连接）——总览树/协作图的实际数据源
  const now = nowIso();
  dbStore.persistLoopRun({
    loopRunId: DEMO.primaryLoop,
    projectId: DEMO.projectId,
    conversationId,
    taskSpecRef: null,
    automationMode: 'demo',
    loopStatus: 'done',
    hash: 'demo-primary-hash',
    isPartial: false,
    createdAt: now,
    updatedAt: now,
    kind: 'primary',
  });
  // 连线构造（attempt2 实测）：投影的边=child.parentTaskId ∈ 快照 taskId 集。
  // resume 快照 parentTaskId=run.parentLoopRunId——故根节点本身也要是一个 running
  // subagent run（parent_loop_run_id=null，task_id 即子任务们的 parent）。
  dbStore.persistLoopRun({
    loopRunId: 'demo_loop_root',
    projectId: DEMO.projectId,
    conversationId,
    taskSpecRef: null,
    automationMode: 'demo',
    loopStatus: 'running',
    hash: 'demo-root-hash',
    isPartial: false,
    createdAt: now,
    updatedAt: now,
    kind: 'subagent',
    parentLoopRunId: null,
    taskId: 'demo_primary_root',
  });
  for (const task of DEMO.tasks) {
    // 5 个子代理全部 running：刷新后经 resume 恢复，总览树/协作图 节点+连线可见。
    // （loop 词汇无 wb 五态投影；wb_tasks 表才承载 accepted/blocked/needs-user/queued 演示态。）
    dbStore.persistLoopRun({
      loopRunId: `demo_loop_${task.id}`,
      projectId: DEMO.projectId,
      conversationId,
      taskSpecRef: null,
      automationMode: 'demo',
      loopStatus: 'running',
      hash: `demo-${task.id}-hash`,
      isPartial: false,
      createdAt: now,
      updatedAt: now,
      kind: 'subagent',
      parentLoopRunId: 'demo_primary_root',
      taskId: `demo_agent_${task.id}`,
    });
  }

  // 阶段3：聊天区可见性（attempt2 ①②）——任务下发 + 执行摘要消息（真 store API，会更新 message_count）。
  // 幂等：仅当演示会话还没有消息时追加（重跑不翻倍）。
  const msgCount = db.prepare('SELECT COUNT(*) c FROM copilot_messages WHERE conversation_id = ?').get(conversationId).c;
  if (msgCount === 0) {
  conversations.appendMessageToConversation(conversationId, 'user',
    '【演示下发】制作产品宣传素材包：主视觉海报 / 宣传短视频 / 落地页文案 / 品牌口播稿 / 素材打包（五任务编排，演示数据可一键清除）',
    { demo: true });
  conversations.appendMessageToConversation(conversationId, 'assistant',
    '编排完成：5 个子任务已入工作台。\n① 主视觉海报 —— accepted\n② 宣传短视频 —— running\n③ 落地页文案 —— blocked（依赖①）\n④ 品牌口播稿 —— needs-user（等你选语气）\n⑤ 素材打包 —— queued',
    { demo: true });
  conversations.appendMessageToConversation(conversationId, 'assistant',
    '计量合计：token ≈31,200 / 成本 ≈¥0.81 / 累计 156s。打开右栏「项目总览」tab 看目标树与协作图（演示数据）。',
    { demo: true });
  }

  console.log(`[demo-seed] 灌入完成。演示会话：${DEMO.convTitle}（id=${conversationId}）`);
}

async function main() {
  const db = openDb();
  try {
    await backup(db);
    if (CLEAN) seedClean(db);
    else seedInsert(db);
  } finally {
    db.close();
  }
}

await main();
