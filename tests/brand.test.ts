import { describe, expect, it } from 'vitest';
import {
  BRAND_LOCKUP,
  BRAND_NAME,
  BRAND_SPACED_NAME,
  BRAND_TAGLINE,
  PRIMARY_CLI_NAME,
} from '../src/brand.js';

describe('Grawkus brand constants', () => {
  it('keeps the public name and tagline in one canonical lockup', () => {
    expect(BRAND_NAME).toBe('Grawkus');
    expect(BRAND_TAGLINE).toBe('terminal coding agents with a mind for the whole repo');
    expect(BRAND_LOCKUP).toBe('Grawkus — terminal coding agents with a mind for the whole repo');
    expect(BRAND_SPACED_NAME).toBe('G R A W K U S');
  });

  it('uses grawkus as the only packaged CLI name', () => {
    expect(PRIMARY_CLI_NAME).toBe('grawkus');
  });
});
