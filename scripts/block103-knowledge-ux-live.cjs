#!/usr/bin/env node
'use strict';
/**
 * block103-knowledge-ux-live.cjs — BLOCK-103 知识空间页产品化重设计实机走查
 * （测试实例 CDP 9223，探针零触碰用户主窗口；对标 block99-console-live.cjs 走查段）：
 *   U1 页壳挂载：/knowledge 页 + 状态条（切换器/switch/页签）+ 会话台把手常驻 + 台面默认不挂载（D2 默认收起）；
 *   U2 空间切换与 hero：REST 建空空间 B → UI 切到 B → hero 空态（双 CTA 内嵌）；
 *   U3 页签往返：检索预览页签输入框挂载 → 回文档库 hero；
 *   U4 抽屉：把手点开 → 台面+composer 挂载 → Esc 收起 → 再开（供截图）；
 *   U5 诚实态记录：嵌入不可用时 switch 禁用+去设置卡（缺 key 环境为真断言，有 key 记录 observation）。
 * 前置：dev 栈（vite 3000 + 后端 3001）+ start-test-instance.sh（CDP 9223）。
 * 证据落 acceptance/block-103/。
 */
const path = require('node:path');
const fs = require('node:fs');

const API = 'http://127.0.0.1:3001';
const AUTH = { Authorization: 'Bearer desktop-local' };

const checks = [];
function assert(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: String(detail || '').slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ' — ' + String(detail || '').slice(0, 300)}`);
}

async function apiRequest(method, pathname, body) {
  const headers = { ...AUTH };
  let payload;
  if (body != null) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(API + pathname, { method, headers, body: payload });
  let parsed;
  try { parsed = await res.json(); } catch { parsed = null; }
  return { status: res.status, body: parsed };
}

async function main() {
  const evidenceDir = path.join(__dirname, '..', 'acceptance', 'block-103');
  fs.mkdirSync(evidenceDir, { recursive: true });

  // C0 前置：后端可达；REST 建一个空空间（hero 走查用，走完即删）
  const health = await apiRequest('GET', '/api/health').catch(() => ({ status: 0 }));
  assert('C0_backend_reachable', health.status > 0 && health.status < 500, `status=${health.status}`);
  let spaceBId = null;
  const created = await apiRequest('POST', '/api/knowledge/spaces', { name: '走查空态空间B' });
  if (created.status === 200 || created.status === 201) {
    spaceBId = created.body && (created.body.space?.id || created.body.id);
  } else {
    // 幂等：上次运行残留（清理未执行）时按名找回
    const list = await apiRequest('GET', '/api/knowledge/spaces');
    const found = ((list.body && (list.body.spaces || list.body)) || []).find((s) => s.name === '走查空态空间B');
    spaceBId = found && found.id;
  }
  assert('C0b_empty_space_available', !!spaceBId, `create=${created.status} id=${spaceBId}`);

  const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
  const client = await lib.connectTestTarget({});
  const evalJs = async (expr) => {
    const r = await client.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval failed');
    return r.result && r.result.value;
  };
  const shot = async (name) => {
    const cap = await client.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(evidenceDir, name), Buffer.from(cap.data, 'base64'));
  };

  await evalJs("location.href='/knowledge'");
  await new Promise((r) => setTimeout(r, 2000));
  // 确定性起点：清掉上轮抽屉开合记忆（D2 默认收起断言的前提）
  await evalJs(`localStorage.setItem('gewu.knowledgeConsoleOpen', '0'); location.reload()`);
  await new Promise((r) => setTimeout(r, 3000));

  // U1 页壳挂载 + D2 默认收起
  const mount = await evalJs(`(() => ({
    page: !!document.querySelector('[data-testid="knowledge-page"]'),
    strip: !!document.querySelector('[data-testid="knowledge-status-strip"]'),
    switcher: !!document.querySelector('[data-testid="knowledge-space-switcher"]'),
    toggle: !!document.querySelector('[data-testid="knowledge-toggle"]'),
    tabs: !!document.querySelector('[data-testid="knowledge-tabs"]'),
    handle: !!document.querySelector('[data-testid="knowledge-console-handle"]'),
    consoleClosed: !document.querySelector('[data-testid="knowledge-console"]'),
  }))()`);
  assert(
    'U1_page_shell_mounted_console_default_closed',
    mount.page && mount.strip && mount.switcher && mount.toggle && mount.tabs && mount.handle && mount.consoleClosed,
    JSON.stringify(mount)
  );

  // U5 诚实态记录（缺 key 环境=真断言；有 key=记录观察）
  const honesty = await evalJs(`(() => ({
    toggleDisabled: document.querySelector('[data-testid="knowledge-toggle"]')?.disabled ?? null,
    openSettings: !!document.querySelector('[data-testid="knowledge-open-settings"]'),
  }))()`);
  if (honesty.toggleDisabled === true) {
    assert('U5_no_key_honest_state', honesty.openSettings === true, JSON.stringify(honesty));
  } else {
    assert('U5_no_key_honest_state', true, `observation: embedding available, toggle enabled (${JSON.stringify(honesty)})`);
  }

  // U2 空间切换到空空间 B → hero
  if (spaceBId) {
    const switched = await evalJs(`(() => {
      const sel = document.querySelector('[data-testid="knowledge-space-select"]');
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.value === '${spaceBId}');
      if (!opt) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, '${spaceBId}');
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    assert('U2a_switched_to_empty_space', switched === true, `spaceBId=${spaceBId}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  const hero = await evalJs(`(() => ({
    hero: !!document.querySelector('[data-testid="knowledge-empty-hero"]'),
    upload: !!document.querySelector('[data-testid="knowledge-empty-hero"] [data-testid="knowledge-upload"]'),
    paste: !!document.querySelector('[data-testid="knowledge-empty-hero"] [data-testid="knowledge-paste-toggle"]'),
  }))()`);
  assert('U2b_hero_empty_state_with_ctas', hero.hero && hero.upload && hero.paste, JSON.stringify(hero));
  await shot('block103-hero.png');

  // U3 页签往返
  await evalJs(`document.querySelector('[data-testid="knowledge-tab-search"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  const searchTab = await evalJs(`(() => ({
    input: !!document.querySelector('[data-testid="knowledge-search-input"]'),
    btn: !!document.querySelector('[data-testid="knowledge-search-btn"]'),
  }))()`);
  assert('U3a_search_tab_mounts_probe', searchTab.input && searchTab.btn, JSON.stringify(searchTab));
  await shot('block103-search-tab.png');
  await evalJs(`document.querySelector('[data-testid="knowledge-tab-docs"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  const backDocs = await evalJs(`!!document.querySelector('[data-testid="knowledge-tab-docs"][aria-selected="true"]')`);
  assert('U3b_docs_tab_roundtrip', backDocs === true, 'aria-selected not restored');

  // U4 抽屉：开 → Esc 收 → 再开
  await evalJs(`document.querySelector('[data-testid="knowledge-console-handle"]').click()`);
  await new Promise((r) => setTimeout(r, 500));
  const openDrawer = await evalJs(`!!document.querySelector('[data-testid="knowledge-console"] textarea')`);
  assert('U4a_drawer_opens_via_handle', openDrawer === true, 'composer not mounted after handle click');
  await shot('block103-drawer-open.png');
  await evalJs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await new Promise((r) => setTimeout(r, 500));
  const escClosed = await evalJs(`!document.querySelector('[data-testid="knowledge-console"]')`);
  assert('U4b_drawer_esc_closes', escClosed === true, 'console still mounted after Esc');
  await evalJs(`document.querySelector('[data-testid="knowledge-console-handle"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  const reopened = await evalJs(`!!document.querySelector('[data-testid="knowledge-console"] textarea')`);
  assert('U4c_drawer_reopens', reopened === true, 'second handle click did not mount console');

  // 清理：REST 删走查空间（fail-safe：拿不到 id 也要如实登记）
  if (spaceBId) {
    const impact = await apiRequest('GET', `/api/knowledge/spaces/${spaceBId}/impact`).catch(() => null);
    const del = await apiRequest('DELETE', `/api/knowledge/spaces/${spaceBId}`);
    assert('C1_walkthrough_space_cleaned', del.status === 200 || del.status === 404, `impact=${JSON.stringify(impact && impact.body)} del=${del.status}`);
  }

  await client.send('Page.bringToFront', {}).catch(() => {});
  await client.close ? await client.close() : null;

  const allPass = checks.every((c) => c.ok);
  console.log(`\nblock103-knowledge-ux-live: ${checks.filter((c) => c.ok).length}/${checks.length} allPass=${allPass}`);
  fs.writeFileSync(
    path.join(evidenceDir, 'block103-knowledge-ux-live.json'),
    JSON.stringify({ flow: 'block103-knowledge-ux-live', finishedAt: new Date().toISOString(), allPass, checks }, null, 2)
  );
  console.log('evidence: acceptance/block-103/block103-knowledge-ux-live.json');
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
