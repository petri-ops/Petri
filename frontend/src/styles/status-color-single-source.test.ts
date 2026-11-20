/**
 * S6a/P0-3 状态色单源 — HK-01 红绿先行契约（R2 清偿批）。
 *
 * R2 评估 P0-3（VISUAL-UPGRADE-PLAN §9.4 U 类，用户 2026-11-20 预授权执行）：
 * `--petri-success` / `--petri-status-success` / `--petri-status-success-fg` 三套并存 =
 * 状态语义双源。合并设计（单一最合理选择）：success 绿收敛到既有 status 家族形态
 * （bare=指示/图形、-fg=前景文字、-bg=卡片底，与 error/warning 家族同构）；
 * `--petri-success`（UI-151 补齐时代产物）删除，12 处消费按角色机械替换，
 * **不留兼容别名**（替换后旧名零定义零引用）。
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CUSTOM = path.join(ROOT, 'frontend', 'src', 'styles', 'custom.css');

function grepFrontend(args: string[]): string[] {
  try {
    const out = execFileSync('git', ['grep', '-n', '-e', ...args, '--', 'frontend/src'], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    return out.split('\n').filter(Boolean);
  } catch {
    return []; // git grep 退出码 1 = 无命中（对「零定义/零消费」断言即通过条件）
  }
}

describe('状态色单源（success 绿家族 = status-success{,-fg}，P0-3）', () => {
  it('旧名 --petri-success 零定义（不留兼容别名）', () => {
    const custom = grepFrontend(['--petri-success:']);
    const selfDefinitions = custom.filter(
      (l) => l.includes('styles/custom.css') && /--petri-success:\s*[^-]/.test(l),
    );
    expect(selfDefinitions, `仍存在定义: ${selfDefinitions.join(' | ')}`).toEqual([]);
  });

  it('旧名 var(--petri-success) 零消费（全前端机械替换完成）', () => {
    let hits: string[] = [];
    try {
      hits = grepFrontend(['' + 'var(--petri-success)']).filter((l) => !l.includes('var(--petri-status-success'));
    } catch {
      hits = []; // git grep 无命中退出码 1 = 已清零
    }
    expect(hits, `仍存在消费: ${hits.join(' | ')}`).toEqual([]);
  });

  it('新家族 light/dark 各定义一次且只住在 custom.css（无第二定义源）', () => {
    // 固定串匹配：`--petri-status-success:` 不会命中 `-fg:` 行（success 后是 `-` 非 `:`）
    const bare = grepFrontend(['--petri-status-success:']);
    const fg = grepFrontend(['--petri-status-success-fg:']);
    // light + dark 各一套（bare 2 + fg 2 = 4 行定义），全部在 custom.css
    const definitions = [...bare, ...fg];
    expect(definitions.length, `定义行: ${definitions.join(' | ')}`).toBe(4);
    for (const d of definitions) expect(d).toContain('styles/custom.css');
  });
});
