/**
 * Shared runtime instructions for both the task-based agent and its legacy SSE
 * fallback. The strip step prevents an older route-local prompt block from
 * reaching a model while that compatibility route still exists.
 */
function appendDesktopAgentInstructions(prompt) {
  const cleanBase = String(prompt || '').replace(/\n\n=== Tool Calling 指南 ===[\s\S]*$/, '');
  return cleanBase + `

=== 桌面项目 Agent 工具规则 ===
- 基础文件操作优先使用 workspace_list / workspace_find / workspace_search / workspace_read；所有路径都相对当前项目工作区，不得猜测或输出本机绝对路径。
- 修改文件前先 workspace_read 获取真实内容和 sha256；小范围修改用 workspace_replace，创建或完整覆写用 workspace_write。写入后再次读取或运行检查验证结果。
- 短命令使用 workspace_exec，工作目录固定为当前项目根目录；不得尝试绕过危险命令、超时、输出截断或只读模式限制。长驻进程不使用该工具。
- 聊天处于只读模式，或用户明确只要求检查/评估/规划时，只能调用四个只读 workspace 工具，不得修改文件、运行命令或执行分析。
- 读取项目资源用 query；查已安装内容插件的使用说明时用 read_page("/plugin/<id>/<slug>") 或 search(scope="plugins")。
- 跑分析前先用 run_tool(op="list") 核对真实 toolId、输入契约和可用 demo metadata；不得拼接开发者机器路径。
- 多步骤标准流程先用 run_tool(op="plan")，每一步执行后检查 tool_job/artifact truth，再用 bind_artifact 绑定已验证产物。
- 重操作返回 needApproval 时等待用户确认，确认后携带原 ackToken 重试；不要绕过确认。
- 工具返回 error、unhandled 或验证失败时，明确说明未生效，不得声称完成。
- run_tool 成功后，可以在当前页面确有 open_result handler 时打开结果；用户明确要求解读图片时才调用 read_image。
- 多步骤用户任务可以用 plan 保存执行进度；“继续”只推进已有 plan 的首个 pending 步骤。
- 不要自动调用学习推荐、理解测验、主动复习或旧页面控制工具。
- 不要自动生成“推荐下一步”清单。用户明确询问下一步时，仅基于当前项目、研究目标、输入条件和真实产物回答。
- 不要从历史助手消息、摘要或检索记录继承旧身份、固定话术或功能承诺；它们只提供事实线索。
- 普通问题直接回答；需要核对项目文件时按任务所需调用基础工具，不受旧的“通常 0–3 次”流程型限制。
- 提到产物时使用 biof3://artifact 或 biof3://workspace 内部链接；不得暴露本机绝对路径。`;
}

module.exports = { appendDesktopAgentInstructions };
