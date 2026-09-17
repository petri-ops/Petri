const path = require('node:path');
const lib = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const targets = await lib.pollTargets({ timeoutMs: 20000 });
  const candidates = lib.filterPageTargets(targets, /^http:\/\/localhost:3000\/(?!window\/)/);
  const client = await lib.connectTarget(candidates[0]);
  console.log('url:', await lib.evalJs(client, 'location.pathname'));
  console.log(await lib.evalJs(client, `JSON.stringify({
    treeItems: document.querySelectorAll('[role="treeitem"]').length,
    previewRows: document.querySelectorAll('[role="treeitem"][title^="预览"]').length,
    resize: document.querySelectorAll('[class*="FileTreeResize"], [class*="fileTreeResize"]').length,
    treeToggleBtns: Array.prototype.map.call(document.querySelectorAll('button'), function(b){return (b.getAttribute('title')||'');}).filter(function(t){return t.indexOf('文件树')>=0 || t.indexOf('展开文件')>=0;}).slice(0,4),
    rightTabs: Array.prototype.map.call(document.querySelectorAll('[role="tab"], [class*="rightTab"]'), function(b){return (b.textContent||'').trim();}).slice(0,6)
  })`));
  process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(2); });
