/**
 * core/petri-server/helpers/gen-ui-prompt.js
 *
 * BLOCK-166 [模型侧契约] 可视化输出根系统提示块（规格 §3.1/§3.3）。
 * 仅当会话绑定项目 workspace 时注入 <workspace>/.petri/gen-ui/<conversationId>/
 * 绝对路径与 fragment 写作要点；未绑定返回 null（能力诚实缺席，plan §2 非范围）。
 * 完整写作规范由模型侧技能 resources/skills/visualize 承载（skills:check 守护）。
 */

const path = require('path');

const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function buildGenUiOutputRootBlock({ projectId, conversationId }) {
  // BLOCK-174 CP-11 — 可用数据源注入由此函数的调用方（agent-runner）在拿到
  // 系统提示块后追加（本模块保持纯字符串构造、不触 DB）。
  const pid = String(projectId || '').trim();
  const cid = String(conversationId || '').trim();
  if (!pid || !cid || !CONVERSATION_ID_PATTERN.test(cid)) return null;

  let workspacePath = null;
  try {
    const db = require('../db');
    const handle = typeof db.getDatabase === 'function' ? db.getDatabase() : null;
    if (!handle) return null;
    const row = handle.prepare('SELECT workspace_path FROM projects WHERE id = ?').get(pid);
    workspacePath = row && row.workspace_path ? row.workspace_path : null;
  } catch {
    return null; // 查询失败=能力缺席，不阻断主链
  }
  if (!workspacePath || !path.isAbsolute(workspacePath)) return null;

  const outputRoot = path.join(workspacePath, '.petri', 'gen-ui', cid);
  return [
    '=== 可视化输出（Gen UI）===',
    '本会话可产出聊天内嵌沙箱可视化页（HTML fragment）。',
    '- 优先级（高于本节其余全部约束）：用户明确要求「完整的单文件 HTML / 可直接双击打开 / 独立交付」',
    '  时，以用户要求为准——写完整 HTML（含 doctype/html/head/body）到 workspace 普通路径交付，',
    '  不要降级成 fragment，也不要输出 ::visualize 指令。',
    `- 可视化输出目录（聊天内嵌沙箱的唯一写入位置，绝对路径；仅在上方「完整文件」例外之外适用）：${outputRoot}`,
    '- 流程：先用文件写入工具把 fragment 写入该目录（文件名小写字母数字连字符 .html），',
    '  再在回复正文中输出指令：::visualize{"path":"<该文件绝对路径>","title":"可选标题"}',
    '- fragment 约束（仅聊天内嵌场景）：只写 HTML 片段（禁 doctype/html/head/body 标签）；',
    '  字面换行书写、写完读回检查；禁 fetch/XHR/WebSocket；单文件 ≤1MB；主题优先 CSS 变量。',
    '- 文件名/主题/尺寸等默认约定属可覆盖项：用户显式给出命名、品牌色或固定尺寸时按用户要求写。',
    '- 完整写作规范见技能 visualize（skill_discover/skill_get 可取）。',
  ].join('\n');
}

module.exports = { buildGenUiOutputRootBlock, CONVERSATION_ID_PATTERN };
