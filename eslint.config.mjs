// eslint.config.mjs — BLOCK-105 P1 根目录 flat config（单配置跨覆盖 src/ core/ scripts/ frontend/src/）
//
// 装载决策（D1/D2 预置裁决通过）：typescript-eslint + react-hooks + security 全部
// 装根 devDependencies，不碰 frontend/package.json + lockfile（P6 源绑定红线）。
// 覆盖策略：
//   - frontend/src/**/*.{ts,tsx}：typescript-eslint recommendedTypeChecked（借
//     frontend/tsconfig.json 的 projectService）+ react-hooks + security；
//     strictTypeChecked 留 P2 棘轮逐步收紧（先拿 recommended 层噪音基线）。
//   - src/ core/ scripts/ 的 JS：js recommended + security（无类型信息，纯语法/反模式层）。
//   - 排除：node_modules / dist / acceptance / .biof3-* / vendor（codex/sdk 不属本项目代码面）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import security from 'eslint-plugin-security';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'acceptance/**',
      '.biof3-*/**',
      '**/.biof3-*/**',
      'codex/**',
      '_external-ref/**',
      'tmp/**',
      'frontend/dist/**',
      // skill 资产目录：dev-verify flows 用 node 全局但无包上下文，且含合法占位模板
      '.agents/**',
    ],
  },

  // ── 基线：所有 JS（src/ core/ scripts/ 等）──
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'core/**/*.js', 'core/**/*.cjs', 'scripts/**/*.{js,mjs,cjs}', 'test/**/*.{mjs,cjs,js}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { security },
    rules: {
      'security/detect-object-injection': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-non-literal-fs-filename': 'off', // 本仓为本地桌面应用，动态路径是常态；靠 allowlist 机制约束
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },

  // ── frontend/src TS/TSX：类型感知 lint（projectService 借 frontend/tsconfig.json）──
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({
    ...c,
    files: ['frontend/src/**/*.{ts,tsx}'],
  })),
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks, security },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'security/detect-object-injection': 'warn',
      'security/detect-child-process': 'warn',
      'security/detect-non-literal-fs-filename': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  // ── src/ core/ 的 TS 类型噪音隔离：JS 文件不做类型感知检查 ──
  {
    ...tseslint.configs.disableTypeChecked,
    files: ['src/**/*.js', 'core/**/*.js', 'scripts/**/*.{js,mjs,cjs}'],
  },
);
