import { describe, it, expect, afterEach } from 'vitest';
import {
  getPaletteId,
  isPaletteId,
  listPalettes,
  PALETTES,
  resolvePaletteId,
  setPalette,
} from '../src/theme.js';

describe('Coolors palettes', () => {
  afterEach(() => {
    setPalette('olive-garden-feast');
  });

  it('lists exactly 12 user-facing Coolors-based schemes', () => {
    const palettes = listPalettes();
    expect(palettes).toHaveLength(12);
    expect(palettes.every((p) => p.source === 'Coolors trending')).toBe(true);
    expect(palettes.map((p) => p.id)).toEqual([
      'olive-garden-feast',
      'fiery-ocean',
      'refreshing-summer-fun',
      'ocean-blue-serenity',
      'pastel-dreamland-adventure',
      'sunny-beach-day',
      'dark-sunset',
      'fiery-red-sunset',
      'fiery-palette',
      'rustic-earthy-tones',
      'golden-summer-fields',
      'vibrant-tones',
    ]);
  });

  it('keeps full swatches for palette previews', () => {
    for (const meta of listPalettes()) {
      const palette = PALETTES[meta.id];
      expect(palette.swatches.length).toBeGreaterThanOrEqual(5);
      expect(palette.swatches.every((c) => /^#[0-9A-F]{6}$/i.test(c))).toBe(true);
    }
  });

  it('resolves legacy palette ids to current Coolors schemes', () => {
    expect(isPaletteId('compact-cmyk')).toBe(true);
    expect(resolvePaletteId('compact-cmyk')).toBe('ocean-blue-serenity');
    expect(setPalette('compact-cmyk')).toBe(true);
    expect(getPaletteId()).toBe('ocean-blue-serenity');
    expect(resolvePaletteId('watermelon-sorbet')).toBe('refreshing-summer-fun');
    expect(resolvePaletteId('soft-sand')).toBe('rustic-earthy-tones');
  });
});
