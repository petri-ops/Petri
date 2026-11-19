/**
 * HK-01（2026-11-19）— 流式停滞错误分类不得误判为 Python 模块缺失。
 * 真实事故：用户收到「Python 依赖模块缺失——请装 Python 运行时」，
 * 实际错误是「模型流式响应停滞（连续无 token 60001ms）」，属分类误导。
 */
import { describe, expect, it } from 'vitest';
import { classifyError } from './errorMessages';

describe('classifyError · stream_stalled 分类', () => {
  it('① 连续无 token 停滞 → STREAM_STALLED，不得误判为 PYTHON_MODULE_MISSING', () => {
    const message = '模型流式响应停滞（连续无 token 60001ms），已中止本次调用';
    const classified = classifyError(new Error(message));
    expect(classified.code).toBe('STREAM_STALLED');
    expect(classified.code).not.toBe('PYTHON_MODULE_MISSING');
  });

  it('② 首 token 停滞同样归 STREAM_STALLED', () => {
    const classified = classifyError('模型流式响应停滞（首 token 120000ms），已中止本次调用');
    expect(classified.code).toBe('STREAM_STALLED');
  });

  it('③ 真实 Python 模块缺失仍归 PYTHON_MODULE_MISSING（不误伤既有分类）', () => {
    const classified = classifyError(new Error("ModuleNotFoundError: No module named 'scanpy'"));
    expect(classified.code).toBe('PYTHON_MODULE_MISSING');
  });

  it('④ STREAM_STALLED 文案不含「插件商店/Python」误导词', () => {
    const classified = classifyError('模型流式响应停滞（连续无 token 60001ms），已中止本次调用');
    expect(classified.mapped.userMessage).not.toMatch(/Python|插件商店/);
  });
});
