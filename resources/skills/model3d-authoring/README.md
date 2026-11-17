# model3d-authoring 产品 Skill（BLOCK-460 L0）

3D 造物域的意图编排层（L0）：把用户 3D 创造请求编排进「部件计划 → sand3d 程序 → runner（run_cmd 审批链内）→ GLB → SceneSpec v1(+joints) 归一校验 → 证据」流水线。

- **skill.json**：产品 Skill 契约（id/版本/prompts/参数/输出）。
- **prompts/system.md**：流水线手册 + 关节契约 + 红线。
- 依赖面：L1 runner=`sidecars/sand3d-runner/`（venv pin sand3d==1.6.3，B-1 隔离边界）；L2 归一/校验=`core/petri-server/helpers/scene3d-import.js` + `scene3d.js`（单一真相 additive joints）。
- 架构从属：`docs/3d-authoring-domain-charter.md`（charter §3.2 禁止第二套中间表示——SceneSpec v1 是唯一场景真相）；`docs/block460-scene-joints-plan.md` §0。
- 装载方式：应用运行时经 `skill_discover`/`skill_get`（同 design-brief 先例）；完整性摘要由 `scripts/post-s7-skill-integrity.mjs --write` 唯一写入 manifest。
