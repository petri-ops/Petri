/**
 * BLOCK-181 代行评估 — gen-ui fragment 路径自愈解析单测。
 * 钉住：规范位直查 / 截断会话目录回退+自愈改名 / 多候选 mtime / 无候选 null。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const paths = require(path.join(root, 'src', 'main', 'gen-ui', 'paths.js'));

function fixture() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'genui-repair-'));
  return ws;
}

test('规范位直查：完整会话目录内命中', () => {
  const ws = fixture();
  const file = path.join(ws, '.petri', 'gen-ui', 'conv_abc', 'chart.html');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '<h1>ok</h1>');
  const r = paths.resolveFragmentPath({ workspacePath: ws, conversationId: 'conv_abc', filePath: '.petri/gen-ui/conv_abc/chart.html' });
  assert.ok(r && r.path === file && r.repaired === false);
});

test('截断会话目录回退 + 自愈改名到规范目录', () => {
  const ws = fixture();
  const truncated = path.join(ws, '.petri', 'gen-ui', 'conv_3c15cb7c-3c15-3c1', 'sales.html');
  fs.mkdirSync(path.dirname(truncated), { recursive: true });
  fs.writeFileSync(truncated, '<h1>chart</h1>');
  const r = paths.resolveFragmentPath({ workspacePath: ws, conversationId: 'conv_3c15cb7c-3c15-3c15-abc', filePath: '.petri/gen-ui/conv_3c15cb7c-3c15-3c1/sales.html' });
  assert.ok(r, '回退命中');
  assert.ok(fs.existsSync(r.path), '改名后文件在规范目录');
  assert.equal(path.basename(path.dirname(r.path)), 'conv_3c15cb7c-3c15-3c15-abc', '目录已自愈为规范会话 id');
  assert.ok(!fs.existsSync(path.dirname(truncated)), '截断目录已迁走');
});

test('多候选：mtime 最新优先', async () => {
  const ws = fixture();
  const dirA = path.join(ws, '.petri', 'gen-ui', 'conv_old');
  const dirB = path.join(ws, '.petri', 'gen-ui', 'conv_new');
  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });
  const fa = path.join(dirA, 'chart.html');
  const fb = path.join(dirB, 'chart.html');
  fs.writeFileSync(fa, 'old');
  fs.writeFileSync(fb, 'new');
  const past = new Date(Date.now() - 60000);
  fs.utimesSync(fa, past, past);
  const r = paths.resolveFragmentPath({ workspacePath: ws, conversationId: 'conv_x', filePath: '.petri/gen-ui/conv_old/chart.html' });
  assert.ok(r, '回退命中');
  assert.equal(fs.readFileSync(r.path, 'utf8'), 'new', 'mtime 最新的候选胜出（自愈改名后返回规范位路径）');
});

test('无候选：null', () => {
  const ws = fixture();
  assert.equal(paths.resolveFragmentPath({ workspacePath: ws, conversationId: 'conv_a', filePath: '.petri/gen-ui/conv_a/nope.html' }), null);
});

test('隐藏文件/无 basename：拒绝', () => {
  const ws = fixture();
  assert.equal(paths.resolveFragmentPath({ workspacePath: ws, conversationId: 'conv_a', filePath: '.petri/gen-ui/conv_a/.hidden' }), null);
});
