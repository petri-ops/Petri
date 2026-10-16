'use strict';
/**
 * scripts/lib/evals-catalog.mjs — BLOCK-190 评测黄金任务 catalog 五列化（§4.1 ZCode ID/setup/action/assertion/evidence）。
 * additive 派生视图：读 evals/suites 下各 .json 任务字段映射五列，不改任务 schema、不动 runGoldenTask/gate。
 * 纯函数（deriveCatalogRow/renderCatalog/collectSuiteTasks）供 CLI 与契约测；产出零 volatile（无 tmp/path/id/时间戳）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// criteria kind → 被核验面（evidence 列取值）。未映射 kind 归入「事件流」兜底。
const EVIDENCE_FACETS = {
  task_completed: '事件流·任务终态',
  final_answer_contains: '答复文本',
  tool_used: '事件流·工具调用',
  tool_not_used: '事件流·工具缺席',
  tool_succeeded: '事件流·工具结果',
  tool_error: '事件流·工具错误',
  no_successful_exec: '事件流·安全属性',
  deny_after_success: '事件流·审批指纹消耗',
  policy_denied: '事件流·动态防护',
  no_policy_denial: '事件流·无拦截',
  event_present: '事件流',
  subagent_completed: '事件流·子任务',
  task_terminal_status: '事件流·终态',
  file_contains: '文件系统',
  genui_fragment_resolves: '文件系统·GenUI 路径',
  outbound_contains: '归一化出站请求',
  funnel_event_present: 'funnel 台账',
  ttfs_computable: 'funnel TTFS',
};

function mdCell(s) {
  return String(s).replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
}

/** 单任务 → 五列 { id, setup, action, assertion, evidence }（字符串，缺列空供测判红）。 */
export function deriveCatalogRow(task) {
  const id = String(task.id || '');
  const accessMode = task.accessMode || 'full';
  const fixtures = task.fixtureFiles && Object.keys(task.fixtureFiles).length ? `fixture=${Object.keys(task.fixtureFiles).join(',')}` : 'fixture=无';
  const approvals = Array.isArray(task.approvals) && task.approvals.length ? ` · approvals=${task.approvals.length}` : '';
  const setup = `accessMode=${accessMode} · ${fixtures}${approvals}`;
  const turns = Array.isArray(task.mockScript) ? task.mockScript.length : 0;
  const prompt = String(task.prompt || '').replace(/\s+/g, ' ').slice(0, 48);
  const action = `${prompt}${String(task.prompt || '').length > 48 ? '…' : ''} · mock=${turns}回合${task.cancelAfterMs ? ' · cancel@ms' : ''}`;
  const criteria = Array.isArray(task.criteria) ? task.criteria : [];
  const assertion = criteria.map((c) => c.kind).join(', ');
  const facets = [...new Set(criteria.map((c) => EVIDENCE_FACETS[c.kind] || '事件流'))];
  const evidence = facets.join(', ');
  return { id, setup, action, assertion, evidence };
}

/** 读一个套件目录下全部 *.json 任务（id 升序）。 */
export function collectSuiteTasks(suitesDir, suite) {
  const dir = path.join(suitesDir, suite);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function listSuites(suitesDir) {
  return fs.readdirSync(suitesDir).filter((s) => fs.statSync(path.join(suitesDir, s)).isDirectory()).sort();
}

/** 渲染五列 catalog markdown（按套件分组·任务 id 升序·确定性·零 volatile）。 */
export function renderCatalog(suitesDir = path.join(ROOT, 'evals', 'suites')) {
  const lines = [
    '<!-- 生成物：npm run evals:catalog（scripts/evals-catalog.mjs）。勿手改——契约测比对逐字节同步。 -->',
    '',
    '# 评测黄金任务 catalog（五列：ID / setup / action / assertion / evidence）',
    '',
    'BLOCK-190 · §4.1 参照黄金任务 catalog 五列模型；每枚 `evals/suites/<suite>/*.json` 派生一行。零 volatile。',
    '',
  ];
  for (const suite of listSuites(suitesDir)) {
    const tasks = collectSuiteTasks(suitesDir, suite);
    if (!tasks.length) continue;
    lines.push(`## suite：${suite}`, '', '| ID | setup | action | assertion | evidence |', '| --- | --- | --- | --- | --- |');
    for (const t of tasks) {
      const r = deriveCatalogRow(t);
      lines.push(`| ${mdCell(r.id)} | ${mdCell(r.setup)} | ${mdCell(r.action)} | ${mdCell(r.assertion)} | ${mdCell(r.evidence)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
