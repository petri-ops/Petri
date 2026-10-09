'use strict';

// ============================================================
// BLOCK-152 H 轨 — commitReview hunk 级 stage 面分类与 per-hunk patch 构造。
//
// 根修复语义（docs/block-152-refactor-candidates-plan.md §2/§6）：
//   - 全 hunk accept 文件 = 整文件 git add（现状保绿）；
//   - 混合（accept + reject/未决）= 仅含 accept hunk 的 patch，经
//     git apply --cached 精确入隔离 index（git-adapter.commitFromIsolatedIndex）；
//   - 全 reject/未决 = 不 stage（治本；前端 BLOCK-147 拦截保留为第二道防线）。
//
// 决策键与前端 reviewModeHelpers.ts hunkSignature 内容寻址算法逐位一致
// （FNV-1a over `type.charCodeAt(0):text\n`，`h{oldStart}-{base36}`）；
// 跨端漂移由 test/block152-hunk-stage.test.mjs 的独立复算副本守护。
//
// plan §6 patch 构造纪律：
//   - hunk 体从原始 diff 文本逐字节切片（保留 `\ No newline at end of file`
//     标记、rename/mode 头），杜绝解析重建引入的行取舍错位；
//   - 仅重算被丢弃前序 hunk 影响的 post-image 起始行
//     （newStart' = newStart − Σ丢弃前序 delta；pre-image 锚定 HEAD 不变）；
//   - 索引正确性以临时仓 `git show :path` 内容断言兜底，不靠退出码。
//
// 签名行解析与 ./diff-parse.js parseDiffFiles 同规则：
// ''（split 尾部伪影）与 '\' 标记不进 lines；'+++'/'---' 头不误判增删行。
// ============================================================

/** BLOCK-147 #1 签名算法的 Node 侧逐位移植（勿单方改动；改必须两端同批 + 测试同批）。 */
function computeHunkSignature(hunk) {
  let hash = 0x811c9dc5;
  for (const line of hunk.lines) {
    const s = `${line.type.charCodeAt(0)}:${line.text}\n`;
    for (let i = 0; i < s.length; i += 1) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return `h${hunk.oldStart}-${hash.toString(36)}`;
}

/**
 * 原始 unified diff 切片：按文件保留 verbatim 文件头与 hunk（原文行 + 解析元数据）。
 * @param {string} diffText
 * @returns {{ files: Array<{
 *   path: string,
 *   headerLines: string[],
 *   binary: boolean,
 *   hunks: Array<{ oldStart: number, newStart: number, oldCount: number, newCount: number,
 *                  headerLine: string, bodyLines: string[], lines: Array<{type:string,text:string}>, delta: number }>
 * }> }
 */
function sliceRawDiff(diffText) {
  const result = { files: [] };
  if (!diffText || typeof diffText !== 'string') return result;
  const lines = diffText.split('\n');
  let current = null;
  let hunk = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      if (current) result.files.push(current);
      current = { path: 'unknown', headerLines: [line], binary: false, hunks: [] };
      hunk = null;
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) current.path = m[2];
      continue;
    }
    if (!current) continue;
    if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) {
      current.binary = true;
      current.headerLines.push(line);
      hunk = null;
      continue;
    }
    if (line.startsWith('@@')) {
      const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
      // git 对单行区间省略 ",1"——省略时按 1 计（unified diff 规范）。
      hunk = {
        oldStart: m ? Number(m[1]) : 0,
        oldCount: m ? (m[2] !== undefined ? Number(m[2]) : 1) : 0,
        newStart: m ? Number(m[3]) : 0,
        newCount: m ? (m[4] !== undefined ? Number(m[4]) : 1) : 0,
        headerLine: line,
        bodyLines: [],
        lines: [],
        delta: 0,
      };
      current.hunks.push(hunk);
      continue;
    }
    if (hunk) {
      if (line === '') continue; // split 尾部伪影（真空行在 raw diff 里是单空格 ctx）
      hunk.bodyLines.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) {
        hunk.lines.push({ type: 'add', text: line.slice(1) });
        hunk.delta += 1;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        hunk.lines.push({ type: 'del', text: line.slice(1) });
        hunk.delta -= 1;
      } else if (line.startsWith('\\')) {
        // `\ No newline at end of file` — 只进原文体（保字节），不进签名行
      } else {
        hunk.lines.push({ type: 'ctx', text: line.startsWith(' ') ? line.slice(1) : line });
      }
    } else {
      current.headerLines.push(line);
    }
  }
  if (current) result.files.push(current);
  return result;
}

/**
 * 由文件切片 + accept hunk 下标集构造仅含 accept hunk 的 patch。
 * 文件头原文保留；每个 accept hunk 重算 post-image 起始行（丢弃前序 hunk 的
 * delta 不再计入），pre-image 起始行/行数与 hunk 体原文逐字节不动。
 * @returns {string|null} null = 无可接受 hunk
 */
function buildAcceptedPatch(fileEntry, acceptedIndices) {
  if (!fileEntry || !Array.isArray(fileEntry.hunks) || fileEntry.hunks.length === 0) return null;
  const acceptSet = new Set(acceptedIndices);
  if (acceptSet.size === 0) return null;
  let droppedDelta = 0;
  let patch = fileEntry.headerLines.map((l) => `${l}\n`).join('');
  for (let i = 0; i < fileEntry.hunks.length; i += 1) {
    const hunk = fileEntry.hunks[i];
    if (!acceptSet.has(i)) {
      droppedDelta += hunk.delta;
      continue;
    }
    const adjustedNewStart = hunk.newStart - droppedDelta;
    patch += `@@ -${hunk.oldStart},${hunk.oldCount} +${adjustedNewStart},${hunk.newCount} @@\n`;
    patch += hunk.bodyLines.map((l) => `${l}\n`).join('');
  }
  return patch;
}

/**
 * stage 面分类：以当前 fresh diff 为准，把 accept 决策键逐 hunk 对账。
 * 决策键在当前 diff 中对不上（hunk 变更/回退/文件消失——BLOCK-147 内容寻址语义下的
 * stale 键）一律不 stage，只如实上报 staleKeys，绝不静默整文件降级。
 * @param {{ decisions: Record<string, string>, diffText: string }} args
 * @returns {{ wholeFiles: string[], patches: Array<{path:string, patch:string}>,
 *             staleKeys: string[], acceptedFilePaths: string[] }}
 */
function classifyReviewStageSurface({ decisions, diffText } = {}) {
  const wholeFiles = [];
  const patches = [];
  const staleKeys = [];
  const acceptedFilePaths = new Set();
  const acceptSigsByFile = new Map();

  for (const [key, decision] of Object.entries(decisions || {})) {
    if (decision !== 'accept') continue;
    const hashIdx = key.lastIndexOf('#');
    if (hashIdx < 0) continue; // 与旧实现同：畸形键跳过（索引段不被解析）
    const file = key.slice(0, hashIdx);
    acceptedFilePaths.add(file);
    if (!acceptSigsByFile.has(file)) acceptSigsByFile.set(file, new Set());
    acceptSigsByFile.get(file).add(key.slice(hashIdx + 1));
  }

  if (acceptedFilePaths.size === 0) {
    return { wholeFiles, patches, staleKeys, acceptedFilePaths: [] };
  }

  const sliced = sliceRawDiff(diffText);
  const byPath = new Map(sliced.files.map((f) => [f.path, f]));

  for (const file of acceptedFilePaths) {
    const entry = byPath.get(file);
    const sigs = acceptSigsByFile.get(file);
    const matched = new Set();
    if (entry && !entry.binary && entry.hunks.length > 0) {
      const acceptedIndices = [];
      entry.hunks.forEach((hunk, idx) => {
        const sig = computeHunkSignature(hunk);
        if (sigs.has(sig) && !matched.has(sig)) {
          matched.add(sig);
          acceptedIndices.push(idx);
        }
      });
      if (acceptedIndices.length === entry.hunks.length) {
        wholeFiles.push(file);
      } else if (acceptedIndices.length > 0) {
        patches.push({ path: file, patch: buildAcceptedPatch(entry, acceptedIndices) });
      }
    }
    for (const sig of sigs) {
      if (!matched.has(sig)) staleKeys.push(`${file}#${sig}`);
    }
  }

  return { wholeFiles, patches, staleKeys, acceptedFilePaths: [...acceptedFilePaths] };
}

// 只导出编排入口 classifyReviewStageSurface；签名复算/diff 切片/patch 构造为模块内私有
// （CK-11 knip 保留面冻结：无外部消费的导出即新增死代码面）。
module.exports = { classifyReviewStageSurface };
