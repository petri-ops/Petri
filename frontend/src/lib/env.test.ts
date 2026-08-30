import { afterEach, describe, expect, it } from 'vitest';
import { getApiPrefix, getComputeApiPrefix, getPlatformApiPrefix } from './env';

afterEach(() => {
  Reflect.deleteProperty(window, 'biof3Desktop');
});

describe('desktop backend API routing', () => {
  it('uses the standard local port when preload configuration is unavailable', () => {
    expect(getApiPrefix()).toBe('http://localhost:3001/api');
    // BLOCK-30 P1: 单后端收敛，language 参数不再分流（Python 工具由
    // 服务端执行器本地执行），恒返回 biof3-server 基址。
    expect(getApiPrefix('python')).toBe('http://localhost:3001/api');
    expect(getComputeApiPrefix()).toBe('http://localhost:3001/api');
    expect(getPlatformApiPrefix()).toBe('http://localhost:3001/api');
  });

  it('uses the port selected by the Electron main process', () => {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: {
        backendConfig: {
          rApiBase: 'http://localhost:43101/api',
        },
      },
    });

    expect(getApiPrefix()).toBe('http://localhost:43101/api');
    expect(getApiPrefix('python')).toBe('http://localhost:43101/api');
    expect(getComputeApiPrefix()).toBe('http://localhost:43101/api');
    expect(getPlatformApiPrefix()).toBe('http://localhost:43101/api');
  });
});
