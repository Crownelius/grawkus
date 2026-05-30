/**
 * API key rotation pool — for users with multiple OpenRouter (or any
 * compatible) accounts who want to round-robin / failover across them
 * when one hits a rate limit or runs out of free credits.
 *
 * Pool composition: config.apiKey + config.apiKeys (deduplicated, order
 * preserved). The single `apiKey` field always becomes pool[0] so users
 * with only the legacy config see no change in behavior.
 *
 * Rotation strategy: on 401 / 429 / quota errors, the failing key is
 * marked "cool" for `COOL_DOWN_MS`, the next healthy key takes over.
 * If all keys are cool, the request fails normally — the user will see
 * the last error message. Health state lives in module memory; restart
 * = fresh start.
 *
 * Why module-level vs persisted: rate-limit windows are usually 60s-5m
 * and reset naturally. Persisting cool-down across processes would
 * make the agent worse at recovering from transient blips.
 */

const COOL_DOWN_MS = 60_000;             // 1 min — typical free-tier RPM window
const QUOTA_COOL_DOWN_MS = 60 * 60_000;  // 1 hour — daily/monthly quota errors

interface KeyState {
  key: string;
  /** ms timestamp when this key is allowed to be tried again; 0 = healthy */
  coolUntil: number;
  /** Last error reason — surfaced in /keys status */
  lastReason?: string;
  /** Counts since process start for diagnostics */
  successes: number;
  failures: number;
}

let pool: KeyState[] = [];
let cursor = 0;     // round-robin pointer for which key to try first

/**
 * Build the pool from a config snapshot. Idempotent; if the same keys
 * are passed in the same order, the existing state is preserved
 * (so cool-downs persist across rebuilds in the same process).
 */
export function setPool(primary: string, extras: string[] = []): void {
  // Dedupe in order: primary first, then extras
  const seen = new Set<string>();
  const all: string[] = [];
  for (const k of [primary, ...extras]) {
    if (k && !seen.has(k)) { seen.add(k); all.push(k); }
  }
  // Preserve state for keys that are still in the pool
  const existing = new Map(pool.map((s) => [s.key, s]));
  pool = all.map((k) => existing.get(k) || {
    key: k, coolUntil: 0, successes: 0, failures: 0,
  });
  if (cursor >= pool.length) cursor = 0;
}

/**
 * Pick the next healthy key to use. Round-robin from the current cursor.
 * Returns null if the pool is empty or all keys are cool.
 */
export function pickKey(): string | null {
  if (pool.length === 0) return null;
  const now = Date.now();
  // Try each key once, starting from cursor
  for (let i = 0; i < pool.length; i++) {
    const idx = (cursor + i) % pool.length;
    if (pool[idx].coolUntil <= now) {
      cursor = (idx + 1) % pool.length;   // next call rotates one further
      return pool[idx].key;
    }
  }
  return null;
}

/**
 * Mark a key as failed. The classifier distinguishes:
 *
 *   KEY problems (cool the key down):
 *     - quota/credit exhausted → 1h cool
 *     - auth rejected           → 1h cool
 *     - rate-limited            → 60s cool
 *
 *   NOT key problems (don't touch the key — surface upward instead):
 *     - 404 model-not-found     → model name wrong, no key swap helps
 *     - 5xx server errors       → provider issue, retry-here doesn't help
 *     - timeout / network       → may be transient, but not key-specific
 *     - any other 4xx (bad request, content filter)
 *
 * The previous version defaulted unknown errors to a 60s cool, which
 * pooled BOTH keys into "cooling" when the user typo'd a model name —
 * a false positive that made it look like both keys were dead.
 */
export function reportFailure(key: string, err: unknown): void {
  const state = pool.find((s) => s.key === key);
  if (!state) return;
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  // Filter out non-key errors FIRST — these should bump the failure count
  // (for visibility) but NOT actually cool the key.
  const isNotKeyProblem =
    /404|model.*not.found|no endpoints found/.test(lower) ||
    /5\d\d|server.?error|bad.gateway|gateway.*timeout/.test(lower) ||
    /content.?filter|safety|moderation/.test(lower) ||
    /context.*overflow|too.many.*tokens|context.?length/.test(lower);

  if (isNotKeyProblem) {
    // Record for diagnostics, don't cool. The error surfaces to the
    // user via printApiError; key stays available for the next call.
    state.failures++;
    state.lastReason = msg.slice(0, 80);
    return;
  }

  let cooldown = COOL_DOWN_MS;
  let reason = msg.slice(0, 80);
  if (/quota|insufficient|credit|payment|billing/.test(lower)) {
    cooldown = QUOTA_COOL_DOWN_MS;
    reason = 'quota/credit exhausted';
  } else if (/auth|invalid.*key|forbidden|401|403/.test(lower)) {
    cooldown = QUOTA_COOL_DOWN_MS;
    reason = 'auth rejected (bad/revoked key)';
  } else if (/rate.?limit|429|too.many/.test(lower)) {
    cooldown = COOL_DOWN_MS;
    reason = 'rate limited';
  } else {
    // Unknown error pattern — DON'T cool. Defaulting to cool was the
    // original bug. Record the failure for diagnostics; the next
    // request can try the same key, or the auto-fallback model logic
    // can step in if the error truly indicates a model-side problem.
    state.failures++;
    state.lastReason = reason;
    return;
  }
  state.coolUntil = Date.now() + cooldown;
  state.lastReason = reason;
  state.failures++;
}

/** Mark a key as having succeeded — clears any cool-down + records stat. */
export function reportSuccess(key: string): void {
  const state = pool.find((s) => s.key === key);
  if (!state) return;
  state.coolUntil = 0;
  state.lastReason = undefined;
  state.successes++;
}

/**
 * Snapshot for /keys status output. Truncates keys to last 4 chars
 * so the UI never prints the full secret.
 */
export interface KeyStatus {
  index: number;
  tail: string;
  healthy: boolean;
  coolDownRemainingSec?: number;
  successes: number;
  failures: number;
  lastReason?: string;
}

export function listStatus(): KeyStatus[] {
  const now = Date.now();
  return pool.map((s, i) => ({
    index: i,
    tail: `…${s.key.slice(-4)}`,
    healthy: s.coolUntil <= now,
    coolDownRemainingSec: s.coolUntil > now ? Math.ceil((s.coolUntil - now) / 1000) : undefined,
    successes: s.successes,
    failures: s.failures,
    lastReason: s.lastReason,
  }));
}

/** Currently-active pool size (post-dedup). */
export function poolSize(): number { return pool.length; }
