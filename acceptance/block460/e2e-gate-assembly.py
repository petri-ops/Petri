"""BLOCK-460 端到端程序：带门（revolute）与抽屉（prismatic）的柜体装配。

sand3d 程序契约（resources/skills/model3d-authoring/prompts/system.md）：
- mm 单位、命名部件、程序末尾相对文件名导出 + fingerprint 打印；
- 不调用 pose（rest 导出；归一器对非零关节值 fail-closed）。
"""
import sand3d as s3d

body = s3d.box("body", 200, 120, 300)
door = s3d.at(s3d.box("door", 180, 14, 280), y=-67, z=10)
drawer = s3d.at(s3d.box("drawer", 160, 100, 60), y=-20, z=220)

leaf = s3d.group("leaf", door)
s3d.joint("door_hinge", leaf, s3d.bbox(body, "-Y-X"), axis="+Z", range=(0, 100))
s3d.joint("drawer_slide", drawer, s3d.bbox(body, "-Y"), kind="prismatic", axis="-Y", range=(0, 80))

cabinet = s3d.assembly("cabinet", body, leaf, drawer)
print("fingerprint:", s3d.fingerprint())
s3d.export(cabinet, "cabinet.glb")
print("e2e assembly exported ok")
