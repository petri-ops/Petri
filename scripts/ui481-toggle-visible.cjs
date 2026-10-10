/**
 * UI-481 过目辅助 — CDP 截图：领域插件货架已装卡片上的「停用/启用」开关。
 * 复用 dev-infra lib 的 connectTarget（CdpClient 单源）。
 */
const path = require('path');
const fs = require('fs');
const { connectTarget } = require(path.join(__dirname, '..', '.agents', 'skills', 'gewu-dev-infra', 'dev-verify', 'lib.cjs'));

(async () => {
  const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
  const page = list.find((t) => t.type === 'page' && /localhost:3000/.test(t.url));
  if (!page) throw new Error('no page target');
  const cdp = await connectTarget(page);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: 'http://localhost:3000/extensions?tab=domain-plugins' });
  await new Promise((r) => setTimeout(r, 3500));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  const out = path.join('acceptance', 'ui-481');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'toggle-visible.png'), Buffer.from(shot.data, 'base64'));
  // 元素级断言：开关按钮在场
  const { root } = await cdp.send('DOM.getDocument');
  const found = [];
  for (const sel of ['[data-testid="plugin-toggle-b157-probe-plugin"]']) {
    try {
      const node = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      found.push({ sel, present: node.nodeId > 0 });
    } catch { found.push({ sel, present: false }); }
  }
  console.log(JSON.stringify(found, null, 1));
  await cdp.close ? cdp.close() : null;
  process.exit(found.every((f) => f.present) ? 0 : 2);
})().catch((e) => { console.error(e); process.exit(1); });
