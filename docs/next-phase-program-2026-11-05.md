---
capability: next-phase-program-2026-11-05
status: reference
goal: 把 2026-11-04 全面重评的结论转成一套「照着就能干、不会跑偏」的逐包开发计划：固定工作模式契约、七个串行工作包的依赖与验收、每包开工/收口的命令级检查单、防跑偏红线与进度台账，使后续每个会话只需读取本总纲与当前包计划即可开工。
acceptance:
  - 七个包各有独立标准计划（front-matter + 范围/非范围/验收/门禁/依赖风险/完成语义），状态统一 planned，编号连续不冲突。
  - 机器可读索引 acceptance/program-2026-11-05/index.json 可被后续会话直接读取，含包序、依赖、验收、touchSurface、sharedBaselines、DoD。
  - 总纲含「工作模式契约」「逐包开工/收口检查单」「防跑偏红线」「进度台账」四件，且每包开工前复核门与收口清单是命令级、可直接复制执行。
  - 零产品代码改动；docs:check / docs:reconcile / closeout 全绿。
reopen: G1+ 项（真实 Provider 矩阵、生态市场、i18n、hooks、签名公证分发）；新增功能域；已取消四项（xlsx 预览 / 科研确认流 / IDE 档位 / BLOCK-347）不复活。
---

# 下一阶段更新计划总纲（2026-11-05）

- 登记状态：**reference（常驻参照总纲）**；下辖 7 个工作包均为 **planned**，逐包发令开工
- 依据：`docs/Petri-Desktop-Evaluation-Report-2026-11-04.md`（工程成熟度 A- / 产品兑现度 C+）
- 用户发令原话：「我希望你按照我们的工作模式做个全方位的更新计划，后面就是逐个开发，所有计划一定要尽可能的标准详细，后续干活的时候就不会跑偏了」
- 阶段边界：**G0 开发期常态 · 不外推 packaged / Provider / GA**；`packaged 回归` 仅指本机未签名打包态验收，不宣称对外发布

---

## §1 总目标与判据

**总目标**：把上轮评估点名的四个「价值兑现」短板全部消灭，并让「能力可用」变成机械可复算的事实。

| 短板（2026-10-15 点名） | 本阶段对应包 | 达标判据 |
| --- | --- | --- |
| 过目积压压价值兑现（无任务级验收） | 348 | 8 个跨域任务有实测结果，自主完成率/干预次数可复算 |
| EAR ≈10%（证据未资产化） | 349 + 351 | 13 条实机证据终态化；EAR ≥40% 且可复算 |
| EHD ≈1.0（债新增/清偿持平） | 全部（靠门禁） | 每包收口时矩阵 P1/P2 不新增，且允许净减 |
| 垂直-通用杠杆拖累（货架可见不可用） | 352 | 三货架 100% 有可用性判定，空壳件有处置 |

**完成本阶段 ≠ G1 启动**。354 只产出「出籍就绪度」判据，是否启动 G1 需另行发令。

---

## §2 工作模式契约（照此执行，不得自行变通）

### 2.1 单包串行

- 任意时刻 **active 工作包 ≤1**（`npm run state` 为准）。7 个包按 §3 顺序逐个推进，**不并行**。
- 每个包开工必须有一次显式发令（「BLOCK-3xx 开整」之类）；本总纲**不是**开工授权。
- 当前 registry 中 `G0-LF` 为常驻 active，属既有基线，不占新包槽位。

### 2.2 三段式：立项 → 开工 → 收口

| 段 | 必做 | 产物 |
| --- | --- | --- |
| 立项（本次已完成） | 计划文档 + registry + README + roadmap/backlog + AUDIT-LOG + impact-map 预登记 | 本总纲 + 7 份计划 + 索引 |
| 开工（每包） | 跑 §6.1 开工检查单；registry `planned→active`；AUDIT-LOG 启动登记 | 可复跑的复核笔录 |
| 收口（每包） | 跑 §6.2 收口检查单；registry `active→completed`；canonical 回写 | 当次证据 + 台账回写 |

### 2.3 每包开工前复核门（沿用 BLOCK-346 §2.5，强制）

前序包会改变矩阵输入面，**不得沿用旧清单**：

```bash
node scripts/functional-surface-audit.mjs --check   # 读 vs baseline 三分类
```

- 新增 P1 → **阻断开工**，先修或立票
- 新增 P2 → 分诊：并入当前包或登记新票
- 消失项 → 记录收敛，不重复开票
- 复核确认无回归后 `--write-baseline` 下调存量（棘轮只进不退）

### 2.4 基线纪律（改一个就要带一串）

| 改动面 | 必须同步 |
| --- | --- |
| 新增/改动 `tool-defs/**` | `test/model-surface-baselines.json --update --force` + 理由；`test/block346-tool-defs-assembly.test.mjs` |
| 新增/改动源码文件 | `test/impact-map.json` 规则（否则 `test:changed` fail-closed） |
| 新增导出但无消费 | `test/knip-baseline.json`（优先删死码，不轻易 --update） |
| 改动 `package.json` 门禁 | 评估 Result Studio **P6 源绑定**影响，必要时重打证据 |
| 改动前端 UI | `docs/ui-productization-audit.md` 同步（否则 `ui:audit:check` 红） |
| 改动热点文件 | `acceptance/block-92/size-baseline.json`（code-size 棘轮） |

### 2.5 证据与表述纪律

- **不得把「未跑 / 失败」表述为通过**；每条验收必须附**当次**证据路径。
- 环境不可得时如实登记 `cancelled` + 原因，**不硬造成功**。
- 人眼判据（如「产物可用性」）必须**先写死判据表再跑**，禁止事后调口径。
- 收口笔录统一带「G0 开发期常态 · 不外推 packaged/Provider/GA」。

### 2.6 台账与广播

每包收口必须：`registry → completed`、README 条目状态、`next-steps-roadmap.md` 与 `pending-work-backlog.md` 队列表、AUDIT-LOG 收口行、`docs:reconcile` 0 issues。

---

## §3 包序与依赖图

```
348 通用 agent 任务基准实测  ──┬──> 350 性能基线四条 ──> 353 packaged 回归 ──┐
                              │                                          │
349 13 条实机证据清偿 ────────┴──> 351 证据资产化 (EAR→40%) ─────────────┤
                                                                       ├──> 354 G0→G1 出籍判据
352 扩展生态可用性核对（独立，排在 351 之后以便共用可用性矩阵脚本）──────┘
```

**执行顺序（固定，串行）**：`348 → 349 → 350 → 351 → 352 → 353 → 354`

| 序 | 编号 | 名称 | 优先级 | 体量 | 依赖 |
| --- | --- | --- | --- | --- | --- |
| 1 | **BLOCK-348** | 通用 agent 任务基准实测 | P0 | 1-2 会话 | 无 |
| 2 | **BLOCK-349** | 13 条实机证据清偿 | P0 | 1 会话 | 无 |
| 3 | **BLOCK-350** | 性能基线四条 | P1 | 1 会话 | 348（复用任务脚本作场景） |
| 4 | **BLOCK-351** | 证据资产化 EAR→40% | P1 | 1-2 会话 | 349 / 350 |
| 5 | **BLOCK-352** | 扩展生态可用性核对 | P1 | 1 会话 | 351（复用矩阵脚本范式） |
| 6 | **BLOCK-353** | packaged 回归 | P2 | 1 会话 | 348 / 350 |
| 7 | **BLOCK-354** | G0→G1 出籍判据 | P2 | 0.5 会话 | 前 6 包全部 |

**不并行理由**：348/349 都要动 `acceptance/` 与 impact-map；350/351/353 都要动基线与门禁；352 与 354 依赖前序结论。文件面重叠 + 单包纪律。

---

## §4 七包标准卡片

每包完整计划见独立文档（下表「计划」列）。卡片在此只做索引与跨包对照，**开工以独立计划为准**。

| 编号 | 计划文档 | 一句话目标 | 可度量验收 | 非范围摘要 |
| --- | --- | --- | --- | --- |
| 348 | `docs/block-348-universal-agent-eval-plan.md` | 8 个跨域任务实测通用 agent 自主能力 | 自主完成率 / 干预次数 / 工具选择合理性 / 产物可用性；短板分级 | 不修暴露的缺陷、不引外部 LLM 评测、不做生信垂类 |
| 349 | `docs/block-349-evidence-clearance-plan.md` | 13 条「仅缺实机证据」终态化 | `in_progress` 28→≤15，每条有证据或降级原因 | 不补做未交付 UI 面、不改状态词表 |
| 350 | `docs/block-350-performance-baseline-plan.md` | 四条性能基线可复跑并入棘轮 | 4 条基线有数值 + 负测能判红 | 本包不做性能优化 |
| 351 | `docs/block-351-evidence-assetization-plan.md` | EAR 从 ≈10% 提到 ≥40% | EAR 可复算且 ≥40%，无假探针 | 不靠缩分母达标、不重写历史证据 |
| 352 | `docs/block-352-extension-shelf-audit-plan.md` | 三货架逐件点验，解决「可见不可用」 | 100% 有判定，空壳件有处置 | 不建第三方市场、不做 i18n/hooks |
| 353 | `docs/block-353-packaged-regression-plan.md` | rc.6 后改动在打包态复验 | 打包态与 dev 一致或差异清单 | 不签名/公证/分发、不补 x64 runtime |
| 354 | `docs/block-354-g0-exit-criteria-plan.md` | 把「G0 何时算完」写成机械判据 | 就绪度可复算（几项达标/未达） | 不启动 G1、不建 Provider/GA 能力 |

**每包计划的固定章节**（缺一不可）：`§1 立项依据` / `§2 范围（逐条）` / `§3 非范围` / `§4 验收（可度量）` / `§5 门禁（机械）` / `§6 依赖·风险·touchSurface·sharedBaselines` / `§7 完成语义 DoD`。

---

## §5 跨包机械门禁（每包收口必跑）

```bash
npm run docs:check          # PASS（登记文档一致）
npm run docs:reconcile      # Validation issues: 0
npm run ui:audit:check      # 有 UI 改动时必须同步台账
npm run quality:surface     # 矩阵棘轮，P1/P2 不得新增
npm run quality:knip:check  # 死码保留面不得新增
npm run quality:types       # 0 错误
npm run quality:lint        # 0 error
npm run closeout            # 14 门全绿（350 起可能扩为 15 门）
```

附加（按改动面触发）：`node scripts/model-surface-baseline.mjs`（工具面变化）、`npm run gate:code-size`（热点文件变化）、`npm run test:changed:list`（新增文件已登记 impact-map）。

**门禁失败处理**：如实登记例外，不得绕过、不得表述为通过。

---

## §6 逐包检查单（命令级，可直接复制）

### 6.1 开工检查单

```bash
cd /Users/zhangdiandian/Documents/1.WorkDir/Petri

# ① 状态恢复
npm run state                                   # 确认 active 槽位为空（G0-LF 常驻除外）
git status --short --branch                     # 确认无在制冲突文件

# ② 复核门（强制）
node scripts/functional-surface-audit.mjs --check
#   → 新增 P1=0 / P2=0 才可继续；否则先修或立票

# ③ 读当前包计划，确认 touchSurface 与实际将改文件一致
cat docs/block-3XX-*-plan.md

# ④ 登记开工：registry planned→active + AUDIT-LOG 启动登记（含用户发令原话）
# ⑤ 复核无回归后收敛基线
node scripts/functional-surface-audit.mjs --write-baseline
```

### 6.2 收口检查单

```bash
# ① 当次证据落盘（不可复用旧笔录）
#    证据目录：acceptance/block-3XX/**

# ② 全门禁
npm run docs:check && npm run docs:reconcile && npm run ui:audit:check
npm run quality:surface && npm run quality:knip:check
npm run quality:types && npm run quality:lint
npm run closeout

# ③ 基线按 2.4 表逐项核对（漏一项即不算收口）
# ④ canonical 回写
#    registry active→completed / README 条目 / roadmap + backlog 队列表 /
#    AUDIT-LOG 收口行 / docs:reconcile 0 issues
# ⑤ 总纲 §8 进度台账填一行
# ⑥ 下一包开工前再跑 6.1 ②（复核门）
```

---

## §7 防跑偏红线（违反即停工）

1. **不扩范围**：计划里没有的，不因「顺手」而做；需要扩范围必须先裁决并写回计划。
2. **不新增功能域**：115 工具已超需求宽度；本阶段只做验证与资产化。
3. **不为清零造无用 UI**：内部端点、诊断端点无用户面需求时白名单化并留理由。
4. **不放宽检测口径凑数**：确需放宽必须有理由 + 留痕 + 负测证明判定仍有效（BLOCK-346 有两次误报教训）。
5. **不硬造成功**：环境不可得如实登记；mock/合成数据必须带 `synthetic` 标记。
6. **不复用旧清单**：每包开工前必须重跑复核门。
7. **不做 G1+ 项**：真实 Provider 矩阵、生态市场、i18n、hooks、签名公证分发一律不碰。
8. **不复活已取消四项**：xlsx 预览、科研确认流、IDE 档位、BLOCK-347。
9. **状态词只用白名单**：`verified / in_progress / cancelled`（UI 台账）、`planned / active / completed / reference`（registry）。
10. **收口必须 canonical 回写**：只改代码不改台账 = 未收口。

---

## §8 进度台账（每包收口后填一行）

| 包 | 发令日 | 开工日 | 收口日 | 关键证据 | 矩阵 P1/P2 | closeout | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 348 | 2026-11-05 | 2026-11-05 | 2026-11-05 | acceptance/block-348/ + docs/block-348-eval-report.md（判据冻结指纹 4b69b2d092bcae22；单测 9/9） | 0/0（复核门） | **PASS（14 门；98cd623c + 9822295c）** | completed——自主完成 6/8、干预 0、工具选择 24/24、产物可用 23/24；**实锤 P1=压缩裁剪破坏 tool 配对**（入池 C-45 待裁决）；T4 环境不可得 |
| 349 | 2026-11-05 | 2026-11-05 | 2026-11-05 | acceptance/block-349/ + docs/block-349-clearance-report.md（探针 5 支 + 清偿测试 4/4） | 0/0（复核门） | **PASS（14 门）** | completed——A 类 13 条全终态=10 verified+3 cancelled（459/471/532 带何时可补）；R 已装新事实；C-46/C-47 入池；口径漂移如实登记 |
| 350 | 2026-11-05 | 2026-11-05 | 2026-11-05 | test/perf-baseline.json + docs/block-350-perf-report.md（负测 6/6） | 0/0（复核门） | 见收口笔录 | completed——三场景基线在案（冷启 546/长会话 20/大树 12ms）；④ packaged skipped 交接 353；quality:perf 入 closeout 15 门 |
| 351 | — | — | — | — | — | — | planned |
| 352 | — | — | — | — | — | — | planned |
| 353 | — | — | — | — | — | — | planned |
| 354 | — | — | — | — | — | — | planned |

---

## §9 明确不做

- 再新增功能域 / 工具族
- 再做代码面审计（346 已机械化，矩阵已入 closeout）
- G1+ 与发布期能力
- 已取消四项的任何形式复活
- 用「评测分数」替代「事实记录」（本阶段先要事实，不要包装）

---

*本总纲为参照文档；开工授权、范围变更、跨包插队均需用户显式发令。*
