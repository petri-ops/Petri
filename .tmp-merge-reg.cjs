// BLOCK-109 rebase 冲突解决：DOC-REGISTRY（JSON 结构化合并）+ roadmap + AUDIT-LOG（头部并集 + 记录行并集）
const fs = require('fs');

// ---------- DOC-REGISTRY：两侧各自登记了不同 id 的新包，合并为两条并存 ----------
const rp = 'docs/DOC-REGISTRY.json';
let raw = fs.readFileSync(rp, 'utf8');
// 先机械去冲突标记：HEAD 侧与 768eb2c1 侧都保留，交给后续去重逻辑
const start = raw.indexOf('<<<<<<< HEAD');
const mid = raw.indexOf('=======', start);
const end = raw.indexOf('>>>>>>>', mid);
const ours = raw.slice(start + '<<<<<<< HEAD\n'.length, mid);
const theirs = raw.slice(mid + '=======\n'.length, end).replace('>>>>>>> 768eb2c1 (feat(block-109): 子智能体编排呈现与韧性四件套——瞬断重试/并行度软上限/结果卡组化/概览孤儿过滤——UI-432)\n', '');
// 解析两段（各含 documents 数组片段）→ 提取新增的 entry 对象
const grabEntries = (segment) => {
  const ids = [];
  const re = /\{\s*"id": "([^"]+)"[\s\S]*?\n  \},/g;
  return { segment, ids };
};
// 简化：分别把两段补齐为合法 JSON 数组结尾解析
const parseChunk = (chunk, tail) => {
  // chunk 形如若干 entry 对象文本；外层补 [ ... ]
  const text = '[' + chunk.replace(/,\s*$/, '') + ']' + tail;
  return text;
};
// 用正则从整段冲突文本中提取两测的全部 entry 对象（以 "id": 开头到平衡的 }）
const extractEntries = (text) => {
  const entries = [];
  const re = /  \{\n(?:  .*\n)*?  \},?\n/g;
  return entries;
};
// 直接用 JSON 修复策略：手工构造合并结果
const idA = 'BLOCK-109-CORE-ARCH-CONVERGENCE';
const idB = 'BLOCK-109-AGENT-ORCHESTRATION-UX';
const sideA = raw.slice(start, mid);   // HEAD（Mac 侧 rebase 后的 theirs? 方向：HEAD=rebase 时的 origin/main）
const sideB = raw.slice(mid + 8, end); // 我的提交侧
const jsonOf = (side) => {
  const m = side.match(/\{[\s\S]*\}/);
  return JSON.parse('[' + m[0].replace(/^\[|\]$/g, '').trim().replace(/,$/, '') + ']');
};
// 冲突段内直接找对象数组：HEAD 段是 documents 数组尾部片段
let entriesA = [], entriesB = [];
try {
  const aText = ours.slice(ours.indexOf('[') === -1 ? 0 : 0);
  // 提取所有顶层对象
  const objRe = /"id": "([^"]+)"/g;
  // 退而求其次：从两侧文本中抽出每个 {"id": ... } 块
  const blockRe = /  \{\n(?:.*\n)*?  \}(?=,?\n)/g;
  const blocksA = ours.match(/  \{\n(?:.*\n)*?  \}/g) || [];
  const blocksB = theirs.match(/  \{\n(?:.*\n)*?  \}/g) || [];
  const parseBlocks = (blocks) => blocks.map((b) => {
    const idm = b.match(/"id": "([^"]+)"/);
    return { id: idm ? idm[1] : null, text: b };
  }).filter((x) => x.id);
  entriesA = parseBlocks(blocksA);
  entriesB = parseBlocks(blocksB);
} catch (e) { console.error('parse err', e.message); }
console.log('A(HEAD) entries:', entriesA.map((e) => e.id).join(','), '| B(theirs) entries:', entriesB.map((e) => e.id).join(','));
fs.writeFileSync(rp + '.debugA', entriesA.map((e) => e.text).join('\n') || '');
fs.writeFileSync(rp + '.debugB', entriesB.map((e) => e.text).join('\n') || '');
