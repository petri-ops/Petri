# BLOCK-459 · 3D P0 可行性探针报告（2026-11-18）

> 依据：`docs/block-459-3d-p0-probe-plan.md`（从属 3D-AUTHORING-DOMAIN-CHARTER）。
> 环境：临时隔离 venv `/tmp/block459-sand3d-venv`（python3.11 + bpy 4.5.16 + sand3d 1.6.3，见 `pip-freeze.txt`）；零全局安装、零产品 manifest 改动；venv 与探针脚本均在仓库外，证据已拷贝本目录。
> 结论先行：**映射可行（S3 判据=可行）**——六行映射 4 direct + 2 convert，无不可行缺口；三个实测差异（floating 命名 / 混合单位 / 轴向局部坐标表示）须写进 IR 契约。

## 1. 实测环境

| 项 | 值 |
|---|---|
| Python | 3.11（`/Users/zhangdiandian/.local/bin/python3.11`） |
| bpy | 4.5.16（py3.11 对应轮子，PyPI 直装成功） |
| sand3d | 1.6.3（与裁决材料记载版本一致） |
| 安装 | `pip install sand3d==1.6.3` 一次成功（macOS arm64，网络可达） |
| 平台轮子风险（R1 预案） | 本机未复现；bpy 4.5 有 mac arm64 轮子 |

## 2. extras 真实 schema 实测（非文档转述）

每个关节导出为**一个独立非 mesh 节点**，挂在「父部件节点 → 关节节点 → 子部件节点」链上；关节 payload 在该关节节点的 `extras.s3d_joint`（rest 导出实测原文，另见 `rest-nodes-dump.json` 全文）：

```json
{"s3d_joint": {
  "name": "hinge_arm",            // 关节名（=程序 s3d.joint 名）
  "type": "revolute",             // 值域实测: revolute | prismatic | continuous | floating
  "value": 0.0,                   // 导出时刻关节值（rest=0；posed45=0.785398 rad）
  "axis": [0.0, 1.0, 0.0],        // 关节节点局部坐标系（局部 +Y=运动轴；节点 rotation 把局部系旋到世界）
  "lower": 0.0, "upper": 1.5707963267948966,  // revolute=弧度；prismatic=米（40mm→0.04）
  "mimic": {"joint": "rail_slider", "multiplier": 0.5}  // follows/ratio 时存在（URDF mimic 同构）
}}
```

实测样例（`probe_assembly.py` → `probe-rest.glb`，sha256 `2e803be3…`）：

| 关节 | 程序指定 | extras 实测 |
|---|---|---|
| hinge_arm | revolute, axis=+Z, range=(0,90)° | type=revolute, axis=[0,1,0](局部+Y，节点无旋转=glTF Y-up 世界 +Z), upper=1.5708(rad) |
| rail_slider | prismatic, axis=+X, range=(0,40)mm | type=prismatic, axis=[0,1,0](节点 rot=[0.5,0.5,-0.5,0.5]→局部+Y 映射世界 +X，四元数验算通过), upper=0.04(米) |
| cap_follow | prismatic, follows=rail_slider, ratio=0.5 | type=prismatic, mimic={joint:rail_slider, multiplier:0.5} |
| spin | continuous | type=continuous, axis 在场，无 lower/upper |
| wobble | free | **type="floating"**（非"free"），无 axis、无 range |

**posed 导出验证**（`probe-posed45.glb`）：pose(45°) 烘焙进关节节点 rotation（绕 Y 45° 四元数）且 `value=0.7853981633974483`——证实 api.md「GLB at the current pose」；**首版 IR 只消费 rest 导出（全部 value=0），不用 pose**（蓝图 R1 预案成立）。

**URDF 交叉对照**（`probe-rest.urdf`，头注「metres and radians」）：URDF origin 全为米（0.04/0.09）、axis=局部 +Z 配 rpy、mimic 带offset——与 GLB extras 同构异表示；URDF 可作 P2 仿真链的平行输入（本探针只作交叉验证）。

## 3. 蓝图 §4.3 六行映射逐项判定（机械输出见 `mapping-verdicts.json`）

| 行 | sand3d（GLB extras 实测） | Scene IR | 判定 | 说明 |
|---|---|---|---|---|
| R1 name | `s3d_joint.name` | `joints[].name` | **direct** | 原样搬运 |
| R2 kind | `s3d_joint.type` ∈ {revolute, prismatic, continuous, floating} | 同值域 | **direct（带命名登记）** | ⚠ 程序层叫 `free`，导出层写 `floating`——IR 值域取导出层四值并登记映射 |
| R3 axis+range | `axis`=关节节点局部 +Y（世界方向需用节点 rotation 变换）；`lower/upper`=米/弧度 | `axis` 用父/世界系 + `range` 保留米/弧度并带单位标签 | **convert** | 轴向需一次四元数变换；单位已由导出层归一（米/弧度），IR 不再做二次换算 |
| R4 follows+ratio | `mimic{joint, multiplier}` | `follows`+`ratio` | **direct** | 字段改名搬运；实测无 `offset`（URDF 侧有），IR 可选字段 |
| R5 assembly 树 | GLB node 树（关节节点夹在父子之间；assembly/group=普通节点） | `nodes` 树 + `kind: part|assembly|frame` | **direct** | 关节节点→IR `joints[]`；非关节节点→`nodes[]`（kind 由 mesh/children 判定） |
| R6 单位 | mesh POSITION 与 node translation=**程序单位（mm 默认）**；关节 range/value=**米/弧度**；URDF=全米 | transform 统一米 | **convert** | ⚠ 混合单位是硬发现：IR 归一器对 translation/scale ×1e-3（mm→m），range/value 原样；programUnits 记入 IR source |

## 4. 确定性验证（L1 判据子集）

- **双进程一致**：同一程序两个独立进程导出 → `probe-rest.glb` 与 `probe-rest-run1.glb` sha256 **完全一致**（`2e803be3…`，见 `SHA256SUMS.txt`）。
- **fingerprint**：`s3d.fingerprint()` 两次调用与跨进程均稳定 `fee4e403d8206135`——可作 L1 程序摘要的直接来源（蓝图 L1「双进程 digest」判据在探针尺度成立）。

## 5. 发现与风险登记（供 P1 plan 吸收）

1. **命名 gap**：`free`（程序/API）→ `floating`（GLB 导出）——IR 值域按导出层四值；消费端做一次别名归一。
2. **混合单位**：transform/mesh=程序单位、joint range/value=米/弧度、URDF=全米——IR 归一器必须显式处理，禁止「全部乘 0.001」的粗放换算。
3. **轴向表示**：GLB axis=关节节点局部 +Y（世界方向=节点 rotation 变换所得）；若 IR 存世界系轴向，归一器需做四元数变换（已验算成功）。
4. **当前 pose 导出**（R1）：posed 导出会把 pose 烘进节点变换并记录 value——首版 IR 只接 rest 导出（value 全 0 校验可作为「确系 rest」的机械判据）。
5. 蓝图 R4 预案（首版只支持 revolute/prismatic）仍有效：continuous/floating 先以直通字段登记、不参与首版可动性验证。

## 6. S3（P1 首包）开工判据

**结论：可行（4 direct + 2 convert，零不可行项）。** 依据：
- extras schema 完整可解析（stdlib JSON chunk 解析即可，零第三方依赖）；
- 六行映射全部有实测通路，两个 convert 均为一次变换（四元数/单位缩放），无语义缺口；
- 确定性 digest 通路成立（sha256 + fingerprint 双证据）；
- 沙盒内零产品依赖可达（venv 隔离安装一次成功）。

S3 按 plan §5 判据可启动（用户预授权 B-3 已含「探针可行→P1」路径；P1 是否开工作为 S3 前置在当期按预置裁决执行）。

G0 开发期常态 · 不外推 packaged/Provider/GA。
