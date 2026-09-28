import { describe, expect, it } from 'vitest';
import { formatScientificValue } from './format-scientific-value';

describe('formatScientificValue', () => {
  it('renders extreme p-values in scientific notation with two decimals', () => {
    expect(formatScientificValue('1.23456789e-08')).toBe('1.23e-8');
    expect(formatScientificValue(4.5e-45)).toBe('4.50e-45');
  });

  it('renders large magnitudes in scientific notation', () => {
    expect(formatScientificValue('1234567')).toBe('1.23e+6');
    expect(formatScientificValue(-98765432)).toBe('-9.88e+7');
  });

  it('keeps everyday-range numbers in plain form with 4 significant digits', () => {
    expect(formatScientificValue('0.05')).toBe('0.05');
    expect(formatScientificValue('3.14159265')).toBe('3.142');
    expect(formatScientificValue('-2.75001')).toBe('-2.75');
    expect(formatScientificValue('2')).toBe('2');
  });

  it('keeps zero and near-zero plain', () => {
    expect(formatScientificValue('0')).toBe('0');
    expect(formatScientificValue('0.001')).toBe('0.001');
  });

  it('passes non-numeric input through unchanged instead of guessing', () => {
    expect(formatScientificValue('abc')).toBe('abc');
    expect(formatScientificValue('NA')).toBe('NA');
    expect(formatScientificValue(null)).toBe('—');
    expect(formatScientificValue(undefined)).toBe('—');
    expect(formatScientificValue('')).toBe('—');
  });
});
