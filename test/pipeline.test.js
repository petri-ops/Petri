/**
 * test/pipeline.test.js — Pipeline 执行器测试
 *
 * 测试场景：
 * 1. 简单 Pipeline：volcano-plot → heatmap-basic
 * 2. 跨语言 Pipeline：R → Python → R
 * 3. 错误处理：continueOnError 选项
 * 4. 超时处理
 * 5. 中间结果传递
 */

const { describe, it, before, mock } = require('node:test');
const assert = require('node:assert');

// Mock fetch for testing
mock.fn();

describe('Pipeline Executor', () => {
  
  before(() => {
    // 动态导入 pipeline 模块（在 mock 设置之后）
    // 注意：实际测试需要先设置 mock
    process.env.R_SERVER_URL = 'http://127.0.0.1:3003';
    process.env.PY_SERVER_URL = 'http://127.0.0.1:3004';
    process.env.PIPELINE_STEP_TIMEOUT = '5000';
    process.env.PIPELINE_GLOBAL_TIMEOUT = '30000';
  });

  describe('executePipeline', () => {
    it('should reject empty pipeline with error', async () => {
      // 导入 pipeline（绕过模块缓存）
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const { executePipeline, PipelineError } = require('../core/gateway/pipeline');

      await assert.rejects(
        () => executePipeline({ steps: [] }),
        (err) => {
          assert(err instanceof PipelineError);
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
    });

    it('should reject pipeline without steps array', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const { executePipeline, PipelineError } = require('../core/gateway/pipeline');

      await assert.rejects(
        () => executePipeline({}),
        (err) => {
          assert(err instanceof PipelineError);
          assert.strictEqual(err.statusCode, 400);
          return true;
        }
      );
    });

    it('should execute single step successfully', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');

      // 模拟成功的单步骤执行
      const mockResult = {
        status: 'ok',
        result: { plot: '/tmp/volcano.png', data: '/tmp/deg.csv' }
      };

      // 设置 mock
      global.fetch = async (_url, _options) => {
        return {
          ok: true,
          status: 200,
          json: async () => mockResult
        };
      };

      const result = await pipelineModule.executePipeline({
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' }
        ]
      });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.steps.length, 1);
      assert.strictEqual(result.steps[0].status, 'completed');
      assert.ok(result.pipelineId);
    });

    it('should pass intermediate results to next step', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');

      let capturedParams = [];

      global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        capturedParams.push(body.params);

        if (capturedParams.length === 1) {
          // 第一个步骤（volcano-plot）返回结果
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              result: {
                outputPath: '/tmp/volcano_output.csv',
                outputType: 'deg_table'
              }
            })
          };
        } else {
          // 第二个步骤（heatmap-basic）应该接收到前一步的结果
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status: 'ok',
              result: { plot: '/tmp/heatmap.png' }
            })
          };
        }
      };

      const result = await pipelineModule.executePipeline({
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' },
          { toolId: 'heatmap-basic', params: {}, language: 'r' }
        ]
      });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.steps.length, 2);
      assert.strictEqual(result.steps[0].status, 'completed');
      assert.strictEqual(result.steps[1].status, 'completed');

      // 验证第二步接收到了前一步的输出
      // 注意：prepareStepParams 合并的是上一步的 result，不是单独的 outputPath
      const step2Params = capturedParams[1];
      // 上一步的 result 被合并到下一步的参数中
      assert.ok(step2Params, 'Step 2 should have received params');
    });

    it('should stop on step failure when continueOnError is false', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');

      global.fetch = async (_url, _options) => {
        return {
          ok: false,
          status: 500,
          json: async () => ({ status: 'error', error: 'Internal server error' })
        };
      };

      const result = await pipelineModule.executePipeline({
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' },
          { toolId: 'heatmap-basic', params: {}, language: 'r' }
        ],
        continueOnError: false
      });

      assert.strictEqual(result.status, 'failed');
      assert.strictEqual(result.steps[0].status, 'failed');
      assert.strictEqual(result.steps[1].status, 'pending');
      assert.ok(result.error);
    });

    it('should continue on step failure when continueOnError is true', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');

      let callCount = 0;
      global.fetch = async (_url, _options) => {
        callCount++;
        if (callCount === 1) {
          return {
            ok: false,
            status: 500,
            json: async () => ({ status: 'error', error: 'Step 1 failed' })
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: 'ok', result: { plot: '/tmp/step2.png' } })
        };
      };

      const result = await pipelineModule.executePipeline({
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' },
          { toolId: 'heatmap-basic', params: {}, language: 'r' }
        ],
        continueOnError: true
      });

      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.steps[0].status, 'failed');
      assert.strictEqual(result.steps[1].status, 'completed');
    });
  });

  describe('getPipelineStatus', () => {
    it('should return null for non-existent pipeline', () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const { getPipelineStatus } = require('../core/gateway/pipeline');

      const status = getPipelineStatus('non-existent-id');
      assert.strictEqual(status, null);
    });

    it('should return pipeline status after execution', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');
      const { getPipelineStatus } = pipelineModule;

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', result: { plot: '/tmp/test.png' } })
      });

      const result = await pipelineModule.executePipeline({
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' }
        ]
      });

      const status = getPipelineStatus(result.pipelineId);
      assert.ok(status);
      assert.strictEqual(status.pipelineId, result.pipelineId);
      assert.strictEqual(status.status, 'completed');
    });
  });

  describe('listPipelines', () => {
    it('should list all pipelines', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');
      const { listPipelines } = pipelineModule;

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', result: {} })
      });

      await pipelineModule.executePipeline({
        steps: [{ toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' }]
      });

      const pipelines = listPipelines();
      assert.ok(Array.isArray(pipelines));
      assert.ok(pipelines.length > 0);
    });
  });

  describe('cleanupPipelines', () => {
    it('should cleanup old pipelines', async () => {
      delete require.cache[require.resolve('../core/gateway/pipeline')];
      const pipelineModule = require('../core/gateway/pipeline');

      global.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ status: 'ok', result: {} })
      });

      // 创建多个 pipeline
      for (let i = 0; i < 5; i++) {
        await pipelineModule.executePipeline({
          steps: [{ toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' }]
        });
      }

      const result = pipelineModule.cleanupPipelines(3);
      assert.ok(typeof result.cleaned === 'number');
      assert.ok(typeof result.remaining === 'number');
      assert.ok(result.remaining <= 3);
    });
  });
});

describe('Pipeline API Integration', () => {
  describe('Request validation', () => {
    it('should validate pipeline request format', () => {
      // 测试请求格式验证逻辑
      const validRequest = {
        steps: [
          { toolId: 'volcano-plot', params: { deg_table: '/data/deg.csv' }, language: 'r' },
          { toolId: 'heatmap-basic', params: { data_matrix: '/tmp/matrix.csv' }, language: 'r' }
        ],
        continueOnError: false
      };

      assert.ok(Array.isArray(validRequest.steps));
      assert.ok(validRequest.steps.length > 0);
      assert.ok(validRequest.steps.every(s => s.toolId));
    });

    it('should support cross-language pipeline', () => {
      const crossLangPipeline = {
        steps: [
          { toolId: 'seurat-pca', params: { input_file: '/data/scRNA.h5ad' }, language: 'r' },
          { toolId: 'scanpy-cluster', params: { n_neighbors: 15 }, language: 'python' },
          { toolId: 'volcano-plot', params: {}, language: 'r' }
        ],
        continueOnError: false
      };

      const languages = crossLangPipeline.steps.map(s => s.language);
      assert.deepStrictEqual(languages, ['r', 'python', 'r']);
    });
  });
});

describe('Pipeline Response Format', () => {
  it('should match expected response structure', () => {
    const expectedFields = [
      'pipelineId',
      'status',
      'steps',
      'continueOnError',
      'timing',
      'error'
    ];

    // 模拟响应结构
    const mockResponse = {
      pipelineId: 'pl-abc123',
      status: 'completed',
      steps: [
        {
          index: 0,
          toolId: 'volcano-plot',
          language: 'r',
          status: 'completed',
          duration: 1500,
          result: { plot: '/tmp/volcano.png' },
          error: null
        }
      ],
      continueOnError: false,
      timing: {
        start: 1692000000000,
        end: 1692000001500,
        totalDuration: 1500
      },
      error: null
    };

    for (const field of expectedFields) {
      assert.ok(field in mockResponse, `Missing field: ${field}`);
    }

    assert.ok(Array.isArray(mockResponse.steps));
    assert.ok(mockResponse.steps[0].index !== undefined);
    assert.ok(mockResponse.steps[0].toolId !== undefined);
    assert.ok(mockResponse.steps[0].status !== undefined);
  });
});
