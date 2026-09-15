# BLOCK-91-COMPOSER-ATTACH-EXPORT — 聊天附件真实接入 + 拖入图片优化 + ssh 拖出导出

最后更新：2026-09-15

状态：`active（P0-LAUNCH 当日立项即开工；用户裁决「需要立项」三项一并：ssh 拖出导出 / 聊天输入框拖入 / 拖入图片优化）`

计划编号：`BLOCK-91-COMPOSER-ATTACH-EXPORT`

主模块：`P-03 Harness 与 Agent 工作流`（聊天消息面）；协作：`P-01`（工作区文件面，复用 BLOCK-90 fs/upload）

前置：BLOCK-90（completed，fs/upload 分片上传双后端同构）、BLOCK-9.2（附件 UI 骨架）、imageRefs 路径引用机制

## 0. 用户裁决留痕

- 「需要立项 SH 项目的文件拖出导出（需先物化本地副本）、聊天输入框拖入（拖文件直接发给 AI） 以及关于聊天输入框 拖入图片的优化」

## 1. 代码事实（立项侦察）

- **附件状态是孤儿（真实缺陷）**：SimpleChat `attachments`（拖入/粘贴）仅进展示条（行 1621）与移除/预览；发送路径 `sendWithRefs`（行 973）从不读取 → 附件**静默丢弃**，从未进入消息管线。
- **拖入与粘贴行为不一致**：粘贴图片写 `dataUrl`（有内容）；拖入文件只存 `previewUrl`（objectURL，无内容载荷）。
- **imageRefs 是现成接入模式**：图片引用 = 「workspace 相对路径，供模型按路径读图」，发送时 `composeMessageWithImageReferences` 把引用拼进文本。
- **BLOCK-90 `fs/upload`** 可把任意二进制分片写入工作区（local/ssh 双后端同构）→ 附件落盘通道现成。

## 2. 设计裁决

- **D1 附件真实接入（修孤儿缺陷）**：发送前把每个附件上传到工作区 `.chat-attachments/<ts>-<name>`（复用 fs/upload 分片），消息文本追加引用行（`[附件: .chat-attachments/…（类型/大小）]`），模型/agent 按路径读取——与 imageRefs 同构，聊天 API 零改动。
- **D2 拖入图片优化（对齐粘贴）**：拖入图片读取 dataUrl（预览+内容载荷一致），上传后走同一引用机制；非图片二进制同样落盘引用。
- **D3 无项目守卫**：欢迎页（projectId=''）附件发送 → 诚实报错「附件需在项目工作区中使用」（无落盘目标，不做匿名附件区）。
- **D4 上限**：单附件 ≤10MB、单次 ≤8 个，超限诚实报错（防误拖整目录刷屏）。
- **D5 ssh 拖出导出（替代物化副本）**：文件行 DownloadURL 直接填后端文件 HTTP URL（与预览同源 GET），Chromium 落盘时流式下载——无需临时物化，local/ssh 同构；本地项目继续用 file:// 直连（BLOCK-90 已验证）。

## 3. 阶段

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| P0 | 立项登记三件套 + UI-381 预登记 | ✅ |
| P1 | 附件落盘 + 发送引用注入（修孤儿缺陷）+ 拖入图片 dataUrl 对齐 + 上限守卫 | in_progress |
| P2 | ssh/本地文件行 DownloadURL 按 workspaceKind 分派（拖出导出全量） | pending |
| P3 | 实机：CDP 合成断言（引用注入/上传落盘）+ 用户真拖验收 | pending |
| closeout | 五件套 + 四门 | pending |

## 4. 非范围

- 附件在历史消息渲染中的富预览（首版消息内仅文本引用行）。
- 附件自动类型分析（Data Profiler 联动）。
- 移动端（BLOCK-70 投影）附件面。

## 5. 验收门

- 契约/组件测试：附件上传落盘、引用注入、上限守卫、无项目守卫、拖入图片 dataUrl 对齐。
- tsc 0；docs:check + ui:audit:check 绿。
- 实机（dev Electron + CDP）：拖文件进 composer → 发送 → 断言 `.chat-attachments/` 落盘 + 消息含引用行；用户真拖验收。

G0 开发期常态 · 不外推 packaged/Provider/GA。
