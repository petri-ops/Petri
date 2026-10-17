import { describe, expect, it } from 'vitest';
import {
  exportEndpointProfilesCsv,
  exportEndpointProfilesJson,
  maskApiKey,
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

  // BLOCK-203 W4a P8（D-2 rider）——契约**有意变更**：此前"调用方传了 key 就写明文"，
  // 现在"传了 key 默认也脱敏，必须显式 masked:false 才出明文"。这条断言就是旧契约的墓碑。
  it('masks credentials by default even when the caller supplies them (D-2)', () => {
    const output = exportEndpointProfilesJson(profiles as never, { 'model-lab': 'sk-test' });
    expect(output).not.toContain('sk-test');
    expect(output).toContain(maskApiKey('sk-test'));
    expect(parseEndpointProfiles(output, 'json').profiles[0]).toMatchObject({ supplier: '实验室' });
    // 导出的 apiKey 字段仍在（列形状不变），但值是脱敏串
    expect(parseEndpointProfiles(output, 'json').profiles[0].apiKey).toBe(maskApiKey('sk-test'));
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

  it('exports plaintext only when masked:false is passed explicitly', () => {
    const output = exportEndpointProfilesJson(profiles as never, { 'model-lab': 'sk-plain-1234' }, { masked: false });
    expect(output).toContain('sk-plain-1234');
    expect(output).toContain('explicitly requested a credential export');
  });

  it('CSV keeps the same header/columns and masks by default', () => {
    const masked = exportEndpointProfilesCsv(profiles as never, { 'model-lab': 'sk-plain-1234' });
    const plain = exportEndpointProfilesCsv(profiles as never, { 'model-lab': 'sk-plain-1234' }, { masked: false });
    expect(masked.split('\n')[0]).toBe(plain.split('\n')[0]);
    expect(masked).not.toContain('sk-plain-1234');
    expect(masked).toContain(maskApiKey('sk-plain-1234'));
    expect(plain).toContain('sk-plain-1234');
  });

  it('maskApiKey keeps only the last four characters and never echoes short secrets', () => {
    expect(maskApiKey('sk-abcdefgh1234')).toBe('***1234');
    expect(maskApiKey('abc')).toBe('***');
    expect(maskApiKey('')).toBe('');
    expect(maskApiKey('  sk-x  ')).toBe('***');
  });
});
