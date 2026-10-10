#!/usr/bin/env node
'use strict';
// A3 单独重验（可复跑）：等 25s → status/diff → 远端 git 对账
const http = require('node:http');
const { CdpClient } = require('./g0-rs-p7-cdp.cjs');
const { execFileSync } = require('node:child_process');
function fetchJson(url){return new Promise((res,rej)=>{http.get(url,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
const pid = process.argv[2];
if (!pid) { console.error('usage: node block67-p3-a3.cjs <projectId>'); process.exit(2); }
(async () => {
  await new Promise(r=>setTimeout(r,25000));
  const targets = await fetchJson('http://127.0.0.1:9222/json');
  const c = await new CdpClient(targets[0].webSocketDebuggerUrl).connect();
  const out = await Promise.race([
    c.send('Runtime.evaluate',{expression:`(async()=>{const br=(window.petri||window.petriDesktop)?.workingTreeReview;if(!br)return 'NO_BRIDGE';const st=await br.status({projectId:'${pid}'});const n=st.data?st.data.files.length:-1;let diffHas=false;if(n>0){const df=await br.diff({projectId:'${pid}',paths:['README.md']});diffHas=JSON.stringify(df).includes('remote-dirty-line');}return JSON.stringify({n,diffHas});})()`,awaitPromise:true,returnByValue:true}),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('eval_timeout')),45000)),
  ]);
  console.log(out.exceptionDetails?'EXC '+String(out.exceptionDetails.exception?.description||'').slice(0,150):out.result.value);
  const remote = execFileSync('ssh',['-o','BatchMode=yes','--','aliyun','cd /root/petri-block67-demo && git status --porcelain | head -1; git log --format=%ad -1 --date=format:%H:%M:%S'],{encoding:'utf8'});
  console.log('remote:', JSON.stringify(remote));
  c.socket.close();
  process.exit(0);
})().catch(e=>{console.error('ERR',e.message);process.exit(1)});
