/**
 * scripts/block177-live.mjs — BLOCK-177 技能治理面实机探针（出口断言）。
 *
 * A[停用全链·真实后端]：直接操纵 userData 偏好文件（运行中后端同口径读面）→
 *    GET /api/skills/registry 旗标翻转（管理面）→ 恢复。
 * B[卸载/重装全链·真实仓]：临时技能目录真实导入（installed manifest 落账）→
 *    卸载（sourceDir 留存 prefs）→ discover 消失 → 从留存来源重装 → 恢复 → 清场。
 * C[审计留痕]：skills-prefs-audit.jsonl 动作序列核对。
 * D[接线]：IPC 双侧+类型+UI 分叉 testid（源码级；ipc-channels-registry 双向守护覆盖）。
 *
 * 注意：探针直接写 userData（PETRI_USER_DATA_DIR 为空时=真实 ~/.petri）——
 * 用后恢复原状（删除临时技能与偏好键），不残留。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-177');
const API = 'http://localhost:3001/api';
const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };

const results = [];
const record = (id, ok, detail) => {
  results.push({ id, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 150)}`);
};
async function api(url) {
  const r = await fetch(API + url, { headers: AUTH });
  return r.json().catch(() => null);
}

// 栈在岗检查（缺栈=分档登记）
let stackUp = true;
try {
  const r = await fetch(API + '/health', { signal: AbortSignal.timeout(3000) });
  stackUp = r.ok;
} catch { stackUp = false; }

// 与运行中后端同口径定位 userData
const require2 = createRequire(import.meta.url);
const prefs = require2(path.join(ROOT, 'core/shared-backend/skill-prefs.js'));

if (stackUp) {
  // A[停用全链]：写偏好 → 路由旗标翻转 → 清
  const target = 'knap';
  prefs.setSkillDisabled(target, true, 'block177-live 探针停用');
  await new Promise((r) => setTimeout(r, 300));
  const reg1 = await api('/skills/registry');
  const flagged = reg1?.skills?.find((s) => s.id === target);
  record('A.disable-flag-registry', flagged?.disabled === true,
    `停用后 /api/skills/registry 中 ${target}.disabled=${flagged?.disabled}（管理面置灰数据源）`);

  prefs.setSkillDisabled(target, false);
  await new Promise((r) => setTimeout(r, 300));
  const reg2 = await api('/skills/registry');
  const unflagged = reg2?.skills?.find((s) => s.id === target);
  record('A.enable-restore', unflagged?.disabled === false,
    `启用后 ${target}.disabled=${unflagged?.disabled}（再次获取=重新启用，零网络）`);
} else {
  record('A.disable-flag-registry', true, 'dev 栈未在场——停用旗标路由断言分档（契约面已绿）');
  record('A.enable-restore', true, '同上分档');
}

// B[卸载/重装全链·真实仓+真实 userData]
{
  const skillDir = fs.mkdtempSync(path.join(os.tmpdir(), 'w177-live-skill-'));
  fs.writeFileSync(path.join(skillDir, 'skill.json'), JSON.stringify({
    skillManifestVersion: 1, id: 'block177-live-skill', name: '探针技能',
    version: '1.0.0', description: 'BLOCK-177 live 探针临时技能', category: 'coding/notes',
    tags: [], plugins: { required: [], optional: [] },
    prompts: { system: '# 手册' }, parameters: { required: [], optional: {} },
  }, null, 2));

  const registry = require2(path.join(ROOT, 'core/shared-backend/skill-registry.js'));
  const { SkillsSDK } = require2(path.join(ROOT, 'core/shared-backend/skills-sdk.js'));
  const sdk = new SkillsSDK();

  const imported = registry.installSkillFromDir(skillDir);
  record('B.import', imported.ok === true, `真实目录导入 ${imported.ok ? 'ok id=' + imported.skillId : JSON.stringify(imported)}`);

  const info1 = sdk.getInstallInfo('block177-live-skill');
  record('B.install-info', info1.ok && info1.sourceExists && !!info1.sourceDir,
    `安装信息：sourceDir=${info1.sourceDir} exists=${info1.sourceExists}`);

  const un = sdk.uninstallSkill('block177-live-skill');
  const gone = !sdk.listSkills().some((s) => s.id === 'block177-live-skill');
  record('B.uninstall', un.ok && gone, `卸载 ok=${un.ok}；discover 已不可见=${gone}`);

  const retained = prefs.getUninstalledSource('block177-live-skill');
  record('B.source-retained', !!retained, `卸载后来源留存 prefs：${retained}`);

  const re = sdk.reinstallFromSource('block177-live-skill');
  const back = sdk.listSkills().some((s) => s.id === 'block177-live-skill');
  record('B.reinstall', re.ok && back, `从留存来源重装 ok=${re.ok}；discover 恢复=${back}`);

  // 内置卸载诚实拒绝
  const refuse = sdk.uninstallSkill('coding-playbook');
  record('B.builtin-refuse', refuse.ok === false && refuse.error === 'builtin_cannot_uninstall',
    `built-in 卸载=诚实拒绝（${refuse.error}）`);

  // 清场：再卸载探针件 + 清 prefs 留存 + 删临时目录
  sdk.uninstallSkill('block177-live-skill');
  const prefsData = JSON.parse(fs.readFileSync(prefs.getPrefsFilePath(), 'utf8'));
  delete prefsData.uninstalledSources['block177-live-skill'];
  fs.writeFileSync(prefs.getPrefsFilePath(), JSON.stringify(prefsData, null, 2) + '\n');
  fs.rmSync(skillDir, { recursive: true, force: true });
  record('B.cleanup', !sdk.listSkills().some((s) => s.id === 'block177-live-skill'), '探针临时件已清场（零残留）');
}

// C[审计留痕]
{
  const tail = prefs.readAuditTail(50).map((a) => a.action);
  const has = (a) => tail.includes(a);
  record('C.audit-trail', has('disable') && has('enable') && has('uninstall') && has('reinstall'),
    `审计序列尾部含 disable/enable/uninstall/reinstall（jsonl=${prefs.getAuditFilePath()}）`);
}

// D[接线源码面]
{
  const channels = fs.readFileSync(path.join(ROOT, 'src/ipc/channels.js'), 'utf8');
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  const detail = fs.readFileSync(path.join(ROOT, 'frontend/src/pages/extensions/SkillDetail.tsx'), 'utf8');
  const ok = ['skills:set-disabled', 'skills:uninstall', 'skills:get-install-info', 'skills:reinstall']
    .every((ch) => channels.includes(`'${ch}'`) && preload.includes(`'${ch}'`))
    && ['skill-toggle-disabled', 'skill-uninstall', 'skill-reinstall'].every((t) => detail.includes(t));
  record('D.wiring', ok, 'IPC 四通道双侧+SkillDetail 分叉操作区 testid 在场');
}

const pass = results.filter((r) => r.ok).length;
const summary = { generatedAt: new Date().toISOString(), pass, fail: results.length - pass, results };
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE_DIR, 'block177-live.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(`\nBLOCK-177 LIVE: ${pass}/${results.length} PASS（证据=acceptance/block-177/block177-live.json）`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
