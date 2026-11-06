---
capability: block-361-nso-w4-extension-single-source
status: completed
goal: NSO-W4 扩展生态单源化——插件源、MCP 工具名与元数据、schema 类型映射、插件入口在任意 dataDir/dev/pack 形态下都按同一套单源规则工作，初始化降级可见（W2-6 已落地 health）。
acceptance:
  - registry.refreshPluginSources 改用 plugin-loader 单源解析（installed 含 PETRI_LOCAL_DATA_DIR/plugins 一档；built-in 含打包 Resources 回落），四源优先级有行为测试
  - listTools.withMetadata 双形状取名（{name} / {function.name}），动态插件/Skill/IDE 工具一律有 executionMetadata（未知名取保守缺省）
  - skill_discover.source enum 由 SOURCE_PRIORITY 派生（含 pack）；_inputsToInputSchema 显式 boolean/file/directory 映射
  - 插件入口不再静默取 files[0]：plugin.json 声明 entryScript 优先，其次同名精确匹配，否则 fail-closed（readdir 排序稳定）
  - 每项负测；证据落 acceptance/nso-2026-11-06/wave-4/
reopen: 范围变化（如 shelf-matrix/能力地图生成器化扩入本包）时由用户重新发令
---

# BLOCK-361 · NSO-W4 扩展生态单源化

> 蓝图依据：[`next-stage-optimization-blueprint-2026-11-06.md`](./next-stage-optimization-blueprint-2026-11-06.md) §7。评估发现 F-07 / F-08 / F-17。
> 排序说明（留痕）：W1 待在制批处置裁决、W3 需改 UI 台账而并发写入者正在改该文件，故按 Jev `next:suggest`（NSO-W4，0.62）先做与两组他方在制零交集的 W4；仍单包串行。

## 非范围

- 不新增依赖；不建第二插件源解析器（registry 改为消费 plugin-loader，不是再写一份）
- 两组他方在制（22M+10?? 在制批、并发写入者的模型偏好 UI）零触碰
- shelf-matrix 与 detour 复判生成器化、Skill artifacts sha256 补齐按体量另批（本包聚焦源/名/schema/入口四个单源缺口）

## 交付与收口（2026-11-06）

| 项 | 状态 | 证据 |
| --- | --- | --- |
| W4-1 插件源单源（F-07） | ✅ | registry `computePluginSources` 消费 plugin-loader；installed 补 `$PETRI_LOCAL_DATA_DIR/plugins`；built-in 打包回落收归 loader |
| W4-2 工具名双形状 + executionMetadata（F-08） | ✅ | `{name}` 形 Skill/IDE 条目投影保守缺省元数据 |
| W4-3 source enum 派生 + schema 类型映射（F-17） | ✅ | enum=SOURCE_PRIORITY 键（含 pack）；boolean/file/directory 显式映射 |
| W4-4 插件入口确定性 | ✅ | `selectPluginEntryScript`；15 个 pack 插件实核均有同名入口，行为零变化 |
| shelf-matrix / detour 复判生成器化、Skill artifacts sha256、三账本同源 | ⏸ 移交 W7 | 蓝图 W7「四账本生成器」同一责任面，避免两包各写一份生成器 |

- 契约 `test/nso-w4-extension-single-source.test.mjs` 5/5（首跑 5/5 红）；插件/MCP 邻域 39 套件 285 pass / 0 fail / 12 skip。提交 `c9d22abb`。
- **completed（带例外）**：蓝图 §7.3 出口中「三份矩阵可由同一命令重建」未达成，移交 W7。
