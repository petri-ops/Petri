import { describe, expect, it } from 'vitest';
import {
  RESULT_MODES,
  availableResultModes,
  isSingleActiveMode,
  resolveResultMode,
} from './resultMode';

describe('availableResultModes', () => {
  it('offers only result when nothing else is built — today\'s state', () => {
    // code needs P4R-5's source projection, history needs P4R-4's version
    // switcher, and compare has no surface distinct from result.
    expect(availableResultModes()).toEqual(['result']);
    expect(availableResultModes({})).toEqual(['result']);
  });

  it('never drops result, whatever the capabilities say', () => {
    expect(availableResultModes({ canProjectSource: true })).toContain('result');
    expect(availableResultModes({ canSwitchVersions: true, canCompare: true })).toContain('result');
  });

  it('adds a mode only when its capability exists', () => {
    expect(availableResultModes({ canProjectSource: true })).toEqual(['result', 'code']);
    expect(availableResultModes({ canSwitchVersions: true })).toEqual(['result', 'history']);
    expect(availableResultModes({ canCompare: true })).toEqual(['result', 'compare']);
  });

  it('reaches all four only when everything is built', () => {
    expect(availableResultModes({
      canProjectSource: true, canCompare: true, canSwitchVersions: true,
    })).toEqual([...RESULT_MODES]);
  });
});

describe('resolveResultMode', () => {
  it('falls back to result for a mode that has no surface', () => {
    // ?mode=compare typed into the address bar is the only way to request it;
    // it must land on the result rather than imply a comparison view exists.
    expect(resolveResultMode('compare')).toBe('result');
    expect(resolveResultMode('code')).toBe('result');
    expect(resolveResultMode('history')).toBe('result');
  });

  it('honours a requested mode once its capability is present', () => {
    expect(resolveResultMode('code', { canProjectSource: true })).toBe('code');
    expect(resolveResultMode('history', { canSwitchVersions: true })).toBe('history');
  });

  it('treats junk and absence as result', () => {
    expect(resolveResultMode(null)).toBe('result');
    expect(resolveResultMode(undefined)).toBe('result');
    expect(resolveResultMode('')).toBe('result');
    expect(resolveResultMode('__proto__')).toBe('result');
    expect(resolveResultMode('Result')).toBe('result');
  });
});

describe('isSingleActiveMode', () => {
  it('holds when the container renders exactly the active mode', () => {
    expect(isSingleActiveMode('result', ['result'])).toBe(true);
  });

  it('fails when modes are stacked rather than exclusive', () => {
    // The defect the plan names: four modes rendered vertically instead of one
    // at a time.
    expect(isSingleActiveMode('result', ['result', 'code'])).toBe(false);
  });

  it('fails when nothing renders, or the wrong one does', () => {
    expect(isSingleActiveMode('result', [])).toBe(false);
    expect(isSingleActiveMode('result', ['code'])).toBe(false);
  });
});
