// UI-397 实测：闲置 6 分钟（>旧 5 分钟阈值）后探活应即时成功（连接未被主动关闭）
const path = require('node:path');
const http = require('node:http');
const AUTH = { Authorization: 'Bearer desktop-local' };
const PID = 'p_mtuuy445_c1un'; // devah (ssh dell)
function ping() {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:3001/api/workspaces/${PID}/ssh-ping`, { headers: AUTH, timeout: 15000 }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.end();
  });
}
(async () => {
  const t0 = Date.now();
  const first = await ping();
  console.log('首探:', JSON.stringify(first), `(${Date.now() - t0}ms)`);
  console.log('闲置 6 分钟（旧机制此处会被主动断连）…');
  await sleep(6 * 60 * 1000);
  const t1 = Date.now();
  const second = await ping();
  const ms = Date.now() - t1;
  console.log('闲置后探:', JSON.stringify(second), `(${ms}ms)`);
  const alive = second && second.ok === true && ms < 2000;
  console.log(alive ? 'PASS: 连接闲置 6 分钟后依然存活（未主动断连）' : 'FAIL: 闲置后未即时恢复');
  process.exit(alive ? 0 : 1);
  function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
})();
