# Code signing policy

Free code signing provided by SignPath.io, certificate by SignPath Foundation

## Scope

Petri Desktop uses SignPath for Windows code signing.

A signature issued under this policy covers **only** artifacts published through official channels:

- Official GitHub Releases of the `petri-ops/Petri` repository
- Official OSS download channels linked from the project README

Packages and binaries obtained from any other channel — community mirrors, third-party package feeds, CI build artifacts, or locally built binaries — are **not** covered by this signature. A valid signature is only an assurance for a build obtained from an official channel; it is not a guarantee for a build from any other source.

## Build pipeline

Release builds are produced by a GitHub Actions workflow. Signing is applied to the artifacts produced by that pipeline for official releases. Building the source locally does not produce an officially signed binary.

## Chinese translation / 中文翻译

Petri Desktop 使用 SignPath 进行 Windows 代码签名。

本策略下的签名**仅**覆盖通过官方渠道发布的产物：

- `petri-ops/Petri` 仓库的官方 GitHub Release
- 项目 README 中链接的官方 OSS 下载渠道

通过其他渠道分发的包或二进制文件——包括社区镜像、第三方软件源、CI 构建产物以及本地构建的二进制文件——**不**受此签名保护。有效签名只是对来自官方渠道的构建产物的保证，不构成对任何其他来源构建产物的保证。

发布构建由 GitHub Actions 工作流产出；签名作用于该流水线为正式发布生成的产物。从源码本地构建不会得到官方签名的二进制文件。
