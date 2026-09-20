#!/usr/bin/env node
// BLOCK-85 §9.2 Mac 侧出码：打开左栏「联邦」弹层（默认「我的设备」tab），读取自动出码的配对链接。
// 前置：dev 栈在跑且 CDP 9222（BIOF3_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev）。
// 用法: node scripts/block85-mac-pairing-code.cjs
const path = require('path');
const {
  pollTargets, filterPageTargets, selectPageTarget, connectTarget, evalJs,
  screenshotPng, createRun,
} = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-85');

async function main() {
  const run = createRun({ name: 'block85-mac-pairing-code', evidenceDir: EVIDENCE_DIR });
  const targets = await pollTargets({ port: 9222, timeoutMs: 15000 });
  const pages = filterPageTargets(targets, /localhost:3000|127\.0\.0\.1:3000|index\.html/);
  if (!pages.length) throw new Error('no_page_target: ' + targets.map(t => t.url).join(' | '));
  const target = await selectPageTarget(pages, {
    probe: async (c) => evalJs(c, `!!document.querySelector('[data-testid="sidebar-federation"]')`),
  });
  const client = await connectTarget(target);

  // 1. 打开「联邦」弹层（开关语义：已开则不重复点），确保切到「我的设备」tab
  //    （MobileSyncPanel 挂载即自动出码；弹层会记住上次停留的 tab）
  const alreadyOpen = await evalJs(client, `!!document.querySelector('[data-testid="federation-popup"]')`);
  if (!alreadyOpen) {
    await evalJs(client, `document.querySelector('[data-testid="sidebar-federation"]').click(); 'ok'`);
  }
  await evalJs(client, `document.querySelector('[data-testid="federation-tab-devices"]')?.click(); 'ok'`);

  // 2. 轮询等 QR 就绪（后端 TTL 5 分钟，面板打开即生成）
  let qrReady = false;
  for (let i = 0; i < 30 && !qrReady; i++) {
    await new Promise((r) => setTimeout(r, 500));
    qrReady = await evalJs(client, `!!document.querySelector('[data-testid="mobile-pairing-qr"]')`);
  }
  run.assert('federation_popup_open', await evalJs(client, `!!document.querySelector('[data-testid="federation-popup"]')`), '弹层在场');
  run.assert('pairing_qr_present', qrReady, '自动出码 QR 在场（≤15s）');
  if (!qrReady) { console.error('QR 未就绪'); process.exitCode = 1; }

  // 3. 读 token 与 primaryUrl（linkHost 是 CSS module 哈希类，改按 title 属性取完整链接）
  const info = await evalJs(client, `(() => {
    const img = document.querySelector('[data-testid="mobile-pairing-qr"]');
    const link = document.querySelector('[data-testid="mobile-copy-link"] span[title]')
      || document.querySelector('[data-testid="mobile-copy-link"] [title]');
    return { qrSrc: img ? img.getAttribute('src') : null, primaryUrl: link ? link.getAttribute('title') : null };
  })()`);
  const token = info && info.qrSrc ? (info.qrSrc.match(/token=([^&]+)/) || [])[1] : null;
  let url = info ? info.primaryUrl : null;
  if (!url && token) {
    // 兜底：本地 localhost 信任面直接向后端要当前活动码。
    // 注意：每次 POST 都轮转新码（面板 4 分钟自动续码同机制），后端活动码与面板 QR
    // 的 token 天然可能不同步——两者各自有效至各自 5 分钟 TTL，不做同 token 断言。
    const res = await fetch('http://127.0.0.1:3001/api/mobile/pairing/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
    const data = await res.json();
    run.assert('backend_pairing_url_shape', !!(data && data.ok && /\/pair\?token=/.test(data.primaryUrl || '')),
      '后端直取配对链接形状');
    url = (data && data.primaryUrl) || null;
  }
  run.assert('pairing_token_extracted', !!token, 'QR src 提取 token');
  run.assert('primary_url_pair_shape', !!url && /\/pair\?token=/.test(url), 'primaryUrl 为配对链接: ' + (url || 'null'));
  run.assert('primary_url_lan_not_loopback', !!url && !url.includes('127.0.0.1') && !url.includes('localhost'),
    'BLOCK-85-HOTFIX 契约：primary 走 LAN 不吃 127.0.0.1');

  const shot = await screenshotPng(client, EVIDENCE_DIR, 'mac-pairing-code.png');
  console.log('screenshot: ' + shot);
  console.log('PAIRING_URL: ' + (url || '(未取得)'));
  await run.finish({ primaryUrl: url, lan: '192.168.0.102', gatewayPort: 3005 });
  try { client.socket.close(); } catch { /* ignore */ }
  if (!run.allPass) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
