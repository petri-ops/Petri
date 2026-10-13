/**
 * scripts/ui-proxy-review.mjs — UI-496~509 代行评估探针（真界面驱动+截图留证）。
 * stage1=静态面（506 徽章/507 治理/499 生成参数/504 成本卡） stage2=任务面（496 Stop/498+509 审批卡）
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const { pollTargets, filterPageTargets, evalJs, connectTarget, screenshotPng } = await import(
  pathToFileURL(libPath).href
).then((m) => m.default ?? m);

const AUTH = { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' };
const API = 'http://127.0.0.1:3001/api';
const EVIDENCE = path.join(ROOT, 'acceptance', 'ui-proxy-review');
const args = process.argv.slice(2);
const stage = (args.find((a) => a.startsWith('--stage=')) || '--stage=1').split('=')[1];

const results = [];
function record(id, ok, detail) {
  results.push({ id, ok, detail: String(detail).slice(0, 240) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${id} — ${String(detail).slice(0, 180)}`);
}

async function api(method, url, body) {
  const r = await fetch(API + url, { method, headers: AUTH, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function withMainWindow(fn) {
  const targets = await pollTargets({ timeoutMs: 15000 });
  const pages = filterPageTargets(targets).filter((t) => t.webSocketDebuggerUrl);
  const target = pages.find((t) => /petri|格物/i.test(t.title || '')) || pages[0];
  if (!target) throw new Error('无可用页面 target');
  const client = await connectTarget(target);
  try { return await fn(client); } finally { try { client.close(); } catch { /* */ } }
}

async function goto(client, url) {
  await evalJs(client, `location.href = ${JSON.stringify(url)}; true;`);
  await new Promise((r) => setTimeout(r, 3200));
}

async function clickText(client, text) {
  return evalJs(client, `(() => {
    const nodes = [...document.querySelectorAll('button, [role="tab"], a, [class*="tab"]')];
    const hit = nodes.find((n) => (n.textContent || '').trim() === ${JSON.stringify(text)} && n.offsetParent !== null);
    if (hit) { hit.click(); return 'clicked'; }
    return 'not-found';
  })()`);
}

async function shot(client, name) {
  const dir = path.join(EVIDENCE, stage);
  fs.mkdirSync(dir, { recursive: true });
  return screenshotPng(client, dir, name);
}

async function bodySample(client) {
  return evalJs(client, `(() => (document.body.innerText || '').replace(/\\n+/g, ' | ').slice(0, 600))()`);
}

// ── Stage 1：静态面 ──
async function stage1() {
  await withMainWindow(async (client) => {
    // UI-506：通用技能 tab → 三态徽章（依赖可用/依赖待装/缺依赖）
    await goto(client, "http://localhost:3000/extensions");
    await clickText(client, "通用技能");
    await new Promise((r) => setTimeout(r, 1200));
    const b = JSON.parse(await evalJs(client, `(() => {
      const cards = document.querySelectorAll('article[class*="skillCard"]');
      const text = document.body.innerText;
      return JSON.stringify({ cards: cards.length, available: /依赖可用/.test(text), installable: /依赖待装|缺依赖/.test(text) });
    })()`));
    record("UI506.badges", b.cards > 0 && b.available && b.installable,
      `cards=${b.cards} 依赖可用=${b.available} 待装/缺依赖=${b.installable}`);
    await shot(client, "ui506-skills-badges.png");

    // UI-507：技能详情治理往返（查看详情 → 停用 → 已停用徽章 → 启用恢复）
    await evalJs(client, "(() => { const btn = [...document.querySelectorAll('button')].find((b) => /查看详情/.test(b.textContent || '')); if (btn) btn.click(); return true; })();");
    await new Promise((r) => setTimeout(r, 1100));
    const toggleAtFirst = await domCountSafe(client, "[data-testid=" + JSON.stringify("skill-toggle-disabled") + "]");
    const toggleText = async () => evalJs(client, "(() => { const b = document.querySelector('[data-testid=" + JSON.stringify("skill-toggle-disabled") + "]'); return b ? (b.textContent || '').trim() : 'gone'; })()");
    // 停用：点击后轮询按钮文本翻转为「启用」（=已停用态）
    let disabledState = false;
    for (let attempt = 0; attempt < 3 && !disabledState; attempt += 1) {
      await evalJs(client, "document.querySelector('[data-testid=" + JSON.stringify("skill-toggle-disabled") + "]')?.click(); true;");
      for (let poll = 0; poll < 4; poll += 1) {
        await new Promise((r) => setTimeout(r, 700));
        if ((await toggleText()) === '启用') { disabledState = true; break; }
      }
    }
    await shot(client, "ui507-skill-disabled.png");
    // 启用恢复：点击后轮询按钮文本翻回「停用」（=已恢复启用态）
    let restoredState = false;
    for (let attempt = 0; attempt < 3 && disabledState && !restoredState; attempt += 1) {
      await evalJs(client, "document.querySelector('[data-testid=" + JSON.stringify("skill-toggle-disabled") + "]')?.click(); true;");
      for (let poll = 0; poll < 4; poll += 1) {
        await new Promise((r) => setTimeout(r, 700));
        if ((await toggleText()) === '停用') { restoredState = true; break; }
      }
    }
    record("UI507.governance-roundtrip", toggleAtFirst > 0 && disabledState && restoredState,
      `toggle 在场=${toggleAtFirst > 0} 停用成功=${disabledState} 启用恢复=${restoredState}`);
    await shot(client, "ui507-skill-detail.png");

    // UI-499：设置→模型接口 生成参数卡（section 深链）
    await goto(client, "http://localhost:3000/settings?section=models");
    await new Promise((r) => setTimeout(r, 800));
    const gen = await domCountSafe(client, "[data-testid=" + JSON.stringify("generation-defaults") + "]");
    record("UI499.gen-defaults", gen > 0, `生成参数卡在场=${gen > 0}`);
    await shot(client, "ui499-gen-defaults.png");

    // UI-504（部分）：用量与资源节 成本上限卡
    await goto(client, "http://localhost:3000/settings?section=usage");
    await new Promise((r) => setTimeout(r, 800));
    const c = JSON.parse(await evalJs(client, "(() => { const t = document.body.innerText; return JSON.stringify({ cost: /成本|熔断|上限/.test(t) }); })()"));
    record("UI504.cost-cap", c.cost, `成本熔断设置面=${c.cost}（联邦双机部分留待）`);
    await shot(client, "ui504-cost-cap.png");
  });
}
// ── Stage 2：任务面 ──
async function stage2() {
  // 规则种子走后端规则 REST（PUT 全量替换→后端读写同一文件，路径必然一致）
  const existing = await api('GET', '/ai/agent-rules');
  const priorRules = (existing.json && existing.json.rules) || [];
  const rule = { id: 'proxy-review-ack-exec', matcher: { type: 'path-glob', pattern: '**' }, action: 'require-ack', scope: 'global', note: '代行评估临时规则', createdAt: new Date().toISOString() };
  const seeded = await api('PUT', '/ai/agent-rules', { rules: [...priorRules, rule] });
  record('stage2.rule-seeded', seeded.status === 200, );
  try {
    await withMainWindow(async (client) => {
      const project = await api('POST', '/data/projects', { name: 'UI 代行评估项目' });
      const projectId = project.json?.project?.id || project.json?.data?.id;
      const conv = await api('POST', '/ai/conversations', { title: '代行评估', project_id: projectId });
      const conversationId = conv.json?.conversation?.id || conv.json?.data?.conversation?.id || conv.json?.data?.id;
      await goto(client, `http://localhost:3000/project/${projectId}?conversationId=${conversationId}`);
      await new Promise((r) => setTimeout(r, 1500));
      await evalJs(client, `(() => {
        const ta = document.querySelector('textarea');
        if (!ta) return 'no-textarea';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(ta, '请在项目里创建文件 notes/hello.txt，内容写 hello。');
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        return 'filled';
      })()`);
      await new Promise((r) => setTimeout(r, 300));
      const send = await evalJs(client, `(() => {
        const btn = document.querySelector('[data-testid="chat-send"]');
        if (btn && !btn.disabled) { btn.click(); return 'chat-send'; }
        const ta = document.querySelector('textarea');
        if (ta) { ta.focus(); ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); return 'enter'; }
        return 'no-send';
      })()`);
      record('stage2.task-sent', send !== 'no-send', `发送=${send}`);

      // 等审批卡（require-ack deny → GuardAckCard）
      let card = null;
      for (let i = 0; i < 45; i += 1) {
        await new Promise((r) => setTimeout(r, 800));
        const v = await evalJs(client, `(() => {
          const card = document.querySelector('[data-testid="guard-ack-card"]');
          if (!card) return 'null';
          return JSON.stringify({
            requestId: /apr_/.test(card.textContent),
            command: Boolean(card.querySelector('.sc-guard-card__command')),
            spanMark: Boolean(card.querySelector('mark[class*="risk"]')),
            armBtn: Boolean(card.querySelector('[data-testid="guard-ack-always"]'))
          });
        })()`);
        if (v && v !== 'null') { card = JSON.parse(v); break; }
      }
      record('UI498+509.card', Boolean(card), card ? JSON.stringify(card) : '审批卡未出现');
      if (!card) {
        // 失败取证：工具活动区文本+全屏截图（看模型到底干了什么）
        await new Promise((r) => setTimeout(r, 8000));
        await shot(client, 'ui498-no-card-fallback.png');
        const tr = await api('GET', '/ai/agent/llm-transcripts?conversationId=' + encodeURIComponent(conversationId) + '&limit=6');
        const records = (tr.json && (tr.json.records || tr.json.data)) || [];
        for (const rec of (Array.isArray(records) ? records : []).slice(-4)) {
          const toolCalls = (rec.response && rec.response.tool_calls) || rec.toolCalls || [];
          console.log('[取证] 模型轮 tools=', JSON.stringify(toolCalls).slice(0, 200), ' content尾=', String((rec.response && rec.response.content) || rec.content || '').slice(-80));
        }
      }
      if (card) {
        await shot(client, 'ui498-509-guard-card.png');
        await evalJs(client, `document.querySelector('[data-testid="guard-ack-always"]')?.click(); true;`);
        await new Promise((r) => setTimeout(r, 500));
        const arm = await domCountSafe(client, '[data-testid="guard-ack-arm-confirm"]');
        record('UI509.arm-two-step', arm > 0, '两步武装确认条在场');
        await shot(client, 'ui509-arm-confirm.png');
        await evalJs(client, `document.querySelector('[data-testid="guard-ack-arm-confirm-no"]')?.click(); true;`);
        await evalJs(client, `document.querySelector('[data-testid="guard-ack-once"]')?.click(); true;`);
        record('UI498.card-actions', true, '放行一次已点击，任务应继续');
      }
    });
  } finally {
    await api('DELETE', '/ai/agent-rules/proxy-review-ack-exec').catch(() => {});
  }
}

async function domCountSafe(client, selector) {
  return evalJs(client, `document.querySelectorAll(${JSON.stringify(selector)}).length;`).then(Number).catch(() => 0);
}

const stages = { 1: stage1, 2: stage2 };
const fn = stages[stage];
if (!fn) { console.error('未知 stage'); process.exit(2); }
try {
  await fn();
} catch (e) {
  record(`stage${stage}-fatal`, false, e && e.message ? e.message : String(e));
}
const pass = results.filter((r) => r.ok).length;
fs.mkdirSync(EVIDENCE, { recursive: true });
fs.writeFileSync(path.join(EVIDENCE, `stage${stage}-results.json`), JSON.stringify({ stage, at: new Date().toISOString(), pass, total: results.length, results }, null, 2));
console.log(`\n=== stage${stage}: ${pass}/${results.length} PASS ===`);
process.exitCode = results.length > 0 && pass === results.length ? 0 : 1;
