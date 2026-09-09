#!/usr/bin/env node
/**
 * scripts/workspace-state.mjs — `npm run state`：Agent 会话状态一键恢复（BLOCK-71）
 *
 * 把治理纪律规定的冷启动阅读顺序（AUDIT-LOG → Git 证据 → canonical registry）
 * 的机械部分压成一条命令，输出单一报告：
 *   1. 分支 / 同步状态 / 最近提交
 *   2. 工作区变更（已知 WIP 列出；临时命名残留单独标 ⚠）
 *   3. AUDIT-LOG 头部摘要 + 「当前待处理项」中未解决（🔴/🟢）条目
 *   4. DOC-REGISTRY 中 status=active 的工作包（canonical 机器真相）
 *
 * 只读：不读 docs/archive/（治理纪律），不改任何文件。
 * 状态类事实以 canonical 文档为准，本脚本只是把这些事实聚合呈现，不是第二真相源。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runGit(args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return '';
  }
}

const TEMP_RE = /(?:-tmp\.[a-z0-9]+|\.tmp|\.bak|\.orig|\.rej|~)$/i;

function section(title) {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(3, 58 - title.length * 2))}`);
}

function gitState() {
  section('Git');
  const branchLine = runGit(['status', '--short', '--branch']).split('\n')[0] || '(unknown)';
  console.log(branchLine);
  const log = runGit(['log', '--oneline', '-5']).trim();
  if (log) console.log(log.split('\n').map((l) => `  ${l}`).join('\n'));

  const rows = runGit(['status', '--porcelain']).split('\n').filter(Boolean);
  const modified = rows.filter((r) => r.startsWith(' M') || r.startsWith('M ') || r.startsWith('MM'));
  const untracked = rows.filter((r) => r.startsWith('??')).map((r) => r.slice(3));
  if (modified.length) {
    console.log(`已修改（跟踪文件）${modified.length} 项:`);
    for (const r of modified.slice(0, 20)) console.log(`  ${r}`);
    if (modified.length > 20) console.log(`  …另外 ${modified.length - 20} 项`);
  }
  if (untracked.length) {
    const susp = untracked.filter((f) => TEMP_RE.test(path.basename(f)));
    console.log(`untracked ${untracked.length} 项${susp.length ? `（其中 ${susp.length} 项命中临时命名，疑似残留 ⚠）` : ''}:`);
    for (const f of untracked.slice(0, 20)) console.log(`  ?? ${f}${susp.includes(f) ? '   ⚠ 疑似残留' : ''}`);
    if (untracked.length > 20) console.log(`  …另外 ${untracked.length - 20} 项`);
  }
  if (!modified.length && !untracked.length) console.log('工作区干净（无跟踪修改、无 untracked）');
}

function auditLogState() {
  section('AUDIT-LOG（活跃广播）');
  const file = path.join(ROOT, 'docs', 'AUDIT-LOG.md');
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    console.log('（docs/AUDIT-LOG.md 读取失败）');
    return;
  }
  const summary = text.split('\n').find((l) => l.startsWith('最后更新：'));
  if (summary) console.log(`${summary.slice(0, 600)}${summary.length > 600 ? ' …' : ''}`);

  const lines = text.split('\n');
  const headingIdx = lines.findIndex((l) => /^#{1,6}\s.*当前待处理项/.test(l));
  if (headingIdx === -1) {
    console.log('（未找到「当前待处理项」区块）');
    return;
  }
  const unresolved = [];
  for (const line of lines.slice(headingIdx + 1)) {
    if (line.startsWith('## ')) break;
    if (line.includes('✅')) continue;
    if (line.includes('无 🔴 阻塞项')) continue; // 总结行「当前无 🔴 阻塞项…」不是条目
    if (/(🔴|🟢)/.test(line)) {
      const dateMatch = line.match(/\d{4}-\d{2}-\d{2}/);
      const title = (line.match(/\*\*(.+?)\*\*/) || [])[1] || line.slice(0, 80);
      unresolved.push({ marker: line.includes('🔴') ? '🔴' : '🟢', date: dateMatch ? dateMatch[0] : '????-??-??', title });
    }
  }
  if (!unresolved.length) {
    console.log('当前待处理项：无未解决（🔴/🟢）条目');
    return;
  }
  console.log(`未解决条目 ${unresolved.length} 条（🔴 阻塞须先处理；🟢 评估合并）:`);
  for (const u of unresolved.slice(0, 10)) {
    console.log(`  ${u.marker} [${u.date}] ${u.title.slice(0, 110)}`);
  }
  if (unresolved.length > 10) console.log(`  …另外 ${unresolved.length - 10} 条`);
}

function registryState() {
  section('Active 工作包（DOC-REGISTRY canonical 真相）');
  const file = path.join(ROOT, 'docs', 'DOC-REGISTRY.json');
  let reg;
  try {
    reg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.log('（docs/DOC-REGISTRY.json 解析失败）');
    return;
  }
  const docs = Array.isArray(reg.documents) ? reg.documents : [];
  const active = docs.filter((d) => d.status === 'active');
  const activeWps = active.filter((d) => d.kind === 'work-package');
  const activeOthers = active.filter((d) => d.kind !== 'work-package');
  const planned = docs.filter((d) => d.status === 'planned');
  if (!activeWps.length) console.log('当前无 active 工作包（启动需用户裁决）。');
  for (const d of activeWps) {
    console.log(`🔴active  ${d.id}  →  ${d.path}${d.truthDomain ? `  [truthDomain: ${d.truthDomain}]` : ''}`);
  }
  if (activeOthers.length) {
    console.log(`其他 active canonical 文档: ${activeOthers.map((d) => d.id).join(', ')}`);
  }
  if (planned.length) {
    console.log(`排队候选（planned）${planned.length} 项: ${planned.map((d) => d.id).join(', ')}`);
  }
}

function main() {
  console.log('== Gewu 工作区状态 ==');
  gitState();
  auditLogState();
  registryState();
  section('下一步提示');
  console.log('治理顺序：🔴/🟢 未决项先处理 → 核对 active 包与手头任务一致 → 开工。');
  console.log('常用：npm run closeout（收口门禁）· npm run hygiene:check（卫生检查）· npm run test:changed:list（影响范围预览）');
}

main();
