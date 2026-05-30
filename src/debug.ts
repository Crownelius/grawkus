/**
 * Debug instrumentation.
 *
 * Writes NDJSON event records to ~/.grawkus/debug/<sessionId>.jsonl
 * for offline analysis. Designed so that with `level === 'off'` (the
 * default), every emit() call is a single boolean check + early return —
 * zero file I/O and negligible CPU on the hot path.
 *
 * Levels (each includes everything below it):
 *
 *   off    — no logging (default; for end users)
 *   info   — high-signal milestones: session start/end, API request/
 *            response summary, tool call summary, hook block, stream
 *            loop detection, mode/perm/model change
 *   debug  — info + per-tool argument previews, per-chunk stream stats,
 *            per-keypress trace at REPL, slash command dispatch
 *   trace  — debug + raw API payloads (truncated), full tool I/O,
 *            internal state transitions
 *
 * Toggling:
 *
 *   - CLI flag:     grawkus --debug [level]
 *   - Env var:      GRAWKUS_DEBUG=trace
 *   - Slash cmd:    /debug on [level]   /debug off   /debug tail [n]
 *
 * The event log is append-only. Each session gets its own file so
 * concurrent grawkus instances don't fight over a single sink.
 * Files are subject to the same 24h GC window as the gateguard state.
 *
 * Design notes:
 *
 *   - We deliberately don't use console.error or any third-party logger.
 *     console.error pollutes the user's REPL view; a third-party logger
 *     adds startup time + a transitive dep. Direct fs.appendFileSync to
 *     an NDJSON file is the lowest-overhead path that's also trivially
 *     consumable by jq / Python / another agent.
 *
 *   - We DO accept the cost of synchronous appendFileSync — debug
 *     instrumentation is rarely on the hot path of perf-sensitive code,
 *     and the cost of one syscall per event (only when level >= info)
 *     is dwarfed by the cost of the API call the event describes.
 *
 *   - Stack traces are NOT captured automatically. Each emit() takes an
 *     explicit `data` object — callers include whatever they need.
 *     Auto-traces would balloon the log file for limited extra value.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getHomeStateDir } from './config.js';

export type DebugLevel = 'off' | 'info' | 'debug' | 'trace';

const LEVEL_ORDER: Record<DebugLevel, number> = {
  off: 0,
  info: 1,
  debug: 2,
  trace: 3,
};

interface DebugState {
  level: DebugLevel;
  sessionId: string | null;
  logPath: string | null;
  eventCount: number;
  startedAt: number;
}

const state: DebugState = {
  level: 'off',
  sessionId: null,
  logPath: null,
  eventCount: 0,
  startedAt: Date.now(),
};

/**
 * Initialize debug at session start. Resolves level from (in priority order):
 *   1. explicit `level` arg (passed in from --debug flag parsing)
 *   2. $GRAWKUS_DEBUG env var
 *   3. existing state.level (typically 'off')
 *
 * Sets the log file path under ~/.grawkus/debug/<sessionId>.jsonl
 * but doesn't touch the filesystem until the first emit (lazy create).
 */
export function initDebug(sessionId: string, explicitLevel?: DebugLevel | string): void {
  state.sessionId = sessionId;
  const envLevel = process.env.GRAWKUS_DEBUG;
  const requested = (explicitLevel || envLevel || state.level || 'off').toLowerCase();
  state.level = isValidLevel(requested) ? requested : 'off';

  if (state.level !== 'off') {
    const dir = join(getHomeStateDir(), 'debug');
    state.logPath = join(dir, `${sessionId}.jsonl`);
    try {
      mkdirSync(dir, { recursive: true });
    } catch { /* if we can't create the dir, emit() will fail-safe */ }
    // GC: drop any debug files older than 24h.
    try {
      const cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        try {
          const s = statSync(p);
          if (s.mtimeMs < cutoff) unlinkSync(p);
        } catch { /* noop */ }
      }
    } catch { /* noop */ }
    emit('info', 'debug.init', { level: state.level, sessionId });
  }
}

function isValidLevel(s: string): s is DebugLevel {
  return s === 'off' || s === 'info' || s === 'debug' || s === 'trace';
}

/**
 * Emit a debug event. The fastest path is the early-return when the
 * configured level is below the event's level — a single integer compare.
 *
 * `data` is shallow-cloned to a JSON-safe form. Functions, BigInts, and
 * circular refs are stripped via the replacer to keep emit cheap and
 * crash-free regardless of what callers throw in.
 */
export function emit(
  eventLevel: Exclude<DebugLevel, 'off'>,
  eventName: string,
  data?: Record<string, unknown>,
): void {
  if (LEVEL_ORDER[state.level] < LEVEL_ORDER[eventLevel]) return;
  if (!state.logPath) return;
  const record = {
    t: new Date().toISOString(),
    rel: Date.now() - state.startedAt,
    lvl: eventLevel,
    ev: eventName,
    ...(data ? { data: safeClone(data) } : {}),
  };
  try {
    appendFileSync(state.logPath, JSON.stringify(record) + '\n', 'utf-8');
    state.eventCount++;
  } catch {
    // If the log file write fails, we don't want to spam errors into
    // the REPL — silently drop the event. The user can re-enable via
    // /debug if the underlying issue is fixed.
  }
}

/**
 * JSON.stringify replacer that prevents crashes on circular refs,
 * BigInt, functions, and overly-large strings. Truncates strings to
 * 8KB so a single huge prompt or tool output doesn't bloat the log.
 */
function safeClone(input: unknown): unknown {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(input, (_key, value) => {
      if (typeof value === 'bigint') return value.toString() + 'n';
      if (typeof value === 'function') return '[function]';
      if (typeof value === 'string' && value.length > 8192) {
        return value.slice(0, 8192) + `…[truncated ${value.length - 8192}b]`;
      }
      if (value && typeof value === 'object') {
        if (seen.has(value as object)) return '[circular]';
        seen.add(value as object);
      }
      return value;
    }),
  );
}

/**
 * Public read-only state snapshot for /debug status output.
 */
export function getDebugStatus(): {
  level: DebugLevel;
  logPath: string | null;
  eventCount: number;
  uptimeMs: number;
} {
  return {
    level: state.level,
    logPath: state.logPath,
    eventCount: state.eventCount,
    uptimeMs: Date.now() - state.startedAt,
  };
}

/**
 * Change the active debug level at runtime. Called from /debug on/off.
 * If transitioning OFF → non-off, we ensure the log dir exists; if
 * transitioning to OFF we leave the file alone (it's append-only and
 * read by external tools).
 */
export function setDebugLevel(level: DebugLevel): void {
  const old = state.level;
  state.level = level;
  if (level !== 'off' && !state.logPath && state.sessionId) {
    const dir = join(getHomeStateDir(), 'debug');
    state.logPath = join(dir, `${state.sessionId}.jsonl`);
    try { mkdirSync(dir, { recursive: true }); } catch { /* noop */ }
  }
  if (level !== 'off' && old !== level) {
    emit('info', 'debug.level-change', { from: old, to: level });
  }
}

/**
 * Read the last N events from the current session's log. Used by
 * /debug tail. Returns lines as JSON strings (one per event); the
 * caller can pretty-print or pass through to jq.
 */
export function tailDebug(n: number): string[] {
  if (!state.logPath || !existsSync(state.logPath)) return [];
  try {
    const raw = readFileSync(state.logPath, 'utf-8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    return lines.slice(-Math.max(1, n));
  } catch {
    return [];
  }
}

/**
 * True if any non-off level is active. Use this to gate expensive
 * data preparation that you don't want to run when debug is off:
 *
 *   if (isDebugActive()) {
 *     emit('debug', 'event-name', { detail: computeExpensiveDetail() });
 *   }
 */
export function isDebugActive(): boolean {
  return state.level !== 'off';
}
