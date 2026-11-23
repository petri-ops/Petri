# C-56 网络素材稿件（2026-11-23，completed）

## 用户发令与裁决

「从网上爬取一个，一些素材过来形成稿件」——覆盖上一轮"创造合成稿件"的选择。执行边界：只取**开放许可**来源、提取事实而非整段复制、标注来源/许可/署名、不编造源文未给的数值。

## 素材来源（可复核）

- **arXiv:1412.3050** v4（Papastamoulis & Rattray，2014 提交 / 2016 修订），标题《A Bayesian model selection approach for identifying differentially expressed transcripts from RNA-Seq data》。
- 许可 **arXiv non-exclusive distribution license 1.0**；DOI `10.48550/arXiv.1412.3050`，期刊版 JRSSC 2017 `10.1111/rssc.12213`。
- 抓取 2026-11-23，来源页 `https://arxiv.org/abs/1412.3050`；元数据/摘要全文/方法事实见 `source-provenance.md`（含英文原文锁定锚点）。
- **为什么选它**：开放许可可分发引用、结构完整（摘要/方法/结果/讨论）、**摘要无量化性能数值**——恰好演练"不编造数字"核心纪律。

## 交付

- `source-provenance.md`：单一来源 provenance + 9 条可回溯事实清单 + "摘要不存在的事实"负面清单 + 英文原文锁定锚点。
- `manuscript-draft.md`：基于 F1–F9 事实的**中文重组稿**（非英文摘要翻译/非整段复制），五节；源文确有的计数词（两条件/两任务/两采样器）逐字保留，无源数值处显式 〈未覆盖〉。
- `rewrite-report.md`：按 Skill §9——数字锁定 6 项零变化 + 四保护校验 + 逐句三栏对照节选 + F 六项命中（含无命中如实标注）+ 4 条未覆盖清单 + provenance/学术判断归人；只出建议、不覆盖输入。

## 红线遵守

- 不整段复制（中文重组、非逐句翻译）；不编造数字（源摘要无性能数值，稿件不补造）；署名/许可/arXiv ID 全保留；不外推学术结论；零新依赖；不改产品 sandbox/CSP/凭据/handler/pack 声明。
- 来源为开放许可预印本，非用户私有稿件、非受版权正文的抓取转载。

## 验证

- `test/c56-web-sourced-fidelity.test.mjs` 6/6（来源/许可/署名、不复制、不编造数字、源名锁定、四保护/F 六项/未覆盖、不覆盖输入+红线）+ Skill 端到端 4/4 → **10/10**。
- docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。

## 完成语义

C-56 从"创造合成稿件"升级为**网络开放许可素材稿件**端到端完成；链路（来源治理→事实提取→中文重组→保真改写→provenance）全验。真实用户论文的改写仍需用户提供其稿件（本批证明链路可用，不代替真实稿件）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
