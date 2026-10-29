import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
function css(file: string): string {
  return fs.readFileSync(path.resolve(root, 'src/components/work-surface', file), 'utf8');
}

describe('NEXT-02B 3D workSurface container layout', () => {
  it('surface 用容器查询而非视口媒体查询降为单列', () => {
    const text = css('Model3DSurface.module.css');
    expect(text).toContain('container-type: inline-size');
    expect(text).toContain('@container (max-width: 720px)');
    expect(text).not.toContain('@media (max-width: 820px)');
  });

  it('review/edit 面板在窄容器内收敛行布局', () => {
    for (const file of ['Model3DReviewPanel.module.css', 'Model3DEditPanel.module.css']) {
      const text = css(file);
      expect(text).toContain('container-type: inline-size');
      expect(text).toContain('@container (max-width: 420px)');
    }
  });
});
