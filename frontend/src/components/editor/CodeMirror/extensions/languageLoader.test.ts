// UI-395 — languageLoader 断链回归测试。
// 历史缺陷：@codemirror/lang-* 全家族为 named 工厂导出（无 default），旧实现只认
// mod.default → loadLanguage 恒返回 null，所有语言高亮从未真正工作过。
// 本文件用**真实模块加载**（不 mock）锁断链回归：js/ts/css/sql/R/legacy-shell 必须
// 返回可用 extension；未知扩展名返回 null（走通用保底）。
import { describe, it, expect, beforeEach } from 'vitest';
import { loadLanguage, _resetLanguageCache } from './languageLoader';
import type { Extension } from '@codemirror/state';

describe('languageLoader（真实加载，UI-395 断链回归）', () => {
  beforeEach(() => {
    _resetLanguageCache();
  });

  async function expectUsable(input: string): Promise<void> {
    const ext = await loadLanguage(input);
    expect(ext, `${input} 应返回可用 language extension`).toBeTruthy();
    // LanguageSupport / StreamLanguage 均实现 Extension（对象或数组形态）
    expect(typeof ext === 'object' || Array.isArray(ext)).toBe(true);
  }

  it('js/ts/tsx 经 named 工厂解析（修复断链）', async () => {
    await expectUsable('a/afterSign.js');
    await expectUsable('src/app.ts');
    await expectUsable('src/App.tsx');
    await expectUsable('comp.jsx');
  });

  it('既有官方包语言仍可用', async () => {
    await expectUsable('x/main.py');
    await expectUsable('x/data.json');
    await expectUsable('x/README.md');
    await expectUsable('x/config.yaml');
  });

  it('扩充包（css/html/sql/cpp/java/go/rust）可用', async () => {
    await expectUsable('x/style.css');
    await expectUsable('x/index.html');
    await expectUsable('x/query.sql');
    await expectUsable('x/main.cpp');
    await expectUsable('x/Main.java');
    await expectUsable('x/main.go');
    await expectUsable('x/lib.rs');
  });

  it('legacy-modes（shell/dockerfile/toml/R/ruby/ini）可用', async () => {
    await expectUsable('scripts/dev.sh');
    await expectUsable('Dockerfile');
    await expectUsable('x/config.toml');
    await expectUsable('analysis/plot.R');
    await expectUsable('Gemfile.rb');
    await expectUsable('x/app.ini');
  });

  it('语言标识路径（language prop 形态）可用', async () => {
    await expectUsable('javascript');
    await expectUsable('typescript');
    await expectUsable('sql');
    await expectUsable('shell');
  });

  it('未知扩展名返回 null（走通用保底高亮）', async () => {
    expect(await loadLanguage('x/blob.xyzzy')).toBeNull();
    expect(await loadLanguage('')).toBeNull();
    const e: Extension | null = await loadLanguage('x/noext');
    expect(e).toBeNull();
  });
});
