# conv_0d113948-4a2 完整分析报告（item 79）

> 性质：纯分析文档，零产品代码改动。数据源（均只读）：
> ① dev 实例 `petri.db`（`incidents` / `copilot_messages` / `copilot_conversations`，`file:...?mode=ro`）；
> ② `llm-transcripts/conv_0d113948-4a2.jsonl`（39 行，全量 agent_iter/vision 请求-响应对核真）；
> ③ 仓内真源码 + Git 提交史（防再犯钉子核验）。
> 前序材料：`acceptance/conv-0d113948-4a2/ERROR-ANALYSIS.md`（错误当日分析，commit 75f9c82e9）、`acceptance/conv-25806ab0-error-analysis/ERROR-ANALYSIS.md`（对照基准）。
> 本报告在前序基础上补齐：逐条根因的代码级定位、机械可修/语义类二分，以及**防再犯钉子的事后实证核验**（前序报告写于钉子落地当天，无法包含复发数据）。

## §0 会话口径

| 项 | 值 |
|---|---|
| 会话 | `conv_0d113948-4a2`，2026-11-26 14:49:24 → 14:56:33（约 7 分钟） |
| 用户诉求 | 「用图像生成工具生成一张插画：夜晚的城市天台，一个宇航员坐着看星空，橙色点睛，扁平风格」 |
| 模型 | `deepseek-flash`（openai-compatible，全 39 条同模型） |
| 工具调用 | 33 次：success 30 / error 2 / denied 1（错误率 9.1%） |
| incidents | 3 条（id 15/16/17），与 3 次非 success 一一对应 |
| 收尾 | 任务最终完成（SVG 生成→Inkscape 渲染 PNG→6 轮看图迭代→`::visualize` 交付，finalization recovered） |

## §1 错误清单（逐条：时间 / 错误类型 / 根因）

### E1 · workspace_exec「handler_error」假失败
- **时间**：2026-11-26T14:50:53.226Z（incidents id 15；callId `call_00_JGjrte1QL1g2gActd9Yt2451`）
- **错误类型**：`status=error` / `terminationReason=handler_error`，41.1ms，结果体仅 `{"ok":false}` 无任何错误消息。
- **命令**：`ls /Applications | grep -i -E "chrome|chromium|edge|firefox" ; which rsvg-convert qlmanage 2>/dev/null`
- **根因**（代码级定位）：探测语义误判——`which rsvg-convert`（rsvg-convert 未装）返回 exit 1，使复合命令整体 exit 1；此时 **stdout 已有有用产出（Chrome/qlmanage）、stderr 为空**，属「探测到不存在工具」的正常结果，却被 `tool-execution.js:34` 的统一分类打成 `handler_error` 并写入 incidents。真源码现已留注释与 hint（`workspace-tools.js` `attachShellSemanticsHint` 内 `probeExitHint` 段，注释直接引用本会话 id）。
- **会话内恢复**：下一迭代即改用 `command -v rsvg-convert || echo no-rsvg` 守护写法重跑成功，无级联。

### E2 · read_image 视觉超时
- **时间**：2026-11-26T14:52:41.094Z（incidents id 16；callId `call_00_ET_ab5fZKujiaP89lXUNU492790`）
- **错误类型**：`status=error` / `handler_error`，**100,918.5ms**（vision provider ~100s 超时上限打满）；结果体 `{ok:false, error:"vision_failed", message:"看图失败: timeout 请求超时"}`；transcript 同刻 vision 行 `error=timeout`。
- **根因**：**瞬态 provider 超时**，非尺寸/格式问题——请求体仅 1400×1000 / 231,780 bytes（0.5MB 级），且后续 6 次 vision 重试全部成功，其中末次（14:56:20）**同一原尺寸图 7.7s 成功**，排除尺寸根因。
- **会话内恢复**：模型先缩图（760px）过渡继续迭代，再回原图终验，零级联。

### E3 · workspace_write 被 sha 覆写门拒绝（denied，非 error）
- **时间**：2026-11-26T14:54:13.058Z（incidents id 17；callId `call_00_ZtzFcnKKfzHCbljjEbCt9254`）
- **错误类型**：`status=denied` / `terminationReason=overwrite_requires_sha256`，2.4ms；结果体 `{error:"expected_sha256_required", reason:"overwrite_requires_sha256", message:"完整覆写已有文件前必须先读取文件，并传入 overwrite=true 和 expectedSha256。"}`
- **根因**：**模型漏传 `overwrite=true`**（不是漏 sha——该调用实际带了正确的 `expectedSha256=60666730…`，只缺 `overwrite` 标志）。机械门按 `workspace-tools.js:591-593`（`args.overwrite !== true` 即拒）fail-closed 拒绝，门行为正确；错在模型跳过了工具契约的一步（长链迭代中对「自己刚创建的文件」想当然仍可覆写）。
- **会话内恢复**：下一迭代补上 `overwrite:true` 同 sha 重写成功（13,349→13,937 bytes，`created:false`），零误覆盖。

## §2 根因分类：机械可修 vs 语义类

| 错误 | 分类 | 判据 |
|---|---|---|
| E1 探测 exit 1 假失败 | **机械可修（已修）** | 判据完全确定（exitCode=1 ∧ stdout 非空 ∧ stderr 空 ∧ 命令含 which/command -v），可纯代码给出可执行纠正 hint，不依赖模型自觉；已落 `probeExitHint`（75f9c82e9，含负测守护不误挂真实失败） |
| E2 vision 超时 | **机械可修（已修提示层）** | 错误码/形态确定（`vision_failed` + timeout/超时字样），已落确定性指引文案「瞬态可重试；建议先缩小图片或拆局部再读」；是否升级为工具层「超时后自动缩图一次」的确定性回退属语义类待裁决（前序报告 §5.2 已列，维持） |
| E3 漏传 `overwrite=true` | **语义类** | 门本身正确且不应放宽（fail-closed 防并发误覆写）；漏传是模型长链行为问题，prompt 铁律已逐字在场仍漏 → 属「prompt 约束不足、模型选择/schema 加严」的产品语义裁决，不是代码缺陷。前序报告 §5.1/5.3 三项裁决点继续挂 owner |

## §3 与 conv_25806ab0 对照（同型错误复发情况）

对照基准：`acceptance/conv-25806ab0-error-analysis/ERROR-ANALYSIS.md`（14 错误 / A 配置拒绝 5 / B sha 门 5 / C 残缺数据级联 4，错误率 4.2%）。

| 上会话根因类 | 本会话复发 | 判据 |
|---|---|---|
| A · 联网配置拒绝（5 次） | **未复发**（无法验证机制，N/A） | 本会话零 `web_*` 调用，`web_access_disabled` 0 条；既不能证明「配置错不重试」引导有效，也不能证伪，不冒领效果 |
| B · sha 门拒绝（5 次） | **同根因复发 1 次**（E3，但形态变轻） | 上会话 5 次均为「漏 sha」；本会话 1 次是「带了 sha 漏 overwrite」——模型对契约的遵循在改善（记住了一半），但 prompt-only 约束对 `deepseek-flash` 仍不充分；机械门第 2 次实证零误覆盖 |
| C · 残缺数据级联（4 次） | **未复发** | 三次错误后模型均先换方案/验证中间产物再继续（E1→换命令、E2→先缩图、E3→带全参数重试），无一次在坏产物上盲重试——上会话落地的「分步/中间产物校验」引导在行为层面生效 |

本会话新增两型（上会话没有）：D 探测 exit 1 假失败（E1）、E vision 瞬态超时（E2）。错误率 4.2%→9.1% 属小样本波动（14→3 绝对数下降），不构成趋势结论。

## §4 防再犯效果验证（HK-01 钉子事后实证 · 本报告核心增量）

**当时落的钉**：commit `75f9c82e9`（2026-11-26 23:06 +0800，已在 origin/main，HEAD 可达）：
1. `probeExitHint`（`workspace-tools.js::attachShellSemanticsHint`）：E1 同型假失败给模型可执行纠正写法；
2. vision timeout 指引（`vision-tools.js`）：E2 同型错误 message 追加「瞬态可重试；建议先缩小图片或拆局部再读」。
配套 HK-01：`test/workspace-exec-error-hint.test.mjs` + `test/conv-0d113948-guidance.test.mjs`。

**核验结果（钉子落地 2026-11-26T15:06Z 之后至今的全部会话数据）**：

| 同型错误 | 落钉后复发 | 证据 |
|---|---|---|
| E1 型（which/command -v 探测 exit 1 → handler_error 假失败） | **0 次** | ① `incidents` 表落钉后 workspace_exec handler_error 共 9 条，逐条核命令均为**异型**（绝对路径越界 / `cd` 出工作区 / `sleep 180` 超时 / 探测外部目录），零条含 which/command -v 假失败；② 11-27 会话（conv_53fb2ec6、conv_4459b1f7）中模型探测命令已改用守护写法：`command -v rg >/dev/null && rg …`、`command -v ffprobe \|\| echo "NO_FFPROBE"`——正是 hint 推荐的 `|| true`/`|| echo` 形态；③ `probeExitHint` 全库 transcript 零次触发（零触发=零触发条件再出现，与②互证） |
| E2 型（read_image vision timeout） | **0 次** | 全库 vision 行 `error=timeout` 仅 1 条 = 本会话原发；落钉后 11-27 的 2 次 read_image handler_error（incidents 23/28）均为 `path_escape` 路径越界，异型 |
| E3 型（overwrite/replace sha 门拒绝） | **0 次** | 落钉后 `incidents` 表零条 `overwrite_requires_sha256` / `replace_requires_sha256`（既有 id 18–55 无一命中） |
| 钉子本身在场 | **绿** | 两钉均为 origin/main 组成部分；本次核验时在 HEAD 重跑两测试文件 `node --test test/workspace-exec-error-hint.test.mjs test/conv-0d113948-guidance.test.mjs` → **7/7 pass**（与提交时「HK-01 7/7」一致） |

**诚实边界**：
- E1/E2「零复发」同时包含两个因素：钉子的纠正指引 + 后续会话任务类型不同（3D/视频生成为主）。落钉后会话确实出现了同类探测场景且模型用了守护写法（②），这是行为级正面证据；但样本量小，不做强因果声明。
- 落钉后会话新增的 workspace_exec handler_error（9 条异型）说明**错误分类面仍在扩大**（路径越界类假失败与 E1 同属「 classifyResult 统一打 handler_error 」家族），probeExitHint 只钉了探测这一型；异型是否值得各自出 hint 属后续独立判断，本报告不代裁决。
- 前序报告 §5 三项 owner 裁决点（prompt 对 deepseek-flash 稳定性 / vision 自动缩图回退 / execution admission 升 enforce）维持 pending，本报告不重复展开、不代答。

status: analysis_complete（纯分析，只读 DB/transcript，零产品代码改动，未跑产品门禁）
