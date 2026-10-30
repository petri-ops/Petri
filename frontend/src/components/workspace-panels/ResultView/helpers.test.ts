/**
 * UI-638 点开腿 — 结果面 fallback 产物记录构造（红绿先行）。
 *
 * 缺陷背景：ResultArtifactShell 的 fallbackArtifacts 把 url 硬写成
 * buildUrl(name)（/api/tools/file/<job>/<name>），丢弃后端投影的 workspace
 * 读面 url —— model3d 产物（model3d/runs/...）因此 404。
 *
 * 桌面端 API 与 SPA 不同源（:3001 vs :3000）：后端投影的是站点绝对路径
 * /api/workspaces/...，必须挂到 API base 才能被 <img>/GLTFLoader 直接取。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { artifactRecordsFromFiles } from './helpers';

const API_BASE = 'http://127.0.0.1:3001/api';
const buildUrl = (name: string) => `${API_BASE}/tools/file/job1/${encodeURIComponent(name)}`;

describe('artifactRecordsFromFiles', () => {
  it('后端声明站点绝对路径 → 挂到 API base（桌面端跨源取流）', () => {
    const records = artifactRecordsFromFiles(
      [{ name: 'scene.glb', type: 'file', url: '/api/workspaces/p1/file?path=model3d%2Fruns%2Fr1%2Fscene.glb' }],
      buildUrl,
      API_BASE,
    );
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'scene.glb');
    assert.equal(
      records[0].url,
      'http://127.0.0.1:3001/api/workspaces/p1/file?path=model3d%2Fruns%2Fr1%2Fscene.glb',
    );
  });

  it('未声明 url → 回落 buildUrl(name)', () => {
    const records = artifactRecordsFromFiles([{ name: 'a.png', type: 'plot', filename: 'a.png' }], buildUrl, API_BASE);
    assert.equal(records[0].url, buildUrl('a.png'));
  });

  it('相对/非法声明 url → 回落 buildUrl（不接受可注入形态）', () => {
    for (const bad of ['model3d/runs/r1/scene.glb', '//evil.example/x', 'javascript:alert(1)', '  ']) {
      const records = artifactRecordsFromFiles([{ name: 'a.png', type: 'plot', url: bad }], buildUrl, API_BASE);
      assert.equal(records[0].url, buildUrl('a.png'), `declared=${bad}`);
    }
  });

  it('站点绝对路径但缺 API base → fail-closed 回落（不得裸用相对路径）', () => {
    const records = artifactRecordsFromFiles(
      [{ name: 'scene.glb', type: 'file', url: '/api/workspaces/p1/file?path=x' }],
      buildUrl,
    );
    assert.equal(records[0].url, buildUrl('scene.glb'));
  });

  it('https 声明保留；name 缺省取 filename', () => {
    const records = artifactRecordsFromFiles(
      [{ filename: 'b.stl', type: 'file', url: 'https://example.com/b.stl' }] as never,
      buildUrl,
      API_BASE,
    );
    assert.equal(records[0].name, 'b.stl');
    assert.equal(records[0].url, 'https://example.com/b.stl');
  });
});
