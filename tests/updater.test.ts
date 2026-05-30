import { describe, expect, it } from 'vitest';
import { compareVersions, getCurrentVersion } from '../src/updater.js';

describe('startup updater helpers', () => {
  it('reports the installed package version', () => {
    expect(getCurrentVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('compares semver-like versions', () => {
    expect(compareVersions('1.35.72', '1.35.71')).toBe(1);
    expect(compareVersions('1.35.71', '1.35.71')).toBe(0);
    expect(compareVersions('1.35.70', '1.35.71')).toBe(-1);
    expect(compareVersions('v2.0.0', '1.99.99')).toBe(1);
  });

  it('treats a stable release as newer than its prerelease', () => {
    expect(compareVersions('1.36.0', '1.36.0-beta.1')).toBe(1);
    expect(compareVersions('1.36.0-beta.1', '1.36.0')).toBe(-1);
  });
});
