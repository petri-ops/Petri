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
    `- 可视化输出目录（唯一允许的写入位置，绝对路径）：${outputRoot}`,
    '- 流程：先用文件写入工具把 fragment 写入该目录（文件名小写字母数字连字符 .html），',
    '  再在回复正文中输出指令：::visualize{"path":"<该文件绝对路径>","title":"可选标题"}',
    '- fragment 约束：只写 HTML 片段（禁 doctype/html/head/body 标签）；字面换行书写、写完读回检查；',
    '  禁 fetch/XHR/WebSocket；单文件 ≤1MB；主题只用 CSS 变量。',
    '- 完整写作规范见技能 visualize（skill_discover/skill_get 可取）。',
  ].join('\n');
}

module.exports = { buildGenUiOutputRootBlock, CONVERSATION_ID_PATTERN };
