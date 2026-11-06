---
capability: block-362-nso-w7a-governance-tooling
status: completed
goal: NSO-W7a 治理工具化——把本程序执行中反复手工补救的两类治理漂移转成机械门禁：audit:compact 永不追加进带未提交改动的归档文件；DOC-REGISTRY coverage 字段由脚本生成并由 docs:check 校验一致。
acceptance:
  - audit-log-compact 归档目标选择为纯函数：目标文件不存在→新建；存在且无未提交改动→追加；存在且有未提交改动（或 git 状态不可读）→写入带时间戳的新文件，永不触碰脏文件
  - docs:check 校验 coverage.documentCount / managedMarkdown 与实际计数一致（漂移即红）；提供一键重算写回命令
  - 红绿先行 + 负测；证据落 acceptance/nso-2026-11-06/wave-7a/
reopen: W7b（最终 canonical 回写、四账本生成器同源、证据生命周期元数据）在全部波次之后另行收口
---

# BLOCK-362 · NSO-W7a 治理工具化

> 蓝图依据：§10（W7）。排序：Jev `next:suggest` = NSO-W7（0.37，低置信）；支持理由=本程序执行中 audit:compact 已三次把链淘汰行追加进他方在制归档文件（W0/W2/W4 各一次，均人工逐字迁回），按「同类第二次出现转机械门禁」须根修；coverage 计数在本程序内已手工同步 4 次（F-22 回潮实证）。

## 非范围

- 不移动/改写任何既有归档内容；不触碰两组他方在制
- 四账本生成器同源、证据生命周期元数据、最终 canonical 回写归 W7b

## 交付与收口（2026-11-06）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| W7a-1 audit:compact 脏目标守卫 | ✅ | `chooseArchiveTarget` 纯函数；契约含脏目标 / git 不可读两条负测；收口 closeout 实战验证见 `acceptance/nso-2026-11-06/wave-7a/` |
| W7a-2 coverage 计数机械校验 + `npm run docs:coverage` | ✅ | `COVERAGE_COUNT_DRIFT`；真实注册表负测（documentCount→1 判红、恢复复绿） |

- 契约 `test/nso-w7-governance-tooling.test.mjs` 5/5（首跑 5/5 红）；相邻治理套件 31/31 + 23/23。提交 `742f6875`。
- **completed**：本包验收全部达成。W7b（四账本生成器同源、证据生命周期元数据、最终 canonical 回写）按立项声明留到全部波次之后。
