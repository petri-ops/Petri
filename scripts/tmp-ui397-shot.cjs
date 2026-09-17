const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\//);
  const target = await lib.selectPageTarget(candidates, { probe: async (c) => lib.evalJs(c, `!!document.getElementById('root')`).catch(() => false) });
  const client = await lib.connectTarget(target);
  await client.send('Page.bringToFront').catch(() => {});
  await lib.evalJs(client, `location.href = 'http://localhost:3000/project/p_mtuuy445_c1un'; 'nav'`);
  await sleep(6000); // 等心跳首拍
  const state = await lib.evalJs(client, `(function(){
    var dot = document.querySelector('[class*="sshBreath"], [class*="dot"]');
    var dots = Array.from(document.querySelectorAll('span')).filter(function(n){ return n.className && String(n.className).indexOf('alive') >= 0; });
    return JSON.stringify({ dotFound: dots.length, sample: dots[0] ? getComputedStyle(dots[0]).backgroundColor : null });
  })()`);
  console.log(state);
  await lib.screenshotPng(client, 'C:/Users/Admin/AppData/Local/Temp/gewu-probe/shots/block95', 'ui397-breath-green.png');
  process.exit(0);
})().catch((e) => { console.error('ERR', e && e.message); process.exit(2); });
