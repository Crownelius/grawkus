/**
 * Coverage for src/key-rotation.ts — the multi-key rotation pool.
 *
 * The pool is the only safety against rate-limited / quota-exhausted
 * users with multiple OpenRouter accounts. v1.24.2 fixed a critical
 * bug where 404 model-not-found errors were treated as key problems
 * and cooled both keys in the pool. These tests pin that behavior so
 * we don't regress.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPool, pickKey, reportFailure, reportSuccess,
  listStatus, poolSize,
} from '../src/key-rotation.js';

describe('key-rotation', () => {
  beforeEach(() => {
    // setPool with no keys empties the pool. Required because module
    // state is shared across tests in the same process.
    setPool('', []);
  });

  describe('setPool', () => {
    it('builds a pool from primary + extras', () => {
      setPool('sk-primary', ['sk-extra1', 'sk-extra2']);
      expect(poolSize()).toBe(3);
    });

    it('dedupes the same key passed multiple times', () => {
      setPool('sk-a', ['sk-a', 'sk-b', 'sk-a']);
      expect(poolSize()).toBe(2);
    });

    it('skips empty strings', () => {
      setPool('sk-a', ['', 'sk-b', '']);
      expect(poolSize()).toBe(2);
    });

    it('handles empty primary + empty extras', () => {
      setPool('', []);
      expect(poolSize()).toBe(0);
    });

    it('preserves state for keys still in the pool after a rebuild', () => {
      setPool('sk-a', ['sk-b']);
      reportSuccess('sk-a');
      reportSuccess('sk-a');
      setPool('sk-a', ['sk-b']);  // same keys, rebuild
      const status = listStatus();
      const a = status.find((s) => s.tail.endsWith('sk-a'));
      expect(a?.successes).toBe(2);
    });
  });

  describe('pickKey', () => {
    it('returns null on an empty pool', () => {
      expect(pickKey()).toBeNull();
    });

    it('returns the primary key on a fresh pool', () => {
      setPool('sk-primary', []);
      expect(pickKey()).toBe('sk-primary');
    });

    it('round-robins across healthy keys', () => {
      setPool('sk-a', ['sk-b', 'sk-c']);
      const seen = new Set<string>();
      for (let i = 0; i < 6; i++) seen.add(pickKey()!);
      expect(seen).toEqual(new Set(['sk-a', 'sk-b', 'sk-c']));
    });

    it('skips cooling keys', () => {
      setPool('sk-a', ['sk-b']);
      // Rate-limit error on sk-a; it should cool.
      reportFailure('sk-a', new Error('429 Too Many Requests rate limited'));
      // Now pickKey should return sk-b exclusively (sk-a is cooling).
      for (let i = 0; i < 5; i++) {
        expect(pickKey()).toBe('sk-b');
      }
    });

    it('returns null when all keys are cooling', () => {
      setPool('sk-a', ['sk-b']);
      reportFailure('sk-a', new Error('429 rate limited'));
      reportFailure('sk-b', new Error('429 rate limited'));
      expect(pickKey()).toBeNull();
    });
  });

  describe('reportFailure classification', () => {
    it('cools the key on a 429 rate-limit error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('429 Too Many Requests rate limited'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(false);
      expect(s.lastReason).toBe('rate limited');
    });

    it('cools the key on a quota/credit error (longer cool-down)', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('insufficient credit on account'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(false);
      expect(s.lastReason).toBe('quota/credit exhausted');
      // quota cool-down is 1h, rate-limit is 60s; we should see >60s remaining
      expect(s.coolDownRemainingSec).toBeGreaterThan(60);
    });

    it('cools the key on an auth error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('401 unauthorized: invalid key'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(false);
      expect(s.lastReason).toBe('auth rejected (bad/revoked key)');
    });

    // ── THE v1.24.2 REGRESSION GUARD ──────────────────────────
    // 404 model-not-found used to cool ALL keys because the default
    // fallthrough was "60s cool". A user typo'd model name shouldn't
    // make the pool look dead.
    it('does NOT cool the key on a 404 model-not-found error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('404 No endpoints found for foo/bar:free'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(true);
      expect(s.failures).toBe(1);
    });

    it('does NOT cool the key on a 5xx server error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('502 Bad Gateway from upstream'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(true);
    });

    it('does NOT cool the key on a content-filter / moderation error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('Content filter: safety policy violation'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(true);
    });

    it('does NOT cool the key on a context-overflow error', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('context length exceeded: too many tokens'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(true);
    });

    it('does NOT cool on unknown error patterns (records failure only)', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('something completely unexpected'));
      const s = listStatus()[0];
      expect(s.healthy).toBe(true);
      expect(s.failures).toBe(1);
    });

    it('ignores reportFailure for a key not in the pool', () => {
      setPool('sk-a', []);
      reportFailure('sk-not-in-pool', new Error('429'));
      // Pool's sk-a should be untouched
      const s = listStatus()[0];
      expect(s.failures).toBe(0);
    });
  });

  describe('reportSuccess', () => {
    it('clears any cool-down', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('429 rate limited'));
      expect(listStatus()[0].healthy).toBe(false);
      reportSuccess('sk-a');
      expect(listStatus()[0].healthy).toBe(true);
    });

    it('clears lastReason', () => {
      setPool('sk-a', []);
      reportFailure('sk-a', new Error('429 rate limited'));
      reportSuccess('sk-a');
      expect(listStatus()[0].lastReason).toBeUndefined();
    });

    it('bumps the success counter', () => {
      setPool('sk-a', []);
      reportSuccess('sk-a');
      reportSuccess('sk-a');
      expect(listStatus()[0].successes).toBe(2);
    });
  });

  describe('listStatus', () => {
    it('truncates keys to last 4 chars so secrets stay redacted', () => {
      setPool('sk-or-v1-abcdefghijklmn', []);
      const s = listStatus()[0];
      expect(s.tail).toBe('…klmn');
      // The full key MUST NOT appear anywhere in the snapshot
      expect(JSON.stringify(s)).not.toContain('abcdefghi');
    });
  });
});
