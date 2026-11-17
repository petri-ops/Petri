# sand3d-runner sidecar（BLOCK-460 L1 几何生产执行器）

sand3d 程序的本地受控入口。**纪律**（`docs/block460-scene-joints-plan.md` §1-C + 3D charter §3.4）：

- agent 只能经 **run_cmd（guard-ack 审批链）** 调用本脚本，禁止任何绕过审批的第二通道、零新 IPC；
- Python 依赖只进本 sidecar 自管 venv（`SAND3D_VENV` env 可覆盖路径），pin `sand3d==1.6.3`；
  **不装全局、不进产品 manifest**（依赖裁决 U-3D-D1/B-1 边界）；
- `--program` / `--out` 只收工作区相对路径（禁绝对路径与 `..`）；
- 程序内 `s3d.export(...)` 必须用**相对文件名**（runner 以 `--out` 为 cwd，产物落该目录）；
- stdout 唯一机器可读出口 = 一行 JSON 契约；失败 `{ok:false,error,...}` 退出码 1，不伪造成功。

## 用法

```bash
# 1) 幂等 bootstrap（venv + pin 安装；SAND3D_PYTHON 可指定宿主解释器，默认 python3.11）
node sidecars/sand3d-runner/sand3d-runner.mjs bootstrap

# 2) 执行程序（程序示例见 resources/skills/3d-authoring/ 与 acceptance/block460/）
node sidecars/sand3d-runner/sand3d-runner.mjs run --program model3d/probe_assembly.py --out model3d/runs/probe
```

## 输出契约（run 成功）

```json
{
  "ok": true,
  "out": "model3d/runs/probe",
  "artifacts": [{"name": "probe.glb", "bytes": 6168, "sha256": "…"}],
  "fingerprint": "fee4e403d8206135",        // 程序 stdout 的 s3d.fingerprint()（缺席则 null）
  "programSha256": "…"
}
```

## 下游

GLB 产物经 `core/petri-server/helpers/scene3d-import.js::importSand3dGlb` 归一为 SceneSpec v1(+joints)
（rest 校验 fail-closed：posed 导出拒绝）。完整链路见 `resources/skills/3d-authoring/` Skill 手册。

## 跨端

`venvPython()` 按 win32/darwin/linux 分支取 `Scripts/python.exe` / `bin/python`；Windows 侧首次使用前
按 dev-infra §76 条款 ⑧ 冒烟一次（bootstrap + run 各一）。
