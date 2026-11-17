"""BLOCK-459 P0 probe: parse a GLB's JSON chunk with stdlib only; dump per-node
name/extras/transform so the real extras schema can be recorded verbatim."""
import json
import struct
import sys


def parse_glb_json(path):
    with open(path, "rb") as f:
        magic, version, length = struct.unpack("<4sII", f.read(12))
        assert magic == b"glTF", f"not glTF: {magic!r}"
        assert version == 2, f"not glTF 2.0: {version}"
        chunk_len, chunk_type = struct.unpack("<I4s", f.read(8))
        assert chunk_type == b"JSON", f"first chunk not JSON: {chunk_type!r}"
        return json.loads(f.read(chunk_len).decode("utf-8"))


def main(path):
    g = parse_glb_json(path)
    out = {
        "file": path,
        "asset": g.get("asset"),
        "sceneCount": len(g.get("scenes", [])),
        "rootNodes": g.get("scenes", [{}])[0].get("nodes", []),
        "nodes": [],
    }
    for i, n in enumerate(g.get("nodes", [])):
        out["nodes"].append({
            "index": i,
            "name": n.get("name"),
            "mesh": n.get("mesh"),
            "children": n.get("children"),
            "translation": n.get("translation"),
            "rotation": n.get("rotation"),
            "scale": n.get("scale"),
            "extras": n.get("extras"),
        })
    # top-level extras if any (scene-level joint data may live here)
    out["topLevelExtrasKeys"] = sorted(g.keys())
    print(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1])
