# Project Workspace Handoff

## 方向

- 目标：尽可能复刻 Codex 的 workspace UI，优先做“轻、窄、少层级”。
- 当前主线：会话区 + 摘要卡 + 右侧工具抽屉的视觉/交互收口。
- 当前最优先：摘要卡片必须继续对齐 Codex，现状仍明显不够像。

## 已完成

- 顶层跨三栏导航已移除。
- 会话输入框已贴底并向 Codex composer 靠拢。
- 右侧已提供 `结果 / 文件 / 终端 / 浏览器 / 聊天`。
- 右侧空态已改成轻量 launchpad。
- 摘要开关按钮已嵌入会话区顶栏。
- 摘要卡缩放手柄已移到左下角，拖拽逻辑已改为对应方向。
- 会话顶栏已压薄，减少顶部占位。

## 当前状态

- 代码已构建通过：`npm run build:spa`
- 重点交互正在观察：摘要卡左下角 resize 手柄是否顺滑可拖。

## 下一步

- 优先修摘要卡：信息结构、卡片尺寸、折叠态、小按钮位置、拖拽手感都要继续打磨。
- 继续微调会话顶栏高度、留白、文字密度。
- 若缩放仍不够顺手，优先检查 pointer 捕获、命中区和 cursor 方向。
- 继续压右侧抽屉与摘要卡的边框、阴影、间距，保持 Codex-like 轻量感。

## 先看这些文件

- `frontend/src/pages/project-workspace.tsx`
- `frontend/src/pages/project-workspace.module.css`
- `frontend/src/components/copilot/SimpleChat.tsx`
- `frontend/src/components/copilot/simple-chat.css`
- `docs/project-workspace-prompt.md`
