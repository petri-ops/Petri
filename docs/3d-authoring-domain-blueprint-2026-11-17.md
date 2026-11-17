---
capability: 3d-authoring-domain
status: planned
goal: 把 3D 创造从散落的 Skill/工具点状堆砌，升级为按领域入驻配方（工具包 + Skill 包 + viewer 包，内核零改动）组织的「3D 造物域」——五层架构（意图编排/几何生产/中间表示/呈现/验证证据）+ 统一 Scene IR + 证据自证闭环，大幅提升 Petri 在物理/工程对象上的创造、可信与扩展能力
acceptance:
  - 蓝图含系统架构概览/核心模块划分/数据模型/关键流程/技术选型依据/整体目标六要素
  - 详细计划含分阶段任务/交付物/里程碑时间线/依赖风险/分工/验收测试六要素
  - 明确处理可扩展性/安全性/性能/运维/成本/用户体验/合规性七个方面，逐项落处理方式
  - 全程 G0 开发期纪律：零新增依赖优先、不碰 Result Studio 资格线、不外推 packaged/Provider/GA
  - 本文件=reference+planned 决策/蓝图材料，不启动任何工作包、不改运行时行为、默认行为不变
---

# 3D 造物域开发蓝图与详细开发计划

> **从属声明**：本文件是可演进的**分阶段实施层**，从属于稳定顶层设计 `docs/3d-authoring-domain-charter.md`；在核心目标/范围/原则/约束上以 charter 为准，冲突时以 charter 为最终依据。本文件负责在 charter §1–§4 约束内展开具体阶段任务，不镜像 charter 的冻结项。
> 触发：2026-11-17 用户裁决原话「需要的 基于此前讨论，将现有想法整合为可直接执行的开发蓝图与详细开发计划」。
> 溯源：三轮调研（three-live 架构与 agent 设计、sand3d 确定性建模 DSL、两者 GLB extras 关节咬合）+ 仓库 canonical 探查（artifact-plane-direction.md 领域入驻配方、gen-ui-data-plane-evaluation-2026-11-17.md 演进方法论、agent-competitiveness-program.md 八维、MCP 客户端货架、Gen UI 沙箱、12 内置 Skill）。
> 定位：本文件 = 决策/蓝图材料（kind=reference，status=planned），供团队执行与后续裁决引用；**不启动工作包、不改运行时、不新建第二 canonical 真相**。任何阶段开工需用户发令 + 走 WORK-PACKAGE-LAUNCH-CHECKLIST。

## §0 一句话结论

Petri 缺的不是 3D 技巧，而是 3D 能力的**骨架**。现有方案停留在「几个 Skill + 接个 MCP」的浅层，根因是把 3D 当成工具堆砌而非一个应整体入驻的**造物领域**。本方案以 Petri 已有的「领域 = 工具包 + Skill 包 + viewer 包、内核零改动」配方为骨架，设计五层架构 + 统一 Scene IR + 证据闭环，把 3D 从散点变成一条**可复用、可审计、可替换**的生产线。

---

# 第一部分 · 开发蓝图

## §1 整体目标

| 层级 | 目标 |
|---|---|
| 愿景层 | Petri 成为可在本地完成「确定性创造 → 可审计验证 → 多端呈现 → 领域可扩展」的 3D 造物 agent |
| 能力层 | 3D 作为新对象类型（物理/工程对象）入驻 Petri，成为一等 artifact，进入选择总线/分屏/血缘/agent 引用回路 |
| 工程层 | 内核零改动：换几何 producer、换 renderer、加垂直领域三者均可插拔，任何一项需动内核即判设计证伪 |
| 差异化层 | 借 three-live/sand3d 的形，长 Petri 的魂——本地主权、全链可审计、证据自证、场景锚放大 |

**非目标（exclusions）**：不做通用低代码平台、不做神经文生 3D、不把 3D 引擎引进渲染进程、不预设未来领域组件、不触碰 Result Studio 资格线、不引入 G1+（Provider/公证/GA/远程发布）。

## §2 系统架构概览

```
L5  治理与扩展层（横切）：capability 声明 / 审批分层 / catalog 领域扩展点
        ↑
L4  验证与证据层：validate → render → sim → gym → artifact truth 链（sha256）
        ↑
L3  呈现层：viewer 包入驻 registry / Gen UI 沙箱 + three-live 双形态 / 选择回路
        ↑
L2  中间表示层（Scene IR · 枢纽）：GLB extras → 统一「关节/装配/材质/单位」契约
        ↑
L1  几何生产层：sand3d 本地 runner（确定性 + 双进程 digest）→ 带关节 GLB
        ↑
L0  意图编排层：3d-authoring 领域 Skill（plan-first → 几何 → 验证，渐进披露）
```

**架构原则**：L2 Scene IR 是解耦枢纽——L1 生产、L3/L4 消费同一 IR；上游换建模 DSL、下游换渲染引擎均不动其它层。这是从「技巧堆砌」到「架构」的分水岭。

## §3 核心模块划分

| 层 | 模块 | 职责 | 依托 Petri 现有底座 | 外部组件 |
|---|---|---|---|---|
| L0 | 3d-authoring Skill | 固化 plan-first 工作流、教模型按规范产出、渐进披露 | `skill_discover` / `skill_get`、Skill 契约 | — |
| L1 | geometry runner | 执行确定性建模程序，产出带关节 GLB | `run_cmd` guard-ack 审批链、本地执行 | sand3d（可替换） |
| L2 | Scene IR + 校验器 | 把 GLB extras 归一为领域无关契约 | 手写校验器惯例（零依赖） | —（新建契约） |
| L3 | 3D viewer 包 | 入驻 viewer registry、双形态呈现、接入选择总线 | artifact-plane 三方配方、Gen UI、viewer registry | three-live |
| L4 | verification adapter | 静态诊断/视觉对照/仿真/可动性，证据入 truth 链 | MCP 货架、artifact-truth、BLOCK-196 契约测试 | three-live CLI/MCP |
| L5 | policy + catalog | capability 默认关、审批分层、领域 catalog 扩展点 | 工具策略、gen-ui spec 评估 P4 扩展点 | — |

## §4 数据模型设计

> **§4.1 修正（2026-11-18 · BLOCK-460 立项批）**：本节假设的「新建独立 SceneIR v0」经 BLOCK-459/460 实探修正——仓库已有 SceneSpec v1 单一真相链（`core/petri-server/helpers/scene3d.js` + model3d-scene-store + agent tools/routes/viewer，BLOCK-322/NEXT-04A 遗产），按 charter §3.2「禁止第二套中间表示」（冻结），IR 落点改为 **SceneSpec v1 additive `joints[]` 扩展**（version `scene3d/v1` 不变、向后兼容）；本节 SceneIR JSON 结构降级为字段映射参照（实测依据见 `acceptance/block-459/PROBE-REPORT.md` 与 `scene-ir-v0-draft.md` 的 N1–N8 归一规则），不再是独立契约。§4.3 映射表与 §5.1 流程不变。

### 4.1 Scene IR v0（领域无关中间表示，L2 核心契约）

```
SceneIR {
  schemaVersion: "1.0"
  source: { producer: "sand3d", programDigest: sha256, units: "mm|cm|m" }
  nodes: [
    { id, name, kind: "part|assembly|frame|anchor",
      parent: nodeId?,
      transform: { translation:[x,y,z], rotation:[x,y,z,w], scale:[x,y,z] },  // 米
      mesh?: { glbNodeIndex, materialRef? },
      jointsOut?: [jointId] }
  ]
  joints: [
    { id, name, child: nodeId, parent: nodeId,
      kind: "revolute|prismatic|continuous|free",
      axis: [x,y,z] | "normal",
      range?: [min,max],           // 角度(度) 或 长度(米)
      follows?: jointId, ratio?: number }
  ]
  materials: [ { id, pbr: {...} } ]
  evidence: { programDigest, exportedAt, verifierResults: [resultRef] }
}
```

### 4.2 Artifact 与证据模型（L4，复用既有）

- **3D artifact**：`kind: "scene3d"`，载荷 = GLB 路径 + SceneIR 路径 + digest；按 artifact-plane 对象层入驻，manifest kinds 是唯一权威源。
- **验证证据**：每条 `verifierResult` = `{ tool, verdict, diagnosticsRef, digest, at }`，写入 artifact truth 链，支持 sha256 复现。
- **widgetState**：沿用 `gen_ui_widget_state` 表（≤16KiB），保存 viewer 相机/选中/关节姿态等 UI 状态。

### 4.3 关键映射契约（P0 探针要验证的核心）

| sand3d（GLB extras） | Scene IR | three-live / KHR_interactivity |
|---|---|---|
| `joint.name` | `joints[].name` | 关节标识 |
| `kind`: revolute/prismatic/continuous/free | 同值域 | `hinge` / `slider` / 连续 / 自定义 |
| `axis` / `range` | 同值 | `axis` / `limits` |
| `follows` + `ratio`（丝杠耦合） | 同字段 | 变量绑定 / 表达式 |
| `assembly`/`group` + anchors | nodes 树 + frame/anchor 节点 | `Object3D` 层级 + 不可渲染 frame |
| mm 单位（export 缩放到米） | transform 用米 | three.js 默认世界单位 |

## §5 关键流程说明

### 5.1 主创作流程（纵向流水线）

1. **L0 编排**：用户意图 → Skill 判定场景类型 → 输出 head 目录优先的部件计划（可被用户审阅）。
2. **L1 生产**：LLM 按 sand3d 八规则写程序 → runner 本地执行 → 双进程 digest 一致性校验 → 导出带关节 GLB。
3. **L2 归一**：解析 GLB extras.joints → SceneIR v0 → 手写校验器 fail-closed（无效 → 降级 + 留痕）。
4. **L3 呈现**：SceneIR → 3D viewer 包渲染（Gen UI 沙箱轻交互 / three-live 多端重渲染，按场景选）。
5. **L4 验证**：validate --json → render 四视图 → sim 60Hz → gym reset/step 可动性 → 结果入 truth 链。

### 5.2 三条协同回路（1+1>2）

- **证据回流回路**：L4 验证结果入 truth 链 → 成为可引用 artifact → 经选择总线回 L0 上下文（"继续验证这个铰链"）→ 创造-验证-再创造闭环。
- **双形态互补回路**：同一 IR 两种呈现（沙箱管富交互轻展示、three-live 管原生多端重渲染），按场景自动选，并存非替代。
- **领域放大回路**：L5 catalog 扩展点让机械/BIM/分子结构包各带组件段入驻，能力随包放大，通用主线不收缩。

## §6 技术选型依据

| 选型 | 决定 | 依据 |
|---|---|---|
| 建模内核 = sand3d | 选它而非 CadQuery/原生 bpy 脚本 | 面向 LLM（API 3600 tokens 可入 prompt）、确定性（双进程 digest）、命名式建模、joints in extras 正好喂 Scene IR；Apache-2.0 |
| 渲染/验证 = three-live | 选它而非自研 3D 引擎 | Three.js 为创作语言、多端原生运行时、capability 沙箱、CLI/MCP 验证闭环 + Agent Gym；正好补 Petri 缺的呈现与验证；Apache-2.0 |
| 中间表示 = 自实现 Scene IR | 借形不引包 | 沿 gen-ui spec 评估路径 A「零新依赖 + 手写校验器 + 复用插座」惯例；IR 契约可治理可定制 |
| 领域结构 = 入驻配方 | 复用 artifact-plane 配方 | 「工具包+Skill包+viewer包、内核零改动」是既有 canonical 设计，3D 作为新领域复用而非另起 |
| 呈现 = Gen UI + three-live 双形态 | 并存非替代 | 沙箱安全层已完备（OOPIF/劫持自愈/origin 隔离）；three-live 补多端原生；沿评估 R1 并存纪律 |

### 6.1 依赖变更审查（DEPENDENCY-CHANGE-CHECKLIST 四问）

- **替代方案**：sand3d/three-live 均有明确不可替代能力（确定性几何 DSL / 多端 JIT 验证闭环）；场景 IR 与校验器自研，不引额外包。
- **许可证与维护度**：两者均 Apache-2.0；sand3d 2.1k stars、three-live 428 stars，均有近期提交；传递依赖：sand3d 带 `bpy`（重），three-live CLI 带 `npx` 运行时依赖——**均需用户显式裁决引入**。
- **影响面**：`bpy` 需 Python 3.11/3.13 + Blender，不入前端 bundle；three-live 走外部 MCP server，零前端 bundle 影响；无 native ABI 风险。
- **退出成本**：L1/L3/L4 各以一层 wrapper/adapter 隔离，外部工具可整层替换，不散落直引。
- **结论**：默认「零新增产品依赖」仍成立；两库定位为**外部可选工具**，接入与否是用户裁决点（U-3D-D1），未裁决前不安装、不引包、不改 package.json/pyproject。

## §7 七方面补充考量（用户要求逐项说明）

| 方面 | 处理方式 |
|---|---|
| **可扩展性** | 三个可替换判据：换 producer（符合 IR 的 GLB 即可）/ 换 renderer（viewer 包注册，容器不动）/ 加领域（入驻配方，动内核即证伪）；catalog 扩展点让领域包零内核改动放大能力 |
| **安全性** | ① capability 声明默认全关（three-live 九能力），显式开启；② 建模程序执行走 `run_cmd` guard-ack 审批链，不建第二通道；③ GLB/URL 走 safeMediaUrl/safeAnchorId 白名单（拒绝 `..`/反斜杠/原型键）；④ Scene IR 校验 fail-closed，无效降级留痕；⑤ 本地执行、产物不出本机 |
| **性能** | ① `bpy` 重执行放本地 runner，不占渲染主线程；② 遵守 sandbox quotas（mesh/顶点/纹理/脚本上限）；③ viewer 用 memo 边界（BLOCK-154），新渲染分支纳入同一性能契约；④ widgetState ≤16KiB 有界；⑤ 大 GLB 走分块/懒加载，首帧预算入验收 |
| **运维** | ① 外部工具版本钉扎精确（sand3d 1.6.3、three-live beta），配置登记；② 本地 runner 失败诚实可见、不静默；③ 证据/日志落 acceptance 与 artifact truth 链，可回放；④ webhook/服务端口不新开（three-live 走 MCP stdio） |
| **成本** | ① 本地建模零 token 外的云成本；② three-live AI 编辑若启用走用户自带 Key（有成本计量，P5-a 确认）；③ 验证 CLI 本地执行零调用费；④ 外部工具无订阅费（Apache-2.0 OSS）；⑤ 用量/成本沿用 Petri 既有模型计量，不建第二套 |
| **用户体验** | ① plan-first 部件计划可审阅再执行（P5 人工介入最小化原则）；② 聊天流内 viewer 卡片内嵌，不跳页；③ 验证结果人类可读（四视图 + 诊断 JSON）；④ 主题/CSP 沿 Gen UI 既有透传；⑤ 失败与降级可见可追，不冒充成功 |
| **合规性** | ① 两库 Apache-2.0 与项目兼容，数据集 CC BY 4.0 若用需署名；② 来源/许可在领域包 manifest 标注；③ 不引入客户/伙伴名称/凭据/私有主机（沿 sand3d AGENTS 红线）；④ 生成物不含隐私数据外传；⑤ G0 纪律：不外推 packaged/Provider/GA 资格 |

---

# 第二部分 · 详细开发计划

## §8 分阶段任务拆解与交付物

> 单工作包串行；下表为建议形态，每阶段立项时按 WORK-PACKAGE-LAUNCH-CHECKLIST 走，开工需用户发令。

| 阶段 | 任务拆解 | 交付物 | 体量 |
|---|---|---|---|
| **P0 可行性探针** | ① 装 sand3d 临时隔离环境（不污染全局）；② 导出一个带 revolute/prismatic 关节的 GLB；③ 解析 `nodes[i].extras` 真实 schema；④ 验证 → `userData.xr.joint` 字段映射；⑤ 定 Scene IR v0 契约 | 探针报告（extras schema 实测 + 映射可行性结论）、Scene IR v0 契约草案、决策记录 | S |
| **P1 领域首包（L0/L1/L2）** | ① 3d-authoring Skill（主 SKILL + references：API/schema/recipes）；② sand3d runner 封装 + guard-ack 审批接线；③ Scene IR 归一器 + 手写校验器（红绿先行）；④ 一个可动装配端到端跑通 | Skill 包、runner adapter、IR 校验器 + 契约测试、acceptance 证据 | M |
| **P2 验证闭环（L4）** | ① three-live MCP 接入货架（逐工具策略）；② validate/render/sim/gym 编排；③ 验证结果入 artifact truth 链；④ sha256 复现用例 | verification adapter、MCP 配置、truth 链证据、复现测试 | M |
| **P3 呈现与扩展（L3/L5）** | ① 3D viewer 包入驻 viewer registry；② Gen UI 沙箱 + three-live 双形态选择；③ 选择总线接线；④ catalog 领域扩展点契约 + 一个领域 viewer 验证零内核改动 | viewer 包、双形态接线、扩展点契约、配方复验证据 | M |
| **P4 收口** | 实机腿 + 台账回写 + closeout | 实机证据、UI 台账/registry 回写、收口笔录 | S |

## §9 里程碑与时间线

| 里程碑 | 对应阶段 | 出口判据 | 时间（相对） |
|---|---|---|---|
| M0 映射可行 | P0 | extras schema 实测 + 字段映射契约红绿 | 第 1 周 |
| M1 最小闭环 | P1 | 一个可动装配：程序→GLB→IR→渲染，确定性 digest 一致 | 第 2–3 周 |
| M2 证据闭环 | P2 | 一份产物的验证结果 sha256 可复现 | 第 4–5 周 |
| M3 领域可扩展 | P3 | 加一个领域 viewer 不动内核（配方复验通过） | 第 6–7 周 |
| M4 收口 | P4 | closeout 门禁全绿 + 实机证据在册 | 第 8 周 |

> 时间为相对估算（1–2 周波次/阶段的中型包节奏），非承诺日历；实际以用户发令与单工作包串行槽位为准。

## §10 依赖关系与风险点

| # | 依赖/风险 | 性质 | 处置 |
|---|---|---|---|
| D1 | sand3d `bpy` 重依赖（Python 3.11/3.13 + Blender） | 用户裁决项 | U-3D-D1：接入前显式裁决；临时隔离安装；不入前端 bundle |
| D2 | three-live 外部 MCP 工具引入 | 用户裁决项 | U-3D-D2：走依赖检查单四问 + 用户裁决；wrapper 隔离 |
| R1 | GLB extras schema 未公开、导出当前 pose（非 rest） | 技术前提 | P0 实读 extras + 源码核对；首版只导 rest pose，不用 `pose` |
| R2 | `follows/ratio`、`free/continuous` 超出简单关节 | 语义缺口 | 首版只支持 revolute/prismatic，复杂耦合降级 + 留痕 |
| R3 | 双形态并存成本（沙箱 vs spec/three-live） | 架构成本 | 并存非替代，边界写进 P3 plan（沿 gen-ui 评估 R1） |
| R4 | `bpy` 确定性跨平台差异（golden digest 平台相关） | 环境差异 | 以 Linux CI digest 为基准，Win/Mac 差异如实登记 |
| R5 | 范围蔓延成通用 3D 引擎/低代码平台 | 范围风险 | 反目标写进每阶段 plan；任一需动内核即触发 reopen |

## §11 资源与人员分工建议

| 角色 | 职责 | 主要阶段 |
|---|---|---|
| 主 Agent（架构/裁决） | 范围决策、IR 契约终审、跨模块取舍、收口审查 | 全程 |
| 子 Agent A（只读探查） | P0 extras schema 实测、three-live/ sand3d 源码核对 | P0 |
| 子 Agent B（Skill/文档） | 3d-authoring Skill 手册 + references 编写 | P1 |
| 子 Agent C（前端 viewer） | 3D viewer 包 + 双形态接线 + 选择总线（边界清晰可独立验证） | P3 |
| 人（用户） | U-3D-D1/D2 依赖裁决、观感 pending_human_eye 签字、阶段发令 | 关键门 |

> 委派纪律：边界清晰、可独立验证的任务委派；需求含糊、治理裁决、跨模块架构判断由主 Agent 保留。单工作包串行，不并行开新包。

## §12 验收标准与测试策略

### 12.1 验收标准（按层）

| 层 | 验收判据 |
|---|---|
| L1 | 双进程构建同一程序 → mesh digest 一致；head 目录优先八规则遵守 |
| L2 | Scene IR 校验器 fail-closed；无效 GLB 降级 + 留痕；字段映射契约测试绿 |
| L3 | 加一个领域 viewer 不动内核（配方复验）；双形态按场景正确选择；主题/a11y 沿既有门 |
| L4 | validate/render/sim/gym 全链产出诊断；验证结果 sha256 复现；证据入 truth 链 |
| L5 | capability 默认关；审批链无第二通道；领域 catalog 扩展零内核改动 |

### 12.2 测试策略（定向优先）

- **契约测试红绿先行**：每阶段先写 HK-01 风格契约测试（植入必红），再实现转绿。
- **定向 Node/前端测试**：`npm run test:changed`（impact-map 驱动）；前端 `test:files --prefix frontend`。
- **专项门禁**：按阶段挂 `--gate`（如 IR 契约、viewer 配方、truth 链复现）。
- **实机腿**：9223 离屏实例跑通端到端（程序→GLB→IR→渲染→验证），跑完即 kill、不设 `PETRI_TEST_ONSCREEN`。
- **治理门禁**：每包收口跑 closeout（hygiene → docs:check → ui:audit:check → test:changed 等）；观感 `pending_human_eye` 不代签。
- **图例值**：`test:all:workspace` / `npm run check` 默认不跑，留 CI；Provider / packaged / GA 矩阵 G0 阶段不跑。

## §13 裁决点与治理定位

| 裁决点 | 内容 | 状态 |
|---|---|---|
| U-3D-D1 | 是否引入 sand3d（`bpy` 重依赖） | pending_user_ruling |
| U-3D-D2 | 是否引入 three-live 外部 MCP 工具 | pending_user_ruling |
| U-3D-D3 | 蓝图是否立项、首包范围（建议 P0–P1）、波次归属 | pending_user_ruling |

- 本文件 = reference + planned 决策/蓝图材料，不启动工作包、不改运行时、默认行为不变。
- 立项后按 artifact-plane-direction「渲染层」语义登记新切片，不重写该文档；不新建第二 canonical 真相。
- 不触碰 Result Studio 资格线（implemented_unverified/experimental、RS-P7 deferred），不以其引擎基础外推自身资格。
- G0 开发期常态 · 不外推 packaged/Provider/GA。

## §14 结论

1. 方向成立：3D 能力的差距是结构性（无骨架/无 IR/无闭环/未用配方/治理缺位），非功能数量，故需系统性方案而非技巧堆砌。
2. 方案以领域入驻配方为骨架、Scene IR 为枢纽、证据闭环为魂，四阶段（P0→P3）从可行到可扩展。
3. 三裁决点（U-3D-D1/D2/D3）待用户裁决；本文件不启动任何工作包，默认行为不变。
