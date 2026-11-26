# petri-pack-create 创作领域包蓝图（正式材料 · 先材料后立项）

> 发令：owner msg_7336be6036e4，战略方向「Petri 后面主要要有创造能力：生图/3D/艺术设计/影视」。
> 性质：**蓝图材料，零代码**。owner 拍板后才创建新仓/写实现。与在飞（打包/队列）只读并行。
> 核真边界：本文架构判断来自兴奋转述+owner 已认可的裁决（dispatch 原文）；P0 通路证据来自当日 logo 生成实测（**本文未直接复现 API 调用**，只引用已认可事实）；bio 包契约/内核现状为本文现读代码证据。

## §1 背景归属论证（双包 + 内核架构）

```
                    ┌──────────────────────────────────────────┐
                    │  Petri 通用 agent 内核（G0 maintained / G1 进行中）
                    │  编排 / 知识 / 工具 / 模型计量 / 可靠性
                    │  ── 领域中性的注册面（四张表+契约校验器）──
                    │  语言表 | 工具表 | 钩子表 | 插件源装载器
                    │  ★新增：生成类工具通用注册面（provider 无关薄层）
                    └───────┬──────────────────────┬───────────────┘
                            │ 契约装载             │ 契约装载
                ┌───────────▼──────────┐   ┌───────▼────────────────┐
                │ petri-pack-bio（科研）│   │ petri-pack-create（创作）│
                │ R/Python 环境         │   │ 生成 provider 凭据/SDK   │
                │ 15 分析插件           │   │ 图像/视频/3D/设计插件     │
                │ 科学校验钩子/演示数据  │   │ 生成→挑选→迭代 产品化      │
                │ pack.json/registry    │   │ pack.json/registry       │
                └──────────────────────┘   └────────────────────────┘
```
- **为什么是领域包而非内核**：生成能力依赖具体 provider（Ark Seedream/Seedance、3D 待选）、凭据、计费、版权策略——全是垂直领域内容；内核只应保留"任何 provider 都能挂上来"的薄注册面。与 bio 包对称：bio 装则生信可用、卸则干净；create 装则创作可用、卸则干净。
- **核真纪律**：bio 包契约图（`docs/block-86-domain-pack-lifecycle-plan.md:43-57`）明确"核心只留四张领域中性注册表 + 零 `r`/`python`/生信/scientific 领域硬编码（BLOCK-83 D7 棘轮）"——create 包必须复制同一纪律：内核生产代码零 `seedream`/`seedance`/`ark`/`create` 硬编码。
- **不新增并行体系**：`core/shared-backend/pack-registry.js` 的 `pack.json` + `plugins/installed.json` + `packs/installed.json` 三件契约（:112/:163/:186）直接复用，create 包照填。

## §2 嵌入架构设计

### 2.1 内核通用生成接口面（provider 无关薄层，仅此一处新增）
- **工具注册**：复用 `core/petri-server/agent-tools/registry.js buildToolRegistry` + MCP `mcp/registry.js listTools/callTool` 现有注册面；新增一类 `generate.*` 工具族（如 `generate.image` / `generate.video` / `generate.model3d`），**签名 provider 无关**：输入=prompt + 可选参考 + 参数字典（尺寸/时长/风格），输出=artifact 描述符（文件路径/sha256/mime/来源元数据）。
- **provider 抽象**：薄接口 `{ id, capabilities, generate(request): ArtifactDescriptor }`；具体 API 调用/凭据/重试/计费全部由 create 包插件实现。内核只做注册、调度、结果归一化、artifact-truth 登记（`core/petri-server/helpers/artifact-truth.js:45-96,391` sha256 实算已存在，直接复用）。
- **注册纪律**：当前已有两个 tool 注册表面（mcp/registry.js 与 agent-tools/registry.js，见第二轮 harness 评估维度 E 缺口）——create 包接入时**只允许经统一投影面注册**，不得新增第三个注册入口（避免漂移加剧）。
- **不做的理由**：内核不内置任何 provider SDK、不存 provider API Key、不写"生成图片/视频/3D"的业务流程——这些是包内容。

### 2.2 展示侧衔接（全部复用既有，零新面板）
| 生成物 | 衔接既有面 | 真源 |
|---|---|---|
| 图像 | Result Studio 产物画布 + 生成文件面板 | `ResultsSurface.tsx:284` / `GeneratedFilesSurface.tsx:187` |
| 视频 | Result Studio（已有 VideoResultViewer）+ 生成文件面板 | `components/workspace-panels/VideoResultViewer` 既有 |
| 3D | 3D 模型面板（SceneSpec/GLB 预览） | `Model3DSurface.tsx:921` 既有 |
| 设计 | SVG 编辑器深化（P3） | 既有 `components/svg-editor/` |
- 右栏审计（`acceptance/right-panel-audit/PANEL-AUDIT.md`）刚确认这些面板均为真实功能、非冗余——不需新增 tab，符合"16 面板不扩张"的克制原则。

### 2.3 领域能力清单（包内插件形态）
- **图像（P0）**：`generate.image` 插件（Seedream provider）+ 参考图上传/风格参数 + 结果入 artifact-truth；生成→挑选→迭代的"多候选并排"交互先在 Result Studio 承接。
- **视频（P1）**：`generate.video` 插件（Seedance 同 Ark 链路），时长/分辨率参数，异步任务态 + 进度。
- **3D（P2）**：`generate.model3d` 插件（provider 待评估），输出 GLB/GLTF → 直接喂既有 3D 面板。
- **设计（P3）**：SVG 编辑器深化（参数化图形/图层/导出），属 P3 而非 P0——与既有编辑器同源、风险低。

### 2.4 owner 强参与原则产品化
- 生成是"对话式迭代"而非"一锤子买卖"：每轮生成返回多候选 + 可反馈"保留/重做/调整"；挑选结果落 artifact-truth 并可在 Result Studio 继续加工。此循环形态由包定义，内核只提供 artifact 与事件通道。

## §2.4 薄包纪律（owner msg_b6d77565f11e 裁决）

owner 关切「领域包很重吗，不想过重」——创作域天然是**薄包**：今日 logo 生成铁证=一个 HTTP POST 出全部能力，零本地模型/零依赖；bio 包的重是科研历史形态（休眠插件/示例数据/本地模型引用），create 包**不复制该形态**。

六条纪律：①零本地模型（生成/编辑全走云端 Ark Seedream/Seedance HTTP）②零重资产（不打包示例图库/预置素材/数据集，示例在线拉取或用户本地提供）③provider 适配器=纯 HTTP+参数映射+产物登记（curl 即完整能力证明）④预设=KB 级小 JSON⑤**体积预算门**：代码+配置<10MB（不含 node_modules/.git/evidence），CI `node scripts/size-budget.cjs` 超限即红⑥休眠插件仅确有离线需求时启用（创作域暂无）。

边界：bio 包现有形态不动（历史包不追溯改）；`pack-registry` 包验收清单可加体积预算作新包通用规范。验收证据 `evidence/` 不计入体积预算。

## §2.5 设计宪法（owner msg_a9c7bc882f84 裁决 · 融入蓝图与 P0）

**第一层 · 展示宪法（格式即插件，通用走内核）**：通用格式（mp4/glTF/图片/SVG）由内核原生 viewer 展示（3D 面板/生成文件面板已承接），领域专属格式才由包注册渲染器（artifactTypes 声明→展示层自动路由）。判例=bio 包 P6「resultSurfaces 退役回 core viewer，放宽验收=假绿」——领域渲染器只用于真领域专属格式，不为通用格式造第二 viewer。

**第二层 · 生成宪法（人是导演，agent 是全部执行者）**：
1. 多候选并排：一次生成 N 候选（P0 `count>1`，当前 1-4），Result Studio 并排对比（今日 logo 六概念流程产品化）；
2. 指向式迭代：owner 点候选+口述方向 → `referenceImagePath` 真图内容 base64 走 image-to-image；**无人手编辑工具概念**——owner 指方向、agent 执行；
3. 规格自证：每候选带 provenance（prompt/model/seed/sha256/reference），可复现可审计可回滚（artifact-truth 同款 sha256）；
4. 验收结构化：owner 结构化要求→agent 自检对比，减少来回。

后续视频/3D/设计子域沿用同一宪法。**P0 新增验收项**：Result Studio 多候选并排可达（与注册/调用/sha256/实机出图并列）。

## §3 P0-P3 分级路线（能力/依赖/成本/验收口径）

| 级 | 能力 | 依赖 | 成本 | 验收口径 |
|---|---|---|---|---|
|**P0 图像生成**|Seedream 文生图/图生图，多候选+迭代；产物入 Result Studio/生成文件|Ark API Key（owner 账号已有）+ 当日 logo 生成已验证通路（dispatch 已认可；本文未直接复现）；内核薄注册面先就位|低（SDK 调用+凭据复用既有 credential-store AES-GCM）；无新基础设施|HK-01：generate.image 注册/调用/artifact sha256 断言；实机生成一张图并落盘可见；卸载包后内核零残留|
|**P1 视频生成**|Seedance 文生视频/图生视频，异步任务态|同 Ark 链路；异步任务模型（复用 tool_jobs 状态机）|中（长任务/超时/成本更高）；需 token 预算与取消路径|异步 job 状态可查、取消有效、产物可播；计费入 ai_usage|
|**P2 3D 生成**|文本/图像→GLB，喂既有 3D 面板|**provider 待评估**（成本/质量/版权三项对比材料）|高（provider 选型未定、可能需外部服务）|选型材料先过 owner；生成 GLB 可在 3D 面板预览|
|**P3 艺术设计工具集**|SVG 编辑器参数化/图层/导出深化|既有 svg-editor 组件；无新 provider|低（纯前端能力深化）|设计产物可编辑/导出、与 artifact-truth 一致|

## §4 治理对称设计（与 bio 包自治边界对齐）

- **归包自治**：provider 选型与凭据、生成参数与提示词模板、版权/内容策略、P0-P3 节奏、包内验收与演示数据、插件清单与 `pack.json`——照 bio 包 `pack.json`/`registry/tool-registry.json`/`plugins/installed.json` 契约自填；包自己的规划/验收不阻塞内核 G1。
- **归内核 G1**：仅"生成类工具通用注册面"（provider 无关签名、artifact 归一化、事件通道）+ 必要的 D7 棘轮（内核零 create 领域硬编码）。内核不为包写业务、不替包排期。
- **对称验收**：bio 包"装则整包可用、卸则除插座外干净移除"（BLOCK-86:12）同样适用于 create：装后 generate.* 可调用、产物可见；卸后注册面空、无残留工具/凭据/面板。
- **不重复评**：本蓝图不重开 G1 六序、不重评 harness 第二轮已列的可扩展性缺口（两 registry 漂移等）——create 接入时遵守其结论（统一投影面），不另造制度。

## §5 风险与开放问题

1. **provider 成本**：图像/视频按张/按秒计费，owner 强参与循环会放大调用量——需包内层预算/确认（与内核成本硬熔断 L3 待裁决边界对齐，不越界改内核）。
2. **3D provider 选型**：P2 未定，需在开项前出"成本/质量/版权/本地可跑性"四项对比材料给 owner；不先假设某家。
3. **版权合规**：生成内容训练数据来源/商用授权/水印标识——属产品语义，需 owner 裁决包内策略；内核不替包背书。
4. **与 G1 主线资源冲突**：create 为新包，不应挤占 G1 六序内核工作；治理对称已保证包自治排期——但 developer 工时若共用，需 owner 明确优先级（开放问题 Q4）。
5. **P0 通路证据边界**：当日 logo 生成实测由兴奋/owner 已认可，本文未直接复现 API 调用；立项前应由包侧自己跑一次可复现的最小调用并留证据。

## §6 owner 裁决点清单

| # | 裁决点 | 建议 | 影响 |
|---|---|---|---|
|1|是否批准 petri-pack-create 立项（第三领域包）？|建议批准（与 bio 对称、内核零领域硬编码）|批准后才有后续；未批准本文仅存档|
|2|P0 是否立即启动（Seedream 图像生成）？|建议启动（通路已验证、成本最低、owner 强参与形态可先跑通）|需批准内核薄注册面动工|
|3|是否立即创建新仓 petri-pack-create？|建议立项后再建（先 blueprint 过目、再建仓，避免先建后改）|新仓命名/归属/权限需 owner 给|
|4|P2 3D provider 选型何时启动材料？|建议 P0 跑通后启动（不阻塞 P0）|影响 3D 能力上线节奏|
|5|版权/内容策略与预算确认阈值？|建议包自治出政策、owner 拍一次标准后自动化|属产品语义、影响生成循环 UX|

status: pending_owner_ruling · 零代码 · 裁决前不建仓不实现。
