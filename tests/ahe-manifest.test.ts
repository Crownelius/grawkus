import { describe, expect, it } from 'vitest';
import { buildAheManifest, parseAheManifestArgs } from '../src/ahe-manifest.js';

describe('AHE manifest command', () => {
  it('normalizes manifest args', () => {
    expect(parseAheManifestArgs('  src/query.ts   timeout   retry ')).toEqual({
      task: 'src/query.ts timeout retry',
    });
  });

  it('prints prediction and regression contract labels', () => {
    const out = buildAheManifest({ task: 'src/query.ts timeout retry' });
    expect(out).toContain('Task/Edit target: src/query.ts timeout retry');
    expect(out).toContain('Prediction:');
    expect(out).toContain('At-risk regression:');
    expect(out).toContain('Verification:');
    expect(out).toContain('Rollback criteria:');
  });
});
