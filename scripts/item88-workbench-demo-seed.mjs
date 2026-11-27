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

function seedClean(db) {
  const wipe = db.transaction(() => {
    db.prepare("DELETE FROM task_events WHERE task_id LIKE 'demo_wb_%'").run();
    db.prepare("DELETE FROM wb_tasks WHERE id LIKE 'demo_wb_%'").run();
    db.prepare("DELETE FROM wb_goals WHERE id LIKE 'demo_wb_%'").run();
    db.prepare("DELETE FROM loop_runs WHERE loop_run_id LIKE 'demo_loop_%'").run();
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
  // appendWorkbenchEvent 落 task_events；该表 DDL 归 agent-task-store（模块加载期建），
  // 脚本上下文不 require 整个 store——这里放同形防御性 DDL（dev 库已存在则 no-op）。
  db.exec(`CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const dbStore = require_(path.join(ROOT, 'core', 'petri-server', 'db.js'));
  const conversations = require_(path.join(ROOT, 'core', 'petri-server', 'helpers', 'conversations.js'));

  // 阶段1（本连接事务）：wb_* / 项目 / 会话；阶段2（db.js 连接）：loop store API。
  // 不把 store API 嵌进本事务——两连接各自持写锁会互锁（WAL 单写者）。
  const insert = db.transaction(() => {
    // 项目（幂等）
    const nowMs = Date.now();
    db.prepare('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(DEMO.projectId, DEMO.convTitle, nowMs, nowMs);

    // 演示会话（幂等：同名即复用）——owner 打开它即可看到总览活形态
    let conv = db.prepare('SELECT id FROM copilot_conversations WHERE title = ?').get(DEMO.convTitle);
    let isNewConv = false;
    if (!conv) {
      const convId = `conv_demo_wb88`;
      db.prepare('INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(convId, 'local', DEMO.convTitle, 'active', DEMO.projectId, 1, nowIso(), nowIso());
      db.prepare('INSERT INTO copilot_messages (id, conversation_id, role, content, ts) VALUES (?,?,?,?,?)')
        .run(`msg_demo_wb88`, convId, 'user', '演示会话：工作台总览灌数据验收（item 88）。演示数据可用 seed 脚本 --clean 一键清除。', nowIso());
      conv = { id: convId };
      isNewConv = true;
    }
    const conversationId = conv.id;

    // 重灌幂等：演示事件链重置（appendWorkbenchEvent 是纯追加，重跑会翻倍）
    db.prepare("DELETE FROM task_events WHERE task_id LIKE 'demo_wb_%'").run();

    // A. wb_* 目标 + 5 任务（schema DDL 形状；wb store API 尚不存在——脚本头注释已声明）
    db.prepare('INSERT INTO wb_goals (id, project_id, description, budget_cny, status, acceptance_json, created_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
      .run(DEMO.goalId, DEMO.projectId, '演示数据，可一键清除——产品宣传素材包（海报/视频/文案/口播/打包）', 12.5, 'active',
        JSON.stringify({ 验收标准: ['五任务全部 delivered 后 accepted', '素材齐全且 README 清单完整'] }), nowIso());

    for (const task of DEMO.tasks) {
      db.prepare('INSERT INTO wb_tasks (id, goal_id, spec_json, status, worker_task_id, priority, dependencies_json, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING')
        .run(task.id, DEMO.goalId, JSON.stringify(task.spec), task.status, null, task.priority,
          JSON.stringify(task.dependencies || []), nowIso());
      // 状态链经真 API 落 task_events（append-only 演示轨迹）
      const chain = {
        accepted: ['confirm', 'queue', 'start', 'review', 'accept'],
        running: ['confirm', 'queue', 'start'],
        blocked: ['confirm', 'queue', 'start', 'block'],
        'needs-user': ['confirm', 'queue', 'start', 'needs-user'],
        queued: ['confirm', 'queue'],
      }[task.status] || [];
      let state = 'draft';
      for (const event of chain) {
        const step = transitionRun(state, event);
        if (!step.ok) throw new Error(`状态链断：${task.id} ${state}+${event}（${step.error}）`);
        appendWorkbenchEvent({ db, taskId: task.id, from: state, to: step.state, event });
        state = step.state;
      }
      if (state !== task.status) throw new Error(`状态机终态不符：${task.id} 期望 ${task.status} 实际 ${state}`);
    }

    return conversationId;
  });

  const conversationId = insert();

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
  for (const task of DEMO.tasks) {
    // 5 个子代理全部 running：刷新后经 resume 恢复，总览树/协作图 5 节点 5 连线可见。
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
      // parentLoopRunId 留空：resume 快照 parentTaskId=undefined → 投影走 root 兜底连线
      // （真实链路 primary 不在子代理快照列表，挂 parent 会得 0 连线——镜像现实形态）。
      parentLoopRunId: null,
      taskId: `demo_agent_${task.id}`,
    });
  }
  console.log(`[demo-seed] 灌入完成。演示会话：${DEMO.convTitle}（id=${conversationId}）`);
  const report = {
    wbGoals: db.prepare("SELECT COUNT(*) c FROM wb_goals WHERE id LIKE 'demo_wb_%'").get().c,
    wbTasks: db.prepare("SELECT COUNT(*) c FROM wb_tasks WHERE id LIKE 'demo_wb_%'").get().c,
    wbEvents: db.prepare("SELECT COUNT(*) c FROM task_events WHERE task_id LIKE 'demo_wb_%'").get().c,
    loopRuns: db.prepare("SELECT COUNT(*) c FROM loop_runs WHERE loop_run_id LIKE 'demo_loop_%'").get().c,
    runningSubagents: db.prepare("SELECT COUNT(*) c FROM loop_runs WHERE loop_run_id LIKE 'demo_loop_%' AND kind='subagent' AND loop_status='running'").get().c,
  };
  console.log('[demo-seed] 数据清单：', JSON.stringify(report));
  console.log('[demo-seed] owner 操作：刷新页面 → 打开会话「演示：产品宣传素材包」→ 右栏「项目总览」tab → 目标树 5 节点 + 协作图 5 连线 + 运行态任务卡（loop 词汇可见态=running/done；wb 五态在 wb_tasks 表，等 wave3 接线投影）。');
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
