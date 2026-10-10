import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// registry 链路（query-tools → db.js）在 require 时即 prepare 语句，
// 不能依赖开发机运行时库：自举一个已迁移的临时 DB（同 agent-workspace-exec-background.test.mjs）。
{
  const Database = require('better-sqlite3');
  const fssync = require('node:fs');
  const os = require('node:os');
  const nodePath = require('node:path');
  const tempDbDir = fssync.mkdtempSync(nodePath.join(os.tmpdir(), 'petri-agent-prompt-db-'));
  const db = new Database(nodePath.join(tempDbDir, 'petri.db'));
  const migrationsDir = nodePath.resolve('src/migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(nodePath.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.PETRI_DB_PATH = nodePath.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try {
      fssync.rmSync(tempDbDir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  });
}
const { buildSystemPrompt } = require('../core/petri-server/helpers/system-prompt.js');
const {
  appendDesktopAgentInstructions,
} = require('../core/petri-server/helpers/desktop-agent-prompt.js');
const { getToolDefs } = require('../core/petri-server/agent-tools/tool-defs.js');

test('desktop prompt rejects legacy identity and automatic recommendation patterns', () => {
  const prompt = appendDesktopAgentInstructions(
    buildSystemPrompt(
      { page: 'desktop-project', projectId: 'project-a' },
      { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-v4-flash' }
    ) +
      '\n\n=== Tool Calling 指南 ===' +
      '\n旧内容：DESeq2 完成后推荐 enrichment 或 gsea，并自称 Petri Copilot。'
  );

  assert.doesNotMatch(prompt, /Petri Copilot/);
  assert.doesNotMatch(prompt, /完成后推荐 enrichment 或 gsea/);
  assert.doesNotMatch(prompt, /FigCode|推荐学习路径/);
  assert.match(prompt, /不要自动生成“推荐下一步”清单/);
  assert.match(prompt, /历史助手消息、摘要或检索记录/);
  assert.match(prompt, /面向用户的正文说明当前判断和接下来要核对什么/);
  assert.match(prompt, /不输出隐藏推理过程/);
});

test('retired learning recommendation tools are not exposed to models', () => {
  const names = getToolDefs().map((entry) => entry.function.name);
  for (const name of [
    'discover_capabilities',
    'act_generic',
    'suggest_next_steps',
    'verify_understanding',
    'suggest_review',
    'record_learning_signal',
  ]) {
    assert.equal(names.includes(name), false, `${name} must remain unavailable`);
  }
});

test('desktop prompt keeps result presentation deterministic and excludes legacy page actions', () => {
  const prompt = appendDesktopAgentInstructions(buildSystemPrompt(
    { page: 'desktop-project', projectId: 'project-a' },
    { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-v4-flash' }
  ));
  assert.match(prompt, /客户端依据成功事件自动打开结果/);
  assert.doesNotMatch(prompt, /discover_capabilities|act_generic|open_result handler/);
});

test('desktop prompt injects platform command guidance (BLOCK-33 P5)', () => {
  const prompt = appendDesktopAgentInstructions(buildSystemPrompt(
    { page: 'desktop-project', projectId: 'project-a' },
    { provider: 'deepseek', providerLabel: 'DeepSeek', model: 'deepseek-v4-flash' }
  ));
  // 环境自省与跨调用不持久
  assert.match(prompt, /编写或执行平台相关命令前先调用 system_info/);
  assert.match(prompt, /cd 与环境变量不跨调用持久/);
  assert.match(prompt, /优先使用 cwd 参数/);
  // Windows 平台指导
  assert.match(prompt, /shell="powershell"/);
  assert.match(prompt, /cmd\.exe 仅作旧式脚本兜底/);
  assert.match(prompt, /posix shell 在 Windows 不可用/);
  // 长任务用 background 工具
  assert.match(prompt, /workspace_exec_background 启动/);
  assert.match(prompt, /process_status 查询存活与日志尾部/);
  assert.match(prompt, /process_stop 停止/);
  assert.match(prompt, /不要用 nohup \/ & 后台符逃避超时管理/);
  // 截断分段读取
  assert.match(prompt, /truncated=true/);
  assert.match(prompt, /head\/tail（或 PowerShell Select-Object）配合 workspace_read 分段读取/);
});
