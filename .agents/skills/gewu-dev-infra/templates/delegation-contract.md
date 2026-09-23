# 委派契约模板（Delegation Contract Template）

> 用途：主 Agent 把任务委派给子 Agent（并行会话、只读探查代理等可用执行体）时的标准任务书模板。
> 强制契约（自包含）：每次委派必须明确任务范围、文件或职责所有权、预期输出、验证要求，
> 以及不得回退或覆盖其他 Agent 改动的约束——本模板六区块即这些强制字段的填空式落地。
> 使用方式：复制下方模板填空；填不满的区块说明该任务还不该被委派（回主 Agent 自做或重新切分）。

---

## 委派任务书

- **委派 ID / 关联工作包**：`<如 BLOCK-71 / P1-3；必须挂在当前唯一 active 工作包之下，不得借委派并行开新包>`
- **任务一句话**：`<动词开头的单句，完成即可验证>`

### 1. 任务范围（Scope）

- 做什么：`<边界清晰的窄范围描述；含糊=不委派>`
- 不做什么（exclusions）：`<显式列出相邻但禁止触碰的面>`

### 2. 文件与职责所有权（Ownership）

- 允许新建：`<路径模式，如 scripts/dev-verify/flows/*.cjs>`
- 允许修改：`<精确文件清单；禁止"等相关文件"式表述>`
- 明确禁区：`<其他 active/并行工作包的文件面、canonical 文档、acceptance 证据>`

### 3. 预期输出（Deliverables）

- 代码/文档产物：`<清单>`
- 验证证据：`<命令 + 期望输出，如 npm run skills:check → PASS>`

### 4. 验证要求（Acceptance）

- 必跑门禁：`<与改动面匹配的最小充分集；文档面 docs:check/ui:audit:check，代码面定向测试>`
- 完成判据：`<可机械核验的判据；"看起来完成"不构成判据>`

### 5. 不得回退 / 覆盖约束（Non-regression）

- `<列出不得回退的既有行为/契约，如"preload.js 既有命名空间零改动">`
- `<未提交 WIP 保护：列出当前工作区已知 WIP 的文件面，声明零触碰>`

### 6. 主 Agent 复核（Review）

- 子 Agent 完成声明不构成收口；主 Agent 必须：
  - [ ] 复核代码/文档 diff 本身
  - [ ] 复跑第 4 节验证命令核对证据
  - [ ] 确认第 5 节约束未被破坏后，才集成并对外宣布结果

---

## 填写示例（精简）

> 委派子 Agent 为 dev-verify 新增一个 `settings-load` flow：
> 范围=仅新建 `scripts/dev-verify/flows/settings-load.cjs`；禁区=`lib.cjs`/`run.cjs` 及
> BLOCK-69/70 文件面；交付=flow 文件 + `npm run verify -- settings-load` 在 dev 栈上
> 4 断言 allPass 的证据；验证=`node --test test/dev-verify.test.mjs` + `npm run verify -- --list`
> 显示新 flow；约束=不改动既有 flow 与证据 JSON 契约。
