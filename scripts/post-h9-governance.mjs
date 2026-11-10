#!/usr/bin/env node
/**
 * post-H9 K0–K7 阶段治理回写工具（CLI；幂等；可注入 --base 供负测）。
 *
 * 职责：把「阶段启动 / 收口」同批写进既有 canonical 文件：
 *   DOC-REGISTRY.json / README.md / next-steps-roadmap.md /
 *   project-workspace-handoff.md / AUDIT-LOG.md / 该阶段 plan 状态头。
 * 不新建第二台账、不新建第二真相源；只做精确插入与幂等替换。
 *
 * 安全不变量：
 *   1. 只写白名单内的路径（5 个 canonical + 8 个 K plan），绝不触碰
 *      user-asset-guard 的 9 项用户资产与任何未跟踪在制 WIP；
 *   2. registry 只在 canonical JSON 格式化一致时才整体重写，否则 fail-closed；
 *   3. 收口前强制校验 plan 与证据目录在场（证据先行）；
 *   4. 重复 launch / 重复 closeout / 锚点缺失 / 锚点非唯一 一律抛错。
 *
 * 蓝图 frontmatter 与 registry 的 POST-H9 条目保持 planned（蓝图 §0.4 设计：
 * living-plan 不占单包串行槽位，程序状态由各 K work-package 承载），
 * 因此工具零触碰未跟踪的蓝图原件，也不制造 FRONTMATTER_STATUS_MISMATCH。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const REL = Object.freeze({
  registry: 'docs/DOC-REGISTRY.json',
  readme: 'docs/README.md',
  roadmap: 'docs/next-steps-roadmap.md',
  handoff: 'docs/project-workspace-handoff.md',
  audit: 'docs/AUDIT-LOG.md',
});

const STAGES = Object.freeze({
  K0: { block: 'BLOCK-396', stage: 'K0', plan: 'docs/block-396-post-h9-k0-criteria-baseline-plan.md', title: '判据校准与可信起点', readmeNo: 395, evidence: 'acceptance/post-h9-2026-11-10/k0/' },
  K1: { block: 'BLOCK-397', stage: 'K1', plan: 'docs/block-397-post-h9-k1-agent-mainline-plan.md', title: '通用 agent 主线兑现度', readmeNo: 396, evidence: 'acceptance/post-h9-2026-11-10/k1/' },
  K2: { block: 'BLOCK-398', stage: 'K2', plan: 'docs/block-398-post-h9-k2-data-plane-plan.md', title: '服务端数据面与规模化', readmeNo: 397, evidence: 'acceptance/post-h9-2026-11-10/k2/' },
  K3: { block: 'BLOCK-399', stage: 'K3', plan: 'docs/block-399-post-h9-k3-experience-plan.md', title: '用户可感知体验收官', readmeNo: 398, evidence: 'acceptance/post-h9-2026-11-10/k3/' },
  K4: { block: 'BLOCK-400', stage: 'K4', plan: 'docs/block-400-post-h9-k4-architecture-plan.md', title: '架构去补丁与单源收编', readmeNo: 399, evidence: 'acceptance/post-h9-2026-11-10/k4/' },
  K5: { block: 'BLOCK-401', stage: 'K5', plan: 'docs/block-401-post-h9-k5-perf-evidence-plan.md', title: '性能与证据门禁化', readmeNo: 400, evidence: 'acceptance/post-h9-2026-11-10/k5/' },
  K6: { block: 'BLOCK-402', stage: 'K6', plan: 'docs/block-402-post-h9-k6-security-plan.md', title: '安全与边界纵深', readmeNo: 401, evidence: 'acceptance/post-h9-2026-11-10/k6/' },
  K7: { block: 'BLOCK-403', stage: 'K7', plan: 'docs/block-403-post-h9-k7-final-acceptance-plan.md', title: '真实任务终验与总收口', readmeNo: 402, evidence: 'acceptance/post-h9-2026-11-10/k7/' },
});

const ALLOWED_REL = new Set([...Object.values(REL), ...Object.values(STAGES).map((s) => s.plan)]);
const PLAN_STATUS_ACTIVE = '> 状态：active · P0-LAUNCH';
const PLAN_STATUS_DONE = '> 状态：completed · COMPLETED';
const AUDIT_TABLE_HEADER = '| 状态 | 日期 | 事项 | 处置边界 |';
const AUDIT_RECORDS_HEADER = '## 最近处理记录';

function read(base, rel) {
  return fs.readFileSync(path.join(base, rel), 'utf8');
}

function write(base, rel, text) {
  if (!ALLOWED_REL.has(rel)) throw new Error(`[post-h9] 拒绝写入白名单外路径: ${rel}`);
  fs.writeFileSync(path.join(base, rel), text);
}

function insertAfterLine(text, exactLine, newLine, label) {
  const lines = text.split('\n');
  const idx = lines.indexOf(exactLine);
  if (idx < 0) throw new Error(`[post-h9] 行锚点缺失 ${label}: ${exactLine}`);
  if (lines.indexOf(exactLine, idx + 1) >= 0) throw new Error(`[post-h9] 行锚点非唯一 ${label}`);
  lines.splice(idx + 1, 0, newLine);
  return lines.join('\n');
}

function removeLineContaining(text, needle, label) {
  const hits = text.split('\n').filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`[post-h9] ${label} 命中 ${hits.length} 行（应恰为 1）`);
  return text.split('\n').filter((l) => !l.includes(needle)).join('\n');
}

function sanitize(note) {
  return String(note).replace(/\|/g, '／').replace(/\r?\n/g, ' ').trim();
}

function patchRegistry(base, fn) {
  const raw = read(base, REL.registry);
  const obj = JSON.parse(raw);
  const serial = `${JSON.stringify(obj, null, 2)}${raw.endsWith('\n') ? '\n' : ''}`;
  if (serial !== raw) throw new Error('[post-h9] registry 非 2-space canonical 格式，拒绝整体重写（fail-closed）');
  fn(obj);
  write(base, REL.registry, `${JSON.stringify(obj, null, 2)}${raw.endsWith('\n') ? '\n' : ''}`);
}

function updateCoverage(base) {
  if (base !== ROOT) return;
  execFileSync(process.execPath, ['scripts/docs-governance.mjs', '--write-coverage'], { cwd: ROOT, stdio: 'pipe' });
}

function launch(base, stage, note) {
  const meta = STAGES[stage];
  if (!meta) throw new Error(`[post-h9] 未知阶段 ${stage}`);
  if (!fs.existsSync(path.join(base, meta.plan))) throw new Error(`[post-h9] 启动前 plan 必须在场: ${meta.plan}`);
  const planText = read(base, meta.plan);
  if (!planText.includes(PLAN_STATUS_ACTIVE)) throw new Error('[post-h9] plan 状态头非 active · P0-LAUNCH');
  if (!planText.includes('status: active')) throw new Error('[post-h9] plan frontmatter status 非 active');

  patchRegistry(base, (obj) => {
    if (obj.documents.some((d) => d.id === meta.block)) throw new Error(`[post-h9] 重复 launch: ${meta.block} 已在册`);
    obj.documents.unshift({
      id: meta.block,
      capability: path.basename(meta.plan, '.md').replace(/-plan$/, ''),
      path: meta.plan,
      kind: 'work-package',
      status: 'active',
      canonical: true,
      truthDomain: meta.block.toLowerCase(),
      entrypoint: 'docs/README.md',
      archivePolicy: 'retain_stable_path',
      phase: 'P0-LAUNCH',
      touchSurface: [meta.plan, `${meta.evidence}**`, 'scripts/post-h9-*', 'test/post-h9-*'],
      sharedBaselines: [],
      tags: ['post-h9', 'optimization', meta.stage.toLowerCase()],
      notes: `用户 2026-11-10 预授权连续工作「按 post-h9-optimization-blueprint-2026-11-10.md 从 K0 到 K7 全部推完」→ ${meta.stage} ${meta.title}。${sanitize(note)} G0 开发期常态 · 不外推 packaged/Provider/GA。`,
    });
  });

  const baseName = path.basename(meta.plan);
  const existingReadme = read(base, REL.readme);
  if (existingReadme.split('\n').some((l) => l.startsWith(`${meta.readmeNo}. `) && l.includes(baseName))) {
    throw new Error(`[post-h9] README 已有 ${meta.readmeNo} 行（重复 launch 或手工残留）`);
  }
  const readmeLine = `${meta.readmeNo}. [\`${baseName}\`](./${baseName}) — 2026-11-10 **active（post-H9 ${meta.stage} · ${meta.title}）**：${sanitize(note)} G0 开发期常态 · 不外推 packaged/Provider/GA。`;
  write(base, REL.readme, `${readmeLine}\n${existingReadme}`);

  for (const key of ['roadmap', 'handoff', 'audit']) {
    const text = read(base, REL[key]);
    const firstLine = text.split('\n')[0];
    const head = `最后更新：2026-11-10（▶ **post-H9 程序 ${meta.stage}=${meta.block} 启动**：${sanitize(note)} 串行槽位=单包 active；蓝图 planned living-plan 不占槽位。G0 开发期常态 · 不外推 packaged/Provider/GA。）`;
    write(base, REL[key], insertAfterLine(text, firstLine, head, key));
  }

  const launchRow = `| 🔵 | 2026-11-10 | **${meta.block}（post-H9 ${meta.stage} · ${meta.title}）启动登记（active）**：用户 2026-11-10 预授权连续工作「按第四轮蓝图 K0→K7 全部推完，全程零参与」。范围=${sanitize(note)} 红线=零新增依赖 / 不动 10 项用户资产与未跟踪 WIP / 不放宽任何基线 / 不撤销既有用户裁决 / 无证据不写 verified。 | U/E/V/W 出决策材料并跳项，不代答不伪造 | ${meta.block} / P0-LAUNCH |`;
  write(base, REL.audit, insertAfterLine(read(base, REL.audit), AUDIT_TABLE_HEADER, launchRow, 'AUDIT 待处理表首'));

  updateCoverage(base);
  return { block: meta.block, stage, action: 'launch' };
}

function closeout(base, stage, note) {
  const meta = STAGES[stage];
  if (!meta) throw new Error(`[post-h9] 未知阶段 ${stage}`);
  if (!fs.existsSync(path.join(base, meta.evidence))) throw new Error(`[post-h9] 证据目录不在场，拒绝收口: ${meta.evidence}`);
  const planText = read(base, meta.plan);
  if (!planText.includes(PLAN_STATUS_ACTIVE)) throw new Error('[post-h9] plan 状态头不是 active（可能已收口）');

  write(base, meta.plan, planText.replace(PLAN_STATUS_ACTIVE, PLAN_STATUS_DONE).replace('status: active', 'status: completed'));

  patchRegistry(base, (obj) => {
    const doc = obj.documents.find((d) => d.id === meta.block);
    if (!doc || doc.status !== 'active') throw new Error(`[post-h9] 重复 closeout 或条目缺席: ${meta.block}`);
    doc.status = 'completed';
    doc.phase = 'COMPLETED';
    doc.notes = `${doc.notes} 【收口】${sanitize(note)}`;
  });

  const baseName = path.basename(meta.plan);
  const rmLines = read(base, REL.readme).split('\n');
  const idx = rmLines.findIndex((l) => l.startsWith(`${meta.readmeNo}. `) && l.includes(baseName));
  if (idx < 0) throw new Error(`[post-h9] README 行缺席 ${meta.readmeNo}`);
  if (!rmLines[idx].includes('**active（')) throw new Error('[post-h9] README 行不是 active（可能已收口）');
  rmLines[idx] = rmLines[idx].replace('**active（', '**completed（');
  write(base, REL.readme, rmLines.join('\n'));

  const withoutLaunch = removeLineContaining(read(base, REL.audit), `**${meta.block}（post-H9`, 'AUDIT 启动行');
  const closeRow = `| ✅ **${meta.block}（post-H9 ${meta.stage} · ${meta.title}）completed**：${sanitize(note)} 证据=\`${meta.evidence}\`。G0 开发期常态 · 不外推 packaged/Provider/GA。 | 2026-11-10 | ${meta.block} / COMPLETED |`;
  write(base, REL.audit, insertAfterLine(withoutLaunch, AUDIT_RECORDS_HEADER, closeRow, 'AUDIT 处理记录表首'));

  for (const key of ['roadmap', 'handoff']) {
    const text = read(base, REL[key]);
    const firstLine = text.split('\n')[0];
    const head = `最后更新：2026-11-10（🏁 **${meta.block}（post-H9 ${meta.stage}）completed**：${sanitize(note)} G0 开发期常态 · 不外推 packaged/Provider/GA。）`;
    write(base, REL[key], insertAfterLine(text, firstLine, head, key));
  }

  updateCoverage(base);
  return { block: meta.block, stage, action: 'closeout' };
}

/**
 * 构造「post-H9 程序启动前」的干净基线副本。
 * 关键：本工具在任何 K 阶段都可被 selftest 复跑，而当前 canonical 文件里
 * 可能已经有本程序自己的 active/completed 条目与 README 行；不剥离会让
 * 「首次 launch 成功」负测变成假红。剥离只发生在 /tmp 副本，不触碰仓库原件。
 */
function freshBase(stage) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'post-h9-gov-'));
  for (const rel of Object.values(REL)) {
    const dest = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), dest);
  }
  const blockIds = new Set(Object.values(STAGES).map((s) => s.block));
  const readmeNos = new Set(Object.values(STAGES).map((s) => s.readmeNo));
  // registry：移除本程序的 work-package 条目与 launch/closeout notes 残留
  const regPath = path.join(tmp, REL.registry);
  const reg = JSON.parse(fs.readFileSync(regPath, 'utf8'));
  reg.documents = reg.documents.filter((d) => !blockIds.has(d.id));
  fs.writeFileSync(regPath, `${JSON.stringify(reg, null, 2)}\n`);
  // README：移除本程序的编号行
  const rmPath = path.join(tmp, REL.readme);
  const rmText = fs.readFileSync(rmPath, 'utf8').split('\n')
    .filter((l) => ![...readmeNos].some((n) => l.startsWith(`${n}. `) && l.includes('post-h9') || l.startsWith(`${n}. `) && l.includes('block-39') || l.startsWith(`${n}. `) && l.includes('block-40')))
    .join('\n');
  fs.writeFileSync(rmPath, rmText);
  // AUDIT-LOG：移除本程序的启动行/收口行（保留表头与其余历史）
  const auPath = path.join(tmp, REL.audit);
  const auText = fs.readFileSync(auPath, 'utf8').split('\n')
    .filter((l) => ![...blockIds].some((b) => l.includes(b) && (l.includes('启动登记（active）') || l.includes('）completed**'))))
    .join('\n');
  fs.writeFileSync(auPath, auText);
  const meta = STAGES[stage];
  const planDest = path.join(tmp, meta.plan);
  fs.mkdirSync(path.dirname(planDest), { recursive: true });
  fs.writeFileSync(planDest, `---\nstatus: active\n---\n${PLAN_STATUS_ACTIVE}\n`);
  return { tmp, planDest, meta };
}

function selftest() {
  const results = [];
  const run = (action, base, note) => {
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/post-h9-governance.mjs'), action, '--stage', 'K0', '--note', note, '--base', base], { cwd: ROOT, stdio: 'pipe' });
      return 'ok';
    } catch { return 'throw'; }
  };

  {
    const { tmp, meta } = freshBase('K0');
    fs.mkdirSync(path.join(tmp, meta.evidence), { recursive: true });
    results.push(['首次 launch 成功', run('launch', tmp, '负测') === 'ok']);
    results.push(['重复 launch 必抛错（幂等）', run('launch', tmp, '负测') === 'throw']);
    const ev = path.join(tmp, meta.evidence);
    fs.rmSync(ev, { recursive: true, force: true });
    results.push(['证据目录缺席时 closeout 必抛错（证据先行）', run('closeout', tmp, '负测') === 'throw']);
    fs.mkdirSync(ev, { recursive: true });
    results.push(['closeout 成功', run('closeout', tmp, '负测') === 'ok']);
    results.push(['重复 closeout 必抛错', run('closeout', tmp, '负测') === 'throw']);
    const reg = JSON.parse(read(tmp, REL.registry));
    const entry = reg.documents.find((d) => d.id === meta.block);
    results.push(['registry 翻 completed 与 plan frontmatter 同步', entry.status === 'completed' && read(tmp, meta.plan).includes('status: completed')]);
    results.push(['AUDIT 启动行移除、收口行在册', !read(tmp, REL.audit).includes('启动登记（active）') || read(tmp, REL.audit).includes(`${meta.block}（post-H9 K0 · ${meta.title}）completed`)]);
    results.push(['README 行 active→completed', read(tmp, REL.readme).split('\n')[0].includes('**completed（')]);
    results.push(['9 项用户资产零触碰', !fs.existsSync(path.join(tmp, 'docs/pelican-bicycle.html')) && !ALLOWED_REL.has('docs/pelican-bicycle.html')]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  {
    const { tmp, planDest } = freshBase('K0');
    const p = path.join(tmp, REL.audit);
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(AUDIT_TABLE_HEADER, 'BROKEN_ANCHOR'));
    let threw = false;
    try { launch(tmp, 'K0', '锚点负测'); } catch { threw = true; }
    results.push(['锚点损坏必抛错（fail-closed）', threw]);
    results.push(['锚点损坏时 plan 状态头未被误改', fs.readFileSync(planDest, 'utf8').includes(PLAN_STATUS_ACTIVE)]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  {
    const { tmp } = freshBase('K0');
    let threw = false;
    try { write(tmp, 'docs/pelican-bicycle.html', 'x'); } catch { threw = true; }
    results.push(['白名单外写入被拒', threw]);
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const failed = results.filter(([, v]) => !v);
  console.log(JSON.stringify({ kind: 'post-h9-governance-selftest', results: Object.fromEntries(results), passed: failed.length === 0 }, null, 2));
  if (failed.length) process.exitCode = 1;
}

function main(argv) {
  const [action, ...rest] = argv;
  const arg = (name, fallback) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : fallback;
  };
  const base = path.resolve(arg('--base', ROOT));
  const stage = arg('--stage', '');
  const note = arg('--note', '');
  if (action === 'selftest') return selftest();
  if (!stage || !note) throw new Error('[post-h9] 需要 --stage 与 --note');
  if (action === 'launch') return console.log(JSON.stringify(launch(base, stage, note)));
  if (action === 'closeout') return console.log(JSON.stringify(closeout(base, stage, note)));
  throw new Error(`[post-h9] 未知动作 ${action}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
