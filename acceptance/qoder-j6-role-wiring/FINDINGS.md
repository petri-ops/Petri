# QODER-J6 角色接入（2026-11-23，completed）

## 用户发令与裁决

「开始 J6 角色接入」：P1 核心 `custom-agent-roles.js` 接入 `agent-roles.js`——内置 ∪ 用户自定义 roles.json 合并、消费端零改、不覆盖 baseRole/内置 key。默认口径（非新裁决点）：用户角色不得覆盖人设真源（BLOCK-339 钉死）。

## 交付

- `core/petri-server/agent-tools/agent-roles.js`：模块级 `AGENT_ROLE_MAP`/`KEY_SET`/`KEYS` 改为 `mergeAgentRoles(AGENT_ROLES, CUSTOM_ROLES)`（P1 纯函数）；`loadCustomRoles(<dataDir>/agent-roles.json)` 模块加载时读一次（进程内角色固定，避免每次 spawn 读盘）；账本缺失/损坏 fail-soft 返回 `[]`（内置不受影响）。
- 消费端函数 `getAgentRole`/`isValidAgentRole`/`renderRoleDirective`/`resolveRoleOrError` **签名与语义零变化**——spawn/followup 无需改一行。
- `__test.loadCustomRoles` 暴露可测入口；`AGENT_ROLE_KEYS` 自动含自定义 key（failInvalidRole 提示同步）。
- 零新依赖；不碰 sandbox/CSP/凭据/B1 token/handler/pack 声明；不改 baseRole 人设。

## 验证

- HK-01 `test/qoder-j6-role-wiring.test.mjs` 红2→绿5（接入存在/内置零变化/baseRole 拒绝+未知 fail-closed/可测入口/红线）。
- 邻域 `block93-agent-roles` + `block49-spawn-agent-tools` **30/30**（消费端零回归）+ P1 核心 5/5 → Node 合计 **40/40**。
- docs:check PASS(664) / ui-audit PASS / lint 0 error / tsc 0 / test:changed 0。
- 诚实边界：用户账本是进程启动期加载（改 roles.json 需重启应用生效，与"重启后生效"先例一致）；未做前端角色 CRUD UI（评审只要求合并接入）。

## 完成语义

J6 从 P1 core → 完整接入 completed。前端角色管理面板若有，留可选增量。

G0 开发期常态 · 不外推 packaged/Provider/GA。
