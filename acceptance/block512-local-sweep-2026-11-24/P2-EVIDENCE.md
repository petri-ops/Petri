# BLOCK-512 P2 · bash/tar 测试健壮化证据（2026-11-24）

## 范围核实（先核码再动，C-32 教训）

- AUDIT-LOG 🟡（2026-10-20）原记 block67/**block89** 与 capability-bundles 整类假红。
- 现码核实：`test/block89-*.test.mjs` 文件已不存在（fs_cp 用例并入 block67 文件内，
  经同一 `runAgent` 执行）；capability-bundles 的 tar 已平台条件化（macOS bsdtar 拒
  `--force-local` → 不加旗标；Windows bsdtar 两道处理在场，文件头注释留证）。
- **实际残余面 = block67 文件内裸 `bash`**（`execFileP('bash', ...)`）：Windows PATH
  解析到 WSL launcher（`C:\...\WindowsApps\bash.exe`）时把 `C:\Users\...` 读成
  `C:UsersAdmin...` → 整类假红。

## 修法（测试显式路径化 + 诚实 skip）

- 新增 `test/helpers/bash-resolver.cjs`：`checkBash()` 解析 PATH 上的 bash；
  命中 WSL launcher 形态时先自动改用标准安装位**显式 Git Bash 路径**
  （`C:\Program Files\Git\bin\bash.exe` 等，零人工）；找不到则返回带可操作原因的
  `ok:false`（原因内嵌 PATH 前置口令 + AUDIT-LOG 2026-10-20 指针）。检测逻辑全可注入
  （platform/whichFn/existsFn）。
- `test/block67-node-agent-fs.test.js`：`runAgent` 改用解析出的 bash 路径；13 个
  bash 依赖用例首行加 `skipIfNoBash(t)` —— Windows 损坏环境下假红 → 带 reason 的
  诚实 skip，macOS / 正常 Git Bash 环境**行为零变化**。

## 验证（本机 macOS）

- `test/block512-bash-resolver.test.mjs` **5/5**（darwin 直通 / WSL launcher+Git Bash
  在位自动改显式路径 / WSL launcher+无 Git Bash 诚实 skip / bash 缺失 / 判据函数）。
- block67 **13 pass + 1 skip + 0 fail**（skip 为既有 macOS BSD find 平台门，行为与
  改前一致；13 个新 guard 在本机全为 no-op）。
- eslint 新文件 0 warning；impact-map：`block512-bash-resolver.test.mjs` 挂入
  `block89-workspace-file-ops` 规则。

## 诚实边界

- Windows 实机（WSL launcher 环境 + Git Bash 显式路径命中）本机不可达，该形态由
  注入模拟单测背书；实机复验归 Windows 指挥席（外部环境项，未闭环如实登记）。
- capability-bundles 的 Windows bsdtar 全链同样属外部环境项，现码平台条件化维持。
