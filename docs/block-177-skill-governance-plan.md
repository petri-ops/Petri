---
capability: skill-governance
goal: 技能治理面——内置技能停用/启用（本地偏好，不物理删除）、已导入技能卸载（接既有单源）与「从原目录重装」（installed manifest sourceDir 复用）、治理动作本地审计留痕；「再次获取」=启用开关/一键重装，零网络。
acceptance:
  - 停用实机走通：停用后 agent 面（skill_discover/索引块/execute）不可见不可执行，管理面（Skills 页）置灰可见「已停用」；启用后全部恢复
  - 已导入技能卸载走通（built-in 拒绝卸载=诚实报错）；卸载后从记录的 sourceDir 一键重装恢复
  - 治理动作（disable/enable/uninstall/reinstall/import）落本地审计 jsonl
  - closeout 门禁绿 + Skills 页操作区按 source 分叉在场
reopen: 任一出口断言未达即返工；本包为 W7 加映（用户 2026-10-13 会话裁决「同意开整」）
status: completed
---

# BLOCK-177 — 技能治理面（停用/卸载/重装/留痕）

## 0. 来源与授权

- 用户 2026-10-13 会话：看到 11 件通用技能后问「能否删除？想再次获取从哪里？」→ 主代理给出「来源决定治理语义」方案 → 用户 /goal「同意开整 搞定」。
- 原则：**来源决定治理语义**。内置=应用资产给停用不给删除（Obsidian 核心插件范式）；已导入=可卸载可重装（sourceDir 已在 installed manifest 落账）。零网络（无云市场重装，BLOCK-158 商店面退役先例）。

## 1. 范围

- **P0 停用/启用**：`skill-prefs.js` 单源（userData/skills-prefs.json；审计 append-only skills-prefs-audit.jsonl）。消费面：SDK listSkills 附 disabled 旗标（管理面置灰可见）、executeSkill 拒绝停用件、agent 面（skill_discover/skill_get/索引块）整体过滤。UI：SkillCard 置灰徽章 + SkillDetail 启停 toggle。
- **P1 卸载/重装**：IPC `skills:set-disabled/uninstall/get-install-info/reinstall` 四通道（registry+preload+main.js+类型面）；SDK `setSkillDisabled/uninstallSkill/getInstallInfo/reinstallFromSource`；UI SkillDetail 按 source 分叉（built-in=启停；installed=卸载确认+来源路径+重装按钮，源目录缺失=如实禁用）。built-in 卸载=诚实拒绝。
- **留痕**：disable/enable/uninstall/reinstall/import 全部 append jsonl（本地主权审计面）。

## 2. 非范围

- 云市场/远程分发重装；内置技能文件物理删除；停用原因结构化分类（自由文本即可）。

## 3. 门禁

契约测试（prefs 纯函数+SDK 真实临时仓走通停用/卸载/重装全链）+ ipc-channels-registry 双向守护自动覆盖 + w7 既有契约不回归 + closeout 十三门 + 实机探针 scripts/block177-live.mjs（acceptance/block-177/）。

## 4. 波报（2026-10-13 收口）

- **P0 停用/启用**：`skill-prefs.js` 单源（userData/skills-prefs.json；审计 append-only jsonl；真幂等停用——已停用再停用保持原登记不覆盖最初 reason）。三面接线：SDK `listSkills` 附 disabled 旗标（管理面置灰可见）/`executeSkill` 拒停用件（SKILL_DISABLED 诚实报错）；agent 面（skill_discover 过滤+skill_get 拒绝+索引注入同源过滤）。UI：SkillCard 置灰+「已停用」徽章、SkillDetail toggle。
- **P1 卸载/重装**：IPC `skills:set-disabled/uninstall/get-install-info/reinstall` 四通道双侧登记+类型面；SDK `uninstallSkill`（built-in 诚实拒绝 builtin_cannot_uninstall）+`getInstallInfo`+`reinstallFromSource`。**设计抓真（契约测试发现）**：卸载会删 installed manifest 条目导致 sourceDir 记录丢失、重装链断裂——修正为卸载前把 sourceDir 留存进 prefs 的 `uninstalledSources`，getInstallInfo 回退查留存面，卸载后仍可一键重装。
- **实机**：block177-live **11/11**（acceptance/block-177/block177-live.json）——真实后端注册表旗标翻转（管理面数据源）、真实目录导入→卸载→留存→重装→恢复全链、built-in 拒绝、审计序列核对、探针件清场零残留。
- **随批缺省裁决**：治理动作确认用 window.confirm（卸载一处；pack 三档勾选式对技能 uninstall 过重，单文件目录删除无共享保留语义）；停用不入 marketplace 式开关页（详情弹窗内联，管理面与详情同屏）。
- G0 开发期常态 · 不外推 packaged/Provider/GA。
