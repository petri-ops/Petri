# item84 3D 凭据误诊核查 + 无凭据降级证据

## §1 只读取证（conv_4459b1f7-b7e / msg_52557209-b86）

- 同会话 `generate.image`(seedream) 与 `generate.video`(seedance) 成功 → Ark key 有效。
- 两次 `generate.model3d` 均 `hyper3d_task_failed`（02:02:08Z / 02:02:30Z），agent 初判「无 Hyper3D 凭据」，文生对照同样失败；最终回复已自我纠正「不是缺密钥，是模型未开通/不可用」。无写凭据工具调用。
- 真 bug：owner 传 `referenceArtifactId=31fbcf49…`（裸 64-hex sha，指向同会话生成的 PNG），插件 `detectMode()` 只认 `input.referenceImage` → 图生退化为文生（tag=hyper3d）；凭据链 `ARK_API_KEY || PETRI_CREDENTIAL_ARK_SEED3D || PETRI_CREDENTIAL_ARK_HYPER3D` 共用一把 Ark key，不存在独立 Hyper3D 凭据分支。

## §2 修复

- `core/petri-server/agent-tools/generate-tools.js::resolveReferenceImage`：裸 sha 扫 `<dataDir>/generated/generate-image` 用 sha256File 命中 → `imageDataUrlFromBuffer` 得 data URL 注入 `referenceImage`；URL 透传；解析不到/多命中抛 `reference_artifact_unresolved` / `artifact_identity_ambiguous`，绝不静默退化成文生。
- 插件错误串改为「模型未开通/不可用或任务失败；图生/文生共用同一把 Ark 凭据，无需独立 Hyper3D key」并附 Ark payload error；`source.reference` 只记 artifactId，避免 data URL 膨胀描述符。
- `tool-defs/generate.js` 描述明写共用一把 Ark key、task_failed 非凭据缺失、失败可询问降级。

## §3 降级三选一与标注

- 触发=agent 驱动既有 `ask_user_question`（零新管线）；`core/petri-server/helpers/model3d-fallback.js::buildModel3DFallbackQuestion()` 三选项：继续本地近似 / 先配置凭据重试 / 取消。
- UI=独立 `Model3DFallbackDialog.tsx`（自有 overlay + `role=alertdialog`，无编辑入口）；`ApprovalSurfaces.tsx` 仅约 5 行按 questionId 前缀渲染 dialog 或原 `UserQuestionCard`，未改 83/85 已验的 ChatArtifactCard/ConversationTimeline/ToolActivityList/Grid。
- 本地生成复用已注册 `model3d_recipe`（SceneSpec scene3d/v1 + Three.js 预览；Blender 缺席诚实 `capability_unavailable`）；无 GLTFExporter、无重依赖。
- 标注：`buildRecipe(...,{annotation:true})` 写 `metadata.title` 后缀「本地近似非 AI 生成」+ `provider:'local'` + `synthetic:true`；`tool_model3d_recipe` 返回 `source{provider:'local',mode:'parametric-recipe',status:'approximation',synthetic:true,label:'本地近似非 AI 生成'}`；`model3d-artifact-projection.js` 透传 source 到会话卡。`missingInfo` 保留，不夸大能力。

## §4 验证

- HK-01 `test/item84-model3d-fallback.test.mjs` 4/4（凭据误诊字符串、sha→data URL、解析失败 fail-closed、三选项、标注字段）；前端 `Model3DFallbackDialog.test.tsx` 2/2（三按钮回调、open=false）。
- 回归：节点 16/16（`generate-builtin-tools`/`next05-recipes`/`block244-ask-question`/`generated-file-route`）；前端 25/25（UserQuestionCard/FullAccessConfirmDialog/主题门）；11 静态门绿。
- 未碰 build/afterPack（item66 已收）。

## §5 待 owner 终审触发方式

重启后端 → 会话区执行一次带 `referenceArtifactId` 的图生 3D → 观察是否不再误判凭据；再复现供应商不可用 → 观察三选一弹窗与「本地近似非 AI 生成」标注。观感 `in_progress` 零代签。
