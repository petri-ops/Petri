import { describe, expect, it } from 'vitest';
import {
  exportEndpointProfilesCsv,
  exportEndpointProfilesJson,
  parseEndpointProfiles,
} from './model-endpoint-transfer';

const profiles = [{
  id: 'model-lab',
  label: '实验室',
  provider: 'openai-compatible',
  baseUrl: 'https://llm.example.com/v1',
  model: 'qwen3-32b',
  defaultModel: 'qwen3-32b',
}] as const;

describe('model endpoint transfer', () => {
  it('exports JSON without credentials and round-trips profiles', () => {
    const output = exportEndpointProfilesJson(profiles as never);
    expect(output).toContain('llm.example.com/v1');
    expect(output).not.toContain('apiKey');
    expect(parseEndpointProfiles(output, 'json').profiles[0]).toMatchObject({
      supplier: '实验室',
      defaultModel: 'qwen3-32b',
    });
  });

  it('includes credentials only when the caller explicitly supplies them', () => {
    const output = exportEndpointProfilesJson(profiles as never, { 'model-lab': 'sk-test' });
    expect(output).toContain('sk-test');
    expect(parseEndpointProfiles(output, 'json').profiles[0].apiKey).toBe('sk-test');
  });

  it('exports and imports quoted CSV fields', () => {
    const output = exportEndpointProfilesCsv([{ ...profiles[0], label: '实验室,主渠道' }] as never);
    const parsed = parseEndpointProfiles(output, 'csv');
    expect(parsed.profiles[0].supplier).toBe('实验室,主渠道');
    expect(parsed.profiles[0].baseUrl).toBe('https://llm.example.com/v1');
  });

  it('imports an explicit key while still rejecting invalid rows', () => {
    const parsed = parseEndpointProfiles(JSON.stringify({ profiles: [
      { supplier: '有效', baseUrl: 'https://example.com/v1', defaultModel: 'model-a', apiKey: 'secret' },
      { supplier: '无效', baseUrl: 'file:///tmp', defaultModel: 'model-b' },
    ] }), 'json');
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0].apiKey).toBe('secret');
    expect(parsed.warnings.join(' ')).toContain('跳过');
  });

  it('preserves a native Anthropic provider and its user-supplied endpoint', () => {
    const output = exportEndpointProfilesJson([{
      id: 'anthropic-main',
      label: 'Anthropic',
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      model: 'claude-test',
      defaultModel: 'claude-test',
    }] as never);
    expect(parseEndpointProfiles(output, 'json').profiles[0]).toMatchObject({
      provider: 'anthropic',
      baseUrl: 'https://api.anthropic.com/v1',
      defaultModel: 'claude-test',
    });
  });
});
