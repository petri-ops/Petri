# Harness Tool Template

最后更新：2026-07-12

新工具接入时，先从这份最小模板开始。不要一上来就为每个工具写一整套专属诊断。

对应脚手架命令：

```bash
npm run harness:scaffold -- demo-tool --title "Demo Tool" --language r
```

默认会生成到 `templates/harness-tools/<id>`，先作为起步骨架使用，不会自动进入运行时插件列表。

## 最小 manifest

```json
{
  "id": "your-tool-id",
  "title": "工具名称",
  "subtitle": "一句话说明",
  "category": "analysis",
  "language": "r",
  "description": "做什么",
  "supportedPlatforms": ["macos", "linux", "windows"],
  "inputs": [],
  "outputs": [],
  "failureModes": [],
  "estimatedMinutes": 2
}
```

## 默认 failureModes

优先复用这几类：

1. `missing_required_file_inputs`
2. `missing_required_columns`
3. `invalid_numeric_values`
4. `runtime_not_ready`
5. `input_path_not_found`
6. `parameter_out_of_range`
7. `empty_result_or_insufficient_signal`

## 什么时候再补专属模式

只有当工具存在以下情况时，才加专属 failure mode：

- 该工具有独特的列语义。
- 该工具有固定的输入格式。
- 该工具有特定的统计假设。
- 该工具需要额外的运行时或外部依赖。

## 推荐流程

1. 先写最小 manifest。
2. 让 Harness 自动补第一轮修复。
3. 跑一次真实样例。
4. 只有在第一次修复仍不够时，再补专属 failureModes。

## 目标

不是让每个工具都变得很长，而是让每个工具都能先跑起来，再逐步变聪明。
