# conv_25806ab0-fa4 工具错误分析（owner msg_2cce0f69e256）

> 性质：只读分析会话数据（未改任何会话/消息）；工具错误清单取自 dev 实例 DB
> `.petri-dev-user-data/data/petri.db` 的 `copilot_messages.meta_json.toolActivities[]` 与 `incidents` 表（两源一致）。

## §0 口径对齐

- DB `incidents` 表与 `toolActivities[status=error]` 均为 **14 条**（owner 口述「8 次」可能是 UI 聚合/时间点观感；本报告覆盖全部 14 条，不挑口径）。
- 会话 18 条消息、332 次工具活动、14 次错误（错误率 4.2%），时间跨度 2026-11-24 02:59 → 11-26 08:11。
- 会话主题：3D 案例检索 → three.js 单页 demo（3D pelican/street）迭代。

## §1 错误清单（14 条，按类）

**A 类 · 联网配置拒绝（5 条，2026-11-24 02:59–03:00）**
| # | 时间 | 工具 | 错误码 | 证据 |
|---|---|---|---|---|
|1-2|02:59:52|web_search ×2|web_access_disabled|`resultData.message=联网能力未开启（默认关）…设置→网络与联网`，duration 1–2ms|
|3-4|03:00:52|web_search ×2|web_access_disabled|同上（owner 在 03:00:50 说「网络开了 你再试试」后**仍失败**）|
|5|03:00:53|web_fetch|web_access_disabled|同上|

**B 类 · 文件写保护 sha 校验（5 条，11-24 03:50 / 11-26 07:53–08:01）**
| # | 时间 | 工具 | 终止原因 | 证据 |
|---|---|---|---|---|
|6|03:50:20|workspace_write|overwrite_requires_sha256|`完整覆写已有文件前必须先读取文件，并传入 overwrite=true 和 expectedSha256`|
|7-8|07:53:59|workspace_replace ×2|replace_requires_sha256|`文本替换前必须先读取文件并传入 expectedSha256`|
|9|07:57:12|workspace_replace|content_conflict|`文件已发生变化，expectedSha256 不匹配`（并发变更校验生效）|
|14|08:01:30|workspace_write|overwrite_requires_sha256|同 #6|

**C 类 · workspace_exec 级联失败（4 条，11-26 07:59:17–29）**
| # | 时间 | 工具 | 错误 | 证据 |
|---|---|---|---|---|
|10|07:59:17|workspace_exec|exit≠0，45.9s|复合命令 `build-street && verify-street > v2.json 2>&1; echo; node -e …`；verify 失败产出残缺 v2.json（`stats.shots=null`）|
|11|07:59:21|workspace_exec|exit=1，103ms|`cat > .petri-agent-tmp/show.cjs <<'EOF'` 写封装脚本失败|
|12|07:59:25|workspace_exec|exit=1，100ms|`node tools/show-report.cjs` → `r.shots.map is not a function`（基于 shots=null）|
|13|07:59:29|workspace_exec|exit=1，100ms|`node -e` 重跑同样读取 → 同类异常；`executionAdmission.mode=observe / reason=execution_admission_consumed`|

## §2 根因分类（一因一类，非单一根因）

1. **A 根因 = 配置状态 + 模型行为（非缺陷）**：联网默认关是设计（工具描述与错误提示均已给开启路径）。owner 03:00:50 说"网络开了"后 03:06 仍出现同类错误 → 需核实设置开关是否即时生效（见待裁决项）。模型在收到明确"配置类"错误后仍重复调用（5 次）。
2. **B 根因 = 模型行为 + 正常机械门**：`expectedSha256` 是防并发误覆写的 fail-closed 门（`workspace-tools.js:598/645`、`reason-codes.js:72-74`），工具描述明确要求先 `workspace_read`。模型在长链迭代中跳过读→校验步骤（4 次），1 次是真实并发变更（content_conflict，门正常生效）。**不应放宽门**。
3. **C 根因 = 模型行为 + 长链命令脆弱性**：第一次 verify 失败后未检查中间产物（shots=null）就连续 3 次在残缺数据上重试；工具描述已提示"封装脚本先单独跑通""长命令用 yield_ms""set -e 陷阱"，模型未遵守。`execution_admission_consumed` 表明执行许可治理已介入。

## §3 防再犯机制（机械门化 vs 产品语义）

| 类 | 机制 | 属性 |
|---|---|---|
|A|错误提示明确「配置类错误、不要重试」+ 引导开启设置/改本地能力|**机械可修（已落地）**|
|A|开关生效时机：owner 开网后仍失败，是否需后端重载？开关状态是否有可见回执？|**产品语义，待 owner 裁决**|
|B|保持 sha256 fail-closed 门（已存在，不放宽）；错误码进 reason-codes 统一模板（已存在）|现状正确，不需要改|
|B|长链中模型漏传 expectedSha256：在工具 schema/description 强化 + 模型侧约束|**产品语义/模型选择，待 owner 裁决**|
|C|长命令失败后中间产物校验提示：在 workspace_exec 错误结果中给「先检查中间产物」指引|可选机械增强（未落地，避免扩大语义）|
|C|强制模型分步执行（先单独跑通脚本再串长链）：提示词/模型行为|**产品语义，待 owner 裁决**|

## §4 已落地（机械项）

- `core/petri-server/agent-tools/web-tools.js`：web_access_disabled 错误 message 改为「配置类错误，不要重试或重复调用 web_*；先告知用户开启设置或改用本地能力」。
- HK-01：`test/tool-error-retry-guidance.test.mjs` 红→绿 2/2（断言提示含"不要重试"、错误码契约不变）。
- 局限：改的是发往模型的错误文本，不替代模型遵循；对已发生会话无回溯修改（只读不改会话数据）。

## §5 待 owner 裁决（产品语义）

1. **联网开关生效时机**：owner 反馈"网络开了"后仍 web_access_disabled——是设置未持久化、需后端重载，还是 UI 与后端状态漂移？（需 owner 授权后另立诊断项）
2. **模型选择/提示词约束**：deepseek-flash 在长链中反复忽略工具描述约束（不传 sha、长链不分步、配置错误重试）——是否换更强模型、或在 system prompt 加"工具错误后先判类再行动"硬约束？
3. **执行治理**：`execution_admission_consumed` 后仍连续 3 次 exec——是否需要在许可消费后自动停止该轮迭代？

status: analysis_complete · pending_owner_ruling（3 项语义裁决）；会话数据只读未改。
