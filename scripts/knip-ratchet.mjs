#!/usr/bin/env node
/**
 * scripts/knip-ratchet.mjs — knip 死代码保留面棘轮（CK-11 收官冻结，新增即红）
 *
 * CK-11 六批收官后死代码面已收敛至保留面（exports 全数定性：盲区误报/测试契约/
 * 动态入口/插件 require 盲区，见 AUDIT-LOG 2026-09-25）。本门禁把保留面冻结为
 * test/knip-baseline.json：
 *   - 现存键（exports/types/files 三类逐条 `类别::文件::符号`）= 已定性保留面，放行；
 *   - 新增键（新死导出/新死类型/新死文件）→ FAIL（exit 1）；
 *   - 减少键 = 真清理，只提示 `--update` 下调基线，不拦（基线即真相，同 D7 语义）。
 *
 * 用法：
 *   node scripts/knip-ratchet.mjs           # 检查模式（closeout 门禁 quality:knip:check）
 *   node scripts/knip-ratchet.mjs --update  # 重扫并重打基线（清理后运行）
 *
 * 范围：只冻结死代码三类（exports/types/files）。dependencies/binaries/unlisted 等
 * 依赖解析类别随 npm 环境波动且不在 CK-11 定性范围，不纳入棘轮。
 * `npm run quality:knip` 仍为 report-only 全量报告；本门禁是它的红线化。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test/knip-baseline.json');
const CATEGORIES = ['exports', 'types', 'files'];

function runKnipJson() {
  // 直调仓库内固定版本（devDependency knip）入口——不经 npx（版本漂移会让门禁假红
  // 假绿），也不 spawn .cmd（Node 新版 EINVAL）。缺安装=环境不完整，fail-closed。
  const knipEntry = path.join(ROOT, 'node_modules', 'knip', 'bin', 'knip.js');
  if (!fs.existsSync(knipEntry)) {
    console.error('[knip-ratchet] 未找到本地 knip（devDependency）——请先 `npm install`。');
    process.exit(1);
  }
  const result = spawnSync(process.execPath, [knipEntry, '--reporter', 'json', '--no-exit-code'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    // knip 的 oxc-parser raw-transfer 会一次性申请 ~6GB ArrayBuffer
    // （BLOCK_SIZE 2147483632 + BLOCK_ALIGN 4294967296），本机直接 RangeError
    // （Array buffer allocation failed）。knip 官方提供 KNIP_DISABLE_RAW_TRANSFER=1
    // 走普通反序列化路径：只改解析速度，不改输出契约（BLOCK-244 收口实机抓真）。
    env: { ...process.env, KNIP_DISABLE_RAW_TRANSFER: '1' },
  });
  if (result.error) {
    console.error(`[knip-ratchet] knip 无法启动：${result.error.message}`);
    process.exit(1);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    console.error(`[knip-ratchet] knip 输出不可解析（exit=${result.status}）：\n${(result.stderr || '').slice(0, 2000)}`);
    process.exit(1);
  }
}

/** 归一化：exports/types 取 `类别::文件::符号`，files 取 `files::文件`。 */
function collectKeys(knipJson) {
  const keys = new Set();
  for (const issue of knipJson.issues || []) {
    if ((issue.files || []).length > 0) keys.add(`files::${issue.file}`);
    // 显式访问而非 issue[cat] 动态索引（security/detect-object-injection）
    for (const sym of issue.exports || []) {
      const name = typeof sym === 'string' ? sym : sym.name;
      if (name) keys.add(`exports::${issue.file}::${name}`);
    }
    for (const sym of issue.types || []) {
      const name = typeof sym === 'string' ? sym : sym.name;
      if (name) keys.add(`types::${issue.file}::${name}`);
    }
  }
  return keys;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error('[knip-ratchet] 基线不存在——首次运行 `node scripts/knip-ratchet.mjs --update` 生成。');
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  return baseline;
}

const update = process.argv.includes('--update');
const current = collectKeys(runKnipJson());

if (update) {
  const previous = fs.existsSync(BASELINE_PATH) ? new Set(JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8')).keys) : new Set();
  const added = [...current].filter((k) => !previous.has(k));
  const removed = [...previous].filter((k) => !current.has(k));
  fs.writeFileSync(
    BASELINE_PATH,
    JSON.stringify(
      {
        _about:
          'CK-11 收官保留面冻结（新增即红）：exports/types/files 三类死代码逐条键。' +
          '门禁 scripts/knip-ratchet.mjs（closeout 门禁 quality:knip:check）拦新增键；' +
          '清理后请运行 node scripts/knip-ratchet.mjs --update 下调基线。' +
          'exports 面已经 CK-11 六批逐案定性（盲区误报/测试契约/动态入口）；types/files 为现存面上界冻结。',
        schemaVersion: 1,
        categories: CATEGORIES,
        updatedAt: new Date().toISOString().slice(0, 10),
        keys: [...current].sort(),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`[knip-ratchet] 基线已刷新 → test/knip-baseline.json（${current.size} 键）`);
  if (added.length) console.log(`  + 新增 ${added.length}：\n    ${added.join('\n    ')}`);
  if (removed.length) console.log(`  - 移除 ${removed.length}：\n    ${removed.join('\n    ')}`);
  process.exit(0);
}

const baseline = new Set(loadBaseline().keys);
const regressions = [...current].filter((k) => !baseline.has(k)).sort();
const improvements = [...baseline].filter((k) => !current.has(k)).sort();

if (improvements.length > 0) {
  console.log(
    `[knip-ratchet] 保留面已减少 ${improvements.length} 处——请运行 ` +
      `node scripts/knip-ratchet.mjs --update 下调基线以保持真相：\n  ${improvements.join('\n  ')}`,
  );
}

if (regressions.length > 0) {
  console.error(
    `[knip-ratchet] FAIL：死代码保留面出现 ${regressions.length} 处新增（CK-11 保留面已冻结，新增即红）。` +
      `新死代码应删除或定性（动态入口/测试契约等留痕于提交说明），确属保留则先定性再 --update：\n  ` +
      `${regressions.join('\n  ')}`,
  );
  process.exit(1);
}

console.log(`[knip-ratchet] PASS（保留面 ${baseline.size} 键冻结，无新增）`);
