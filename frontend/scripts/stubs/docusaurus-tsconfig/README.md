# Docusaurus `tsconfig` 桩 (stub)

## 为什么需要这个目录

`vendor/biof3-core/tsconfig.json` 里有：

```json
{
  "extends": "@docusaurus/tsconfig",
  ...
}
```

esbuild 在 transform `vendor/biof3-core/packages/shared-copilot/*.ts` 时，会沿着
该文件路径向上找到 `vendor/biof3-core/tsconfig.json`，并按 npm-resolution
规则在 `vendor/biof3-core/node_modules`（再向上到 `vendor/node_modules`、`node_modules`）
搜 `@docusaurus/tsconfig`。

- **本地开发**：依赖当前目录的 npm 缓存 / 运气，esbuild 在 tsconfig `extends`
  解析失败时多数时候只 warning 不抛错（vite 5.4 / esbuild 0.21 + node 23）。
- **CI 上**：macOS / Windows / Ubuntu runner 默认 Node 24，esbuild 对 extends
  解析失败更严格 → 直接 `[vite:esbuild] failed to resolve "extends":"@docusaurus/tsconfig"`,
  build 失败。

桌面版整套是脱离 Docusaurus 跑的，没有 `front-end/docusaurus` 这条线；
submodule 里继承 docusaurus tsconfig 只是 core 仓历史。

## 这个 stub 是什么

`tsconfig.json` —— 一个**最小可编译**的 tsconfig shape，借用上游
`@docusaurus/tsconfig` 的通用 compilerOptions（`ES2022`、`module: esnext`、
`moduleResolution: bundler`、`jsx: preserve`、`noEmit: true`、`skipLibCheck`）。

## 在 CI 怎么用

`.github/workflows/ci.yml` 和 `.github/workflows/release.yml` 在
`Install frontend dependencies` 之后加了 step：

```yaml
- name: Stub @docusaurus/tsconfig for submodule tsconfig extends
  run: |
    mkdir -p vendor/biof3-core/node_modules/@docusaurus/tsconfig
    cp frontend/scripts/stubs/docusaurus-tsconfig/tsconfig.json \
       vendor/biof3-core/node_modules/@docusaurus/tsconfig/tsconfig.json
```

这一步把 desktop 仓自己追踪的 stub 写入 submodule 内部的 `node_modules`。
submodule 自身 `.gitignore` 第一行就是 `node_modules/`，所以这个写入不会被
submodule 当成脏文件；desktop repo 视图里也看不到，但磁盘上有，esbuild
就能 npm-resolve 到 `@docusaurus/tsconfig`。

## 为什么不动 submodule 也不加 npm devDep

- 不动 submodule：因为 desktop 是下游，不应改上游 BioF3 core 的产物。
- 不在 desktop 加 npm devDep：esbuild 的 extends 解析从 `vendor/biof3-core/`
  这个目录的 `node_modules` 开始，**不**读 desktop 仓 `frontend/node_modules`。

## 何时可以删除

当 BioF3 core 仓里 `vendor/biof3-core/tsconfig.json` 不再 extend docusaurus
（或 desktop 仓不再 import `vendor/biof3-core/packages/shared-copilot/*.ts`）
时，这个 stub 就没用了，连带 `.github/workflows/*` 里那一个 step 一并删。
