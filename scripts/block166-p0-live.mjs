/**
 * scripts/block166-p0-live.mjs — BLOCK-166 P0 全链实机探针。
 *
 * 链路：DB 播种（项目/会话/含 ::visualize 指令的助手消息）→ 预置 fragment
 * （<ws>/.petri/gen-ui/<convId>/chart-demo.html）→ CDP 打开工作区页 → 点选会话 →
 * 断言 GenUiCard 渲染出 petri-genui:// iframe + 高度回报生效 → 截图证据。
 *
 * 诚实边界（plan P0 门禁 vs 环境实况）：本机 dev 数据面无任何模型渠道 key
 * （copilot_settings 空，旧配置随 .biof3-dev-user-data 删除灭失）——「模型手写
 * fragment」环节以预置文件替代，其余全链（解析器/prepare IPC 校验/协议宿主/
 * CSP/高度/渲染）均为真实路径。真模型补跑=用户在应用内配好 key 后自然对话一次。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const DB_PATH = path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(ROOT, 'acceptance', 'block-166');
const CONV_TITLE = 'BLOCK-166 P0 全链探针';
const libPath = path.join(ROOT, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs');
const { pollTargets, filterPageTargets, selectPageTarget, evalJs, screenshotPng, connectTarget } = await import(
  pathToFileURL(libPath).href
).then((m) => m.default ?? m);

function openDb() {
  const Database = require(path.join(ROOT, 'node_modules', 'better-sqlite3'));
  return new Database(DB_PATH);
}

const FRAGMENT = `<!-- BLOCK-166 P0 探针 fragment：静态条形图（CSS 变量主题） -->
<div id="gen-ui-p0-demo" style="padding:20px;font-family:system-ui,sans-serif">
  <h3 style="margin:0 0 4px;color:var(--foreground);font-size:15px">Gen UI P0 全链探针 · 静态图表示例</h3>
  <p style="margin:0 0 16px;color:var(--muted-foreground);font-size:12px">沙箱页渲染成功 · 主题变量生效 · 高度自适应</p>
  <div id="bars" style="display:flex;flex-direction:column;gap:10px"></div>
  <script>
    (function () {
      var data = [
        ['解析器切分', 96], ['prepare IPC 校验', 88], ['协议宿主拼壳', 80],
        ['CSP 响应头', 72], ['高度回报', 64], ['iframe 渲染', 58],
      ];
      var bars = document.getElementById('bars');
      data.forEach(function (pair) {
        var row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:10px';
        var label = document.createElement('span');
        label.textContent = pair[0];
        label.style.cssText = 'width:120px;color:var(--muted-foreground);font-size:12px';
        var track = document.createElement('div');
        track.style.cssText = 'flex:1;height:18px;border-radius:9px;background:var(--muted)';
        var fill = document.createElement('div');
        fill.style.cssText = 'height:18px;border-radius:9px;background:var(--primary);width:' + pair[1] + '%';
        track.appendChild(fill);
        row.appendChild(label); row.appendChild(track);
        bars.appendChild(row);
      });
      var done = document.createElement('p');
      done.textContent = 'P0 pipeline OK';
      done.style.cssText = 'margin:16px 0 0;color:var(--primary);font-size:12px';
      bars.appendChild(done);
    })();
  </script>
</div>`;

function seed() {
  const ws = path.join(ROOT, 'tmp', 'block166-ws');
  fs.mkdirSync(ws, { recursive: true });
  const db = openDb();
  const now = new Date().toISOString();
  const projectId = 'p_blk166live_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO projects (id, name, user_id, modality, created_at, updated_at, workspace_path, workspace_kind, status) VALUES (?,?,?,?,?,?,?,?,?)'
  ).run(projectId, 'block166-live', 'local-user', 'general', now, now, ws, 'local', 'active');
  const convId = 'c_blk166_' + Date.now().toString(36);
  db.prepare(
    'INSERT INTO copilot_conversations (id, user_id, title, status, project_id, message_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)'
  ).run(convId, 'local-user', CONV_TITLE, 'active', projectId, 2, now, now);
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(convId, 'user', '请用沙箱可视化展示 P0 全链检查结果', null, now);
  const scopeRoot = path.join(ws, '.petri', 'gen-ui', convId);
  fs.mkdirSync(scopeRoot, { recursive: true });
  const fragPath = path.join(scopeRoot, 'p0-pipeline-demo.html');
  fs.writeFileSync(fragPath, FRAGMENT, 'utf8');
  const fragPosix = fragPath.replace(/\\/g, '/');
  db.prepare(
    'INSERT INTO copilot_messages (conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?)'
  ).run(
    convId,
    'assistant',
    `P0 全链检查完成，六项全部通过，静态图表如下：\n\n::visualize{"path":"${fragPosix}","title":"P0 全链检查"}\n\n图表数据为本轮探针实测汇总。`,
    null,
    now
  );
  db.close();
  return { projectId, convId, ws };
}

function cleanup(projectId) {
  try {
    const db = openDb();
    const rows = db.prepare('SELECT id FROM copilot_conversations WHERE project_id = ?').all(projectId);
    for (const row of rows) db.prepare('DELETE FROM copilot_messages WHERE conversation_id = ?').run(row.id);
    db.prepare('DELETE FROM copilot_conversations WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    db.close();
  } catch { /* 尽力清场 */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const { projectId } = seed();
  let assertions = [];
  let ok = true;
  try {
    const targets = await pollTargets({ timeoutMs: 20_000 });
    const candidates = filterPageTargets(targets, /localhost:3000/);
    const target = await selectPageTarget(candidates, {
      probe: async (c) => !!(await evalJs(c, 'document.querySelector("#root")')),
    });
    const client = await connectTarget(target);
    await evalJs(client, `location.href = 'http://localhost:3000/project/${projectId}'`);
    await sleep(3500);
    // 会话若未自动选中则按标题点选
    let clicked = await evalJs(client, `(() => {
      const els = Array.from(document.querySelectorAll('button, [role="button"], a, li, div'));
      const hit = els.find(e => e.textContent && e.textContent.includes('${CONV_TITLE}') && e.offsetParent !== null);
      if (!hit) return false;
      let target = hit;
      while (target && target !== document.body) {
        if (target.matches('button,[role="button"],a') || (target.onclick)) break;
        target = target.parentElement;
      }
      (target || hit).click();
      return true;
    })()`);
    await sleep(2500);

    const cardCount = await evalJs(client, `document.querySelectorAll('[data-testid="gen-ui-card"]').length`);
    const cardState = await evalJs(client, `(() => {
      const card = document.querySelector('[data-testid="gen-ui-card"]');
      if (!card) return 'NO CARD';
      const err = card.querySelector('[role="alert"]');
      if (err) return 'ERROR: ' + err.textContent.trim().slice(0, 200);
      const ph = card.querySelector('[data-testid="gen-ui-invalid"]');
      if (ph) return 'INVALID';
      const f = card.querySelector('iframe');
      return f ? 'IFRAME ' + f.getAttribute('src') : 'LOADING';
    })()`);
    const iframeSrc = await evalJs(client, `(() => {
      const f = document.querySelector('[data-testid="gen-ui-card"] iframe');
      return f ? f.src : '';
    })()`);
    const frameHeight = await evalJs(client, `(() => {
      const wrap = document.querySelector('[data-testid="gen-ui-card"] div[style*="height"]');
      return wrap ? parseInt((wrap.getAttribute('style')||'').match(/height:\\s*(\\d+)/)?.[1] || '0', 10) : 0;
    })()`);
    assertions = [
      { name: '会话点选/自动选中', pass: clicked === true || cardCount > 0 },
      { name: 'GenUiCard 渲染在场', pass: cardCount >= 1, detail: `count=${cardCount}, state=${String(cardState).slice(0, 160)}` },
      { name: '沙箱 iframe petri-genui:// origin', pass: String(iframeSrc).startsWith('petri-genui://gen-'), detail: String(iframeSrc).slice(0, 60) },
      { name: '高度回报生效（>240 初始）', pass: frameHeight > 240, detail: `height=${frameHeight}` },
    ];
    ok = assertions.every((a) => a.pass);
    await screenshotPng(client, EVIDENCE_DIR, 'p0-live-gen-ui-card.png');
  } finally {
    cleanup(projectId);
  }
  const report = { at: new Date().toISOString(), allPass: ok, assertions, note: '模型手写 fragment 环节以预置文件替代（dev 数据面无渠道 key）；解析器/IPC 校验/协议宿主/CSP/高度/渲染全链真实路径。' };
  fs.writeFileSync(path.join(EVIDENCE_DIR, 'p0-live.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
