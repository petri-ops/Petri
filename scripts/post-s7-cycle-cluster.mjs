#!/usr/bin/env node
/**
 * B-25 余环归簇门（不需要人，但也不冒充环已消亡）。
 *
 * 现状 12 个存量环全部经过同一条边：
 *   core/petri-server/agent-tools/spawn-agent-tools.js --lazy require--> ../agent-runner.js
 * 真正的消亡要把 runAgentLoop 抽成独立模块或改依赖注入，属核心循环结构性重构
 * （需独立立项 + 全量回归）。本门先做两件可机械验证的事：
 *   ① 环总数只减不增（棘轮）；② 每个存量环必须能归因到已登记的根因簇，
 *      出现「新簇」即红，防止新环混进存量数字里不被发现。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = path.join(ROOT, 'acceptance/block-109/arch-cycles-baseline.json');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/cycle-clusters.json');

// item 86（2026-11-27）— 五簇全部消亡：循环依赖真解耦（kernel-registry 组合根 locator
// 反转 A/B/C 族、tool-defs 纯数据化 D 族、permissions-contract 纯面抽取 E 族、
// 前端组件合并/自环直出 F/G 族），arch-cycles 基线 13→0。本登记表随之清空；
// 新环由 arch-cycles 门（基线外即红）+ 本测试的负测继续值守。
export const CLUSTERS = [];

export function clusterCycles(cycles, clusters = CLUSTERS) {
  const rows = cycles.map((c) => {
    const hit = clusters.find((k) => k.marker.test(String(c)));
    return { cycle: c, cluster: hit ? hit.id : 'UNCLUSTERED' };
  });
  const unclustered = rows.filter((r) => r.cluster === 'UNCLUSTERED').map((r) => r.cycle);
  return { rows, unclustered, byCluster: Object.fromEntries(clusters.map((k) => [k.id, rows.filter((r) => r.cluster === k.id).length])) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const base = JSON.parse(fs.readFileSync(BASE, 'utf8'));
  const r = clusterCycles(base.cycles || []);
  const evidence = {
    schemaVersion: 1, kind: 'b25-cycle-cluster-triage', generatedAt: new Date().toISOString(),
    totalCycles: (base.cycles || []).length,
    clusters: CLUSTERS,
    byCluster: r.byCluster,
    unclustered: r.unclustered,
    ok: r.unclustered.length === 0,
    decision: r.unclustered.length === 0
      ? 'all-cycles-attributed-to-known-root-cause'
      : 'new-cluster-detected-needs-triage',
    note: '归簇≠消亡。12 环仍是存量债；消亡需独立立项改核心循环。环总数由 gate:arch-cycles 棘轮只减不增守护。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`[cycle-cluster] ${evidence.ok ? 'PASS' : 'FAIL'} — ${evidence.totalCycles} 环 / ${JSON.stringify(r.byCluster)} / 未归因 ${r.unclustered.length}`);
  process.exitCode = evidence.ok ? 0 : 1;
}
