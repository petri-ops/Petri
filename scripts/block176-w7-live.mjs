/**
 * scripts/block176-w7-live.mjs — BLOCK-176 W7 波实机探针（CP-20/21/22 出口断言）。
 *
 * A[CP-20] 双格式注册：skills:check 全绿（14 技能）+ 真实仓发现 9 件 skill-md。
 * B[CP-21] preflight 三态：真实 which/where 探测 + 缺依赖技能诚实报告；
 *          安装审批链=既有 run_cmd guard-ack 链（源码对齐+指引在场），真实全局安装
 *          留待用户授权会话（不越权污染全局环境）。
 * C[CP-21 全链本机实证]：defuddle 技能「探测(installable)→本地隔离安装(npm --prefix
 *          临时目录，零全局污染)→PATH 注入后复核(available)」三步留痕。
 * D[CP-22] 九技能迁移在册 + knap 手册渐进披露可读（get 面=真实注册表数据）。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-176');

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 160)}`);
};

// A[CP-20]：skills:check（双格式校验门真实执行）
let skillsCheckOut = '';
try {
  skillsCheckOut = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'skill-scaffold.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
} catch (e) {
  skillsCheckOut = String(e.stdout || '') + String(e.stderr || '');
}
record('A.skills-check-dual-format', /PASS/.test(skillsCheckOut) && /9 SKILL\.md/.test(skillsCheckOut),
  skillsCheckOut.trim().split('\n').filter((l) => l.includes('产品 Skill 校验')).join(' ').slice(0, 200) || skillsCheckOut.slice(-200));

// B[CP-21]：preflight 真实探测（注册表=真实仓）
const { SkillRegistry } = require(path.join(ROOT, 'core/shared-backend/skill-registry.js'));
const { preflightAll } = require(path.join(ROOT, 'core/shared-backend/skill-preflight.js'));
const registry = new SkillRegistry();
const all = registry.discover();
const mdCount = all.filter((s) => s._format === 'skill-md').length;
record('A.discover-dual-format', mdCount >= 9, `discover 共 ${all.length}，skill-md ${mdCount} 件`);

const pre = preflightAll(all);
const statuses = {};
for (const r of Object.values(pre)) statuses[r.status] = (statuses[r.status] || 0) + 1;
const knapPre = pre.knap || {};
record('B.preflight-tri-state', ['available', 'installable', 'missing_deps', 'blocked_platform'].includes(knapPre.status)
  && Array.isArray(knapPre.missingBins),
  `knaps status=${knapPre.status} missing=${(knapPre.missingBins || []).join(',')}；全量分布=${JSON.stringify(statuses)}`);

// B2：审批链对齐（源码面：preflight 指引走既有 run_cmd 审批链；guard-ack 记录面在册）
{
  const st = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/skill-tools.js'), 'utf8');
  const guardAckExists = fs.existsSync(path.join(ROOT, 'core/petri-server/helpers/guard-ack-store.js'));
  record('B.install-governance-aligned', /审批确认/.test(st) && /未批准不执行/.test(st) && guardAckExists,
    'preflight 安装指引指向既有命令审批链（guard-ack/审批记录在册），未建第二确认通道；真实全局安装留待用户授权会话');
}

// C[CP-21 全链本机实证]：defuddle 探测→本地隔离安装→复核
{
  const before = pre.defuddle || {};
  record('C.defuddle-probe-before', before.status === 'installable' || before.status === 'available',
    `安装前 status=${before.status} missingBins=${(before.missingBins || []).join(',')}`);

  let installedLocally = false;
  let installDetail = '';
  if (before.status === 'installable') {
    try {
      const prefix = fs.mkdtempSync(path.join(os.tmpdir(), 'w7-defuddle-'));
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      // Node 20.12+/24：spawnSync 直接拉 .cmd 报 EINVAL——win32 走 shell（路径无空格，拼接安全）
      execFileSync(npmCmd, ['install', 'defuddle-cli', '--prefix', prefix, '--no-audit', '--no-fund', '--loglevel', 'error'],
        { encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
      const binDir = path.join(prefix, process.platform === 'win32' ? 'node_modules\\.bin' : 'node_modules/.bin');
      process.env.PATH = binDir + path.delimiter + process.env.PATH;
      installedLocally = true;
      installDetail = `本地隔离安装于 ${prefix}（零全局污染；evidence 留痕=本次安装命令与目录）`;
    } catch (e) {
      installDetail = '本地隔离安装失败（网络/npm 环境）：' + String(e.message).slice(0, 80);
    }
  }
  record('C.defuddle-local-install', installedLocally || before.status === 'available',
    installedLocally ? installDetail : (before.status === 'available' ? '本机已有 defuddle，跳过安装步' : installDetail));

  // 复核：重新探测（PATH 已含本地 bin；用 preflightSkill=真实 which/where 面，
  // 不用 checkSkillDeps 纯函数缺省 hasBin=()=>true 的假阳性通道）
  const { probeBinSync, preflightSkill } = require(path.join(ROOT, 'core/shared-backend/skill-preflight.js'));
  const afterBin = probeBinSync('defuddle');
  const skillDefuddle = registry.get('defuddle');
  const after = preflightSkill(skillDefuddle);
  record('C.defuddle-recheck-available', after.status === 'available' && afterBin === true,
    `安装后 status=${after.status}（which/where 实测 defuddle=${afterBin}）→ 探测→安装→可用 全链留痕`);
}

// D[CP-22]：九技能在册 + 渐进披露（手册真实可读）
{
  const expected9 = ['obsidian-markdown', 'mermaid-visualizer', 'excalidraw-diagram', 'json-canvas',
    'obsidian-bases', 'obsidian-cli', 'defuddle', 'knap', 'obsidian-setup'];
  const missing = expected9.filter((id) => !registry.get(id));
  const knap = registry.get('knap');
  record('D.cp22-nine-skills', missing.length === 0 && knap && knap.prompts.system.length > 200,
    missing.length ? `缺 ${missing.join(',')}` : `9 件全在册；knap 手册 ${knap.prompts.system.length} 字符（get 渐进披露面真实可读）`);
  const mermaid = registry.get('mermaid-visualizer');
  record('D.cp22-genui-bridge', /Gen UI/.test(mermaid.prompts.system) && /模板优先/.test(mermaid.prompts.system),
    'mermaid 技能手册打通 Gen UI 卡片+visualize 模板优先节（迁移对齐 Petri 产出面）');
}

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, 'w7-live.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\nW7 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-176/w7-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
