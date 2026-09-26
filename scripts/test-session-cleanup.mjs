#!/usr/bin/env node
/**
 * BLOCK-123 G-03 — 测试实例会话残留清理（dev 卫生工具）。
 *
 * 背景：测试实例直连主 dev 栈数据目录，历次 flow/探针/取证会话（UI442/UI444 取证、
 * LIVE-VERIFY、BLOCK121-验收、BLOCK123-走验/审阅面等）在左栏会话列表持续堆积。
 *
 * 用法：
 *   node scripts/test-session-cleanup.mjs            # 干跑：仅列出匹配会话
 *   node scripts/test-session-cleanup.mjs --yes      # 实删（逐条 DELETE）
 *   node scripts/test-session-cleanup.mjs --limit 500
 *
 * 安全：只删标题匹配 isTestSessionTitle 模式的会话（探针/取证/验收命名），
 * 用户真实会话零触碰；非 2xx 逐条如实报错不中断。
 */
const API = process.env.BIOF3_API || 'http://127.0.0.1:3001/api';
const AUTH = { Authorization: 'Bearer desktop-local' };

// 测试生成会话/项目的命名模式（审计留痕：新增模式须先补 test/test-session-cleanup.test.mjs）
const TEST_TITLE_PATTERNS = [
  /^UI\d{3,}-/,            // UI-44x 取证会话
  /^BLOCK\d+-/,            // BLOCK 走查/验收/审阅面
  /^BK\d+-/i,
  /^B\d{2,}[a-z-]*-/i,     // B109-spawn
  /^B-Goals/i,             // B-Goals-PASS
  /^LIVE-VERIFY/i,
  /^probe-manual/i,
  /(取证|走验|验收)-\d{10,}$/,
];

/** 标题是否为测试生成会话（导出供契约测试）。 */
export function isTestSessionTitle(title) {
  if (typeof title !== 'string' || title.trim() === '') return false;
  return TEST_TITLE_PATTERNS.some((pattern) => pattern.test(title.trim()));
}

async function rest(method, p) {
  const resp = await fetch(API + p, { method, headers: AUTH });
  let data = null;
  try { data = await resp.json(); } catch { /* non-json */ }
  return { ok: resp.ok, data };
}

const args = new Set(process.argv.slice(2));
const yes = args.has('--yes');
const limitIdx = process.argv.indexOf('--limit');
const limit = limitIdx > -1 ? Number(process.argv[limitIdx + 1]) || 200 : 200;

// 测试会话多为项目绑定（全局列表扫不到）：逐项目扫描其会话 + 全局无项目会话。
const projResp = await rest('GET', '/data/projects?limit=500');
const projects = (projResp.data && (projResp.data.projects || projResp.data)) || [];
const candidates = [];
for (const project of Array.isArray(projects) ? projects : []) {
  const name = project.name || '';
  const isTestProject = isTestSessionTitle(name);
  const convResp = await rest('GET', `/ai/conversations?limit=${limit}&project_id=${encodeURIComponent(project.id)}`);
  const convs = (convResp.data && convResp.data.conversations) || [];
  for (const c of convs) {
    if (isTestProject || isTestSessionTitle(c.title)) {
      candidates.push({ id: c.id, title: c.title || '(无标题)', projectId: project.id, projectName: name });
    }
  }
}
const globalResp = await rest('GET', `/ai/conversations?limit=${limit}`);
for (const c of (globalResp.data && globalResp.data.conversations) || []) {
  if (isTestSessionTitle(c.title) && !candidates.some((x) => x.id === c.id)) {
    candidates.push({ id: c.id, title: c.title || '(无标题)', projectId: null, projectName: '(全局)' });
  }
}
// 测试命名的项目本体（workspace 目录同属残留）一并登记
const testProjects = (Array.isArray(projects) ? projects : []).filter((p) => isTestSessionTitle(p.name || ''));
for (const p of testProjects) {
  if (!candidates.some((x) => x.projectId === p.id)) {
    candidates.push({ id: '(项目本体)', title: p.name, projectId: p.id, projectName: p.name });
  }
}

console.log(`扫描 ${projects.length} 个项目 / ${limit} 上限全局会话，命中测试残留 ${candidates.length} 条${yes ? '（实删）' : '（干跑，--yes 实删）'}`);
let deleted = 0;
for (const c of candidates) {
  if (!yes) {
    console.log(`  [dry] ${c.projectName} :: ${c.title} (${c.id})`);
    continue;
  }
  if (c.id === '(项目本体)') {
    const d = await rest('DELETE', '/data/projects/' + encodeURIComponent(c.projectId));
    if (d.ok) deleted += 1;
    else console.error(`  [fail] 项目 ${c.projectId} -> ${JSON.stringify(d.data).slice(0, 120)}`);
    continue;
  }
  const d = await rest('DELETE', '/ai/conversations/' + encodeURIComponent(c.id));
  if (d.ok) deleted += 1;
  else console.error(`  [fail] ${c.id} ${c.title} -> ${JSON.stringify(d.data).slice(0, 120)}`);
}
console.log(yes ? `已删除 ${deleted}/${candidates.length} 条` : '干跑结束（--yes 实删）');
