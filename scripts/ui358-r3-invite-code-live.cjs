#!/usr/bin/env node
// UI-358 修订 3 实机探针：协作成员 tab 直接出码 + 双向文案。
// 前置：dev 栈在跑且 CDP 9222。用法: node scripts/ui358-r3-invite-code-live.cjs
const path = require('path');
const {
  pollTargets, filterPageTargets, selectPageTarget, connectTarget, evalJs,
  screenshotPng, createRun,
} = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-85');

async function main() {
  const run = createRun({ name: 'ui358-r3-invite-code-live', evidenceDir: EVIDENCE_DIR });
  const targets = await pollTargets({ port: 9222, timeoutMs: 15000 });
  const pages = filterPageTargets(targets, /localhost:3000|127\.0\.0\.1:3000|index\.html/);
  if (!pages.length) throw new Error('no_page_target');
  const target = await selectPageTarget(pages, {
    probe: async (c) => evalJs(c, `!!document.querySelector('[data-testid="sidebar-federation"]')`),
  });
  const client = await connectTarget(target);

  // 幂等打开联邦弹层并切到协作成员 tab
  const alreadyOpen = await evalJs(client, `!!document.querySelector('[data-testid="federation-popup"]')`);
  if (!alreadyOpen) {
    await evalJs(client, `document.querySelector('[data-testid="sidebar-federation"]').click(); 'ok'`);
  }
  await evalJs(client, `document.querySelector('[data-testid="federation-tab-peers"]')?.click(); 'ok'`);

  // 1. 邀请块在场（位于粘贴卡上方）+ 空态双向文案（列表/空态异步加载，等待任一渲染完成）
  const inviteBeforeAdd = await evalJs(client, `(() => {
    const panel = document.querySelector('[data-testid="federation-panel"]');
    const invite = panel?.querySelector('[data-testid="federation-invite"]');
    const add = panel?.querySelector('[data-testid="federation-pair-input"]');
    if (!invite || !add) return false;
    return invite.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING ? true : false;
  })()`);
  run.assert('invite_block_above_add_card', inviteBeforeAdd === true, '本机配对码块位于添加卡上方');
  let emptyText = '';
  for (let i = 0; i < 20 && !emptyText; i++) {
    await new Promise((r) => setTimeout(r, 400));
    emptyText = await evalJs(client, `document.querySelector('[data-testid="federation-empty"]')?.textContent || ''`);
  }
  run.assert('empty_state_two_way', /本机配对码发给对方/.test(emptyText), '空态双向文案: ' + emptyText.slice(0, 40));

  // 2. 切 tab 即自动出码（默认自动生成，无需手动点击）：QR + 链接 + 复制 + 重新生成
  let qrUp = false;
  for (let i = 0; i < 25 && !qrUp; i++) {
    await new Promise((r) => setTimeout(r, 400));
    qrUp = await evalJs(client, `!!document.querySelector('[data-testid="federation-invite-qr"]')`);
  }
  run.assert('invite_autogen_on_tab_open', qrUp, '切 tab 后自动出码（≤10s，无手动点击）');
  const link1 = await evalJs(client, `document.querySelector('[data-testid="federation-invite-link"]')?.textContent || ''`);
  run.assert('invite_link_pair_shape', /\/pair\?token=/.test(link1) && !/127\.0\.0\.1|localhost/.test(link1),
    '链接为 LAN 配对链接: ' + link1.slice(0, 60));
  run.assert('invite_copy_and_regen_present',
    await evalJs(client, `!!document.querySelector('[data-testid="federation-invite-copy"]') && !!document.querySelector('[data-testid="federation-invite-regen"]')`),
    '复制 + 重新生成按钮在场');

  // 3. 重新生成 → token 轮转
  await evalJs(client, `document.querySelector('[data-testid="federation-invite-regen"]').click(); 'ok'`);
  let link2 = link1;
  for (let i = 0; i < 20 && link2 === link1; i++) {
    await new Promise((r) => setTimeout(r, 400));
    link2 = await evalJs(client, `document.querySelector('[data-testid="federation-invite-link"]')?.textContent || ''`);
  }
  run.assert('invite_regen_rotates_token', link2 !== link1 && /\/pair\?token=/.test(link2), '重新生成轮转 token');

  // 4. 一个码两种用途的说明在场
  const inviteHint = await evalJs(client, `document.querySelector('[data-testid="federation-invite"]')?.textContent || ''`);
  run.assert('dual_use_caption', /手机扫码＝进入本机工作区/.test(inviteHint) && /添加本机为协作节点/.test(inviteHint),
    '邀请块含双用途说明');

  // 5. 我的设备 tab 的二维码说明补双向文案（面板挂载 + status 拉取均为异步，放宽等待）
  await evalJs(client, `document.querySelector('[data-testid="federation-tab-devices"]')?.click(); 'ok'`);
  let devicesHint = '';
  for (let i = 0; i < 40 && !/添加为.*协作节点/.test(devicesHint); i++) {
    await new Promise((r) => setTimeout(r, 500));
    devicesHint = await evalJs(client, `document.querySelector('[data-testid="federation-section-devices"]')?.textContent || ''`);
  }
  run.assert('devices_qr_hint_dual_use', /添加为.*协作节点/.test(devicesHint), '我的设备二维码说明含协作节点用途');

  const shot = await screenshotPng(client, EVIDENCE_DIR, 'ui358-r3-invite-code.png');
  console.log('screenshot: ' + shot);
  await run.finish({});
  try { client.socket.close(); } catch { /* ignore */ }
  if (!run.allPass) process.exitCode = 1;
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
