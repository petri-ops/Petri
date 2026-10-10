#!/usr/bin/env node
'use strict';
// 调试探针：导航到项目页 → 发送 resident_task_create 请求 → 每 5s 抓取聊天区文本 → 打印
const path = require('path');
const REPO = path.join(__dirname, '..');
const lib = require(path.join(REPO, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const projectId = process.argv[2];
  const targets = await lib.pollTargets({ timeoutMs: 15000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  const main = await lib.selectPageTarget(pages, {
    probe: (client) => lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')', 5000).catch(() => false),
  });
  const client = await lib.connectTarget(main);
  await client.send('Page.navigate', { url: `http://localhost:3000/project/${projectId}` });
  let ok = false;
  for (let i = 0; i < 30 && !ok; i++) {
    ok = await lib.evalJs(client, '!!document.querySelector(\'textarea.sc-input\')').catch(() => false);
    if (!ok) await delay(1000);
  }
  console.log('interactive:', ok);
  await delay(2500);

  const prompt = [
    '请用 resident_task_create 工具创建一个驻留任务，参数如下：',
    'command 填：sleep 1200 && echo done > .petri/resident/sleep-done.txt',
    'intent 填：P4 全链验证探针：挂机 20 分钟',
    'success_criteria 填：1200 秒后 sleep-done.txt 出现',
    'failure_handling 填：notify-only',
    '创建完成后，把返回的 taskId、pid 和日志路径原样告诉我。',
  ].join('\n');
  const sent = await lib.evalJs(client, `(async () => {
    const ta = document.querySelector('textarea.sc-input');
    if (!ta) return 'no_textarea';
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(prompt)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    const send = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
    if (!send || send.disabled) return 'send_unavailable';
    send.click();
    return 'sent';
  })()`, 10000);
  console.log('send result:', sent);
  if (sent !== 'sent') { client.socket.close(); process.exit(1); }

  for (let i = 0; i < 24; i++) {
    await delay(5000);
    const snapshot = await lib.evalJs(client, `(() => {
      const msgs = [...document.querySelectorAll('[class*="sc-msg-assistant"], [class*="assistantMessage"], .markdown-body')];
      const last = msgs.length ? msgs[msgs.length - 1].innerText.slice(-300) : '(no msgs)';
      const busyEl = document.querySelector('[class*="sc-busy"], [class*="typing"]');
      const sendBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.title || '').includes('发送'));
      return JSON.stringify({ msgCount: msgs.length, last, busy: !!busyEl, sendDisabled: sendBtn ? sendBtn.disabled : null });
    })()`, 15000).catch((e) => JSON.stringify({ evalErr: e.message }));
    console.log(`t+${(i + 1) * 5}s:`, snapshot);
    const parsed = JSON.parse(snapshot);
    if (!parsed.busy && parsed.sendDisabled === false && i >= 2) {
      const full = await lib.evalJs(client, `(() => {
        const msgs = [...document.querySelectorAll('[class*="sc-msg-assistant"], [class*="assistantMessage"], .markdown-body')];
        return msgs.map((m) => m.innerText).join('\\n===\\n').slice(-1200);
      })()`, 15000).catch(() => 'eval_err');
      console.log('=== FULL TAIL ===');
      console.log(String(full).slice(-1200));
      break;
    }
  }
  client.socket.close();
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
