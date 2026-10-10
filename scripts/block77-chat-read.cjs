#!/usr/bin/env node
'use strict';
const path = require('path');
const REPO = path.join(process.cwd());
const lib = require(path.join(REPO, '.agents', 'skills', 'petri-dev-infra', 'dev-verify', 'lib.cjs'));
const delay = (ms) => new Promise(r => setTimeout(r, ms));
async function main() {
  const targets = await lib.pollTargets({ timeoutMs: 10000 });
  const pages = lib.filterPageTargets(targets, /localhost:3000/);
  const main = await lib.selectPageTarget(pages, {
    probe: (c) => lib.evalJs(c, '!!document.querySelector("textarea.sc-input")', 5000).catch(() => false),
  });
  const client = await lib.connectTarget(main);
  await client.send('Page.navigate', { url: 'http://localhost:3000/project/p_mtvqlevq_2oe5' }).catch(() => {});
  await delay(5000);
  const expr = [
    '(() => {',
    '  var msgs = document.querySelectorAll("[class*=sc-msg-assistant], [class*=assistantMessage], .markdown-body");',
    '  var out = [];',
    '  for (var i = 0; i < msgs.length; i++) out.push(msgs[i].innerText);',
    '  return out.join("\\n===\\n").slice(-2000);',
    '})()',
  ].join('\n');
  const text = await lib.evalJs(client, expr, 20000);
  console.log(text);
  client.socket.close();
}
main().catch(e => console.log('ERR', e.message));
