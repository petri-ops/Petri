---
capability: block462-3d-p2-verification
status: active
goal: 3D 造物域 P2 验证闭环（BLOCK-462，L4）——three-live 外部 MCP/CLI 经隔离 sidecar 接入（B-2 裁决：外部工具 + adapter 隔离、capability 默认关、零产品依赖），verification adapter 编排 validate/render/sim 消费 SceneSpec(+joints) 产物，验证结果入 artifact truth 链（sha256 可复现）
acceptance:
  - HK-01 红绿先行：verification adapter 契约测试先红后绿（诊断 JSON 形状/exit 语义/失败诚实）
  - three-live 隔离安装（仓库外或 sidecar 自管目录，零产品 manifest 改动）；真实 CLI/MCP 工具面只读实测在册
  - MCP 货架登记（逐工具策略、capability 默认关、显式开启）或如实降级登记
  - validate/render 编排产诊断 JSON + 渲染证据；sim/gym 若外部条件不足则 external-blocked 如实降级
  - 验证结果写入 truth 链（verifierResults{tool,verdict,diagnosticsRef,digest,at}）+ sha256 复现用例（双进程 digest 一致）
---

# BLOCK-462 · 3D P2 验证闭环（L4）（active / P2-LAUNCH）

> **发令**：用户 2026-11-18「好的 按照你的建议来进行」（= Jev 单一建议 3D P2 验证闭环获发令；B-2 three-live 裁决 2026-11-18 已在册：引入但仅外部 MCP + adapter 隔离，capability 默认关）。
> **从属**：`docs/3d-authoring-domain-charter.md`（§1.4 L4 验证证据层 / §3.3 fail-closed）→ 蓝图 §8 P2 任务卡 → 本 plan。
> **上游**：BLOCK-459 探针（sand3d GLB 产物 + fingerprint）+ BLOCK-460（SceneSpec v1 joints + scene3d-import）。

## 0. 三方工具核实结论（2026-11-18 只读）

- **three-live npm VERIFIED**：v1.4.0、Apache-2.0、deps: none、13 versions、bin=`three-live`/`three-live-cli`/`three-live-mcp`、6.2MB（keywords: webxr/glb/usdz/mcp/cad/csg 与裁决材料一致）。
- 与裁决材料差异对账：逐工具清单/能力沙箱细节在装后只读实测登记（UNVERIFIED→VERIFIED 逐项留痕）。

## 1. 范围（scope）

1. **隔离安装**：sidecar 自管目录（沿 BLOCK-460 sand3d-runner 模式：`sidecars/three-live-runner/` + bootstrap 子命令，npm 隔离 prefix 安装 pin three-live@1.4.0；零产品 package.json 改动、零全局污染）。
2. **工具面实测**：`three-live --help` / `three-live-cli` / `three-live-mcp` 只读实测（工具清单/退出码/输出契约），与裁决材料九工具逐项对账，差异如实登记。
3. **MCP 货架接入**：若 three-live-mcp 为标准 stdio MCP server → 按既有 MCP 配置面登记（外部 server + 逐工具 mcp-tool-policy，**默认全关**、显式开启；不建第二通道）；若形态不符 → adapter 走 CLI 直调（run_cmd guard-ack 链内），MCP 接入如实降级登记。
4. **verification adapter（L4 核心）**：`sidecars/three-live-runner/verify.mjs`（或等价）——输入 BLOCK-459/460 产物（GLB + SceneSpec 文档），编排 validate → render（证据帧/视图）→ sim（视外部条件）；产诊断 JSON `{tool, verdict, diagnostics, digest, at}`，失败诚实（exit≠0 + 可读诊断）。
5. **truth 链接入**：verifierResults 追加进 SceneSpec `metadata.provenance` 或按 artifact-truth 既有惯例登记（不建第二真相）；sha256 复现用例 = 同一 GLB 两次验证 → digest 一致（契约测试钉住）。
6. **证据落盘**：acceptance/block462/（端到端诊断 JSON + 渲染产物 sha256 + 复现记录）。

## 2. 非范围（exclusions）

- 3D viewer 包入驻 viewer registry / 双形态呈现 / 选择总线（=P3 另包）；
- Agent Gym 训练闭环（若外部条件不足如实降级；核心验证范式自研抽象按 B-2 边界）；
- capability 显式开启的 UI 面（P5-a 确认属后续）；产品 MCP 默认配置变更（登记为「可接入、默认关」）；
- 任何前端渲染进程内 3D 引擎（charter §2.2 排除项）；G1+。

## 3. 验收门禁与证据

- **G1 红绿**：verification adapter 契约测试（valid GLB → verdict=pass + digest；损坏 GLB → verdict=fail + 诊断；exit 语义）先红后绿。
- **G2 工具面对账**：three-live 实测清单 vs 裁决材料九工具，逐项 VERIFIED/UNVERIFIED 登记在册。
- **G3 隔离性**：零产品 manifest 改动（git status 产品面零 diff）；安装目录在 sidecar 自管范围。
- **G4 truth 链**：verifierResults 落盘 + 双进程 sha256 复现一致。
- **G5 治理**：closeout 定向门 + impact-map 登记。

## 4. 完成语义

- completed = G1–G5 全绿或明确 external-blocked 归因 + 六件套回写。观感项（渲染证据帧属素材非 UI 写面，不新增台账条目；如实登记于证据）。
- 失败诚实：three-live Beta 上游漂移（R1 风险）任何一步实测不符 → 降级留痕，不伪造通过。

G0 开发期常态 · 不外推 packaged/Provider/GA。
