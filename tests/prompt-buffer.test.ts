import { describe, expect, it } from 'vitest';
import {
  applyQueuedInputChunk,
  drainQueuedInputBytes,
  normalizeTypeaheadDraftForPrompt,
  queuedInputBytesToText,
} from '../src/prompt-buffer.js';

describe('type-ahead prompt restoration', () => {
  it('restores queued single-line text as an editable draft', () => {
    expect(normalizeTypeaheadDraftForPrompt('keep typing')).toBe('keep typing');
  });

  it('does not turn enter typed during a chain into auto-submit behavior', () => {
    expect(normalizeTypeaheadDraftForPrompt('first line\r\nsecond line\n')).toBe('first line second line');
  });

  it('edits queued bytes with backspace before restoring the draft', () => {
    const bytes: number[] = [];
    expect(applyQueuedInputChunk(bytes, Buffer.from('draft'))).toMatchObject({ mutated: true });
    expect(applyQueuedInputChunk(bytes, Buffer.from([0x7F]))).toMatchObject({ mutated: true });
    expect(queuedInputBytesToText(bytes)).toBe('draf');
  });

  it('ignores terminal escape sequences without corrupting queued text', () => {
    const bytes = Array.from(Buffer.from('keep'));
    expect(applyQueuedInputChunk(bytes, Buffer.from([0x1B, 0x5B, 0x44]))).toEqual({
      mutated: false,
      ignoredEscape: true,
    });
    expect(queuedInputBytesToText(bytes)).toBe('keep');
  });

  it('normalizes queued Enter as spacing and never creates hidden auto-submit text', () => {
    const bytes: number[] = [];
    applyQueuedInputChunk(bytes, Buffer.from('first\r\nsecond\n'));
    const drained = drainQueuedInputBytes(bytes);
    expect(drained).toBe('first\nsecond');
    expect(bytes).toEqual([]);
    expect(normalizeTypeaheadDraftForPrompt(drained)).toBe('first second');
  });
});
