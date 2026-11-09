---
capability: block-384-sibling-pack-clearance
status: completed
goal: C-46/C-49 兄弟仓（petri-pack-bio）机械清偿——deseq2.R 跨行字符串语法错 paste0 合并 + 三个插件 golden fixture sourceScriptSha256 漂移重锚（脚本为现值真相，fixture 是契约锚点无输出内容存储）；清偿后解锁 P6 重算与 p4r/deseq2 域 16 残红。
acceptance:
  - deseq2.R 通过 R 语法解析（Rscript -e parse 或真实执行）
  - 三插件 golden fixture 与当前脚本 sha 一致且 SDK validateResultStudioDescriptor 全绿
  - p4r-invariants / deseq2-multifactor-design / p4r-baseline / block218 定向全绿
  - g0:result-studio:p6:update exit 0（P6 证据重算成功）或新根因逐件归因
  - 兄弟仓改动独立提交（其自身 git 历史），本仓只记录指针
reopen: 兄弟仓再改脚本后重锚 fixture
---

# BLOCK-384 · C-46/C-49 兄弟仓清偿批

> 发令：用户 2026-11-09「待裁决的三项 你有什么建议吗 如果有可以直接按照建议推进」＝授权按建议执行。建议①（兄弟仓机械清偿）即本包；建议②（FK=ON）与③（ADMISSION 拨硬）维持缓，理由在册。
> 前置：兄弟仓工作树干净（c58d328），pack 插件漂移扫描：deseq2/go-kegg/volcano-plot 三处 sourceScriptSha256 漂移（inputBindings/artifactContract 摘要全部与现值一致=纯脚本漂移）。
> 阶段纪律：G0 开发期常态 · 不外推 packaged/Provider/GA。

## 1. 修法

1. deseq2.R:72-73 跨行字符串常量 → paste0(...) 合并（C-46①）。
2. 三插件 golden-revisions/result-studio-v1.json 的 sourceScriptSha256 → 当前脚本 sha256（C-49 + C-46 家族；fixture 无输出内容存储=契约锚，重锚即「声明当前脚本为 golden 基线」；input/artifact 摘要未漂移故非迁移路径）。
3. 兄弟仓独立 commit；本仓回写 backlog C-46①/C-49 销号 + 台账。

## 2. 非范围

- C-46②（pack 0.2.x 交付回流兄弟仓 latest）；FK=ON 全量切换（缓）；ADMISSION 拨硬（缓）；凭据更新（用户资产）。

---

## 3. 收口（2026-11-09）

| 项 | 终态 | 证据 |
| --- | --- | --- |
| C-46① deseq2.R | ✅ | paste0 合并；Rscript parse 全 pack 10 脚本通过；p4r-invariants/deseq2-multifactor-design/p4r-baseline 全绿（此前 C-46 残红 21/21 清偿） |
| C-49 三插件 golden 重锚 | ✅ | deseq2/go-kegg/volcano-plot sourceScriptSha256 → 现值（inputBindings/artifactContract 未漂移=纯脚本漂移）；SDK validate 三插件 valid=true |
| C-46② resultSurface 回流 | ✅ | ui/result.html 按 BLOCK-218 冻结契约重建（petri:surface-context/resultData/imageDataUrl/data.rows/data.text/petri:ready/零外部资源零 fetch）+ pack.json provides.resultSurfaces bio-result；契约测 2/2 |
| P6 重算 | ⏸→专项 | **前进两站**：cohort≥3 不变式已过（C-49 生效）；recovery electron 腿 refresh（compare 激活+结果画布锚+waitForLifecycle 循环+审计诊断）后 driver 15/14 pass；残余=lifecycle_ready 等待竞态（run2 起 intermittent，run7/8 连续两轮"Script failed to execute"）——需专门调试会话逐帧取证，不在本批硬闯 |
| 建议② FK=ON / ③ ADMISSION | 维持缓 | 理由见 §1 发令段 |

**兄弟仓提交**：a186d20（语法+重锚）+ 8b0e87f（resultSurface 回流），独立 git 历史在册。
**backlog**：C-46①/C-49 销号；C-46② 销号（backflow 完成）；P6 recovery electron 专项另立。
