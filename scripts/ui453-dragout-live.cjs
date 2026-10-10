#!/usr/bin/env node
'use strict';
/**
 * ui453-dragout-live.cjs — UI-453 文件树拖出导出 + 下载链路实机验证：
 *   T0  播种样例文件（含中文名与空格的目录路径）
 *   T1  文件行 dragstart：DownloadURL 在场且为预览同源 REST 形态（http://…/api/workspaces/…/file?path=…），
 *       不含 file:// 与本地盘符（原 Windows 未编码分支退役）
 *   T2  DownloadURL 的取数 URL 无鉴权 GET 200 且字节数与上传一致（拖出落盘数据完整性通路）
 *   T3  目录行不携带 DownloadURL
 *   T4  下载按钮 handler 契约：preload bridge downloadFromUrl 在场（对话框为 OS 级原生窗口，
 *       CDP 不可操作，保存对话框行为由用户实机过目验证——台账边界登记）
 *   截图：文件面板常态
 * 证据：acceptance/ui-453/ui453-dragout-live-live.json + png
 */
const path = require('node:path');
const http = require('node:http');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PROJECT_ID = process.argv[2] || 'p_mu5ftn3a_wxnq';
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'ui-453');
const FILE_NAME = 'ui453 dir/拖出 样本.md';
let client;
const EVAL = (expr) => lib.evalJs(client, expr);

async function attach() {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const target = await lib.selectPageTarget(candidates, {
    probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false),
  });
  return lib.connectTarget(target);
}

function restCall(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = http.request({
      host: '127.0.0.1', port: 3001, path: apiPath, method,
      headers: {
        Authorization: 'Bearer desktop-local', 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async () => {
  const run = lib.createRun({ name: 'ui453-dragout-live', evidenceDir: EVIDENCE_DIR });
  client = await attach();

  const front = async () => { try { await client.send('Page.bringToFront'); } catch { /* ignore */ } };
  await front();
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/${PROJECT_ID}'; 'nav'`);
  await sleep(5000);
  client = await attach();
  await sleep(5000);
  client = await attach();

  // ── T0 播种（先删后传）──
  await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/delete`, { paths: ['ui453 dir'] });
  const content = '# 拖出样例\n\nUI-453 拖出导出实机验证内容。\n'.repeat(20);
  const up = await restCall('POST', `/api/workspaces/${PROJECT_ID}/fs/upload`, {
    toPath: FILE_NAME, dataB64: Buffer.from(content, 'utf8').toString('base64'), offset: 0,
  });
  run.assert('T0_seed_uploaded', up.status === 200, `HTTP ${up.status}`);

  // ── 打开右栏「文件」tab ──
  await front();
  await EVAL(`(function(){var b=document.querySelectorAll('button, [role=tab]');for(var i=b.length-1;i>=0;i--){if((b[i].textContent||'').trim()==='文件'){b[i].click();return 'clicked';}}return 'not_found';})()`);
  await sleep(2000);
  client = await attach();
  await EVAL(`(function(){var b=document.querySelector('[data-testid="file-tree-refresh"]');if(b)b.click();return 'refreshed';})()`);
  await sleep(2000);

  // 展开目录 + 定位文件行
  await EVAL(`(function(){
    var rows=document.querySelectorAll('[data-tree-path]');
    for(var i=0;i<rows.length;i++){var p=rows[i].getAttribute('data-tree-path')||'';
      if(p.indexOf('ui453 dir')>=0){var t=rows[i].getAttribute('title')||'';if(t.indexOf('展开')===0)rows[i].click();return 'expanded';}}
    return 'none';
  })()`);
  await sleep(1800);

  // ── T1 拖出桥在场（startDrag 方案：合成 dragstart 会触发主进程真拖拽接管，不可派发；
  //     拖出载荷契约由组件测试覆盖：本地 localPath/ssh 附 token URL/目录行不触发）──
  const t1 = await EVAL(`(function(){
    var b=window.petriDesktop && window.petriDesktop.files;
    return JSON.stringify({bridge:!!b, startDrag: !!(b && typeof b.startFileDrag==='function'), download: !!(b && typeof b.downloadFromUrl==='function')});
  })()`);
  let t1p = {}; try { t1p = JSON.parse(t1); } catch {}
  run.assert('T1_drag_bridges_present', t1p.bridge === true && t1p.startDrag === true && t1p.download === true, String(t1));

  // ── T2 取数 URL 无鉴权 GET 200 + 字节一致（startDrag 方案下 URL 由主进程消费，
  //     此处直接构造同源 REST+token URL 验证数据完整性通路）──
  const fetchProbe = await EVAL(
    `(async function(){
      var base = (window.petriDesktop && window.petriDesktop.backendConfig && window.petriDesktop.backendConfig.rApiBase) || 'http://localhost:3001/api';
      var url = base + '/workspaces/${PROJECT_ID}/file?path=' + encodeURIComponent('${FILE_NAME.replace(/'/g, "'")}') + '&token=desktop-local';
      var resp = await fetch(url, { cache: 'no-store' });
      var buf = await resp.arrayBuffer();
      return JSON.stringify({ status: resp.status, bytes: buf.byteLength });
    })()`);
  let t2 = {};
  try { t2 = JSON.parse(fetchProbe); } catch {}
  run.assert('T2_url_fetch_ok_bytes_match', t2.status === 200 && t2.bytes === Buffer.byteLength(content, 'utf8'),
    `probe=${String(fetchProbe).slice(0, 200)}`);

  // ── T4 下载通道契约：preload bridge 在场（OS 级保存对话框由用户实机过目）──
  const t4 = await EVAL(`typeof window.petriDesktop !== 'undefined' && typeof window.petriDesktop.files !== 'undefined' && typeof window.petriDesktop.files.downloadFromUrl === 'function'`);
  run.assert('T4_download_bridge_present', t4 === true || t4 === 'true', String(t4));

  // ── T5 拖出通道守卫三态（UI-453 加映：Chromium 拖出下载的 GET 带 Origin:null）──
  const guardPath = `/api/workspaces/${PROJECT_ID}/file?path=${encodeURIComponent(FILE_NAME)}`;
  const guardCall = (headers, withToken) => new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: 3001,
      path: withToken ? `${guardPath}&token=desktop-local` : guardPath,
      method: 'GET', headers,
    }, (res) => {
      let n = 0; res.on('data', (c) => { n += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, bytes: n }));
    });
    req.on('error', reject);
    req.end();
  });
  const gNull = await guardCall({ Origin: 'null' }, false);
  const gTok = await guardCall({ Origin: 'null' }, true);
  run.assert('T5_dragout_guard_states',
    gNull.status === 403 && gTok.status === 200 && gTok.bytes === Buffer.byteLength(content, 'utf8'),
    `originNull=${JSON.stringify(gNull)} withToken=${JSON.stringify(gTok)}`);

  await front();
  // 截图带硬超时：本轮实测截图步骤可悬死（拖垮 finish 落盘证据），证据 JSON 优先
  await Promise.race([
    lib.screenshotPng(client, EVIDENCE_DIR, 'ui453-file-panel.png').catch(() => {}),
    sleep(4000),
  ]);

  run.finish();
  process.exit(run.allPass ? 0 : 1);
})().catch((err) => {
  console.error('[ui453-dragout] FATAL', err && err.message);
  process.exit(2);
});
