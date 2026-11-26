# conv_0d113948-4a2 工具错误分析（owner「conv_0d113948-4a2 你看看咋回事」）

> 性质：只读核真。数据源=dev 实例 `.petri-dev-user-data/data/petri.db`（`copilot_messages.meta_json.toolActivities[]`、`incidents` 表）与 `.petri-dev-user-data/data/llm-transcripts/conv_0d113948-4a2.jsonl`（39 行）。**未改任何会话/消息数据**。
> 对照基准：`acceptance/conv-25806ab0-error-analysis/ERROR-ANALYSIS.md`（14 错误 / 三类根因）。

## §0 口径与总览

| 项 | 值 |
|---|---|
| 会话 | `conv_0d113948-4a2`，标题「新对话」，2026-11-26 14:49:24 → 14:56:33（约 7 分钟） |
| 用户诉求 | 「用图像生成工具生成一张插画：夜晚的城市天台，一个宇航员坐着看星空，橙色点睛，扁平风格」 |
| 模型 | `deepseek-flash`（全 39 条 transcript 同一模型/provider） |
| 消息 | DB 2 条（user + 最终 assistant），`meta_json` 103KB |
| 工具活动 | 33 次：success 30 / error 2 / denied 1（错误率 9.1%，高于上会话 4.2%，但绝对数小） |
| incidents | 3 条（id 15/16/17），与 3 次非 success 活动一一对应 |
| LLM 层错误 | 1 条（vision timeout，14:52:41） |
| vision 调用 | 7 次：1 次 timeout + 6 次成功 |
| 收尾 | `finalization={attempts:1, recovered:true}`、`loopRef.phase=completed`——任务最终完成 |

## §1 错误清单（3 条，逐条证据链）

### E1 · workspace_exec「handler_error」假失败（it7，14:50:53）
- 活动：`call_00_JGjrte1QL1g2gActd9Yt2451`，`status=error`、`terminationReason=handler_error`、41.1ms。
- 命令：`ls /Applications | grep -i -E "chrome|chromium|edge|firefox" ; which rsvg-convert qlmanage 2>/dev/null`
- 结果：`exitCode=1`、`stdout="Google Chrome.app\nrsvg-convert not found\n/usr/bin/qlmanage\n"`、**`stderr` 空**、`timedOut=false`；`executionAdmission.mode=observe / reason=execution_admission_consumed`（与上会话同款治理观察态）。
- 判定：**非真实失败**——`which` 对不存在工具返回 1，前半段探测已拿到 Chrome/qlmanage 有用产出。被 `classifyResult` 统一打成 `handler_error` 并写入 incidents。
- 后续：it8 立刻改用 `command -v rsvg-convert || echo no-rsvg` 重跑，`exitCode=0`——模型自主纠正，无级联。

### E2 · read_image 视觉超时（it10，14:52:41）
- 活动：`call_00_ET_ab5fZKujiaP89lXUNU492790`，`status=error`、`terminationReason=handler_error`、**100,918.5ms**。
- 结果：`{ok:false, error:"vision_failed", message:"看图失败: timeout 请求超时", fileName:"astronaut-rooftop.png"}`。
- 请求体核真：data URL PNG **1400×1000 / 231,780 bytes**；0.5MB 级图，非超大图。
- 后续 6 次 vision 重试：14:52:56（760×543/105KB，12.4s 成功）→ 14:53:21（760×741，20.2s）→ 14:54:41（760×741，11.0s）→ 14:55:12（760×543，28.8s）→ 14:55:59（900×643，30.2s）→ **14:56:20（1400×1000/231.9KB，7.7s 成功）**。
- 判定：**瞬态 provider 超时**——最后同一原尺寸图 7.7s 成功，排除尺寸/格式根因；模型先缩图过渡再回原图。

### E3 · workspace_write 被 sha 门拒绝（it15，14:54:13）
- 活动：`call_00_ZtzFcnKKfzHCbljjEbCt9254`，`status=denied`（非 error）、`terminationReason=overwrite_requires_sha256`、2.4ms。
- 结果：`{ok:false, error:"expected_sha256_required", reason:"overwrite_requires_sha256", message:"完整覆写已有文件前必须先读取文件，并传入 overwrite=true 和 expectedSha256。", messageKey:"agent_tool.overwrite_requires_sha256"}`；目标 `tools/make-astronaut-rooftop.mjs`。
- 后续：it16 同一路径 `workspace_write` **成功**，`resultData.previousSha256=60666730…`、`sha256=e374bd2f…`、`created:false`，13,349→13,937 bytes；未发生覆盖误写。
- 判定：**门正常生效**，但模型跳过读→sha 步骤一次（与上会话 B 类同根因）。

## §2 根因分类（与上会话三类对照）

| 类 | 本会话 | 根因 | 证据链 | 与上会话对照 |
|---|---|---|---|---|
| **新 D** | E1 | 探测命令退出码语义：`which`/`command -v` 对缺失工具返回 1，复合命令整体 exit 1；`classifyResult` 无差别打 `handler_error` | stdout 有产出、stderr 空、it8 换写法即成功 | **新根因**（上会话 C 类 exec 失败是残缺数据级联，本例是假失败） |
| **新 E** | E2 | vision provider 瞬态超时（100s 上限） | 同尺寸原图末次 7.7s 成功；6 次重试全成功 | **新根因**（上会话无 vision 错误） |
| **B（同根因）** | E3 | 模型在长链中跳过 `workspace_read → expectedSha256`，尽管 system prompt 已钉铁律 | 错误文本原样；门拒绝；it16 合规重试 | **同根因**——上会话 B 类 5 次，本会话 1 次；机械门有效、prompt 约束不足 |
| A（配置重试） | 未触发 | 本会话无 `web_*` 调用，`web_access_disabled` 0 次 | incidents 仅 3 条 | 无法据此验证「配置错不重试」机制实效 |
| C（残缺数据级联） | 未复现 | 三次错误后均先验证/换方案再继续，未在坏产物上盲重试 | E1→it8 换命令；E2→先缩图；E3→带 sha 重试 | 上会话 C 类防再犯（分步/中间产物校验）本会话**行为层面生效** |

## §3 已落地防再犯机制的真实效果核实（owner 指定项）

1. **「配置类错误不要重试」引导**（`web-tools.js`，上会话机械落地）：本会话**未触发**——无 web_* 调用，故既不能证明有效也不能证伪。列为 N/A，不冒领效果。
2. **工具契约三铁律**（`system-prompt.js`，上会话落地）：核真 transcript 首轮 system prompt 第 21–24 行**逐字在场**（铁律一 sha、铁律二分步、铁律三配置错不重试）。实效**部分**：
   - 铁律一被违反 1 次（E3）→ prompt-only 对 `deepseek-flash` **不足以稳定约束**；但门兜住且立即合规重试。
   - 铁律二/三对应行为本会话未见违反（无盲重试、无残缺数据级联）。
3. **sha256 fail-closed 门**（既有机械门）：**有效**——E3 被拒、零误覆盖；与上会话结论一致，不放宽。
4. **执行许可治理**（`execution_admission_consumed`）：E1 结果里仍为 `mode=observe`（与上会话同），只观察不强制；模型在 observe 下继续迭代，无自动停轮。

## §4 防再犯落地（本轮机械项，HK-01 红绿先行）

| 缺口 | 改动 | HK-01 |
|---|---|---|
| E1 探测命令假失败 | `core/petri-server/agent-tools/workspace-tools.js::attachShellSemanticsHint` 增 `probeExitHint`：仅当 `exitCode=1 && stdout 非空 && stderr 空 && 命令含 which/command -v` 时给 `|| true` 写法；真实失败不误挂（既有负测守护） | `test/workspace-exec-error-hint.test.mjs` 增 1 条，红→绿 |
| E2 视觉超时无指引 | `core/petri-server/agent-tools/vision-tools.js`：`vision_failed` 且 detail 含 timeout/超时时，message 追加「瞬态可重试；建议先缩小图片或拆局部再读」；错误码 `vision_failed` 不变 | `test/conv-0d113948-guidance.test.mjs` 红2/2→绿2/2 |
| 合计 | — | 两文件 **7/7 绿**（5 条既有 + 2 条新增） |

边界：改的是发往模型的提示文本与结果字段，**不回溯改会话数据、不改门语义、不放宽 sha 门**。

## §5 待 owner 裁决（语义类，出材料不擅动）

1. **prompt 铁律对 `deepseek-flash` 的稳定性**：三铁律逐字在场仍漏 1 次 sha——是否给 `workspace_write` 在工具 schema 层再钉 `expectedSha256` 必填（机械门加严，可能影响新文件创建），还是换更强模型？
2. **vision 超时重试策略**：本会话 6 次重试才恢复（首次 100s）；是否在 `read_image` 层内置「超时后自动缩图一次」的确定性回退，而非依赖模型自觉？
3. **执行许可 `mode=observe` 是否升 enforce**：上会话与本会话均见 `execution_admission_consumed` 后继续迭代；是否进入强制档（会改变默认放行裁决，需产品级决定）。

status: analysis_complete · pending_owner_ruling（3 项语义）；会话数据只读未改。
