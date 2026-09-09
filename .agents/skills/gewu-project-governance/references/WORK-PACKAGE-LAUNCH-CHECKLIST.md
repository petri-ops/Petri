# 工作包立项 / 启动检查单

> 逐项勾选；任何一项不满足即不具备启动条件（或需用户显式裁决豁免并留痕）。
> canonical 依据：`$gewu-project-governance` SKILL.md §"Start or change a work package"。

## 0. 启动前置（硬门）

- [ ] `npm run state` / `docs/AUDIT-LOG.md`：无 🔴 阻塞项；🟢 项不阻塞本包或已评估
- [ ] `git status`：无未知 WIP（已知 WIP 属其他并行包时，列明其文件面并承诺零触碰）
- [ ] **唯一 active 槽位**：无 active 工作包，或用户显式裁决插队/并行（并行须写明文件面隔离边界）
- [ ] 用户裁决留痕：记录裁决原话（"用户裁决「…」"），无裁决不立项

## 1. Plan ID 与范围

- [ ] 复用既有 Plan ID（本包是其增量）还是新建 ID（独立责任与验收边界）——二选一有据
- [ ] 轻量包可免独立 plan 文件：plan=本 AUDIT-LOG 条目（对标 TEST-INFRA-DEBT 先例），但范围/验收仍须写全
- [ ] 独立 plan 文件包含：范围、**非范围（exclusions）**、依赖、证据位置、验收门禁、完成语义
- [ ] 环境纪律核对：dev 栈启动方式（fnm Node 24 + remote-debugging-port）、后端变更须重启、并行包文件面零触碰

## 2. 登记三件套

- [ ] 新建 governed Markdown 已登记 `docs/DOC-REGISTRY.json`（kind/status/truthDomain 唯一/entrypoint）+ 入口链接
- [ ] 有 DOC-REGISTRY 条目者：`planned → active`，`phase: P0-LAUNCH`
- [ ] AUDIT-LOG 启动登记行（格式见 `AUDIT-LOG-ENTRY-TEMPLATE.md`）：标题带"启动登记（active…）"，正文含裁决来源/范围/红线/非范围
- [ ] 头部"最后更新"行前插本包摘要

## 3. 收口预期预先声明

- [ ] 写明本包验收门禁清单（定向测试/专项门禁/实机断言数），收口时逐项对账
- [ ] 写明预期节奏（一次会话收口 / 分 P 阶段），与用户约定一致
