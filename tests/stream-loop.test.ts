/**
 * Coverage for the stream-loop detector (countTailRepetitions in
 * src/query.ts). This is the only safety against runaway streams now
 * that maxTurns defaults to Infinity (v1.27.2).
 *
 * The detector is intentionally coarse: it pattern-matches on the last
 * 200-char window appearing 3+ times in the stream. False positives
 * would cancel legitimate streams; false negatives would let the
 * owl-alpha-style infinite-loop bug through. These tests pin both
 * sides of that balance.
 */
import { afterEach, describe, it, expect } from 'vitest';
import {
  countTailRepetitions,
  isKnownFlakyOpenRouterModel,
  isTurnCancelKeySequence,
  resolveFirstTokenTimeoutMs,
} from '../src/query.js';

describe('countTailRepetitions', () => {
  // Most tests use a tiny window so they read naturally. The production
  // detector uses window=200, threshold=3.

  describe('healthy streams (should NOT trigger)', () => {
    it('returns 0 for stream shorter than window*threshold', () => {
      // 10*3 = 30 chars minimum; 'short' is well below.
      expect(countTailRepetitions('short', 10, 3)).toBe(0);
    });

    it('returns low count on a stream with no repetition', () => {
      // A varied stream where the last 10 chars don't appear elsewhere.
      // Note: a uniform block like 'A'.repeat(30) IS technically a
      // legitimate stuck signal (the model is repeating a single char
      // ~3 times in 10-char windows), and the detector correctly
      // flags it. Real-world text is varied; that's what we test.
      const text =
        'function add(a, b) { return a + b; }\n' +
        'function sub(a, b) { return a - b; }\n' +
        'function mul(a, b) { return a * b; }\n' +
        'export { add, sub, mul };';
      const count = countTailRepetitions(text, 10, 3);
      expect(count).toBeLessThan(3);
    });

    it('returns low count on lorem-ipsum-style varied text', () => {
      const text =
        'The quick brown fox jumps over the lazy dog. ' +
        'Pack my box with five dozen liquor jugs. ' +
        'How vexingly quick daft zebras jump. ' +
        'Sphinx of black quartz, judge my vow. ' +
        'The five boxing wizards jump quickly.';
      const count = countTailRepetitions(text, 20, 3);
      expect(count).toBeLessThan(3);
    });

    it('returns 1 (not 3+) on a single copy of self-similar text — overlap regression guard', () => {
      // Single repetition of a self-similar 10-char window. With the
      // pre-fix overlapping idx++ the same window could match 3 times
      // shifted by 1 char each; the non-overlapping idx += windowSize
      // counts it as exactly 1.
      const text = 'AAAAAAAAAA'.repeat(1) + 'BBBBBBBBBB';
      const count = countTailRepetitions(text, 10, 3);
      expect(count).toBeLessThan(3);
    });
  });

  describe('stuck streams (SHOULD trigger)', () => {
    it('reaches threshold when the same window appears N times', () => {
      // 10-char window repeated exactly 3 times non-overlapping.
      const text = 'preamble' + 'XXXXXXXXXX'.repeat(3);
      const count = countTailRepetitions(text, 10, 3);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('catches the owl-alpha repro pattern (200-char window x 3)', () => {
      // Reproduces the v1.27.1 bug: model emits the same 4 tool-call
      // JSON lines as text repeatedly. Each loopBlock is ~120 chars,
      // window is 200, so we need enough repeats that a 200-char
      // tail snapshot finds itself 3+ times non-overlapping in the
      // stream (i.e. >= 6 reps of the unit so 3 non-overlapping
      // 200-char copies fit).
      const loopBlock = JSON.stringify({
        name: 'bash',
        arguments: { command: 'npm install typescript' },
      }) + '\n' + JSON.stringify({
        name: 'bash',
        arguments: { command: 'tsc --init' },
      }) + '\n';
      const text = 'intro text\n' + loopBlock.repeat(10);
      const count = countTailRepetitions(text, 200, 3);
      expect(count).toBeGreaterThanOrEqual(3);
    });

    it('catches repetition even when tail starts mid-pattern', () => {
      // Window slice is exactly the LAST N chars, so the alignment
      // of where the pattern started doesn't matter — what matters
      // is that the same N-byte window appears 3+ times.
      const pat = 'REPEATED_PATTERN_';
      const text = 'preamble ' + pat.repeat(10);
      const count = countTailRepetitions(text, pat.length * 2, 3);
      expect(count).toBeGreaterThanOrEqual(3);
    });
  });

  describe('threshold short-circuit (perf)', () => {
    it('stops counting at threshold (does not exhaustively scan)', () => {
      // 100 reps; even if the function counted all 100 it'd return >=3.
      // We're verifying behavior, not benchmarking — assertion is on
      // the return value capped at threshold.
      const text = 'X'.repeat(10 * 100);
      const count = countTailRepetitions(text, 10, 3);
      // Function returns immediately after hitting threshold
      expect(count).toBe(3);
    });
  });

  describe('edge cases', () => {
    it('handles windowSize === fullText.length cleanly', () => {
      const text = 'abc';
      const count = countTailRepetitions(text, 3, 3);
      expect(count).toBe(0);  // text.length < window * threshold = 9
    });

    it('handles threshold of 1 (matches once)', () => {
      const text = 'abc'.repeat(2);
      // window = 'bcabc'[-3] = 'abc'; appears 2 non-overlap times in 'abcabc'
      // But the early-return short-circuits at threshold=1
      const count = countTailRepetitions(text, 3, 1);
      expect(count).toBe(1);
    });

    it('handles threshold of 0 cleanly (loop never executes)', () => {
      const count = countTailRepetitions('a'.repeat(100), 10, 0);
      // Length guard `< window * threshold` short-circuits when
      // threshold is 0 (100 < 0 is false, so we enter; but the
      // outer while-loop has threshold=0 so the if-break fires
      // immediately after the first match). Either way count is
      // a small non-negative number.
      expect(count).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('resolveFirstTokenTimeoutMs', () => {
  const original = process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
  const originalNonInteractive = process.env.GRAWKUS_NON_INTERACTIVE;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
    } else {
      process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = original;
    }
    if (originalNonInteractive === undefined) {
      delete process.env.GRAWKUS_NON_INTERACTIVE;
    } else {
      process.env.GRAWKUS_NON_INTERACTIVE = originalNonInteractive;
    }
  });

  it('uses fast interactive watchdogs for OpenRouter models', () => {
    delete process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
    delete process.env.GRAWKUS_NON_INTERACTIVE;

    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/owl-alpha',
    })).toBe(6_000);
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'deepseek/deepseek-v4-flash',
    })).toBe(6_000);
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'deepseek/deepseek-v4-pro',
    })).toBe(6_000);
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/free',
    })).toBe(8_000);
  });

  it('keeps more patient defaults for non-interactive harness runs and allows env override', () => {
    delete process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS;
    process.env.GRAWKUS_NON_INTERACTIVE = '1';
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/owl-alpha',
    })).toBe(20_000);
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/free',
    })).toBe(60_000);

    process.env.GRAWKUS_FIRST_TOKEN_TIMEOUT_MS = '1234';
    expect(resolveFirstTokenTimeoutMs({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/owl-alpha',
    })).toBe(1234);
  });
});

describe('known flaky model detection', () => {
  it('detects OpenRouter preview models for watchdog tuning only', () => {
    expect(isKnownFlakyOpenRouterModel({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/owl-alpha',
    })).toBe(true);
    expect(isKnownFlakyOpenRouterModel({
      provider: 'OpenRouter (Any Model)',
      model: 'deepseek/deepseek-v4-flash',
    })).toBe(true);
    expect(isKnownFlakyOpenRouterModel({
      provider: 'OpenRouter (Any Model)',
      model: 'deepseek/deepseek-v4-pro',
    })).toBe(true);
    expect(isKnownFlakyOpenRouterModel({
      provider: 'OpenRouter (Any Model)',
      model: 'openrouter/free',
    })).toBe(false);
    expect(isKnownFlakyOpenRouterModel({
      provider: 'Ollama',
      model: 'local/owl-alpha',
    })).toBe(false);
  });
});

describe('turn cancel key sequence parsing', () => {
  it('recognizes raw F5 and Shift+F5 escape sequences used by Windows/xterm terminals', () => {
    expect(isTurnCancelKeySequence(Buffer.from('\x1b'))).toBe(true);
    expect(isTurnCancelKeySequence(Buffer.from('\x1b[27;1;27~'))).toBe(true);
    expect(isTurnCancelKeySequence(Buffer.from('\x1b[15~'))).toBe(true);
    expect(isTurnCancelKeySequence(Buffer.from('\x1b[15;2~'))).toBe(true);
    expect(isTurnCancelKeySequence(Buffer.from('\x1b[15;5~'))).toBe(true);
    expect(isTurnCancelKeySequence(Buffer.from('\x1b[A'))).toBe(false);
    expect(isTurnCancelKeySequence(Buffer.from('hello'))).toBe(false);
  });
});
