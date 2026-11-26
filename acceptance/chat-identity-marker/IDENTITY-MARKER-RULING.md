# 会话身份标识轻量方案 · 三形态裁决材料（试用反馈⑦）

> 发令：Orca bb8dddaf msg_0ed29b4c18e0（owner 反馈「会话窗口是否需要头像呢…像是问答」）。
> 性质：**方案材料 + 静态视觉稿，零代码改动**。owner 拍板选形态后才实现；前提=owner 已裁决「维持原 UI 风格、不搞大改版」。观感零代签。

## §0 核码真源（先纠正前提）

- **agent 侧并非"无任何身份标识"**：`SimpleChatMessageRow.tsx:222-226` 已渲染 `.sc-msg-avatar`（用户=`user` 图标，agent=`cpu` 图标），`simple-chat.css:477-499` 定义 26px 圆角方块、agent 用 `--petri-accent-bg` 底 + `--petri-text-secondary` 弱色。
- 真问题=**agent 标识视觉权重过低**（弱色 + 通用 cpu 图标），owner 感知为"问答文档"。因此三形态本质是**强化既有标识**，不是从零新增头像——避免大改版、符合 owner 既定裁决。
- 用户侧现状=accent 实心底 + 白图标（`--petri-on-accent`），明显；agent 侧=弱色底+弱色图标，不明显——两侧权重不对称是感知根源。
- token 真源：`--petri-bg-subtle` / `--petri-accent-bg` / `--petri-text-secondary` / `--petri-border-strong` / `--petri-status-*` 均亮暗双定义（design-charter / custom.css），零新 token。

## §1 三形态对比（每项：视觉稿 / 侵入面 / 暗色）

### 形态 A — 既有 avatar 升级为 Petri 品牌缩略（20-24px）
- 视觉：`visual-direction.html#shape-a`。把 agent 侧 cpu 图标换成 Petri logo 缩略（24px，沿用 `icons/icon.png` 既有资源），底仍 `--petri-accent-bg`、图标改 `--petri-accent`（提一档权重）；用户侧不动。
- 侵入面：**零结构改动**（只换 `<Icon name>` 与两条 CSS 声明）；`SimpleChatMessageRow.tsx:225-226` + `simple-chat.css:495-499`。memo 边界/消息契约零变。
- 暗色：`--petri-accent-bg`/`--petri-accent` 随主题走，无需暗色专判；实测只需 CDP 取色确认。
- 取舍：最贴 owner "是否需要头像"的直觉，但引入品牌图形（需确认 `icons/icon.png` 作为消息行缩略的观感）；视觉权重提升最明显。

### 形态 B — 极小角色字标（"Petri"）+ 状态语义色
- 视觉：`visual-direction.html#shape-b`。agent 头像位改极窄字标（`Petri` 11px sm 档 + 一至两个状态字：思考中/执行工具/完成，用既有 status token 着色），用户侧不动。
- 侵入面：小（avatar 位渲染分支 + 一条 CSS）；状态字若接 `m.loop`/streaming 既有字段则零新 state，若接工具活动需读 `AgentProgress` 既有数据。**不改消息体布局**。
- 暗色：status token 双定义、sm 字号在暗底对比度达标（theme contract 守护）。
- 取舍：身份+状态一并传达、信息量最高；但"字标"比图标占横向空间，长对话里重复出现可能噪。

### 形态 C — 6-8px 状态点（完成态低权重）
- 视觉：`visual-direction.html#shape-c`。agent 左侧 avatar 缩为 6-8px 圆点；运行中随状态变色（status token），完成态回落到中性低权重（`--petri-text-muted`），几乎不占视觉。
- 侵入面：最小（avatar 位尺寸缩小 + 背景/圆角改点状；状态色可先用既有 `m.pending`/`m.loop`）；用户侧不动。
- 暗色：状态点用 status token、完成态 muted 双定义；小圆点在暗底需 CDP 对比度核。
- 取舍：最克制、最贴"维持原 UI 风格"；但身份辨识最弱（只有色点，无 logo/字），可能不够解决 owner "像问答文档"的感知。

## §2 推荐与请 owner 拍板

- **推荐 A**：owner 问的是"是否需要头像"，形态 A 直接回应——把已存在但过淡的 agent 标识升级为品牌缩略，零结构改动、零新资源（`icons/icon.png` 现成）、零新依赖，且用户侧保持现状符合"不搞大改版"。
- 若 owner 更看重"对话感/状态可读"选 B；若更看重"极致克制、最少视觉噪音"选 C。
- **请 owner 回 A/B/C**（或"都不采纳维持现状"）。收到裁决前零实现代码、零 HMR。

## §3 边界与验证

- 红线：克制、低视觉权重、不引入大改版；暗色兼容；零新 token/依赖；不改功能语义与消息契约。
- 视觉稿为静态 HTML（浏览器打开、亮暗并排对照），不是可运行原型、不引入新 runtime。
- owner 拍板后的验证计划：HK-01 红绿（标识渲染断言）+ theme-token-contract + SimpleChat 邻域 + CDP 实机取色/截图 + 观感零代签（owner 过目）。

status: pending_user_ruling（Agent 不代答、不写实现代码）
