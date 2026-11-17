"""BLOCK-459 P0 probe: build a sand3d assembly with revolute + prismatic + follows joints,
export GLB at rest and at a posed state, print fingerprint for determinism check."""
import sand3d as s3d


def build():
    base = s3d.box("base", 100, 60, 10)
    post = s3d.at(s3d.box("post", 12, 12, 80), x=40, z=10)
    arm = s3d.at(s3d.box("arm", 70, 14, 8), x=5, z=90)

    slider = s3d.box("slider", 20, 20, 12)
    slider = s3d.at(slider, on=s3d.bbox(arm, "+X"))
    cap = s3d.box("cap", 10, 10, 6)
    cap = s3d.at(cap, on=s3d.bbox(arm, "+X").move(x=8))

    s3d.joint("hinge_arm", arm, s3d.bbox(post, "+Z"), axis="+Z", range=(0, 90))
    s3d.joint("rail_slider", slider, s3d.bbox(arm, "+X"), kind="prismatic", axis="+X", range=(0, 40))
    s3d.joint("cap_follow", cap, s3d.bbox(arm, "+X").move(x=8), kind="prismatic", axis="+X",
              follows="rail_slider", ratio=0.5)

    return s3d.assembly("probe_machine", base, post, arm, slider, cap)


m = build()
print("fingerprint_a:", s3d.fingerprint())
s3d.export(m, "probe-rest.glb")
s3d.export(m, "probe-rest.urdf")
s3d.pose(m, 45, joint="hinge_arm")
s3d.export(m, "probe-posed45.glb")
print("fingerprint_b:", s3d.fingerprint())
print("exported ok")
