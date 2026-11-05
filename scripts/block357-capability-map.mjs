#!/usr/bin/env node
/**
 * BLOCK-357 — 用户向能力地图生成器（勿手改产物）。
 *
 * 从全量核对矩阵（scripts/functional-surface-audit.mjs 的输出）生成
 * `docs/capability-map.md`：按**任务/能力域**组织，而不是按工具名罗列。
 *
 * 设计纪律：
 * - 输出确定性（只用 matrix.generatedAt / head，不取当前时间）→ 可复跑一致
 * - 只陈述 G0 dev 边界内的事实，不出现 GA / Provider / 可发布 等越界宣称
 * - 所有数字来自矩阵，不在本脚本里写死能力清单
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MATRIX = path.join(ROOT, 'acceptance/functional-audit-2026-11-04/surface-matrix.json');
const OUT = path.join(ROOT, 'docs/capability-map.md');

const DOMAIN_LABELS = Object.freeze({
  'agent-orchestration': '任务编排与子智能体',
  'browser': '浏览器操作',
  'godot': '游戏引擎桥',
  'computer': '电脑使用（桌面控制）',
  'knowledge': '知识空间与检索',
  'model3d': '3D 模型与编辑',
  'remote': '远程执行目标',
  'resident': '常驻任务',
  'result-studio': '结果面与批注',
  'session': '会话与上下文',
  'skill': '技能',
  'svg': 'SVG 编辑器',
  'web': '联网检索与抓取',
  'workflow': '工作流',
  'workspace': '工作区文件与终端',
  'worktree': '工作树（Git worktree）',
  'harness': '科研任务计划（只读分析）',
});

function load() {
  return JSON.parse(fs.readFileSync(MATRIX, 'utf8'));
}

export function buildCapabilityMap(matrix) {
  const tools = matrix.toolRows || [];
  const byDomain = new Map();
  for (const t of tools) {
    const key = t.domain || 'other';
    if (!byDomain.has(key)) byDomain.set(key, []);
    byDomain.get(key).push(t);
  }
  const domains = [...byDomain.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const lines = [];
  lines.push('# Petri 能做什么（能力地图）');
  lines.push('');
  lines.push('> **自动生成，勿手改**。生成器 `scripts/block357-capability-map.mjs`；');
  lines.push('> 数据源 `acceptance/functional-audit-2026-11-04/surface-matrix.json`（`scripts/functional-surface-audit.mjs` 产出）。');
  lines.push(`> 矩阵生成时间：${matrix.generatedAt || '未记录'}；覆盖 ${tools.length} 个工具、${(matrix.ipcRows || []).length} 个 IPC 通道、${(matrix.routeRows || []).length} 个路由端点。`);
  lines.push('');
  lines.push('## 边界（先读这一段）');
  lines.push('');
  lines.push('- 本图只描述 **G0 开发期 dev Electron 边界内** 已实现且可达的能力。');
  lines.push('- **不外推** packaged 发布态、真实 Provider 矩阵、对外服务能力；这些内容不在本图范围内。');
  lines.push('- 「可达」= 有定义、有契约、有 handler、有调度元数据，且在访问档矩阵中至少一档放行。');
  lines.push('- 工具是否真的适合某个具体任务，取决于模型判断；本图不承诺任务成功率。');
  lines.push('');
  lines.push('## 能力域');
  lines.push('');
  lines.push('| 域 | 能做什么 | 工具数 | 可达 |');
  lines.push('| --- | --- | ---: | ---: |');
  for (const [key, rows] of domains) {
    const reachable = rows.filter((r) => r.reachable !== false).length;
    const label = DOMAIN_LABELS[key] || key;
    lines.push(`| \`${key}\` | ${label} | ${rows.length} | ${reachable}/${rows.length} |`);
  }
  lines.push('');
  lines.push('## 使用条件');
  lines.push('');
  lines.push('| 条件 | 说明 |');
  lines.push('| --- | --- |');
  lines.push('| 访问档 | `read` / `workspace-write` / `full`；写与执行类工具按契约的 sideEffect 受档位约束 |');
  lines.push('| 用户审批 | 控制类与破坏性操作走两段式确认（needApproval + ackToken），前端确认卡批准后执行 |');
  lines.push('| 平台 | 电脑使用分 macOS / Windows 两套实现；Linux 不在本阶段范围 |');
  lines.push('| 外部资源 | 部分分析插件需要运行时 capability bundle；缺失时如实降级并给出指引 |');
  lines.push('');
  lines.push('## 当前已知限制（来自矩阵）');
  lines.push('');
  const p1 = (matrix.findings || []).filter((f) => f.sev === 'P1').length;
  const p2 = (matrix.findings || []).filter((f) => f.sev === 'P2').length;
  const p3 = (matrix.findings || []).filter((f) => f.sev === 'P3');
  lines.push(`- 功能面矩阵判定：**P1=${p1} / P2=${p2} / P3=${p3.length}**（P1/P2 为阻断级，归零后才可宣称能力面自洽）。`);
  for (const f of p3) lines.push(`- P3 \`${f.kind}\` · ${f.subject}：${String(f.detail || '').slice(0, 120)}`);
  lines.push('');
  lines.push('## 怎么查更细');
  lines.push('');
  lines.push('- 逐工具契约与可达性：`docs/functional-surface-matrix-2026-11-04.md`（脚本生成）');
  lines.push('- 项目整体评估：`docs/Petri-Desktop-Evaluation-Report-2026-11-05.md`');
  lines.push('- 下一阶段任务：`docs/next-tasks-2026-11-05.md`');
  lines.push('');
  lines.push('*由 `npm run quality:surface` 的矩阵刷新后，重跑本生成器即可更新；产物确定性，可比对。*');
  lines.push('');
  return lines.join('\n');
}

/** 越界宣称守卫：出现这些词即判生成器不合格。 */
export function assertNoOverclaim(text) {
  const banned = [/可发布/, /已发布/, /GA 可用/, /Provider 矩阵已验证/, /对外服务可用/];
  for (const re of banned) if (re.test(text)) throw new Error(`capability-map 越界宣称：${re}`);
  return true;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const md = buildCapabilityMap(load());
  assertNoOverclaim(md);
  fs.writeFileSync(OUT, md);
  console.log(`[block357] capability-map written -> ${path.relative(ROOT, OUT)} (${md.length} chars)`);
}
