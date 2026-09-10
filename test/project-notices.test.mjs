// BLOCK-78 P2-⑤ — 项目持久通知 store 零网络测试。
// 插入/未读计数/项目隔离/全部已读/已读修剪。唯一账本契约：append-only + 读标记。
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = dirname(fileURLToPath(import.meta.url));

const tempRoot = mkdtempSync(join(tmpdir(), 'b78-notices-'));
process.env.BIOF3_DB_PATH = join(tempRoot, 'notices.db');
process.env.BIOF3_LOCAL_DATA_DIR = join(tempRoot, 'local-data');

const require = createRequire(import.meta.url);
{
  const Database = require(resolve(__dirname, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const boot = new Database(process.env.BIOF3_DB_PATH);
  const migDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of require('node:fs').readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(require('node:fs').readFileSync(require('node:path').resolve(migDir, f), 'utf8'));
  }
  boot.close();
}
const { createProjectNoticeStore } = require('../core/biof3-server/helpers/project-notices.js');
const db = require('../core/biof3-server/db');

test('project-notices：插入/未读计数/项目隔离/全部已读', () => {
  const store = createProjectNoticeStore(db.getDatabase());

  store.insertNotice({ projectId: 'p1', kind: 'job_failed', title: '火山图 失败', detail: 'Rscript exited 1' });
  store.insertNotice({ projectId: 'p1', kind: 'job_failed', title: 'QC 失败', detail: 'low cells' });
  store.insertNotice({ projectId: 'p2', kind: 'job_failed', title: '别的项目 失败', detail: '' });
  store.insertNotice({ projectId: 'p1', kind: 'job_failed', title: '', detail: '无标题应被拒' });

  assert.equal(store.unreadCount('p1'), 2, '无标题插入被拒 → 仅 2 条未读');
  assert.equal(store.unreadCount('p2'), 1, '项目隔离');

  const list = store.listNotices({ projectId: 'p1', unreadOnly: true });
  assert.equal(list.length, 2);
  assert.equal(list[0].title, 'QC 失败', 'created_at 同秒内按 id DESC 稳定排序');
  assert.equal(list[0].kind, 'job_failed');

  const marked = store.markAllSeen('p1');
  assert.equal(marked, 2);
  assert.equal(store.unreadCount('p1'), 0);

  const all = store.listNotices({ projectId: 'p1' });
  assert.equal(all.length, 2, '已读保留可查（不删除）');
  assert.ok(all.every((n) => n.readAt));
});

test('project-notices：防御（缺参返回 null/0）', () => {
  const store = createProjectNoticeStore(db.getDatabase());
  assert.equal(store.insertNotice({ projectId: '', kind: 'job_failed', title: 'x' }), null);
  assert.equal(store.unreadCount(''), 0);
  assert.equal(store.markAllSeen(''), 0);
});
