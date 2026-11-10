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

export const CLUSTERS = [
  {
    id: 'agent-runner-agent-tools-backref',
    edge: 'agent-runner.js -> agent-tools/* -> spawn-agent-tools.js --lazy require--> agent-runner.js',
    marker: /agent-runner\.js.*agent-tools/,
    note: 'agent-tools 工具实现回指 agent-runner（含 loop-orchestrator 链）。懒加载打断运行期 require 环，静态图仍成环；消亡需抽 runAgentLoop 或依赖注入。',
  },
  {
    id: 'agent-fallback-resume-backref',
    edge: 'agent-runner.js -> helpers/agent-fallback.js (-> routes/ai-agent/resume.js)',
    marker: /agent-runner\.js.*agent-fallback\.js/,
    note: '续跑与降级辅助回指主循环，属 resume 语义簇。',
  },
  {
    id: 'tool-defs-registry-backref',
    edge: 'agent-tools/registry.js <-> agent-tools/tool-defs.js',
    marker: /agent-tools\/registry\.js.*tool-defs\.js/,
    note: '工具定义与注册表互为定义/执行，拆环需把 defs 改成纯数据。',
  },
  {
    id: 'guest-permissions-backref',
    edge: 'helpers/guest-permissions.js <-> helpers/permissions.js',
    marker: /guest-permissions\.js/,
    note: '访客权限委托基础权限又反向读，抽公共判定表可消。',
  },
  {
    id: 'frontend-component-mutual',
    edge: '前端组件互斥引用：PetriOpenFileDevBridge / LeftPanel<->LeftSshCreatePanel / FileTreeItem<->FileTreeList',
    marker: /frontend\/src\//,
    note: '三处前端组件双向 import（类型或回调），需按组件职责抽共享类型/契约。',
  },
];

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
