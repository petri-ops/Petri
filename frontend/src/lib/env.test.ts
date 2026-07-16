import { afterEach, describe, expect, it } from 'vitest';
import { getApiPrefix, getComputeApiPrefix, getPlatformApiPrefix } from './env';

afterEach(() => {
  Reflect.deleteProperty(window, 'biof3Desktop');
});

describe('desktop backend API routing', () => {
  it('uses the standard local ports when preload configuration is unavailable', () => {
    expect(getApiPrefix()).toBe('http://localhost:3001/api');
    expect(getApiPrefix('python')).toBe('http://localhost:3004/api');
    expect(getComputeApiPrefix()).toBe('http://localhost:3001/api');
    expect(getPlatformApiPrefix()).toBe('http://localhost:3001/api');
  });

  it('uses the ports selected by the Electron main process', () => {
    Object.defineProperty(window, 'biof3Desktop', {
      configurable: true,
      value: {
        backendConfig: {
          rApiBase: 'http://localhost:43101/api',
          pythonApiBase: 'http://localhost:43104/api',
        },
      },
    });

    expect(getApiPrefix()).toBe('http://localhost:43101/api');
    expect(getApiPrefix('python')).toBe('http://localhost:43104/api');
    expect(getComputeApiPrefix()).toBe('http://localhost:43101/api');
    expect(getPlatformApiPrefix()).toBe('http://localhost:43101/api');
  });
});
