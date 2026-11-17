> **落点变更（2026-11-18 · BLOCK-460 立项批）**：实探发现既有 SceneSpec v1 链后，按 charter §3.2「禁止第二套中间表示」，canonical 落点改为 SceneSpec v1 additive `joints[]` 扩展（见 docs/block460-scene-joints-plan.md §0）；本文件的 N1–N8 归一规则原样作为归一器实现输入，JSON 形态仅作字段参照。
# Scene IR v0 契约草案（BLOCK-459 探针产物 · P1 canonical 化底稿）

> 性质：**草案**（acceptance 证据，非 canonical）。P1 立项时在其 plan 内 canonical 化并登记 DOC-REGISTRY；本文件不登记第二真相。
> 实测依据：`PROBE-REPORT.md` §2/§3（sand3d 1.6.3 导出实测，非文档转述）。

## 0. 设计原则（沿 charter §3）

- L1 只生产 IR、L3/L4 只消费 IR；禁止第二套中间表示（charter §3.2）。
- fail-closed：校验失败阻断产出并留痕，不静默降级（charter §3.3）。
- 零新依赖：IR 校验器手写（`frontend`/`core` 侧零 npm 依赖，JSON Schema 式手写校验沿 gen-ui 评估路径 A 惯例）。

## 1. Schema（v0）

```jsonc
{
  "schemaVersion": "0.1",                     // v0 草案版本；P1 canonical 化时定 "1.0"
  "source": {
    "producer": "sand3d",                     // 导出来源（L1 可替换判据）
    "producerVersion": "1.6.3",
    "programDigest": "sha256-<程序指纹>",      // s3d.fingerprint() 或程序文件 sha256
    "units": { "program": "mm", "ir": "m" }   // 实测混合单位 → IR 统一米
  },
  "nodes": [                                  // 非关节节点（part/assembly/frame）
    {
      "id": "arm",                            // = GLB node.name（同层唯一）
      "kind": "part",                         // part(mesh 在场) | assembly(有 children 无 mesh) | frame(无 mesh 无 mesh 子树锚点)
      "parent": "hinge_arm",                  // GLB 父节点名；根为 null
      "transform": {                          // 归一米；从 GLB 层级乘积或逐节点 ×1e-3
        "translation": [0.0, 0.09, 0.0],      // 米
        "rotation": [x, y, z, w],             // GLB 节点 rotation 原样（四元数）
        "scale": [1, 1, 1]
      },
      "mesh": { "glbMeshIndex": 3, "sourceUnits": "mm" }  // mesh 在场才有；sourceUnits 留给消费端复核
    }
  ],
  "joints": [
    {
      "id": "hinge_arm",                      // = s3d_joint.name
      "name": "hinge_arm",
      "child": "arm",                         // 关节节点的 children[0]
      "parent": "post",                       // 关节节点的父节点
      "kind": "revolute",                     // 导出层值域: revolute|prismatic|continuous|floating（程序层 free→floating 归一）
      "axis": [0, 0, 1],                      // 父/世界系（由关节节点 rotation 变换局部 +Y 所得）；floating 无 axis=null
      "range": { "min": 0, "max": 1.5707963267948966, "unit": "rad" },  // prismatic unit="m"；continuous/floating 无 range
      "value": 0.0,                           // 导出时刻关节值（rest=0）；rest 校验判据
      "follows": null,                        // mimic.joint 或 null
      "ratio": null                           // mimic.multiplier 或 null（follows 时必有 ratio）
    }
  ],
  "materials": [                              // v0 直通 GLB material 引用（P3 viewer 细化）
    { "id": "mat-0", "pbr": { "glbMaterialIndex": 0 } }
  ],
  "evidence": {
    "glbSha256": "2e803be3…",                 // 源 GLB 摘要（truth 链复现锚）
    "exportedAt": "2026-11-18T01:23:51Z",
    "verifierResults": []                     // L4 填充：{ tool, verdict, diagnosticsRef, digest, at }
  }
}
```

## 2. 归一规则（GLB extras → IR v0）

| # | 规则 | 实测依据 |
|---|---|---|
| N1 | 关节节点（extras 含 `s3d_joint`）→ `joints[]`，其 children[0]→`child`、父节点→`parent`；其余节点→`nodes[]` | PROBE-REPORT §2 |
| N2 | `s3d_joint.type` 原样四值；程序层 `free` 已由导出层写为 `floating`，IR 不再做别名（消费端文档登记） | probe-kinds 实测 |
| N3 | `axis`：取 `s3d_joint.axis`（局部 +Y）经关节节点 rotation（四元数）变换到父/世界系；floating→null | 四元数验算（[0.5,0.5,-0.5,0.5]·[0,1,0]=[1,0,0]） |
| N4 | `range`：revolute→unit="rad"，prismatic→unit="m"，continuous/floating→无 range；lower/upper 原样（导出层已归一米/弧度） | PROBE-REPORT §2 表 |
| N5 | `transform.translation/scale`：程序单位→米（×1e-3，mm 默认；units 可从 program 段读）；`rotation` 原样 | mesh accessor 与 URDF 交叉对照 |
| N6 | `mimic{joint,multiplier}` → `follows`/`ratio`；无 mimic → null | cap_follow 实测 |
| N7 | rest 校验：全部 `value==0` 才接受为 rest 导出；否则 fail-closed 拒绝并留痕（首版不消费 posed 导出） | posed45 实测（value=0.785） |
| N8 | 确定性：IR 附 `glbSha256` + `source.programDigest`；双进程 GLB sha256 一致作为 L1 判据 | SHA256SUMS.txt |

## 3. fail-closed 校验器要点（P1 实施红线）

- 必填字段缺失 / kind 越界 / units 缺失 / value≠0（rest 校验）→ 拒绝整份 IR，产出诊断 JSON，不产出半份 IR。
- `id` 同层唯一、`child/parent` 引用必须存在（无悬空引用）。
- follows 指向的 joint id 必须在场且非自身（禁止环）。
- 数值字段必须有限数（NaN/Infinity 拒绝）。

## 4. 与五层架构的对位

| 层 | 本契约的角色 |
|---|---|
| L1 | sand3d runner 产出 GLB + 程序文本；IR 归一器消费 GLB |
| L2 | 本契约 = L2 枢纽；校验器 fail-closed（P1 红绿先行：先写植红测试再实现） |
| L3 | viewer 包消费 IR 渲染（P3） |
| L4 | verifierResults 入 truth 链，sha256 复现（P2） |
