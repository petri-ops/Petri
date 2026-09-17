const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('D:/1.WorkDir/biof3-desktop/core/biof3-server/node_modules/better-sqlite3');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'srv-boot-'));
const boot = new Database(path.join(dir, 'b.db'));
const mig = 'D:/1.WorkDir/biof3-desktop/src/migrations';
for (const f of fs.readdirSync(mig).filter(f => f.endsWith('.sql')).sort()) boot.exec(fs.readFileSync(path.join(mig, f), 'utf8'));
boot.close();
process.env.BIOF3_DB_PATH = path.join(dir, 'b.db');
process.env.BIOF3_LOCAL_DATA_DIR = dir;
process.env.PORT = '3999';
process.on('uncaughtException', (e) => { console.log('UNCAUGHT:', e.message); });
try {
  require('D:/1.WorkDir/biof3-desktop/core/biof3-server/server.js');
  console.log('server.js loaded');
} catch (e) {
  console.log('SERVER LOAD FAIL:', e.message);
  process.exit(0);
}
setTimeout(() => {
  const http = require('http');
  const req = http.request({ host: '127.0.0.1', port: 3999, path: '/api/ai/agent', method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer desktop-local' } }, (res) => {
    let b = ''; res.on('data', c => b += c); res.on('end', () => { console.log('POST /api/ai/agent →', res.statusCode, b.slice(0, 120)); process.exit(0); });
  });
  req.on('error', (e) => { console.log('req err:', e.message); process.exit(0); });
  req.write(JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }));
  req.end();
}, 3000);
