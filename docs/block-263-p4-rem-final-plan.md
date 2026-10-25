---
capability: p4-rem-final
goal: P4-REM 数据模型收官（母纲 §6.5 第 12 行·串行队列最后一项）：E13 Result Studio 高级 tab 迁移收尾（补 history 只读 tab 全链）、域中性 11 处/6 键 compat 清零裁决、写面 tab 出籍判档（C-44 依赖）、真实结果页保真实机（R 运行时在装则真链、未装则如实登记）；收口后 §6.5 串行队列清零。
acceptance:
  - history tab 全链：核心有界只读列表端点（≤100 行、项目归属鉴权）+ packTabData history 桥接真端点（删除 no_endpoint 诚实回落）+ pack 仓补 tabs 声明与 renderTab 分支 + host 映射既有（history→history）；契约测（端点有界/桥形状/页面声明）红绿。
  - 写面 tab 裁决留痕：selection / revisions 完整写操作（restore/replay）/ annotations / export 写出——全部依赖 pack iframe 写桥（BLOCK-254 C-2 已判阻塞 = backlog C-44），本包判档出籍并回写 E13；核心各面均已交付的对照证据逐条列出。
  - methods 判档：数据面已 pack 化（BLOCK-220/234 provides.methods：citations/toolLabels/python 模板），渲染面随 result body 的 report artifactTypes 已由 pack 接管；方法学导出（写文件动作）保留核心——判档=数据面已达成，不另立 tab。
  - lineage 图形态保留核心（BLOCK-236 既有裁决重申）；pack 侧 lineage 表格形态已交付。
  - 域中性裁决：11 处/6 键 compat 逐条判档=保留（schema 回填/legacy 权限别名/安全策略边界/运行时制品契约——清零即破坏存量，与零迁移裁定冲突）；判档写入本文件 §3，基线维持显式兼容终态。
  - 实机腿：隔离栈 probe /api/runtime/status——R installed 则跑真实 demo 分析全链（job→产物→truth 校验→结果页 pack 渲染）；未装则如实登记（UI-526 重开条件不变）并以 artifact-truth 校验过的产物链补证；断言 JSON 落 acceptance/block-263/。
  - closeout 十三门 PASS；母纲 E13 🟡→✅、§6.5 第 12 行 completed（串行队列清零）、registry/roadmap/handoff/AUDIT-LOG 回写。
reopen: pack iframe 写桥（C-44：selection/revisions 写操作/annotations/export 写出统一依赖）；R 运行时安装后 UI-526 实机补腿（需用户授权 657MB 下载）；E13 lineage 图形态核心渲染长期保留；G1+。
status: active
---

# BLOCK-263 · P4-REM 数据模型收官（串行队列最后一项）

用户发令：「搞定 P4-REM 数据模型收官」（2026-10-25）。母纲依据：§6.5 第 12 行（母纲硬约束：最后）+ E13 行。

本包当前阶段 = **P0 对账完成（§1–§3）**；P1 起按 §4 串行推进。

## 0. 启动前置（2026-10-25 实测）

| 项 | 事实 | 来源 |
| --- | --- | --- |
| 分支 | `main`，`f2fc2998`（BLOCK-262）已提交，工作区干净 | `git status` |
| active 槽位 | 无 active 工作包（BLOCK-262 已收口）；本包占用 | handoff |
| 队列位置 | §6.5 串行队列唯一剩余项（Q4b 已于 BLOCK-262 收口，🔴 已清零） | 母纲 §6.5 |

## 1. P0 对账 · E13 高级 tab 现状矩阵（2026-10-25 实码）

| Tab | 契约白名单 | pack 声明 | pack 渲染器 | 数据桥 | 实机 | 判定 |
| --- | --- | --- | --- | --- | --- | --- |
| result 主 body | ✓ | ✓（bio-result surface） | ✓（ui/result.html） | ✓（packResultData） | ✓（UI-544） | **已交付** |
| code | ✓（revisions-source） | ✓ | ✓ | ✓ | ✓（UI-544） | **已交付** |
| compare | ✓ | ✓ | ✓（四列表） | ✓（changesets 真实形状） | ✓（UI-545） | **已交付** |
| lineage | ✓ | ✓ | ✓（表格形态） | ✓（lineage ≤200/400） | UI-544 批 | **已交付**（图形态核心保留） |
| history | ✓（白名单在） | **✗ 未声明** | ✗ | ✗（诚实 `no_endpoint`） | ✗ | **本包 P1 迁移** |
| selection | ✗ | ✗ | ✗ | ✗ | — | **出籍 C-44**（写面：选区→工具入参需写桥；核心 selection 已有） |
| revisions 完整 | 部分（source 只读已迁） | 部分 | 部分 | 部分 | — | restore/replay 写操作出籍 C-44；只读源码已交付 |
| annotations | ✗ | ✗ | ✗ | ✗ | — | **出籍 C-44**（BLOCK-254 C-2 判定：契约冻结+写权限边界；核心锚点批注已交付） |
| methods | ✗（非 tab） | 数据面 ✓（provides.methods） | report artifact 已由 pack 渲染 | ✓ | — | **判档：数据面已达成**；导出动作保留核心 |
| export | ✗ | ✗ | ✗ | ✗ | — | **出籍 C-44**（写出动作=写面） |

证据：`core/petri-server/helpers/pack-contributions.js:46`（白名单 4 tab）、pack `pack.json` tabs 声明 3 个、`packTabData.ts:95`（history `no_endpoint` 诚实回落）、`resultSurfaceHost.ts:7-9`（code/history/compare 模式映射已有）。

## 2. P1 设计 · history tab 全链

1. **核心端点**：`GET /api/result-studio/history?jobId=&limit=&offset=`（revisions.js 内）——job→artifactFamily 解析（复用 changesets 路由的 repository.listRevisions 形态）→ 有界列表（≤100/页）→ `{ revisions: [{revisionId, label, createdAt}], hasMore }`；项目归属鉴权对齐既有 revisions 路由。
2. **packTabData 桥**：history 分支改接真端点（保留有界：≤100 行、字段白名单、失败 `{ok:false,reason}` 形态不变）；删 `no_endpoint` 回落。
3. **pack 仓**（兄弟仓独立提交）：`pack.json` tabs 补 `{id:'history'}`；`ui/result.html` renderTab 补 history 分支（表格：版本/标签/时间，只读）。
4. **host**：映射既有（history→history），无需改动；`tab_not_claimed` 回落仍为兜底。

## 3. P2 裁决落档

### 3.1 写面 tab 出籍（C-44 统一依赖）

selection / revisions 写操作（restore/replay）/ annotations / export 写出——四者共同依赖 pack iframe 写桥。BLOCK-254 §2-9 已判定：批注 kind/几何契约冻结 + 写权限边界（pack 能写哪些 scope、pack.json 能力声明）是独立契约包（backlog **C-44**）。核心各面对照证据：selection=核心交互路由（routes/result-studio/selection.js）、revisions diff=compare tab 已迁 + restore/replay 核心 revisions.js、annotations=BLOCK-254 锚点批注全链、export=methods-export.js。**判档：出籍，不在本包做写桥。**

### 3.2 域中性 11 处 / 6 键 compat 裁决

| 键 | 类别 | 裁决理由 |
| --- | --- | --- |
| agent-tool-policy.js::h5ad | security-policy-extension | 科学源扩展名白名单是安全策略边界；移除改变文件策略 |
| db/schema.js::single-cell ×2 | schema-backfill | 存量 projects.modality 回填；schema 迁移裁定不迁移 |
| guest-permissions.js::single-cell | legacy-permission-alias | 存量权限 JSON 零迁移兼容 |
| permissions.js::single-cell ×3 | legacy-permission-alias | 同上（data 组 OR 解析） |
| capability-bundles.js::wgcna ×3 | runtime-bundle-identity | 已发布运行时制品 ID/URL/hash 契约；改名即失配 |
| project-modality.js::single-cell | legacy-modality-value | 存量 modality 兼容值；未知回落 general |

**总裁决：保留（清零不成立）**——六键全部是存量兼容/安全边界/制品契约性质，清零=破坏性变更，与既有「零迁移兼容存量」裁定冲突。基线维持 schemaVersion 2 显式兼容白名单为**终态**；`domain-neutrality.test.mjs` 逐键一致断言继续在守。

### 3.3 methods 判档

数据面已 pack 化（BLOCK-220 `provides.methods` citations/toolLabels + BLOCK-234 S4 python 模板 + S5 scientificProfiles）；渲染面 report artifact 属 resultSurfaces artifactTypes（pack 已接管）；方法学导出（写文件）保留核心。**判档：达成，不另立 tab。**

## 4. 阶段计划

| 阶段 | 内容 | 出口断言 |
| --- | --- | --- |
| P0 对账 | 本文件 §0–§3 + 登记 | docs:check / ui:audit:check 绿 |
| P1 history tab | 端点 + 桥 + pack 声明/渲染器 | 契约测红绿（端点有界/桥形状/pack 页面契约）；packTabData 测试更新 |
| P2 裁决落档 | §3 判档随收口回写 E13/§6.5/backlog C-44 指向 | 回写后 docs 门禁绿 |
| P3 实机腿 | 隔离栈：runtime probe → R 在装则真实 demo 全链；未装如实登记 + truth 链补证 | 断言 JSON 落 acceptance/block-263/ |
| P4 收口 | closeout 十三门 + canonical 回写 + 提交 | E13 🟡→✅；§6.5 串行队列清零 |

## 5. 完成语义

- `completed` = P1 契约绿 + P2 裁决回写 + P3 实机腿（或如实 R 未装登记）+ closeout 十三门 PASS + 母纲/台账回写。
- 写面 tab 不因 C-44 未做而阻塞收口（出籍判档即交付）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
