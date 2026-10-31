/**
 * sceneFeatures.ts — BLOCK-322 P3-03 v2b 第二票：前端特征表（与后端 model3d-features.js 同源移植）。
 *
 * R4 架构规则禁止前端引后端实现——同源移植、漂移由两侧契约测试对账（同 packWriteBridge 模式）。
 * 约束编辑器消费面：node 选中 → 特征下拉（derivePrimitiveFeatures 输出）→ mate 表单。
 */

export interface SceneFeatureRow {
  id: string;
  feature: string;
  kind: string;
  parts: string[];
  center?: number[];
  dimsKey?: string;
  size?: number;
  radius?: number;
}

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

function sha256(text: string): string {
  // 轻量同步 sha256（与后端 crypto.createHash('sha256') 对账；Web Crypto 为 async，此处用纯 JS 实现）
  // prettier-ignore
  const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) { bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f)); }
    else { bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f)); }
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i -= 1) bytes.push(Math.floor(bitLen / 2 ** (i * 8)) & 0xff);
  const w = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = (bytes[offset + i * 4] << 24) | (bytes[offset + i * 4 + 1] << 16) | (bytes[offset + i * 4 + 2] << 8) | bytes[offset + i * 4 + 3];
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = ((w[i - 15] >>> 7) | (w[i - 15] << 25)) ^ ((w[i - 15] >>> 18) | (w[i - 15] << 14)) ^ (w[i - 15] >>> 3);
      const s1 = ((w[i - 2] >>> 17) | (w[i - 2] << 15)) ^ ((w[i - 2] >>> 19) | (w[i - 2] << 13)) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
}

function quant2(value: number): number {
  return Number(Number(value).toFixed(2));
}

function featureId(parts: string[]): string {
  return 'feat:' + sha256('feature/v1|' + parts.join('|')).slice(0, 24);
}

const PLANAR_FACES_BY_TYPE: Record<string, string[]> = {
  box: ['+x', '-x', '+y', '-y', '+z', '-z'],
  cylinder: ['+z', '-z'],
};

interface SceneNodeLite {
  id: string;
  type: string;
  dimensions?: Record<string, unknown>;
}

/** 基元节点特征表（与后端 derivePrimitiveFeatures 同源：同输入同 id）。 */
export function deriveSceneFeatures(node: SceneNodeLite): SceneFeatureRow[] {
  const dims = node.dimensions && typeof node.dimensions === 'object' ? node.dimensions : {};
  const features: SceneFeatureRow[] = [];
  const half = {
    x: (Number(dims.width) || 0) / 2,
    y: (Number(dims.depth) || 0) / 2,
    z: (Number(dims.height) || 0) / 2,
  };
  const push = (feature: string, kind: string, extra: string[]) => {
    const parts = [node.type, feature, kind, ...extra];
    features.push({ id: featureId(parts), feature, kind, parts, ...Object.fromEntries(extra.map((e) => e.split(':')).filter((p) => p.length === 2).map(([k, v]) => [k, Number.isFinite(Number(v)) ? Number(v) : v])) });
  };
  if (node.type === 'box') {
    for (const face of PLANAR_FACES_BY_TYPE.box) {
      const meta = face.match(/^([+-])([xyz])$/);
      if (!meta) continue;
      const sign = meta[1] === '+' ? 1 : -1;
      const axis = meta[2];
      const idx = AXIS_INDEX[axis];
      const dimsKey = { x: 'width', y: 'depth', z: 'height' }[axis] || axis;
      const center = [0, 0, 0];
      center[idx] = half[axis as keyof typeof half] * sign;
      push(face, 'plane', [`center:${center.map(quant2).join(',')}`, `dimsKey:${dimsKey}`, `size:${quant2(Number(dims[dimsKey]) || 0)}`]);
    }
  } else if (node.type === 'cylinder') {
    const radius = quant2(Number(dims.radius) || 0);
    for (const face of PLANAR_FACES_BY_TYPE.cylinder) {
      const sign = face === '+z' ? 1 : -1;
      push(face, 'plane', [`center:0,0,${quant2(half.z * sign)}`, `radius:${radius}`]);
    }
    push('side', 'cylinder', [`radius:${radius}`, `height:${quant2(Number(dims.height) || 0)}`]);
  } else if (node.type === 'sphere') {
    push('surface', 'sphere', [`radius:${quant2(Number(dims.radius) || 0)}`]);
  }
  return features;
}

/** 全场景特征表（按节点聚合）。 */
export function deriveSceneFeatureTable(nodes: SceneNodeLite[]): Record<string, SceneFeatureRow[]> {
  const table: Record<string, SceneFeatureRow[]> = {};
  for (const node of nodes) {
    const features = deriveSceneFeatures(node);
    if (features.length > 0) table[node.id] = features;
  }
  return table;
}
