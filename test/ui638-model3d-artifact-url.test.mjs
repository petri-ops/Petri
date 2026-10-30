/**
 * UI-638 点开腿 — model3d 产物 URL 投影契约（红绿先行）。
 *
 * 缺陷背景（实机 2026-10-30）：RW-06 补齐 result_json.artifacts 投影后，
 * Result Studio 选中 scene.glb 仍取流 404——artifacts 只有 name/path/sha256，
 * 前端回落 /api/tools/file/<job>/<name>，而 model3d 产物住在项目工作区
 * model3d/runs/<runId>/，不在 tool run output 布局。
 *
 * 契约：投影必须给出工作区读面 URL（/api/workspaces/:projectId/file?path=），
 * 且对绝对路径 / 越界路径 / 缺项目 fail-closed（不给 url，回落实旧行为）。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildModel3dArtifactRecords,
  buildWorkspaceArtifactUrl,
} from '../core/petri-server/helpers/model3d-artifact-projection.js';

describe('UI-638 model3d artifact url projection', () => {
  it('工作区相对路径 → /api/workspaces/<projectId>/file?path=<encoded>', () => {
    const records = buildModel3dArtifactRecords('p_demo', [
      { path: 'model3d/runs/m3d-1/scene.glb', sha256: 'a'.repeat(64) },
    ]);
    assert.equal(records.length, 1);
    assert.equal(records[0].name, 'scene.glb');
    assert.equal(records[0].filename, 'scene.glb');
    assert.equal(records[0].path, 'model3d/runs/m3d-1/scene.glb');
    assert.equal(records[0].sha256, 'a'.repeat(64));
    assert.equal(
      records[0].url,
      '/api/workspaces/p_demo/file?path=model3d%2Fruns%2Fm3d-1%2Fscene.glb',
    );
  });

  it('绝对路径 / 盘符 / 越界段 / 空路径 fail-closed（不给 url）', () => {
    for (const bad of ['/etc/passwd', 'C:\\Windows\\win.ini', 'model3d/../../secret.glb', '..\\x.png', '']) {
      const records = buildModel3dArtifactRecords('p_demo', [{ path: bad, sha256: null }]);
      assert.equal(records.length, 1, `path=${bad}`);
      assert.equal(records[0].url, undefined, `path=${bad} 不得带 url`);
    }
  });

  it('缺 projectId → 全量无 url（旧行为保持）', () => {
    const records = buildModel3dArtifactRecords('', [{ path: 'model3d/runs/m3d-1/scene.glb' }]);
    assert.equal(records.length, 1);
    assert.equal(records[0].url, undefined);
    assert.equal(buildWorkspaceArtifactUrl(null, 'model3d/runs/m3d-1/scene.glb'), null);
  });

  it('反斜杠路径归一后仍可投影；非数组输入返回空数组', () => {
    assert.equal(
      buildWorkspaceArtifactUrl('p_demo', 'model3d\\runs\\m3d-1\\front.png'),
      '/api/workspaces/p_demo/file?path=model3d%2Fruns%2Fm3d-1%2Ffront.png',
    );
    assert.deepEqual(buildModel3dArtifactRecords('p_demo', null), []);
    assert.deepEqual(buildModel3dArtifactRecords('p_demo', undefined), []);
  });

  it('projectId 编码：特殊字符不得注入查询串', () => {
    const url = buildWorkspaceArtifactUrl('p a&b', 'model3d/runs/x/scene.glb');
    assert.ok(url && url.startsWith('/api/workspaces/p%20a%26b/file?path='), String(url));
  });
});
