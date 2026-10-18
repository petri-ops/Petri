---
capability: project-trust-policy
goal: BLOCK-207 = runlist W7b（阶段 4 C-2）＝ **项目/工作区信任级别 + 命名权限档**的最小可用形态：给项目标 `trusted` / `untrusted` / `inherit`，在 agent 循环入口对请求的 `accessMode` 做**只能收紧**的天花板（untrusted ⇒ 禁止写/执行），并把信任变更写进追加式审计。**默认 `inherit` = 零行为变化**（现状最保守的落地方式不是"一上线就把所有项目降级"）。
acceptance:
  - P0 基线：`test/block207-trust-policy.test.mjs` 冻结 `applyTrustCeiling` 的四档 × 三信任级矩阵（untrusted: read→read、plan→plan、workspace-write→read、full→read）与"默认 inherit 不改任何档位"。
  - P1 schema：族 `trust-policy`——`trustPolicy.defaultLevel`（枚举 inherit/trusted/untrusted，默认 inherit）+ 条目 `<item>.{project, level}`。
  - P2 落点：`helpers/trust-policy.js`（`trust-policy.json` 走 `data-paths`）：读宽容/写消毒/`levelForProject`/`applyTrustCeiling`/`resetTrustPolicy`；**信任变更写 `trust-audit.jsonl`（追加式，含 from/to/actor/at）**。
  - P3 接线：`agent-runner` 构造 `accessMode` 处应用天花板——**只收紧、永不放大**；`plan`/`read` 不受影响（信任是"能不能动工作区"的问题，不是"能不能看"）。
  - P4 写面：`GET/PUT /api/trust/policy`（400 + diagnostics）；未知 level 拒绝；变更落审计。
  - P5 收尾：`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES` 接入；closeout 十三门。
  - 完成语义：**不做第二套权限系统**——四档判定、审批链、用户规则层一字不动；信任只是"在进入判定前把请求档位压到天花板以下"。命名权限档 v1 = 三个信任级（inherit/trusted/untrusted），不做任意组合的自定义档。
reopen: 项目级自定义权限组合（accessMode + 工具白黑名单命名档）；信任级别的 UI；跨设备信任同步；按目录（而非项目 id）的匹配规则。
status: completed
---

# BLOCK-207 · 阶段 4 C-2：项目/工作区信任级别

执行序位置=`docs/stage-3-4-execution-runlist.md` 的 **W7b**（W0–W7a 已 completed）。用户发令：2026-10-18「行 冲完 W7b」。

## 0. P0 勘察（实码）

- `accessMode` 的唯一构造点：`core/petri-server/agent-runner.js:779-782`（上下文显式值优先，否则取 `runtime` 族的全局默认）。
- 四档判定在 `agent-tool-policy` / 审批链，**本包不碰**；用户规则层（`agent-user-rules`）独立生效，与信任正交。
- 现在**没有任何项目级信任概念**：同一台机器上，任何项目都按请求档位跑。

## 1. 判定：patch + 新建薄层

信任是"进入判定前的天花板"，不是新的判定器。因此只加：一个注册表族 + 一个落点模块 + 一处在 `accessMode` 构造点应用 `min()` + 一条审计。

## 2. 红线

- **默认 inherit**：不配置 = 零行为变化（"最保守"的落地方式不是默认降级所有人）。
- **只能收紧**：`applyTrustCeiling` 永不返回比请求更宽的档位（单测钉死矩阵）。
- **不动四档判定/审批/用户规则**；不新增依赖；不碰 G1+。

## 3. 落地记录（2026-10-18）

- **P1+P2**：schema 加 `trust-policy` 族（`defaultLevel` + `project`/`level`）⇒ 注册表 **16 族 / 84 键**；`helpers/trust-policy.js`（`trust-policy.json` 走 `data-paths`；`applyTrustCeiling` 纯函数；变更追加 `trust-audit.jsonl`）。
- **P3**：接在 `agent-runner` 的 `accessMode` 构造点（`_applyProjectTrustCeiling`）；**只能收紧**（untrusted: `workspace-write`/`full` → `read`，`read`/`plan` 原样）；信任层故障 **fail-open 回原档位**（它是收紧器不是判定器）。
- **P4**：`GET/PUT /api/trust/policy`（400 + diagnostics）；导入与重置也走同一写函数 ⇒ **actor 分别记 `import` / `reset`**，不留"从文件导入就绕过留痕"的后门。
- **P5**：`config-transfer`/`config:doctor`/漂移门 `NO_UI_FAMILIES` 接入；closeout 十三门 PASS。
- **抓真一处**：`sanitizeItem` 只校验"出现了的字段"，于是 `{project}` 缺 `level` 的半条会被读侧留下 → `levelForProject` 返回 `undefined`。改为读侧要求 `project`+`level` 齐全、写侧对缺 `level` 明确报错（回归测当场抓到）。
- 证据：`test/block207-trust-policy.test.mjs` 6/6（矩阵/默认零变化/优先级/守卫/审计/读宽容）+ 漂移/基线/transfer 21/21 + knip PASS + lint 0 error。
