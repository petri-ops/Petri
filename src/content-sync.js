/**
 * content-sync.ts — 桌面版内容增量同步
 *
 * 启动时（及每 4 小时）检查远端 manifest，下载变化的文件到本地。
 * 同步范围：前端静态站（HTML/JS/CSS）+ R 脚本 + Demo 数据 + copilot-index.json
 *
 * 文件级 diff：对比 SHA256，只下载变化的文件。
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const MANIFEST_URL =
  process.env.BIOF3_CONTENT_MANIFEST_URL ||
  'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/content-manifest.json';
const CONTENT_BASE =
  process.env.BIOF3_CONTENT_BASE ||
  'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/desktop/content/';

const USER_DATA_DIR =
  process.env.BIOF3_LOCAL_DATA_DIR || path.join(app.getPath('documents'), 'BioF3-Local');
const LOCAL_CONTENT_DIR = path.join(USER_DATA_DIR, 'content');
const LOCAL_HASH_FILE = path.join(LOCAL_CONTENT_DIR, 'file-hash.json');

// 并发下载限制
const MAX_CONCURRENT = 5;

// ── 下载文件 ───────────────────────────────────────────────────

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try {
          fs.unlinkSync(destPath);
        } catch {}
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close(() => resolve(destPath));
      });
    });
    req.on('error', (e) => {
      file.close();
      try {
        fs.unlinkSync(destPath);
      } catch {}
      reject(e);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载超时'));
    });
  });
}

// ── 并发控制 ───────────────────────────────────────────────────

async function mapLimit(items, limit, fn) {
  const results = [];
  let index = 0;
  const workers = [];
  for (let i = 0; i < limit; i++) {
    workers.push(
      (async () => {
        while (index < items.length) {
          const current = index++;
          try {
            results[current] = await fn(items[current]);
          } catch (e) {
            results[current] = { error: e.message };
          }
        }
      })()
    );
  }
  await Promise.all(workers);
  return results;
}

// ── 主同步逻辑 ─────────────────────────────────────────────────

async function syncContent() {
  console.log('[content-sync] checking for updates...');

  // 1. 下载远端 manifest
  const remoteManifest = await fetchJson(MANIFEST_URL);
  if (!remoteManifest || !remoteManifest.files) {
    console.warn('[content-sync] no valid manifest from remote');
    return;
  }

  // 2. 加载本地 hash
  let localHashes = {};
  try {
    localHashes = JSON.parse(fs.readFileSync(LOCAL_HASH_FILE, 'utf8'));
  } catch {}

  // 3. 找变化文件
  const changed = [];
  const removed = [];
  for (const [file, hash] of Object.entries(remoteManifest.files)) {
    if (localHashes[file] !== hash) {
      changed.push(file);
    }
  }
  for (const file of Object.keys(localHashes)) {
    if (!remoteManifest.files[file]) {
      removed.push(file);
    }
  }

  if (changed.length === 0 && removed.length === 0) {
    console.log('[content-sync] already up to date');
    return;
  }

  console.log(`[content-sync] ${changed.length} files to download, ${removed.length} to remove`);

  // 4. 下载变化文件（并发）
  let successCount = 0;
  let failCount = 0;
  await mapLimit(changed, MAX_CONCURRENT, async (file) => {
    const localPath = path.join(LOCAL_CONTENT_DIR, file);
    try {
      await downloadFile(CONTENT_BASE + encodeURI(file), localPath);
      successCount++;
    } catch (e) {
      console.warn(`[content-sync] download failed: ${file}: ${e.message}`);
      failCount++;
    }
  });

  // 5. 删除已移除文件
  for (const file of removed) {
    try {
      fs.unlinkSync(path.join(LOCAL_CONTENT_DIR, file));
    } catch {}
  }

  // 6. 更新本地 hash（只记录成功下载的）
  const newHashes = {};
  for (const [file, hash] of Object.entries(remoteManifest.files)) {
    if (!changed.includes(file) || fs.existsSync(path.join(LOCAL_CONTENT_DIR, file))) {
      newHashes[file] = hash;
    }
  }
  fs.mkdirSync(LOCAL_CONTENT_DIR, { recursive: true });
  fs.writeFileSync(LOCAL_HASH_FILE, JSON.stringify(newHashes, null, 2));

  console.log(
    `[content-sync] done: ${successCount} downloaded, ${failCount} failed, ${removed.length} removed`
  );

  // 7. 通知 r-server 内容更新（R 脚本是运行时读盘，无需重载）
  if (globalThis._biof3ContentUpdated) {
    try {
      globalThis._biof3ContentUpdated();
    } catch {}
  }
}

// ── 辅助：fetch JSON ──────────────────────────────────────────

function fetchJson(url) {
  return new Promise((resolve) => {
    let buf = '';
    const req = https.get(url, { timeout: 15000 }, (res) => {
      if (res.statusCode !== 200) {
        return resolve(null);
      }
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(buf));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      try {
        req.destroy();
      } catch {}
      resolve(null);
    });
  });
}

module.exports = { syncContent, LOCAL_CONTENT_DIR };
