# BioF3 Harness Engine Spec v1

最后更新：2026-07-11

这份文档定义 BioF3 的“Prompt 工程 / Harness 工程”底座。

目标不是把模型写得更长，而是把模型的工作方式变成可编排、可验证、可扩展、可移植的执行系统。

## 1. 目标

Harness 负责把用户的模糊意图，转成稳定的分析动作链：

1. 读取用户当前上下文。
2. 自动探测文件与项目结构。
3. 识别可用插件、技能和执行器。
4. 组装任务级 prompt。
5. 调用工具或 workflow。
6. 校验结果是否符合预期。
7. 失败时自动修复或降级。

一句话：

> 用户只描述“想做什么”和“数据在哪”，Harness 负责把“怎么做”补齐。

## 2. 设计原则

- 模型可替换，Harness 不可替换。
- 插件负责真实计算，Skills 负责策略，Harness 负责编排。
- 用户不应先理解文件结构再让模型工作。
- 任何正式分析都必须经过注册插件、标准 workflow 或受控执行器。
- 弱模型也要能跑出可用结果，差异只体现在质量，不体现在能不能跑。
- 所有执行都要可追踪、可复现、可回滚。

## 3. 总体架构

### 3.1 分层

1. **Context Layer**
   - 当前页面
   - 当前项目
   - 当前结果
   - 最近对话
   - 用户事实
   - 文件库索引

2. **Discovery Layer**
   - 自动识别文件类型、表头、分组列、样本数、缺失值、目录结构
   - 自动发现可用插件、技能、workflow
   - 自动发现平台能力（本地 / Linux / Windows / 容器）

3. **Planning Layer**
   - 任务拆解
   - 工具选择
   - 参数补全
   - 失败预判
   - 备选路径

4. **Execution Layer**
   - 本地执行器
   - 远端执行器
   - 容器执行器
   - Windows / Linux / macOS 适配器

5. **Verification Layer**
   - schema 校验
   - 产物校验
   - 结果完整性校验
   - 失败修复
   - retry / fallback

6. **Presentation Layer**
   - 聊天结果卡片
   - HTML 报告
   - artifact 预览
   - 下载 / 分享 / 二次交互

## 4. 跨平台执行规范

### 4.1 目标

同一套 Harness 需支持：

- 桌面版 macOS
- 云端 Linux
- Windows 本地部署
- 远端集群

### 4.2 平台抽象

不得把平台差异写死在 prompt 里。平台差异必须下沉到执行层。

统一能力接口至少包括：

- `resolvePath()`
- `normalizePath()`
- `detectRuntime()`
- `checkRuntimeReady()`
- `execCommand()`
- `runScript()`
- `readFile()`
- `writeArtifact()`
- `mountWorkspace()`

### 4.3 平台能力声明

每个插件或 workflow 应声明：

- `supportedPlatforms`
- `runtime`（R / Python / shell / container）
- `pathStyle`
- `envRequirements`
- `packageRequirements`
- `resourceHints`

### 4.4 路径和文件规则

- 模型不得直接拼硬编码系统路径。
- Harness 必须把相对路径、绝对路径、挂载路径统一归一。
- Windows / macOS / Linux 的分隔符差异必须在执行层处理。
- artifact 路径必须标准化成 canonical path，再交给上层。

## 5. 大文件与索引规范

### 5.1 目标

当项目变大、文件变多、上下文变长时，Harness 要能“先索引，再回答”，不能每次都全量扫。

### 5.2 索引分层

1. **元数据索引**
   - 文件名
   - 大小
   - 类型
   - 修改时间
   - 所属项目 / job / artifact

2. **内容索引**
   - 表头
   - 前若干行
   - 关键字段
   - 文本摘要

3. **语义索引**
   - 工具用途
   - 文件角色
   - 分析阶段
   - 历史结果关联

### 5.3 索引要求

- 支持增量更新。
- 支持 hash 去重。
- 支持背景预建。
- 支持缓存命中。
- 支持按 project / job / dataset / plugin 分区。
- 支持大文件只读样本，不强制全量加载。

### 5.4 索引策略

优先级顺序：

1. 已有索引
2. 局部缓存
3. 快速探测
4. 全量扫描

如果能通过索引判断文件结构，就不要重新解析整份文件。

### 5.5 当前 Phase 2 落地状态

已新增轻量文件探测与目录索引入口：

```bash
npm run harness:index -- <path>
```

当前实现位于 `scripts/harness-file-index.mjs`，先作为 Harness 的可复用核心模块和 CLI 使用。它已经支持：

- CSV / TSV / JSON / 文本 / 二进制文件的快速识别。
- 表格表头、样例行、列类型、缺失值、数值列比例探测。
- DEG 表、表达矩阵、样本分组表、manifest、summary 等常见角色推断。
- 表达矩阵方向粗判：`rows_are_features` / `rows_are_samples`。
- 大文件采样读取，避免把整份文件塞进上下文。
- 文件 hash 与 `.biof3-harness-index.json` 缓存读写。
- 基于插件 manifest 输入定义的候选文件推荐：
- BioF3 范围解析：
  - `path`：任意本地目录或文件。
  - `project`：项目工作目录。
  - `job`：工具任务目录。
  - `artifact`：工具任务 `output/` 产物目录。
  - `dataset`：本地可解析数据集路径。
- 给模型使用的瘦身摘要：`--prompt-summary`。
- 参数修复第一版：
  - 文件输入自动预填。
  - DEG 常见列名别名映射。
  - 数值参数默认值填充与上限裁剪。

```bash
npm run harness:index -- <dataset-dir> --for-manifest <tool-definition.json>
npm run harness:index -- --scope artifact --job-id <jobId> --prompt-summary
npm run harness:index -- <dataset-dir> --for-manifest <tool-definition.json> --repair-params '{"top_n":999}'
```

这一步不是最终 UI，而是给后续参数补全、失败修复和弱模型工具选择提供稳定的结构化摘要。

## 6. 自动化工作流

Harness 的标准执行链应是：

1. **Inspect**
   - 识别文件、目录、项目、上下文

2. **Infer**
   - 推断数据结构、分析意图、缺失参数

3. **Select**
   - 选插件、选技能、选执行器

4. **Plan**
   - 生成步骤、补默认值、列出风险

5. **Run**
   - 执行工具或 workflow

6. **Verify**
   - 检查产物、状态、字段、文件完整性

7. **Repair**
   - 参数修复、路径修复、格式修复、重试

8. **Report**
   - 返回结构化结果 + 可读报告

## 7. Plugin / MCP 规范

### 7.1 必填字段

每个插件都应至少声明：

- `id`
- `version`
- `language`
- `runtime`
- `supportedPlatforms`
- `inputs`
- `outputs`
- `artifacts`
- `examples`
- `failureModes`

### 7.2 输入契约

输入不仅是表单字段，还要描述：

- 字段含义
- 是否必填
- 默认值
- 适用前提
- 容易出错的格式
- 文件类型约束

### 7.3 输出契约

输出必须尽量标准化为：

- 图
- 表
- 日志
- HTML
- JSON
- 可下载文件

### 7.4 失败模式

插件必须提前声明常见失败模式，例如：

- 列名不存在
- 分组列缺失
- 文件格式不对
- 物种不匹配
- 包缺失
- 设计矩阵无效

Harness 才能据此做自动修复。

## 8. Skills 规范

Skills 的职责不是“执行真实计算”，而是“给模型提供工作策略”。

适合放进 Skills 的内容：

- 常见分析路径
- 任务分解模板
- 参数选择经验
- 失败排查顺序
- 结果解读套路
- 交互式追问策略

不适合放进 Skills 的内容：

- 固定的具体执行代码
- 与平台强绑定的路径
- 真实工具注册表
- 变化很快的参数 schema

一句话：

> Skills 负责“怎么想”，插件和 Harness 负责“怎么跑”。

## 9. Prompt Compiler 规范

Prompt 不是单一长文本，而是编译出来的。

编译输入应包括：

- 当前页面
- 当前项目
- 当前结果
- 用户历史偏好
- 文件索引摘要
- 已安装插件清单
- 当前可执行能力
- 最近失败记录
- 目标任务类型
- 平台能力

编译原则：

- 先短后长
- 先结构后正文
- 先事实后建议
- 先工具契约后自然语言
- 只塞和当前任务有关的上下文

## 10. 自动修复与重试

Harness 必须支持最基本的修复回路：

1. 参数名修复
2. 路径修复
3. 列名修复
4. 格式修复
5. 轻量默认值补全
6. 再执行一次

如果多次修复失败，再把问题交给用户。

### 10.1 修复边界

不能盲修的情况包括：

- 数据列语义不清
- 分组信息无法推断
- 输入文件明显损坏
- 结果需要用户确认实验设计

## 11. 可观察性与复现

每次成功执行都应记录：

- 输入文件
- 版本
- 插件名
- 参数
- 执行器
- 平台
- 索引命中情况
- 中间产物
- 最终产物
- 失败重试记录

这样才能支持回看、复现、审计、迁移。

## 12. 推荐落地顺序

### Phase 1

- 统一 plugin manifest
- 统一 artifact schema
- 补 failureModes

当前落地状态（2026-07-11）：

- `plugin-loader.normalizePluginManifest()` 已将 `plugin.json + tool-definition.json` 归一为 `BioF3PluginManifest v1`。
- MCP `tools/list` 已透传 `_manifest`、`outputSchema.artifacts` 和 `failureModes`。
- 内置可运行插件 `volcano-plot`、`gene-correlation`、`pca-explorer` 已补 `pluginManifestVersion`、`supportedPlatforms` 和 `failureModes`。
- 已新增 `npm run harness:check` 和 `test/harness-manifest.test.mjs` 做回归校验。

### Phase 2

- 文件探测器
- 目录索引器
- 内容索引缓存

### Phase 3

- 执行器抽象
- 平台适配层
- 自动修复回路

### Phase 4

- Skills 流程模板
- 常见任务包
- 评测集与回归测试

### Phase 5

- 远端集群接入
- Windows 适配
- 大规模索引性能优化

## 13. 验收标准

满足以下条件，Harness v1 才算可用：

- 用户只给文件位置，系统能自己判断数据结构。
- 用户不写全参数，系统能自动补出大部分合理默认值。
- 插件新增后，不需要重写主 prompt。
- 弱模型也能跑通标准流程。
- 大项目下仍能快速定位文件与结果。
- 跨平台部署不会把路径和执行逻辑写死。
- 失败后能自动修复一轮，再决定是否打断用户。
