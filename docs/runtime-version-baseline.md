# Runtime 版本基线契约

> 双端（macOS / Windows）R 与 Python 运行时的**精确到 patch 的版本基线**。
> 目的：确保两端基础包产物、插件 `builtAgainst`、构建脚本三方版本完全一致，
> 避免因某端用了不同的小版本导致下游插件 ABI 错位、prebuilt 二进制不兼容。

- 状态：**生效**（2026-08-08 确立）
- 范围：`biof3-r-runtime`、`biof3-py-runtime`（manifest `kind: runtime`）及其下游插件
- 维护：任何改动 `builtAgainst` / 运行时版本下限 / 构建脚本版本常量，必须先改本文件再动代码与 manifest

---

## 1. 版本基线（锁定值）

| 运行时 | macOS（已发布 · qualified） | Windows（目标，必须一致） | 来源 / 依据 |
|--------|------------------------------|------------------------------|-------------|
| **R** | **4.5.2** | **4.5.2** | build-r-bundle.mjs `BUNDLE_MANIFESTS[*].rVersion = '4.5.2'`，且打包时硬校验 `plan.rVersion !== manifest.rVersion → fail` |
| **Bioconductor** | **3.22** | **3.22** | 同上脚本 `bioconductorVersion: '3.22'` |
| **Python** | **3.11（sub-version 待取证）** | **3.11（sub-version 待取证）** | 所有 Python 插件 `builtAgainst: { python: "3.11" }`；确切 sub-version 需从 macOS 构建机 `BIOF3_BUILD_PYTHON` 实际解释器取证后回填 |

> ⚠️ **不允许**写 `4.5.x` / `3.11.x` 这类模糊版本。基线必须精确到 patch（如 `4.5.2`），
> 具体 sub-version（如 `3.11.9`）取证后回填。

---

## 2. 为什么必须精确到 patch

1. **R 插件**：17 个 R 插件的 `builtAgainst: { r: "4.5" }`、`runtime.r: ">=4.3.0"/">=4.4.0"`。
   基础包实际装的 R 若为 4.6.1 等 ≠ 4.5.2 的版本，预编译 C/C++/Fortran 包的 **ABI/SEXP 布局可能不兼容**，
   轻则加载告警、重则 `cannot open shared object` / 段错误。
2. **Python 插件**：6+ 个插件的 `builtAgainst: { python: "3.11" }`、`runtime.python: ">=3.10.0"`。
   若装了 3.12+，`numpy/scipy/pandas` 等的 **wheel ABI 标签（cp311 vs cp312）不兼容**，import 直接失败。
3. **双端 ABI 对齐**：macOS 已用 4.5.2 发布；Windows 若用 4.6.1，两端产物行为可能发散，
   统计结果（尤其依赖 RNG/底层运算的）可能出现可复现性差异。

---

## 3. 各端版本依据

### 3.1 macOS（真实，已发布）
- **R 4.5.2**：`scripts/build-r-bundle.mjs` → `rVersion: '4.5.2'`（r-enrichment / r-wgcna 两 bundle 均一致），打包硬校验。
- **Bioconductor 3.22**：同上。
- **Python**：仓库内无 macOS py build 脚本；制品已在 OSS（`manifest.json` `biof3-py-runtime.artifacts.macos-arm64`
  已填 sha256/sizeBytes），精确 sub-version 待从 macOS 机取证回填。

### 3.2 Windows（在建，目标对齐 macOS）
| 脚本 | 关键位置 | 基线要求 | 现状 |
|------|----------|----------|------|
| `scripts/provision-win-r-runtime.mjs` | `R_VERSION` 默认 | **R 4.5.2** | ✅ 已改为 4.5.2；URL 自动切 `bin/windows/base/old/4.5.2/` |
| `scripts/build-win-r-runtime-artifact.mjs` | 源 R prefix 探测 | **build 机需装 4.5.2**（脚本继承 build 机 R 版本） | ✅ 注释已明确 |
| `scripts/build-win-runtime-artifact.mjs`（py） | 源 Python 探测 | **Python 3.11**（回填 sub-version 后锁死） | 待取证 |

**CRAN 来源**（已实测 HTTP 200）：
```
https://cran.r-project.org/bin/windows/base/old/4.5.2/R-4.5.2-win.exe
https://cran.r-project.org/src/base/R-4/R-4.5.2.tar.gz
https://cloud.r-project.org/bin/windows/base/old/4.5.2/R-4.5.2-win.exe
```
> 注：`bin/windows/base/` 根目录只保留当前最新版（现为 4.6.1）在 `R-<v>-win.exe`。
> 历史版本必须在 `bin/windows/base/old/<version>/` 子目录。脚本已据此做 URL 目录判断。

---

## 4. 改成基线版本的正确步骤（add to any future change）

1. **改本文件** → 更新基线表；
2. 改 `manifest.json` 中对应的 `runtime` / `builtAgainst`（如需）；
3. 改所有受影响构建脚本的版本常量（provision / build / bundle）；
4. 若 sub-version 改变，重算制品 sha256/sizeBytes 并填 `manifest.json` + `manifest.placeholders.json`；
5. `npm run check`（含 `manifest` schema 校验）全绿后提交。

---

## 5. 待办/未决

- [ ] macOS Python 精确 sub-version 取证（从 macOS 构建机 `BIOF3_BUILD_PYTHON` 实查），锁死双端 Python 基线。
- [ ] Windows R/Python 官方 `windows-x64` 制品产出（`build-win-r-*-runtime-artifact.mjs`）+ 填 `manifest.json`/`placeholders.json`，完成双端 OSS 分发闭环。
- [ ] 平台选择自动化：`selectArtifact` 确认按 platformId 过滤（防装错平台导致的"非 Windows R 树"残留再次出现）。

---

## 附：版本引用索引（代码/清单中所有"版本声明"）

| 文件 | 位置 | 当前值 | 基线要求 |
|------|------|--------|----------|
| `scripts/build-win-r-runtime-artifact.mjs` | 注释 + 源探测 | 4.5.2（注释已改） | build 机需 R 4.5.2 |
| `scripts/provision-win-r-runtime.mjs` | `R_VERSION` 默认 | 4.5.2（已改） | 4.5.2 |
| `scripts/build-r-bundle.mjs` | `rVersion` | 4.5.2 | 4.5.2（macOS 基线） |
| `manifest.json` 所有 R 插件 | `runtime.r` | `>=4.3.0`/`>=4.4.0` | 下限 < 4.5.2，OK；`builtAgainst: r=4.5` 契合 |
| `manifest.json` 所有 Python 插件 | `runtime.python` | `>=3.10.0` | 下限 < 3.11，OK；`builtAgainst: python=3.11` 契合 |
