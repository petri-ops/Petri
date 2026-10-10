// step11: click 继续执行 -> wait popover -> click 确认继续 -> poll completion + no-reexec proof
import { existsSync, statSync } from 'node:fs';
const targets = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:3000'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
function send(method, params) {
  return new Promise((res, rej) => {
    const i = ++id;
    const h = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === i) { ws.removeEventListener('message', h); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.addEventListener('message', h);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
}
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  return r.result?.value;
};
const mtime = (f) => { try { return statSync(`<repo>/${f}`).mtimeMs; } catch { return -1; } };
const pre = { s1: mtime('p39s1.txt'), s2: mtime('p39s2.txt') };
console.log('PRE_MT:', JSON.stringify(pre));

// 1. click outer 继续执行
console.log('OPEN:', await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续执行'); if(!b) return 'none'; b.click(); return 'opened'; })()`));
await sleep(800);
// 2. click exact 确认继续
console.log('CONFIRM:', await ev(`(() => { const b=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='确认继续'); if(!b) return 'no-confirm-btn'; if(b.disabled) return 'disabled'; b.click(); return 'confirmed'; })()`));
// 3. poll: new task created + files s3/s4 + s1/s2 mtimes unchanged
const t0 = Date.now();
let done = false, s3s4 = false;
while (Date.now() - t0 < 180000) {
  await sleep(2000);
  s3s4 = existsSync('<repo>/p39s3.txt') && existsSync('<repo>/p39s4.txt');
  const all4 = s3s4 && existsSync('<repo>/p39s1.txt') && existsSync('<repo>/p39s2.txt');
  if (all4) {
    // wait a bit more for task to wrap up
    await sleep(4000);
    done = true; break;
  }
}
const post = { s1: mtime('p39s1.txt'), s2: mtime('p39s2.txt') };
console.log('DONE:', done, 'S3S4:', s3s4, 'NO_REEXEC_S1S2:', post.s1 === pre.s1 && post.s2 === pre.s2);
// 4. final UI state: resume button should be gone
console.log('UI_TAIL:', await ev(`(() => { const t=document.body.innerText; const btn=[...document.querySelectorAll('button')].find(x=>(x.textContent||'').trim()==='继续执行'); return JSON.stringify({ resumeBtnVisible: !!btn, tail: t.slice(-300) }); })()`));
ws.close();
process.exit(0);
