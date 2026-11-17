import sand3d as s3d

base = s3d.box("kbase", 60, 60, 8)
wheel = s3d.at(s3d.cylinder("wheel", 30, 10), x=20, z=8)
dial = s3d.at(s3d.box("dial", 15, 15, 8), x=-20, z=8)
s3d.joint("spin", wheel, s3d.bbox(base, "+Z").move(x=20), kind="continuous")
s3d.joint("wobble", dial, s3d.bbox(base, "+Z").move(x=-20), kind="free")
m = s3d.assembly("kind_probe", base, wheel, dial)
s3d.export(m, "probe-kinds.glb")
print("kinds exported ok")
