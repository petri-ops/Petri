---
capability: qdomain-pack-skills
goal: Q-DOMAIN P1 — 把 3 个生信 skill 从核心迁入 petri-pack-bio，建立 pack `provides.skills` 与 skill-registry 的发现/停用/卸载；核心 built-in 只保留 11 个通用 skills。
acceptance:
  - pack 缺失：核心 11 个 skills；registry 无 3 个生信 skill；`skills:check` PASS（11）。
  - pack 在位：3 个生信 skill 以 source=pack 出现；`skills:check` PASS（11+3）；preflight 仍按插件依赖给三态。
  - 卸载/停用：3 个 skill 从 registry/shelf 消失；核心无生信 skill 目录；数据/产物保留。
  - 三态 fixture 单测 5/5 + 邻域测试 + closeout 十三门。
reopen: P2 prompt/UI/result surface；P4 data model；pack UI 安装/版本协商；真实 9223 实机腿（本轮若受栈限制则如实登记）。
status: completed
---

# BLOCK-214 · Q-DOMAIN P1：领域包 Skills 贡献与生信 Skills 去核

> 用户裁决：2026-10-20「可以的 按照建议来」——垂直领域完全插件化，领域内容只进 pack；结果页保持生信专属，数据 truth 留核心。
> 方向母纲：`docs/qoder-essence-absorption-plan.md` §2.5/§2.6/§6-Q-DOMAIN。

## 1. 范围

- **pack 契约**：`petri-pack-bio/pack.json` 增 `provides.skills = "skills/"`；pack 新增 `skills/` + `skills/manifest.json`，承载 3 个生信 skill。
- **核心去核**：`resources/skills/manifest.json` 删除 3 个生信条目；删除对应目录；核心 built-in 只剩 11 个通用 skill。
- **注册表发现**：`core/shared-backend/skill-registry.js` 增 `loadPackSkills()`——从 `<dataDir>/packs/installed.json` 的已安装/启用 pack 读取 `skills/manifest.json`；source=`pack`，优先级 built-in(10) > pack(15) > installed(20)；卸载/停用即清理。
- **校验面**：`scripts/skill-scaffold.mjs --check` 抽出 `checkSkillDir`，核心 11 + 已检出 pack 的 3 个 skill 共用同一套校验；pack 缺失时只校验 11，不制造假红。
- **UI**：SkillSource 增 `pack`；卡片来源标签「领域包」；pack skill 不进入单 skill 治理面（由 pack 安装/卸载管理）。

## 2. 非范围

- 不改 prompt/UI 动作/Result Studio/data model（属 Q-DOMAIN P2/P2b/P4）。
- 不把 artifact truth/repository/lineage 搬进 pack。
- 不新增依赖；不做 marketplace/云。
- 不把 pack 安装 UI/版本协商并入本包（P1 只做发现与生命周期语义）。

## 3. 验收与证据

- `test/block214-pack-skills.test.mjs`：已安装 → source=pack；卸载 → 消失；停用 → 不出现；无 skills 目录 → 不报错；核心 built-in 无 3 个生信 skill（5/5）。
- 邻域：`test/block211-skill-deps-plugins.test.mjs`（C-33 改为校验 pack 数据面）、`test/block211-pack-dirs.test.mjs`、`test/pack-registry.test.mjs`。
- `npm run skills:check`：pack 在位 PASS（11 内置 + 3 领域包）。
- 9223 实机（若栈可用）：`/api/skills/registry` 3 个 source=pack；货架「领域包」标签；卸载后消失。若栈不可用，如实登记 `env`，不用单测冒充实机。
- 证据落 `acceptance/block-214/`；收口跑 closeout 十三门。

## 4. 回归风险

- `skills-sdk`/preflight 消费方是否仍能拿到 pack skills（source/plugins.required 形状不变）。
- 已安装 pack 记录缺失时不得报错（fail-open 为“无 pack skill”，不是“注册表崩”）。
- installed/built-in 同名优先于 pack，避免 pack 覆盖用户技能。

## 5. 落地记录（2026-10-20）

- **P0 基线**：核心 built-in 14 → 11（3 个生信 skill 移出）；pack 无 `skills/`；dev `packs/installed.json=[]`。
- **P1 契约/发现**：`petri-pack-bio/skills/` + `skills/manifest.json` + `pack.json provides.skills`；`skill-registry.loadPackSkills()` 从已安装/启用 pack 发现（source=pack，built-in>pack>installed，卸载/停用清理）；核心 manifest/目录去核；`skills:check` 抽 `checkSkillDir` 共用判据（11+3 PASS）；UI `SkillSource`/「领域包」标签 + pack skill 不进单 skill 治理面。
- **验证**：`test/block214-pack-skills.test.mjs` **5/5**；邻域（block211/block157/block163/block176/skill-import/pack-registry）**32/32 + 20/20**；`skills:check` **11+3 PASS**；`tsc` 0。
- **产品路径**：同一后端进程——pack 安装时 `/api/skills/registry` **14（3 个 source=pack）**、preflight 三态如实；卸载后 **11（0 pack）**，无需重启。
- **实机（9223）**：`block214-pack-skills` pack 在位 **4/4**（领域包标签+三卡）/ 卸载后 **2/2**（三卡消失+空态）；截图 `acceptance/block-214/ui-pack-skills-installed.png` / `ui-pack-skills-absent.png`；证据 `block214-pack-skills-installed.json` / `-absent.json` / `acceptance.json`。
- **环境**：验证后 dev packs 恢复 `[]`；pack 仓 `skills/` + `pack.json provides.skills` 待随包提交。
- **边界**：P2 prompt/UI actions、P2b Result Surface、P4 data model 仍 planned；本轮不宣称“生信完全插件化”。

## 6. 收口（2026-10-20）

- **closeout 十三门 PASS**（audit:compact/hygiene/docs/ui-audit/test:changed/code-size/arch-cycles/css-modules/secret/arch/lint/types/knip）；`skills:check` 报告级 OK（11+3）。
- **knip 自纠**：新 dev-verify flow 首跑被 knip 判新增；按既有先例定性为动态入口（`run.cjs` 按 flowId 懒加载）后 `--update` 基线 245 键，复跑 PASS。
- **证据**：`acceptance/block-214/`（acceptance.json + installed/absent 截图 + 双态 flow JSON）；UI-529 `verified（dev Electron 边界内）`。
- **遗留**：Q-DOMAIN P2/P2b/P4 仍 planned；dev `packs/installed.json` 恢复 `[]`；pack 仓 `skills/` 随包提交。G0 开发期常态 · 不外推 packaged/Provider/GA。
