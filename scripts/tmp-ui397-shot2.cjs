const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) });
  const client = await lib.connectTarget(target);
  await client.send('Page.bringToFront').catch(() => {});
  // 打开右栏「文件」tab
  await lib.evalJs(client, `(function(){
    var tabs = Array.from(document.querySelectorAll('button, [role=tab]'));
    var f = tabs.filter(function(n){ return n.textContent && n.textContent.trim().startsWith('文件'); })[0];
    if (f) f.click();
    return 'tab';
  })()`);
  await sleep(12000); // 等下轮心跳
  const state = await lib.evalJs(client, `(function(){
    var alive = document.querySelectorAll('span[class*="alive"]').length;
    var conn = document.querySelectorAll('span[class*="connecting"]').length;
    var dead = document.querySelectorAll('span[class*="dead"]').length;
    return JSON.stringify({ alive, connecting: conn, dead });
  })()`);
  console.log(state);
  await lib.screenshotPng(client, 'C:/Users/Admin/AppData/Local/Temp/gewu-probe/shots/block95', 'ui397-stable.png');
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(2); });
