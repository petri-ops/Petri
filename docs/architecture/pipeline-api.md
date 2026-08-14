# Pipeline API 设计文档

## 概述

Pipeline 是 Gateway 层提供的跨语言任务编排能力，支持 R → Python → R 等多步骤工作流的顺序执行与中间结果传递。

## 请求格式

### POST /api/pipeline/execute

执行一个 Pipeline 工作流。

**请求体：**

```json
{
  "steps": [
    {
      "toolId": "seurat-pca",
      "params": { "input_file": "/data/scRNA.h5ad", "npcs": 50 },
      "language": "r"
    },
    {
      "toolId": "scanpy-cluster",
      "params": { "n_neighbors": 15, "resolution": 0.5 },
      "language": "python"
    },
    {
      "toolId": "volcano-plot",
      "params": {},
      "language": "r"
    }
  ],
  "continueOnError": false
}
```

**字段说明：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| steps | Array | 是 | 步骤列表 |
| steps[].toolId | string | 是 | 工具 ID |
| steps[].params | object | 否 | 工具参数 |
| steps[].language | string | 否 | 运行时语言（r 或 python） |
| continueOnError | boolean | 否 | 遇到错误是否继续，默认 false |

## 响应格式

```json
{
  "status": "ok",
  "pipelineId": "pl-a1b2c3d4e5f6",
  "status": "completed",
  "steps": [
    {
      "index": 0,
      "toolId": "seurat-pca",
      "language": "r",
      "status": "completed",
      "duration": 1250,
      "result": { "output_path": "/tmp/pca_output.rds" },
      "error": null
    }
  ],
  "timing": { "start": 1692000000000, "end": 1692000006550, "totalDuration": 6550 },
  "error": null
}
```

## API 端点

| 方法 | 端点 | 说明 |
|------|------|------|
| POST | /api/pipeline/execute | 执行 Pipeline |
| GET | /api/pipeline/status/:id | 查询状态 |
| GET | /api/pipeline/list | 列出所有 Pipeline |
| POST | /api/pipeline/cleanup | 清理已完成 Pipeline |

## 中间结果传递

自动将前一步输出作为下一步输入，根据 outputType 映射字段：
- deg_table → deg_table
- data_matrix → data_matrix
- gene_list → gene_list

## 超时配置

| 环境变量 | 默认值 | 说明 |
|----------|--------|------|
| PIPELINE_STEP_TIMEOUT | 5 分钟 | 单步骤超时 |
| PIPELINE_GLOBAL_TIMEOUT | 30 分钟 | 全局超时 |

## 测试示例

```bash
curl -X POST http://localhost:3005/api/pipeline/execute \
  -H "Content-Type: application/json" \
  -d '{
    "steps": [
      { "toolId": "volcano-plot", "params": { "deg_table": "/data/deg.csv" }, "language": "r" },
      { "toolId": "heatmap-basic", "params": {}, "language": "r" }
    ]
  }'
```
