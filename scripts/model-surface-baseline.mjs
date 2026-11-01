/**
 * scripts/model-surface-baseline.mjs — BLOCK-325 模型可见面尺寸预算（dsh model-surface.spec 同型）。
 *
 * 测量对象（核心自有面，pack 注入内容不在内——pack 是合法域扩展通道）：
 *   - 系统提示：buildSystemPromptSections(null)（base 角色段 + 原则段；动态上下文随会话变化，不进基线）
 *   - 工具定义：registry.getProviderToolDefs() 全量 JSON 字符量 + 逐工具字面量 + 工具数
 *
 * 棘轮语义（block141 bundle-baseline 同族，dsh「缩文本就下调，上调须在 commit message 说明理由」）：
 *   - 任何指标**增长**即红（systemPromptChars / toolDefsCount / toolDefsChars / perToolChars 任一）；
 *   - 收缩合法；用 `--update` 把基线下调到现状（只许降不许升——update 时对增长指标拒绝写入）；
 *   - 新增工具=toolDefsCount 增长=红，走 --update 留痕。
 *
 * 用法：node scripts/model-surface-baseline.mjs            # 对账（CI 与测试同源）
 *       node scripts/model-surface-baseline.mjs --update   # 收缩后下调基线
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BASELINE_PATH = path.join(ROOT, 'test', 'model-surface-baselines.json');

/** BLOCK-215/217 域中性迁移后，核心模型可见面的退役词（pack 注入内容不在扫描面）。 */
export const RETIRED_TERMS = Object.freeze([
  '单细胞', 'scRNA', 'DESeq2', 'Seurat', 'FigCode', '空间转录组',
]);

/** 测量前自举：registry 族依赖已迁移的 DB（query-tools→db.js）；同 block244 测试姿势
 *  （临时目录 + migrations 全量 + PETRI_DB_PATH/PETRI_LOCAL_DATA_DIR 隔离）。真实后端
 *  进程内 env 已在场则跳过。 */
let _booted = false;
function ensureBackendDatabase() {
  if (_booted) return;
  _booted = true;
  if (process.env.PETRI_DB_PATH && fs.existsSync(process.env.PETRI_DB_PATH)) return;
  bootIsolatedDatabase();
}

/** 真正的自举实现（同步，供 measure 调用）。 */
function bootIsolatedDatabase() {
  const os = require('node:os');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-model-surface-'));
  const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const dbPath = path.join(tempDir, 'petri.db');
  const boot = new Database(dbPath);
  const migrationsDir = path.join(ROOT, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = dbPath;
  process.env.PETRI_LOCAL_DATA_DIR = path.join(tempDir, 'data');
  fs.mkdirSync(process.env.PETRI_LOCAL_DATA_DIR, { recursive: true });
  process.on('exit', () => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* Windows */ }
  });
}

/** 测量核心模型可见面（纯函数式：不落盘）。 */
export function measureModelSurface() {
  ensureBackendDatabase();
  const { buildSystemPromptSections } = require(resolve(ROOT, 'core/petri-server/helpers/system-prompt.js'));
  const { getProviderToolDefs } = require(resolve(ROOT, 'core/petri-server/agent-tools/registry.js'));

  // 确定性代表页：desktop-project 空数据态（含页提示与脚手架模板）为最厚的确定性组装；
  // 动态上下文（真实数据集/任务列表）随会话变化，不进基线。
  const pages = [null, { page: 'desktop-home' }, { page: 'desktop-project' }];
  let systemPromptChars = 0;
  let systemPromptSections = {};
  for (const page of pages) {
    const sections = buildSystemPromptSections(page);
    const chars = sections.sections.reduce((sum, s) => sum + s.chars, 0);
    systemPromptSections[page ? page.page : 'base'] = chars;
    if (chars > systemPromptChars) systemPromptChars = chars;
  }

  const defs = getProviderToolDefs();
  const perTool = {};
  let toolDefsChars = 0;
  let toolDefsJson = '';
  for (const def of defs) {
    const name = def && def.function ? String(def.function.name || '') : '';
    if (!name) continue;
    const json = JSON.stringify(def);
    perTool[name] = json.length;
    toolDefsChars += json.length;
    toolDefsJson += json;
  }
  return {
    systemPromptChars,
    systemPromptSections,
    toolDefsCount: Object.keys(perTool).length,
    toolDefsChars,
    perToolChars: perTool,
    // 扫描面全文（退役词扫描消费；compare/shrink 不读此键）
    _scanText: { systemPrompt: sections0Text(buildSystemPromptSections), toolDefsJson },
  };
}

/** 拼回确定性系统提示全文（供退役词扫描；与 measure 同输入）。 */
function sections0Text(buildSystemPromptSections) {
  return ['base', 'desktop-home', 'desktop-project']
    .map((key) => (key === 'base' ? null : { page: key }))
    .map((page) => buildSystemPromptSections(page).prompt)
    .join('\n');
}

/** 对账：current 相对 baseline 的增长项（空数组=通过）。 */
export function compareAgainstBaseline(current, baseline) {
  const violations = [];
  const growth = (label, now, base) => {
    if (typeof base !== 'number') return; // 基线缺项=新指标，--update 留痕
    if (now > base) violations.push(`${label}: ${now} > ${base}（+${now - base}）`);
  };
  growth('systemPromptChars', current.systemPromptChars, baseline.systemPromptChars);
  growth('toolDefsCount', current.toolDefsCount, baseline.toolDefsCount);
  growth('toolDefsChars', current.toolDefsChars, baseline.toolDefsChars);
  for (const [name, chars] of Object.entries(current.perToolChars || {})) {
    growth(`perTool[${name}]`, chars, (baseline.perToolChars || {})[name]);
  }
  return violations;
}

/** 下调基线：只接受收缩与新指标；任何增长拒绝写入（growth 显式 --force 才可，默认拒绝）。 */
export function shrinkBaseline(current, previous) {
  const next = {
    updatedAt: new Date().toISOString(),
    systemPromptChars: previous.systemPromptChars ?? current.systemPromptChars,
    toolDefsCount: previous.toolDefsCount ?? current.toolDefsCount,
    toolDefsChars: previous.toolDefsChars ?? current.toolDefsChars,
    perToolChars: { ...(previous.perToolChars || {}) },
  };
  for (const [name, chars] of Object.entries(current.perToolChars || {})) {
    const base = next.perToolChars[name];
    next.perToolChars[name] = base === undefined ? chars : Math.min(base, chars);
  }
  next.systemPromptChars = Math.min(next.systemPromptChars, current.systemPromptChars);
  next.toolDefsCount = Math.min(next.toolDefsCount, current.toolDefsCount);
  next.toolDefsChars = Math.min(next.toolDefsChars, current.toolDefsChars);
  return next;
}

function main() {
  const current = measureModelSurface();
  if (process.argv.includes('--update')) {
    const previous = fs.existsSync(BASELINE_PATH)
      ? JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'))
      : {};
    const violations = previous.updatedAt ? compareAgainstBaseline(current, previous) : [];
    if (violations.length > 0) {
      console.error('[model-surface] --update 拒绝写入：检测到增长（增长必须走有意变更并在 commit message 说明理由）：');
      for (const v of violations) console.error('  - ' + v);
      process.exitCode = 1;
      return;
    }
    const next = shrinkBaseline(current, previous);
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + '\n');
    console.log(`[model-surface] 基线已下调 → ${path.relative(ROOT, BASELINE_PATH)}（updatedAt=${next.updatedAt}）`);
    return;
  }
  // 对账模式
  if (!fs.existsSync(BASELINE_PATH)) {
    console.error(`[model-surface] 基线缺席：${path.relative(ROOT, BASELINE_PATH)}（首次落盘请 --update）`);
    process.exitCode = 1;
    return;
  }
  const baseline = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
  const violations = compareAgainstBaseline(current, baseline);
  if (violations.length > 0) {
    console.error('[model-surface] FAIL——模型可见面超出基线（prompt/工具定义通胀是 CI 红线）：');
    for (const v of violations) console.error('  - ' + v);
    console.error('  缩文本后用 --update 下调基线；确属有意增长须在 commit message 说明理由。');
    process.exitCode = 1;
    return;
  }
  console.log(`[model-surface] PASS——systemPrompt=${current.systemPromptChars} chars / toolDefs=${current.toolDefsCount} 个 ${current.toolDefsChars} chars（基线内）`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
