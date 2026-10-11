# visualize — 沙箱可视化（Gen UI）

在聊天回复中产出内嵌沙箱交互页的能力技能（BLOCK-166）。

- **用途**：模型把 HTML fragment 写入会话专属可视化目录（系统提示注入的
  `<workspace>/.petri/gen-ui/<conversationId>/`），回复正文输出
  `::visualize{"path":...}` 指令，客户端渲染为聊天流内嵌独立 origin 沙箱页。
- **规范真值**：`prompts/system.md`（fragment 硬约束：纯片段/字面换行/白名单
  CDN/禁网络 API/≤1MB/CSS 变量主题）。
- **宿主实现**：`src/main/gen-ui/`（scheme/paths/shell/csp/vendor）+
  `frontend/src/components/copilot/gen-ui/`（解析器与卡片）。
- **阶段**：P0 可看（静态渲染）；桥与持久化随 BLOCK-166 P1/P2 开放。
