"""BLOCK-459 P0 probe: verify blueprint §4.3 six-row mapping against the MEASURED GLB extras.
Reads the JSON dump produced by parse_glb.py, walks nodes, and emits a per-row verdict:
  direct   — field(s) found with expected semantics, mappable as-is
  convert  — field(s) found but needing a documented transform
  gap      — field(s) not present in extras (needs another source or is unsupported)
"""
import json
import sys

EXPECTED_ROWS = [
    ("R1 name",       ["name"],                    "joint name"),
    ("R2 kind",       ["kind"],                    "revolute|prismatic|continuous|free"),
    ("R3 axis+range", ["axis", "range"],           "axis vector or named direction; range [min,max]"),
    ("R4 follows+ratio", ["follows", "ratio"],     "丝杠耦合（依赖关节值）"),
    ("R5 assembly tree", ["children/parent"],      "nodes 树 + frame/anchor 节点"),
    ("R6 units mm→m", ["translation scale"],       "export 缩放到米（transform 单位核对）"),
]


def collect_joint_extras(dump):
    """Collect all extras that look like joint payloads, keyed by node name."""
    joints = []
    for n in dump.get("nodes", []):
        ex = n.get("extras")
        if isinstance(ex, dict) and any(k in ex for k in ("joint", "joints", "kind", "axis", "range", "follows")):
            joints.append({"node": n.get("name"), "nodeIndex": n.get("index"), "extras": ex})
    return joints


def main(dump_path):
    dump = json.load(open(dump_path))
    joints = collect_joint_extras(dump)
    verdicts = {}
    for row, fields, _desc in EXPECTED_ROWS:
        found = {}
        for j in joints:
            for f in fields:
                for k in j["extras"] if isinstance(j["extras"], dict) else []:
                    if f.split("/")[0] in k or k == f:
                        found.setdefault(f, []).append(f"{j['node']}.{k}")
        verdicts[row] = {
            "fields": fields,
            "found": found,
            "verdict": "direct" if all(any(f in ff for ff in found) for f in fields) else ("convert" if found else "gap"),
        }
    print(json.dumps({"jointExtrasNodes": len(joints), "verdicts": verdicts}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
