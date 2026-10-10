/**
 * BLOCK-20 PHASE 4 — `applyInverseHunk` / `invertUnifiedDiff` per-hunk 粒度门禁。
 *
 * 现有 git-adapter.test.mjs 仅覆盖：
 *   - 输入校验（空 / null patch 抛 patch_required）
 *   - 单一整文件正向 patch 一次性全部 revert
 *
 * 本文件专门验证 *per-hunk 粒度* 的预期：
 *   1. `invertUnifiedDiff` 纯函数级别的字符串行为（间接通过
 *      `applyInverseHunk` 观察 working tree 状态与错误码；
 *      不修改 production 代码，遵循 option (a)）。
 *   2. 真实工作区中：3 个 hunk → 仅 reject 第 N 个；相邻 hunk；
 *      单行 hunk；空 diff 报错。
 *
 * 工区沿用 test/git-adapter.test.mjs 同样路径策略（系统 git + 临时目录）。
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createGitAdapter, GitAdapterError } = require('../core/shared-backend/git-adapter');

const gitReady = (() => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

// ---------------------------------------------------------------------------
// Helpers (copied locally to keep this file independent from git-adapter.test.mjs)
// ---------------------------------------------------------------------------

function makeWorkspace(context, prefix = 'petri-b20-per-hunk-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  context.after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort cleanup */ }
  });
  return root;
}

function initUserRepository(root) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  execFileSync('git', ['init', '--quiet'], { cwd: root, env });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: root, env });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: root, env });
  writeFileSync(join(root, 'README.md'), '# user project\n');
  execFileSync('git', ['add', 'README.md'], { cwd: root, env });
  execFileSync('git', ['commit', '--quiet', '-m', 'initial'], { cwd: root, env });
}

function commitFile(root, relative, content, message) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  writeFileSync(join(root, relative), content);
  execFileSync('git', ['add', relative], { cwd: root, env });
  execFileSync('git', ['commit', '--quiet', '-m', message], { cwd: root, env });
}

function createAdapter(root) {
  return createGitAdapter({ gitDir: join(root, '.git'), workTree: root });
}

function throwsWithCode(fn, expectedCode) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof GitAdapterError, `expected GitAdapterError, got ${error?.name}`);
    assert.equal(error.code, expectedCode);
    return true;
  });
}

/**
 * 从多 hunk unified diff 中抽出第 n 个 hunk，并附 `---`/`+++` header。
 * 这是前端 per-hunk reject 时的标准切片方式：每个 hunk 单独调用
 * `applyInverseHunk`，从而获得 per-hunk 粒度的撤销能力。
 *
 * 注意末尾追加 `\n`：被切的 hunk body 末尾原本会有换行（与下一个 @@ 分隔），
 * `split('\n')` 会把它吃光，喂给 git apply 时若无 trailing newline 会触发
 * `corrupt patch at line N`（实测复现），因此这里补一个。
 */
function extractNthHunk(patch, n) {
  const lines = patch.split('\n');
  const dashIdx = lines.findIndex((l) => l.startsWith('---'));
  const plusIdx = lines.findIndex((l) => l.startsWith('+++'));
  if (dashIdx < 0 || plusIdx < 0) {
    throw new Error('patch missing --- / +++ file headers');
  }
  const hunkStarts = [];
  for (let i = plusIdx + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('@@')) hunkStarts.push(i);
  }
  if (n < 0 || n >= hunkStarts.length) {
    throw new Error(`hunk index ${n} out of range [0, ${hunkStarts.length})`);
  }
  const start = hunkStarts[n];
  const end = hunkStarts[n + 1] !== undefined ? hunkStarts[n + 1] : lines.length;
  const trimmed = [lines[dashIdx], lines[plusIdx], ...lines.slice(start, end)]
    .filter((l, idx, arr) => !(idx === arr.length - 1 && l === ''));
  return trimmed.join('\n') + '\n';
}

function countHunks(patch) {
  return (patch.match(/^@@/gm) || []).length;
}

// ===========================================================================
// PART 1 — invertUnifiedDiff 纯函数行为（通过 applyInverseHunk 观察）
//
// 不直接调用 module-private 函数；改用可观察的 side-effects：
//   - 工作树最终内容
//   - applyInverseHunk 抛出的稳定 error.code
// 这避免了任何 production 代码改动（遵循 option (a)）。
// ===========================================================================

test('PHASE 4 invert: only + lines become all - lines in the inverse (header counts stay unbalanced → git apply rejects)', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 工作树只在 HEAD 之上做纯增加（无任何删除）
  commitFile(root, 'list.txt', 'a\nb\nc\n', 'baseline');
  writeFileSync(join(root, 'list.txt'), 'a\nb\nc\nnew1\nnew2\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'list.txt' });

  // 前向 hunk 应该只有 + 行（--- header 除外）。
  const bodyLines = side.diff.split('\n').slice(2);
  const plusBody = bodyLines.filter((l) => l.startsWith('+'));
  const minusBody = bodyLines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
  assert.ok(plusBody.length >= 1, `expected + lines, got diff:\n${side.diff}`);
  assert.equal(minusBody.length, 0, `expected no body - lines, got:\n${minusBody.join('\n')}`);

  // 应用 invert：expected failure mode is git_apply_inverse_failed，
  // 因为 invertUnifiedDiff 不重算 hunk 行号，但 hunk body 经过 +/- 翻转后
  // 与 header 中保留的旧计数不再一致 — 这正是"按字符翻转"实现的边界。
  let caught;
  try { adapter.applyInverseHunk({ patch: side.diff }); } catch (error) { caught = error; }
  assert.ok(caught instanceof GitAdapterError, 'expected GitAdapterError');
  assert.equal(caught.code, 'git_apply_inverse_failed', `unexpected code: ${caught.code}`);
  // 工作树 content 不应被破坏（apply 失败时 git apply 应当 fail-closed）。
  assert.equal(readFileSync(join(root, 'list.txt'), 'utf-8'), 'a\nb\nc\nnew1\nnew2\n');
});

test('PHASE 4 invert: only - lines become all + lines in the inverse (same unbalanced boundary)', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 工作树只删除了中间几行（无新增）
  commitFile(root, 'list.txt', 'a\nb\nc\nd\ne\n', 'baseline');
  writeFileSync(join(root, 'list.txt'), 'a\nc\ne\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'list.txt' });

  const bodyLines = side.diff.split('\n').slice(2);
  const minusBody = bodyLines.filter((l) => l.startsWith('-') && !l.startsWith('---'));
  const plusBody = bodyLines.filter((l) => l.startsWith('+') && !l.startsWith('+++'));
  assert.ok(minusBody.length >= 1, `expected - lines, got diff:\n${side.diff}`);
  assert.equal(plusBody.length, 0, `expected no body + lines, got:\n${plusBody.join('\n')}`);

  let caught;
  try { adapter.applyInverseHunk({ patch: side.diff }); } catch (error) { caught = error; }
  assert.ok(caught instanceof GitAdapterError, 'expected GitAdapterError');
  assert.equal(caught.code, 'git_apply_inverse_failed', `unexpected code: ${caught.code}`);
  assert.equal(readFileSync(join(root, 'list.txt'), 'utf-8'), 'a\nc\ne\n');
});

test('PHASE 4 invert: mixed +/- / context — context preserved, +/- flipped, full revert succeeds', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  commitFile(root, 'data.txt', 'line1\nline2\nline3\nline4\n', 'baseline');
  // 修改 line2 + 增加 line4.5 + 删除 line4，整体平衡
  writeFileSync(join(root, 'data.txt'), 'line1\nLINE-TWO\nline3\nline3.5\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'data.txt' });
  // patch 中既有 + 也有 -
  assert.ok(side.diff.includes('-line2'), `expected -line2, got:\n${side.diff}`);
  assert.ok(side.diff.includes('+LINE-TWO'), `expected +LINE-TWO, got:\n${side.diff}`);
  // 上下文行原样保留
  assert.ok(side.diff.includes(' line1'), 'expected context line1');
  assert.ok(side.diff.includes(' line3'), 'expected context line3');
  // 成功应用 inverse，恢复 HEAD 内容
  adapter.applyInverseHunk({ patch: side.diff });
  assert.equal(readFileSync(join(root, 'data.txt'), 'utf-8'), 'line1\nline2\nline3\nline4\n');
});

test('PHASE 4 invert: empty / null patch → patch_required guard', () => {
  // 这个 case 不依赖 git（校验只走字符串判断）。
  const adapter = createGitAdapter({ gitDir: join(tmpdir(), '.git-empty'), workTree: tmpdir() });
  throwsWithCode(() => adapter.applyInverseHunk({ patch: '' }), 'patch_required');
  throwsWithCode(() => adapter.applyInverseHunk({ patch: null }), 'patch_required');
  throwsWithCode(() => adapter.applyInverseHunk({}), 'patch_required');
});

test('PHASE 4 invert: header-less patch (@@ + body only) — invertUnifiedDiff pass-through is harmless', { skip: !gitReady }, (context) => {
  // invertUnifiedDiff 不强求 --- / +++：它对所有非 + 起始的非 header 行都透传，
  // 对 header 行透传，对 + / - 行翻转。我们无法在没有 file header 的情况下让
  // `git apply` 找到目标文件，所以这一支必然走到 git_apply_inverse_failed；
  // 关键断言是：失败原因不是 patch_required（说明 invert 阶段已被走完），
  // 也不是别的"拼写"错误，表明该函数不会副作用地修改 @@ body。
  const root = makeWorkspace(context);
  initUserRepository(root);
  commitFile(root, 'headerless.txt', 'baseline\n', 'baseline');
  writeFileSync(join(root, 'headerless.txt'), 'baseline\nadd\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'headerless.txt' });
  const lines = side.diff.split('\n');
  const hunkStart = lines.findIndex((l) => l.startsWith('@@'));
  const headerless = lines.slice(hunkStart).join('\n');
  assert.ok(hunkStart >= 0 && headerless.startsWith('@@'), 'sanity: header-only patch must start with @@');

  let caught;
  try { adapter.applyInverseHunk({ patch: headerless }); } catch (error) { caught = error; }
  assert.ok(caught instanceof GitAdapterError, 'expected GitAdapterError');
  // 失败必须是 git_apply_inverse_failed；不应是 patch_required。
  assert.equal(caught.code, 'git_apply_inverse_failed', `unexpected code: ${caught.code}`);
  // 工作树保持原样
  assert.equal(readFileSync(join(root, 'headerless.txt'), 'utf-8'), 'baseline\nadd\n');
});

test('PHASE 4 invert: multi-hunk forward patch — applyInverseHunk is single-pass (frontend must loop)', { skip: !gitReady }, (context) => {
  // 设计契约（见 git-adapter.js 中注释）："必须是单 hunk 输入；多 hunk 在前端循环调用即可"。
  // 这里验证两件事：
  //   - 一次性的多 hunk 正向 patch，applyInverseHunk 会整体把 working tree 回到 HEAD。
  //   - 我们真正想要的 per-hunk 粒度只能通过"逐 hunk 调用 applyInverseHunk"获得
  //     （下面的 PHASE 4 reject #1 / #2 案例）。
  const root = makeWorkspace(context);
  initUserRepository(root);
  commitFile(
    root,
    'three.txt',
    Array.from({ length: 13 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `c${i + 1}`).join('\n') + '\n',
    'baseline'
  );
  // 三个区域各改一行
  writeFileSync(
    join(root, 'three.txt'),
    Array.from({ length: 5 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
      'A6\n' +
      Array.from({ length: 7 }, (_, i) => `a${i + 7}`).join('\n') + '\n' +
      Array.from({ length: 5 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
      'B6\n' +
      Array.from({ length: 7 }, (_, i) => `b${i + 7}`).join('\n') + '\n' +
      Array.from({ length: 5 }, (_, i) => `c${i + 1}`).join('\n') + '\n' +
      'C6\n' +
      Array.from({ length: 7 }, (_, i) => `c${i + 7}`).join('\n') + '\n'
  );
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'three.txt' });
  // 应当有 3 个独立 hunk（用默认 -U3，行间距足够大）
  assert.equal(countHunks(side.diff), 3, `expected 3 hunks, got:\n${side.diff}`);
  // applyInverseHunk 一次性把全部 hunk revert
  adapter.applyInverseHunk({ patch: side.diff });
  // 回到 baseline
  assert.equal(
    readFileSync(join(root, 'three.txt'), 'utf-8'),
    Array.from({ length: 13 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `c${i + 1}`).join('\n') + '\n'
  );
});

test('PHASE 4 invert: lines with literal + content (++foo) flip first + to - and preserve rest in a balanced hunk', { skip: !gitReady }, (context) => {
  // 这一例里我们故意让前向 hunk 同时含 `-` 与 `+` 操作（含 ++foo 的字面 `+` 行），
  // 使 invertUnifiedDiff 的输出 hunk body 在两侧行数上仍然平衡，git apply 能吃下去。
  // 这才能真正验证"首字符 + 翻 -、其余字符保留"的字符串行为。
  //   HEAD: prev\nfoo\nnext
  //   WT:   prev\n+foo\nnext   （line2 的 foo 被替换为字面的 "+foo"）
  // Forward hunk body:
  //   -foo
  //   ++foo
  // After invertUnifiedDiff body:
  //   +foo
  //   -+foo
  // 两侧各有 1 + 1 = 平衡；旧端 3 行、新端 3 行；header `-1,3 +1,3` 仍然正确。
  // Apply 后 → 恢复 HEAD 字面 `foo`。
  const root = makeWorkspace(context);
  initUserRepository(root);
  commitFile(root, 'plus-content.txt', 'prev\nfoo\nnext\n', 'baseline');
  writeFileSync(join(root, 'plus-content.txt'), 'prev\n+foo\nnext\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'plus-content.txt' });
  // 前向 patch 应包含字面 ++foo（addition 操作 + 内容以 + 开头）
  assert.ok(side.diff.includes('++foo'), `expected ++foo in forward diff, got:\n${side.diff}`);
  assert.ok(side.diff.includes('-foo'), `expected -foo in forward diff, got:\n${side.diff}`);
  // 成功应用 → 字面 `+foo` 行被删除、原始 `foo` 行被恢复
  adapter.applyInverseHunk({ patch: side.diff });
  assert.equal(readFileSync(join(root, 'plus-content.txt'), 'utf-8'), 'prev\nfoo\nnext\n');
});

// ===========================================================================
// PART 2 — Real-world per-hunk reject 场景
//
// 用例都走 makeWorkspace + initUserRepository + splitSideDiff，然后用
// extractNthHunk 拆出单 hunk patch 喂给 applyInverseHunk，验证 per-hunk 粒度。
// ===========================================================================

test('PHASE 4 reject hunk #1 of 3 — only first hunk reverted, others remain', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  commitFile(
    root,
    'three-hunks.txt',
    Array.from({ length: 13 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
      Array.from({ length: 13 }, (_, i) => `c${i + 1}`).join('\n') + '\n',
    'baseline'
  );
  writeFileSync(
    join(root, 'three-hunks.txt'),
    Array.from({ length: 5 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
      'A6\n' +
      Array.from({ length: 7 }, (_, i) => `a${i + 7}`).join('\n') + '\n' +
      Array.from({ length: 5 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
      'B6\n' +
      Array.from({ length: 7 }, (_, i) => `b${i + 7}`).join('\n') + '\n' +
      Array.from({ length: 5 }, (_, i) => `c${i + 1}`).join('\n') + '\n' +
      'C6\n' +
      Array.from({ length: 7 }, (_, i) => `c${i + 7}`).join('\n') + '\n'
  );
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'three-hunks.txt' });
  assert.equal(countHunks(side.diff), 3, `expected 3 hunks, got:\n${side.diff}`);

  // 只 reject 第 0 个 hunk（A6 → a6）
  const onlyFirst = extractNthHunk(side.diff, 0);
  adapter.applyInverseHunk({ patch: onlyFirst });

  const lines = readFileSync(join(root, 'three-hunks.txt'), 'utf-8').split('\n');
  // 文件结构：13 行 a 区域 + 13 行 b 区域 + 13 行 c 区域 + 末尾 \n → split 后是 40 个元素
  // a6 在 lines[5]（0 索引），b6 在 lines[18]，c6 在 lines[31]
  assert.equal(lines[5], 'a6', `expected line 6 to revert to lowercase a6, got: ${lines[5]}`);
  assert.equal(lines[18], 'B6', `expected line 19 (b-region line 6) untouched, got: ${lines[18]}`);
  assert.equal(lines[31], 'C6', `expected line 32 (c-region line 6) untouched, got: ${lines[31]}`);
  // sanity：总行数（39 个真实行 + 1 个空字符串尾巴）
  assert.equal(lines.length, 40, `expected 40 elements (39 lines + trailing ''), got ${lines.length}`);
});

test('PHASE 4 reject second hunk when hunks are adjacent (no shared context) — still safe', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 紧贴的两个变更，用 -U1 让 git 把它们切成 2 个独立 hunk（默认 -U3 会合并）
  commitFile(root, 'adjacent.txt', 'a1\na2\na3\na4\na5\nb1\nb2\nb3\nb4\nb5\n', 'baseline');
  writeFileSync(join(root, 'adjacent.txt'), 'a1\nA2\na3\na4\na5\nb1\nB2\nb3\nb4\nb5\n');
  const adapter = createAdapter(root);
  // 直接走 git diff -U1 取出多 hunk patch（splitSideDiff 暴露 context 参数）
  const side = adapter.splitSideDiff({ path: 'adjacent.txt', context: 1 });
  assert.equal(countHunks(side.diff), 2, `expected 2 adjacent hunks with -U1, got:\n${side.diff}`);
  assert.equal(readFileSync(join(root, 'adjacent.txt'), 'utf-8'), 'a1\nA2\na3\na4\na5\nb1\nB2\nb3\nb4\nb5\n');

  // 只 reject 第 1 个 hunk（B2 → b2）
  const onlySecond = extractNthHunk(side.diff, 1);
  adapter.applyInverseHunk({ patch: onlySecond });

  // 第一个 hunk 的修改保留；第二个 hunk 已 revert
  assert.equal(readFileSync(join(root, 'adjacent.txt'), 'utf-8'), 'a1\nA2\na3\na4\na5\nb1\nb2\nb3\nb4\nb5\n');
});

test('PHASE 4 reject a single-line change hunk works', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 单行变化：middle 被替换为 middle-CHANGED（一个 - 加一个 +，上下文是 first/last）
  commitFile(root, 'one.txt', 'first\nmiddle\nlast\n', 'baseline');
  writeFileSync(join(root, 'one.txt'), 'first\nmiddle-CHANGED\nlast\n');
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'one.txt' });
  assert.equal(countHunks(side.diff), 1, `expected 1 hunk, got:\n${side.diff}`);
  assert.ok(side.diff.includes('-middle'), `expected -middle in diff, got:\n${side.diff}`);
  assert.ok(side.diff.includes('+middle-CHANGED'), `expected +middle-CHANGED in diff, got:\n${side.diff}`);

  const single = extractNthHunk(side.diff, 0);
  adapter.applyInverseHunk({ patch: single });
  assert.equal(readFileSync(join(root, 'one.txt'), 'utf-8'), 'first\nmiddle\nlast\n');
});

test('PHASE 4 reject from unchanged file: splitSideDiff returns empty diff → patch_required', { skip: !gitReady }, (context) => {
  const root = makeWorkspace(context);
  initUserRepository(root);
  // 不修改文件，直接拿 splitSideDiff
  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'README.md' });
  assert.equal(side.diff, '', `expected empty diff for unchanged file, got: ${side.diff.slice(0, 80)}`);
  // 喂给 applyInverseHunk → patch_required（前置输入校验）
  throwsWithCode(() => adapter.applyInverseHunk({ patch: side.diff }), 'patch_required');
});

test('PHASE 4 reject per-hunk selector: extracting each hunk and applying in order yields same final state as full-patch reject', { skip: !gitReady }, (context) => {
  // 这是 per-hunk 工作流的契约验证：
  //   - 全 patch 一次性 reject → working tree 回 HEAD
  //   - 逐 hunk 串行 reject（hunk #0、#1、#2）→ 同上
  // 两条路径必须收敛到同一最终状态；如果将来实现里偷工减料只还原第一个 hunk，
  // 这个 test 就会暴露。
  const root = makeWorkspace(context);
  initUserRepository(root);
  const baselineA = Array.from({ length: 13 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
    Array.from({ length: 13 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
    Array.from({ length: 13 }, (_, i) => `c${i + 1}`).join('\n') + '\n';
  commitFile(root, 'parity.txt', baselineA, 'baseline');

  const mutated = Array.from({ length: 5 }, (_, i) => `a${i + 1}`).join('\n') + '\n' +
    'A6\n' +
    Array.from({ length: 7 }, (_, i) => `a${i + 7}`).join('\n') + '\n' +
    Array.from({ length: 5 }, (_, i) => `b${i + 1}`).join('\n') + '\n' +
    'B6\n' +
    Array.from({ length: 7 }, (_, i) => `b${i + 7}`).join('\n') + '\n' +
    Array.from({ length: 5 }, (_, i) => `c${i + 1}`).join('\n') + '\n' +
    'C6\n' +
    Array.from({ length: 7 }, (_, i) => `c${i + 7}`).join('\n') + '\n';
  writeFileSync(join(root, 'parity.txt'), mutated);

  const adapter = createAdapter(root);
  const side = adapter.splitSideDiff({ path: 'parity.txt' });
  assert.equal(countHunks(side.diff), 3);

  // 路径 A：单次 applyInverseHunk 完成整树回滚
  adapter.applyInverseHunk({ patch: side.diff });
  const finalA = readFileSync(join(root, 'parity.txt'), 'utf-8');
  assert.equal(finalA, baselineA);

  // 路径 B：把工作树改成 mutated，再逐 hunk reject
  writeFileSync(join(root, 'parity.txt'), mutated);
  const side2 = adapter.splitSideDiff({ path: 'parity.txt' });
  assert.equal(countHunks(side2.diff), 3);
  for (let i = 0; i < countHunks(side2.diff); i += 1) {
    adapter.applyInverseHunk({ patch: extractNthHunk(side2.diff, i) });
  }
  const finalB = readFileSync(join(root, 'parity.txt'), 'utf-8');
  // 两条路径必须完全等价
  assert.equal(finalB, finalA, 'per-hunk sequential reject must equal whole-patch reject');
  assert.equal(finalB, baselineA);
});
