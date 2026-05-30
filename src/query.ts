import chalk from 'chalk';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import * as readline from 'node:readline/promises';
import type { Message, GrawkusConfig } from './types.js';
import type { Tool } from './tools/types.js';
import { ALL_TOOLS, getToolByName } from './tools/index.js';
import { resolveUserPath } from './tools/path-utils.js';
import { streamChat, resetClient } from './api.js';
import { checkPermission, explainPermission } from './permissions.js';
import { buildSystemPrompt } from './system-prompt.js';
import { runHooks } from './hooks.js';
import { scanToolCall, printSecurityWarning } from './security.js';
import { trackUsage } from './cost-tracker.js';
import {
  shouldCompact,
  compactMessages,
  quickCompact,
  estimateTokens,
  buildCompactionConfig,
  contextCapTokens,
  enforceContextCap,
  inferContextWindowTokens,
} from './compaction.js';
import type { Mode } from './modes.js';
import { assistantTranscriptPrefix, theme, sym, printToolRun, printToolResult, printThinkingOpen, printThinkingText, printThinkingClose, printCost, printApiError, formatDuration, categorizeApiError } from './theme.js';
import {
  isVoiceEnabled, getTtsConfig, getAccessibilityConfig,
  speakAssistantResponse, speak, speakUserEcho,
} from './voice.js';
import { isLikelyDestructive, describeDestructive, countWords, summarize } from './accessibility.js';
import { audioCue } from './audio.js';
import { setStatus } from './status.js';
import { collapseCompletedTurns } from './turn-context.js';
import * as liveQueue from './live-queue.js';
import {
  activateFooter,
  buildFooterSnapshot,
  isFooterActive,
  setFooterActivity,
  setFooterCost,
  shouldUseFixedFooter,
  updateFooter,
  writeScrollableLine,
} from './fixed-footer.js';
import { applyQueuedInputChunk, drainQueuedInputBytes, queuedInputBytesToText } from './prompt-buffer.js';
import { emit as dbgEmit } from './debug.js';
import { applyAgentToolInstructions } from './agents-md.js';
import {
  buildBenchmarkCompletionReminder,
  buildBenchmarkTrajectorySystemBlock,
  makeBenchmarkPermissionDecisionEvent,
  makeBenchmarkInvalidToolActionEvent,
  makeBenchmarkTraceEvent,
  writeBenchmarkTrace,
  type BenchmarkUsageEvent,
  type BenchmarkTraceEvent,
} from './benchmark-trace.js';
import { buildTodoStateBlock } from './tools/todo.js';
import { buildRuntimeInfoBlock } from './runtime-info.js';
import { buildAutoRepoMapBlock } from './codemaps.js';
import { archiveLargeToolOutput } from './tool-output-archive.js';

// Per-session set: once we've told the user "this model didn't emit
// reasoning tokens" we don't repeat it on every turn. Cleared per process,
// not persisted — restart, see hint again. Keyed by sessionId so different
// sessions get fresh hints.
const _thinkingHintShownForSession = new Set<string>();

const INTERACTIVE_FIRST_TOKEN_TIMEOUT_MS = 8_000;
const INTERACTIVE_FLAKY_FIRST_TOKEN_TIMEOUT_MS = 6_000;
const NON_INTERACTIVE_FIRST_TOKEN_TIMEOUT_MS = 60_000;
const NON_INTERACTIVE_FLAKY_FIRST_TOKEN_TIMEOUT_MS = 20_000;
const FAST_DIRECT_FIRST_TOKEN_TIMEOUT_MS = INTERACTIVE_FIRST_TOKEN_TIMEOUT_MS;
const INTERACTIVE_STREAM_IDLE_TIMEOUT_MS = 45_000;
const NON_INTERACTIVE_STREAM_IDLE_TIMEOUT_MS = 120_000;
const FAST_DIRECT_STREAM_IDLE_TIMEOUT_MS = 20_000;
const KNOWN_FLAKY_OPENROUTER_MODEL_PATTERNS = [
  'owl-alpha',
  'horizon-alpha',
  'horizon-beta',
  'optimus-alpha',
  'quasar-alpha',
] as const;

function envTimeoutMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.floor(parsed);
}

export function resolveFirstTokenTimeoutMs(
  config: Pick<GrawkusConfig, 'model' | 'provider'>,
): number {
  const flaky = isKnownFlakyOpenRouterModel(config);
  const nonInteractive = process.env.GRAWKUS_NON_INTERACTIVE === '1';
  const fallback = nonInteractive
    ? (flaky ? NON_INTERACTIVE_FLAKY_FIRST_TOKEN_TIMEOUT_MS : NON_INTERACTIVE_FIRST_TOKEN_TIMEOUT_MS)
    : (flaky ? INTERACTIVE_FLAKY_FIRST_TOKEN_TIMEOUT_MS : INTERACTIVE_FIRST_TOKEN_TIMEOUT_MS);
  return envTimeoutMs('GRAWKUS_FIRST_TOKEN_TIMEOUT_MS', fallback);
}

export function resolveTurnFirstTokenTimeoutMs(
  config: Pick<GrawkusConfig, 'model' | 'provider'>,
  fastDirect = false,
): number {
  const timeoutMs = resolveFirstTokenTimeoutMs(config);
  return fastDirect ? Math.min(timeoutMs, FAST_DIRECT_FIRST_TOKEN_TIMEOUT_MS) : timeoutMs;
}

export function resolveStreamIdleTimeoutMs(fastDirect = false): number {
  const fallback = process.env.GRAWKUS_NON_INTERACTIVE === '1'
    ? NON_INTERACTIVE_STREAM_IDLE_TIMEOUT_MS
    : fastDirect
      ? FAST_DIRECT_STREAM_IDLE_TIMEOUT_MS
      : INTERACTIVE_STREAM_IDLE_TIMEOUT_MS;
  return envTimeoutMs('GRAWKUS_STREAM_IDLE_TIMEOUT_MS', fallback);
}

export function isKnownFlakyOpenRouterModel(
  config: Pick<GrawkusConfig, 'model' | 'provider'>,
): boolean {
  const model = String(config.model || '').toLowerCase();
  const provider = String(config.provider || '').toLowerCase();
  return provider.includes('openrouter')
    && KNOWN_FLAKY_OPENROUTER_MODEL_PATTERNS.some((pattern) => model.includes(pattern));
}

function fallbackModelForTurn(
  config: GrawkusConfig,
  usedFallbackModel: boolean,
): string | null {
  const fallback = config.fallbackModel;
  if (usedFallbackModel || !fallback || fallback === config.model) return null;
  return fallback;
}

export function isTurnCancelKeySequence(chunk: Buffer): boolean {
  const seq = chunk.toString('utf8');
  return (
    seq === '\x1b' ||
    seq === '\x1b\x1b' ||
    /^\x1b\[27(?:;\d+)*~$/.test(seq) ||
    seq === '\x1b[15~' ||
    seq === '\x1b[15;2~' ||
    seq === '\x1b[15;5~' ||
    seq === '\x1b[15;6~' ||
    seq === '\x1b[15;3~'
  );
}

const FAST_DIRECT_SYSTEM_PROMPT =
  'You are Grawkus. Answer the user directly and concisely. ' +
  'Do not mention tools, repositories, or implementation steps unless the user asks.';

const FAST_DIRECT_POSITIVE = [
  /^(hi|hello|hey|thanks|thank you)\b/i,
  /^(?:i\s+)?(?:need|want)\s+(?:your\s+)?help\b/i,
  /^(?:help me|can you help|could you help|would you help)\b/i,
  /^(?:i|we)\s+(?:like|love|hate|prefer|think|feel|am|are)\b/i,
  /^(?:sorry,?\s*)?(?:make|rewrite|revise|adjust|redo|try)\s+(?:it|that|this)\b/i,
  /^(what|who|when|where|why|how|which)\b/i,
  /^(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?(?:explain|define|summarize|translate|calculate|compute|write|draft|make|create|tell|give)\b/i,
  /^(?:please\s+)?(?:tell|give)\s+me\b/i,
  /^please\s+(?:explain|define|summarize|translate|calculate|compute|write|draft|make|create)\b/i,
  /^(?:i\s+need|i(?:'|\u2019)d\s+like|i\s+would\s+like)\s+(?:you\s+to\s+)?(?:explain|define|summarize|translate|calculate|compute|write|draft|make|create)\b/i,
  /^(explain|define|summarize|translate|calculate|compute)\b/i,
  /^(?:write|draft|make|create)\s+(?:a|an|the)?\s*(?:short\s+)?(?:poem|haiku|joke|story|paragraph|message|email)\b/i,
  /\b(square root|sqrt)\b/i,
  /\?$/,
];

const FAST_DIRECT_REPO_OR_TOOL = /\b(repo|repository|codebase|workspace|file|folder|directory|path|terminal|powershell|shell|command|npm|node|python|typescript|javascript|git|commit|diff|pr|pull request|branch|test|build|lint|install|package|debug|error|stack trace|log|fix|implement|refactor|review|audit|security|benchmark|run|execute|read|search|grep|edit|patch|write[- ]file|website|web\s*site|site|portfolio|landing\s+page|web\s+page|html|css|react|vue|svelte|vite|next\.?js|single[- ]file|dashboard|component|form|desktop|save|hireable|resume)\b/i;
const FAST_DIRECT_CONTEXTUAL = /^(?:(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?|please\s+)?(continue|carry on|resume|do it|same|again|that|this|those|these|it)\b/i;
const FAST_DIRECT_REVISION_CONTEXT = /^(?:(?:please\s+)?(?:can|could|would|will)\s+you\s+(?:please\s+)?)?(?:make|change|update|revise|rewrite|redo|adjust|convert|turn)\s+(?:it|that|this|him|her|them|he|she)\b/i;
const FAST_DIRECT_FOLLOWUP_EDIT_WITH_HISTORY = /^(?:(?:i\s+need\s+you\s+to|i(?:'|\u2019)d\s+like\s+you\s+to|(?:can|could|would|will)\s+you)\s+)?(?:please\s+)?(?:make|change|update|revise|rewrite|redo|adjust|convert|turn)\s+(?:the|this|that|it|him|her|them|he|she)\b/i;

export function shouldUseFastDirectReply(
  userQuery: string | undefined,
  mode: Mode,
  hasPriorAssistantContext = false,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (env.GRAWKUS_FAST_DIRECT === '0') return false;
  if (env.GRAWKUS_NON_INTERACTIVE === '1') return false;
  if (mode !== 'dev') return false;
  const text = (userQuery || '').trim();
  if (!text || text.length > 600) return false;
  if (text.includes('\n') || text.includes('```')) return false;
  // Follow-up turns should preserve full session context. Fast-direct is
  // intentionally first-turn-biased to avoid context drift/regressions.
  if (hasPriorAssistantContext) return false;
  if (FAST_DIRECT_CONTEXTUAL.test(text)) return false;
  if (FAST_DIRECT_REVISION_CONTEXT.test(text)) return false;
  if (FAST_DIRECT_FOLLOWUP_EDIT_WITH_HISTORY.test(text)) return false;
  if (FAST_DIRECT_REPO_OR_TOOL.test(text)) return false;
  return FAST_DIRECT_POSITIVE.some((pattern) => pattern.test(text));
}

function hasPriorAssistantContext(messages: Message[]): boolean {
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx <= 0) return false;
  for (let i = 0; i < lastUserIdx; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant') continue;
    if (typeof msg.content !== 'string') return true;
    if (msg.content.trim().length > 0) return true;
  }
  return false;
}

function printInteractiveTurnAccepted(config: GrawkusConfig): void {
  if (process.env.GRAWKUS_NON_INTERACTIVE === '1') return;
  if (!process.stdout.isTTY) return;
  const line = theme.dim(
    `  submitted to ${config.provider} | ${config.model}. Waiting for model events; Esc or F5 cancels.`,
  );
  if (isFooterActive()) {
    writeScrollableLine(line);
  } else {
    console.log(line);
  }
}

export interface WorkingIndicator {
  stop(): void;
}

export function formatWorkingIndicatorFrame(
  elapsedMs: number,
  frameIndex = 0,
  message = 'Working',
): string {
  const frames = ['\u25dc', '\u25dd', '\u25de', '\u25df'];
  const frame = frames[Math.abs(frameIndex) % frames.length];
  return `  ${frame} ${message} (${formatDuration(elapsedMs)} \u2022 Esc/F5 to interrupt)`;
}

function startWorkingIndicator(startedAtMs: number, screenReader: boolean, turn = 0): WorkingIndicator | null {
  if (screenReader) return null;
  if (process.env.GRAWKUS_NON_INTERACTIVE === '1') return null;
  if (!process.stdout.isTTY) return null;

  const messages = [
    'Sumi ink moving',
    'Edo lanterns cycling',
    'Kamon crest pulsing',
    'Neon shoji breathing',
    'Signal blade drawn',
  ];
  let frame = 0;
  let stopped = false;

  // Always start an interval-driven spinner on stdout as the reliable
  // fallback. The footer (if active) will also render its own activity
  // line, but this ensures the user ALWAYS sees movement regardless of
  // footer state or Windows terminal quirks.
  const paint = (): void => {
    if (stopped) return;
    const elapsed = Date.now() - startedAtMs;
    const message = messages[Math.floor(frame / 8) % messages.length];
    const line = formatWorkingIndicatorFrame(elapsed, frame, message);
    process.stdout.write('\r\x1b[K' + theme.dim(line));
    frame++;
  };

  paint();
  const timer = setInterval(paint, 250);

  // Also update the footer activity if it's active — keeps both surfaces in sync.
  if (isFooterActive()) {
    setFooterActivity(messages[0], turn, startedAtMs);
  }

  return {
    stop: (): void => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1b[K');
      if (isFooterActive()) setFooterActivity('Receiving response', turn, startedAtMs);
    },
  };
}

function ensureTurnFooterActive(ctx: QueryContext, screenReader: boolean): void {
  if (screenReader) return;
  if (!shouldUseFixedFooter(ctx.config)) return;
  if (!isFooterActive()) {
    activateFooter(buildFooterSnapshot(
      ctx.config,
      ctx.mode,
      { id: ctx.sessionId },
      ctx.cwd,
    ));
    return;
  }
  // Footer is already active — force-refresh the snapshot and trigger
  // a redraw so the ticker/animation state resets cleanly between turns.
  updateFooter(buildFooterSnapshot(
    ctx.config,
    ctx.mode,
    { id: ctx.sessionId },
    ctx.cwd,
  ));
}

function clearActiveTurnHandle(streamAbort: AbortController): void {
  const g = globalThis as {
    __turnAbortCtl?: AbortController | null;
    __turnCancelCurrent?: (() => void) | null;
  };
  if (g.__turnAbortCtl === streamAbort) {
    g.__turnAbortCtl = null;
    g.__turnCancelCurrent = null;
  }
}

/**
 * Count how many NON-OVERLAPPING occurrences of the last `windowSize`
 * characters of `fullText` appear in the full string. Bails as soon as
 * `threshold` is reached so the cost is O(threshold * windowSize) in
 * the common stuck-model case rather than O(fullText.length).
 *
 * Non-overlapping by stepping the search index by `windowSize` after
 * each match. Overlapping counts cause false positives on self-similar
 * text (markdown tables, repeated import lines, ASCII art) — the audit
 * found that `idx++` made a single copy match 3+ times when there were
 * only two genuine repeats.
 *
 * Exported so the loop-detector behavior can be unit-tested without
 * driving the full streamChat loop.
 */
export function countTailRepetitions(
  fullText: string,
  windowSize: number,
  threshold: number,
): number {
  if (fullText.length < windowSize * threshold) return 0;
  const window = fullText.slice(-windowSize);
  let count = 0;
  let idx = 0;
  while ((idx = fullText.indexOf(window, idx)) !== -1) {
    count++;
    if (count >= threshold) break;
    idx += windowSize;
  }
  return count;
}

export interface QueryContext {
  config: GrawkusConfig;
  messages: Message[];
  cwd: string;
  rl: readline.Interface;
  sessionId: string;
  mode: Mode;
}

function replaceMessagesInPlace(messages: Message[], nextMessages: Message[]): Message[] {
  if (nextMessages !== messages) {
    messages.splice(0, messages.length, ...nextMessages);
  }
  return messages;
}

/**
 * Suppress input during agent work — model streaming AND tool execution.
 *
 * Earlier versions only suppressed during the `for await streamChat()`
 * phase, leaving a gap during tool execution where the user's typing
 * leaked through inline with tool output (e.g. "sdsds" appearing between
 * web_fetch calls). Now the guard spans the entire runQuery, and
 * executeToolCalls calls `pause()` / `resume()` around the permission
 * prompt so rl.question() can read Y/n input cleanly.
 *
 * Mechanism: detach every 'keypress' listener on stdin that isn't tagged
 * with __grawkusHotkey__ (the F-key listener from index.ts). That stops
 * readline from echoing typed chars or buffering them into its next-line
 * state, while keeping F1–F10 status hotkeys live.
 *
 * Returned shape:
 *   pause()   — re-attach readline listeners so permission prompts work
 *   resume()  — detach again to re-suppress
 *   restore() — final cleanup: re-attach, drop data listener, restore raw mode
 */
type TaggedListener = ((...args: unknown[]) => void) & { __grawkusHotkey__?: boolean };

export interface InputGuard {
  pause(): void;
  resume(): void;
  /** Return whatever the user typed during streaming, then clear the buffer. */
  drainQueuedInput(): string;
  /**
   * Register a callback invoked when the user presses Ctrl+G (Steer).
   * The handler is responsible for aborting the active stream / chain;
   * queued type-ahead is restored into the next editable prompt.
   */
  onSteer(handler: () => void): void;
  restore(): void;
}

function startInputSuppression(screenReader: boolean = false): InputGuard {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    return {
      pause: () => { /* noop */ },
      resume: () => { /* noop */ },
      drainQueuedInput: () => '',
      onSteer: () => { /* noop */ },
      restore: () => { /* noop */ },
    };
  }
  const wasRaw = stdin.isRaw;

  // Live queue display — bottom-anchored input box that shows what the
  // user has typed into the queue. Activate immediately so the box is
  // present from the start of streaming, even when empty. Skip entirely
  // in screen-reader mode: NVDA / JAWS read every cursor move as fresh
  // content, which makes a live-updating widget far worse than silent.
  const liveBoxActive = !screenReader && liveQueue.activate();

  // Steer/cancel (Ctrl+G mid-stream cancel). Caller registers a handler via
  // onSteer(); we invoke it when 0x07 (BEL / Ctrl+G) arrives during
  // suppression. The handler is responsible for aborting the active
  // stream; queued type-ahead is restored at the prompt.
  let steerHandler: (() => void) | null = null;

  // Snapshot non-tagged keypress listeners. These are the ones we toggle
  // on suppress/unsuppress; the tagged hotkey listener (F1–F10) stays
  // attached unconditionally so status keys work during streaming and
  // tool execution alike.
  const allKeypressListeners = stdin.listeners('keypress').slice() as TaggedListener[];
  const togglableListeners = allKeypressListeners.filter((l) => !l.__grawkusHotkey__);

  let detached = false;

  function suppress(): void {
    if (detached) return;
    for (const l of togglableListeners) stdin.removeListener('keypress', l);
    detached = true;
  }
  function unsuppress(): void {
    if (!detached) return;
    for (const l of togglableListeners) stdin.on('keypress', l);
    detached = false;
  }

  // Queued-input buffer (Codex audit "queued_user_messages"). Instead of
  // dropping typed chars during streaming, collect printable ones so we
  // can pre-fill them into the NEXT prompt when the chain ends. The user
  // can keep typing their next request while the current one's still
  // working — it appears at the prompt ready to send or edit.
  //
  // Heuristic to avoid garbage from terminal escapes: collect printable
  // ASCII plus Enter, handle backspace locally, and drop multi-byte
  // escape sequences like arrows / function keys without corrupting the
  // queued draft.
  const queued: number[] = [];

  const dataHandler = (chunk: Buffer): void => {
    if (chunk[0] === 0x03) {
      try { stdin.setRawMode(false); } catch { /* noop */ }
      liveQueue.deactivate();
      process.exit(0);
    }
    // Ctrl+G (BEL, 0x07) -> cancel trigger. Fires the registered handler
    // which aborts the active stream; the queued buffer is restored into
    // the next prompt. Doesn't append the 0x07 itself to the queue.
    if (chunk[0] === 0x07 && detached) {
      if (steerHandler) {
        try { steerHandler(); } catch { /* never break input on a steer error */ }
      }
      return;
    }
    if (detached && isTurnCancelKeySequence(chunk)) {
      if (steerHandler) {
        try { steerHandler(); } catch { /* never break input on a cancel error */ }
      }
      return;
    }
    // Esc (0x1B) → Steer trigger, but only for a BARE Esc (chunk of
    // exactly one byte). Multi-byte chunks starting with 0x1B are ANSI
    // escape sequences for arrow keys / function keys / Alt+letter, and
    // arrive in raw mode as one contiguous chunk on every supported
    // terminal (xterm, iTerm, Windows Terminal, Alacritty, Kitty). The
    // length heuristic distinguishes them without a 50ms debounce.
    //
    // Esc and Ctrl+G are now aliases — Esc matches Claude Code + Codex
    // muscle memory, Ctrl+G is kept for existing users.
    if (chunk[0] === 0x1B && chunk.length === 1 && detached) {
      if (steerHandler) {
        try { steerHandler(); } catch { /* never break input on a steer error */ }
      }
      return;
    }
    // Windows Terminal and several xterm-compatible terminals encode
    // F5 / Shift+F5 as escape sequences. readline does not reliably
    // surface the shifted variant as key.name='f5' on Windows, so handle
    // the raw bytes here while input is suppressed. During an active turn,
    // bare F5 is also treated as cancel because dictation cannot sensibly
    // start while the model/tool chain owns stdin.
    if (detached && isTurnCancelKeySequence(chunk)) {
      if (steerHandler) {
        try { steerHandler(); } catch { /* never break input on a cancel error */ }
      }
      return;
    }
    if (!detached) return;          // only collect while we're suppressing
    const { mutated } = applyQueuedInputChunk(queued, chunk);
    // Refresh the live box with current buffer contents so the user
    // sees their typing in real time. Done lazily — only when mutated
    // — to avoid drawing on every random byte.
    if (mutated && liveBoxActive) {
      liveQueue.update(queuedInputBytesToText(queued));
    }
  };
  try { stdin.setRawMode(true); } catch { /* noop */ }
  stdin.on('data', dataHandler);
  stdin.resume();

  // Start suppressed — typing during model streaming is the default-block case
  suppress();

  return {
    pause: unsuppress,    // pause suppression = allow typing (for permission prompts)
    resume: suppress,     // resume suppression = block typing again
    drainQueuedInput: (): string => {
      return drainQueuedInputBytes(queued);
    },
    onSteer: (handler: () => void): void => {
      steerHandler = handler;
    },
    restore: () => {
      unsuppress();       // ensure listeners are back before we leave
      stdin.removeListener('data', dataHandler);
      try { stdin.setRawMode(wasRaw); } catch { /* noop */ }
      // Tear down the live queue box + restore default scroll region.
      // Idempotent; safe to call even if activation was skipped.
      liveQueue.deactivate();
    },
  };
}

/**
 * Validate tool arguments against the tool's JSON schema
 */
/**
 * F4 — Tool-call dedup fingerprint.
 *
 * Normalizes the raw JSON arguments before hashing so trivially-
 * different forms collapse to the same key:
 *
 *   - parsed + JSON.stringify with sorted keys (so {"a":1,"b":2} and
 *     {"b":2,"a":1} hash the same)
 *   - common path arguments (file_path, path, cwd, dir) normalized to
 *     forward-slashes and lowercased (catches `read /app/x.py` vs
 *     `read /APP/X.PY` vs `read \\app\\x.py`)
 *   - whitespace runs in `command` collapsed (catches `ls  -la` vs `ls -la`)
 *
 * Errors during parse fall through to a literal-string fingerprint —
 * worse than nothing? No: even a literal hash of the raw arg string
 * catches the most common case (model emits identical JSON twice).
 */
/**
 * StateAct — task-state block injected fresh each turn.
 *
 * Source: arxiv 2410.02810 ("StateAct: Enhancing LLM Base Agents via
 * Self-prompting and State-tracking"). Reports +10% over ReAct on
 * ALFWorld, +30% on TextCraft, +7% on WebShop. Zero added LLM calls.
 *
 * Mechanism: before each assistant turn, prepend a short structured
 * block summarizing (a) the ORIGINAL GOAL — re-injected as a
 * reminder, since long chains can drift away from the initial task,
 * and (b) RECENT ACTIONS — a compressed view of what tool calls
 * have been made so far. The model gets a fresh recap every turn
 * regardless of context drift.
 *
 * Directly attacks the failure mode observed on `run-pdp11-code`
 * (375K context, model wrote `gen_load.py` twice with identical
 * content because the earlier write had drifted out of attention).
 *
 * Implementation choices:
 *   - State block is a `system` role message inserted AFTER the main
 *     system prompt (so the latter stays cacheable) but BEFORE the
 *     message history. The model interprets it as ambient context.
 *   - Action list shows only the last N actions to keep the block
 *     short. Older actions are summarized in the conversation
 *     history itself (and increasingly masked by F2 observation
 *     masking).
 *   - The block is regenerated EVERY turn from current messages.
 *     Not persisted; it's purely a derived view.
 *   - Skipped on very short chains (< 3 messages) where there's
 *     nothing to recap.
 *   - Opt-out via GRAWKUS_STATE_BLOCK=0.
 */
const STATE_BLOCK_RECENT_ACTIONS = 8;
const STATE_BLOCK_GOAL_MAX_CHARS = 400;

export function buildStateBlock(messages: Message[]): string | null {
  if (process.env.GRAWKUS_STATE_BLOCK === '0') return null;
  if (messages.length < 3) return null;

  // GOAL = the first user-role message. This is the original task
  // instruction from the harness or human. Re-inject it so the model
  // can't drift even when the user message has scrolled far up.
  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return null;
  const goal = firstUser.content.replace(/\s+/g, ' ').trim().slice(0, STATE_BLOCK_GOAL_MAX_CHARS);
  if (!goal) return null;

  // RECENT ACTIONS = each tool_call the assistant has emitted so
  // far, flattened. We don't include results (those are in the
  // message history); we just track WHAT was attempted. The model
  // uses this to avoid redoing completed work.
  type Action = { tool: string; argsPreview: string };
  const actions: Action[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const calls = (m as Message & { tool_calls?: Array<{ function: { name: string; arguments: string } }> }).tool_calls;
    if (!calls) continue;
    for (const tc of calls) {
      const argsRaw = String(tc.function.arguments ?? '');
      const compact = argsRaw.replace(/\s+/g, ' ').slice(0, 80);
      actions.push({ tool: tc.function.name, argsPreview: compact });
    }
  }
  if (actions.length === 0) return null;

  const recent = actions.slice(-STATE_BLOCK_RECENT_ACTIONS);
  const olderCount = actions.length - recent.length;

  const lines: string[] = [
    '<task_state>',
    `Original goal: ${goal}${goal.length >= STATE_BLOCK_GOAL_MAX_CHARS ? '\u2026' : ''}`,
    `Actions completed: ${actions.length}`,
  ];
  if (olderCount > 0) {
    lines.push(`Recent ${recent.length} (${olderCount} earlier omitted):`);
  } else {
    lines.push(`Actions:`);
  }
  recent.forEach((a, i) => {
    lines.push(`  ${i + 1}. ${a.tool}(${a.argsPreview}${a.argsPreview.length >= 80 ? '\u2026' : ''})`);
  });
  lines.push('');
  lines.push('Stay focused on the goal. Do not re-issue actions you have already completed — refer to their results in the conversation above.');
  lines.push('</task_state>');
  return lines.join('\n');
}

/**
 * F2 — Observation Window Masking.
 *
 * Source: arxiv 2508.21433 ("The Complexity Trap: Simple Observation
 * Masking Is as Efficient as LLM Summarization for Agent Context
 * Management"). Cuts token cost ~50% on long agent loops while
 * matching or beating LLM-summarization solve rates — at ZERO extra
 * inference cost.
 *
 * Strategy: keep the last MASKING_WINDOW tool-result messages in
 * full. For older tool-results, replace `content` with a short stub
 * indicating what was there. The stub preserves `role` and
 * `tool_call_id` so the OpenAI message-schema invariants are not
 * violated.
 *
 * We DO NOT mask:
 *   - assistant turns (the reasoning chain stays intact)
 *   - user turns (task instruction + DeCRIM critique prompts)
 *   - system messages (priming + mode)
 *
 * Only `role === 'tool'` messages are masked, because the paper's
 * empirical finding is that ~84% of token cost is tool observations
 * and the model rarely needs the old verbatim output to make the
 * next decision — it needs the current state. The reasoning trace
 * across assistant turns carries the necessary memory.
 *
 * Tunable: MASKING_WINDOW = 12 (last 12 tool-results stay verbatim).
 * Conservative for our model class — the paper's Qwen3-32B run
 * regressed -11.8% with overly aggressive masking, while Gemini-Flash
 * gained +8.5%. Deepseek-v4-flash is in that capability band, so we
 * pick a generous window. Override with GRAWKUS_MASK_WINDOW.
 *
 * Threshold: we only bother masking when the total estimated payload
 * exceeds ~60K characters (rough proxy for ~15K tokens). Below that,
 * masking adds noise without saving anything material.
 */
/**
 * GoalAct-style global planning block.
 *
 * Source: arxiv 2504.16563 ("Enhancing LLM-Based Agents via Global
 * Planning and Hierarchical Execution") and the later HiPlan line of
 * global-local planning work. This is intentionally not another LLM call:
 * it derives coarse phase signals from the transcript and injects a small
 * planning policy before each turn.
 */
export function buildGlobalPlanBlock(messages: Message[]): string | null {
  if (process.env.GRAWKUS_GLOBAL_PLAN === '0') return null;

  const firstUser = messages.find((m) => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return null;
  const goal = firstUser.content.replace(/\s+/g, ' ').trim();
  if (!goal) return null;

  const actions = collectPlanActions(messages);
  const complexEnough = isComplexGoal(goal) || actions.total >= 2;
  if (!complexEnough) return null;

  const phase = inferPlanPhase(actions);
  const nextMove = recommendNextMove(actions, phase);
  const signals = [
    `inspect=${actions.inspect}`,
    `research=${actions.research}`,
    `edit=${actions.edit}`,
    `execute=${actions.execute}`,
    `verify=${actions.verify}`,
    `errors=${actions.errors}`,
  ].join(', ');

  return [
    '<global_plan>',
    `Current phase: ${phase}`,
    `Progress signals: ${signals}`,
    `Next best move: ${nextMove}`,
    'Execution policy:',
    '  1. Keep a 3-7 step plan in working memory and update it after each tool result.',
    '  2. Work on one active subgoal at a time; avoid branching into unrelated tasks.',
    '  3. Prefer inspect -> edit -> verify -> summarize. After edits, run the narrowest useful verification.',
    '  4. If a command fails or times out, change strategy instead of retrying the same call.',
    '</global_plan>',
  ].join('\n');
}

interface PlanActions {
  total: number;
  inspect: number;
  research: number;
  edit: number;
  execute: number;
  verify: number;
  errors: number;
}

function collectPlanActions(messages: Message[]): PlanActions {
  const actions: PlanActions = {
    total: 0,
    inspect: 0,
    research: 0,
    edit: 0,
    execute: 0,
    verify: 0,
    errors: 0,
  };

  for (const m of messages) {
    if (m.role === 'assistant' && m.tool_calls) {
      for (const tc of m.tool_calls) {
        actions.total++;
        const name = tc.function.name;
        const args = String(tc.function.arguments ?? '');
        if (isInspectTool(name)) actions.inspect++;
        if (isResearchTool(name)) actions.research++;
        if (isEditTool(name)) actions.edit++;
        if (name === 'bash') actions.execute++;
        if (isVerificationToolCall(name, args)) actions.verify++;
      }
    }
    if (m.role === 'tool' && typeof m.content === 'string' && isErrorObservation(m.content)) {
      actions.errors++;
    }
  }

  return actions;
}

function isComplexGoal(goal: string): boolean {
  const lower = goal.toLowerCase();
  if (goal.length >= 140) return true;
  return /\b(benchmark|leaderboard|architecture|refactor|debug|implement|integrate|migrate|optimi[sz]e|research|verify|multi-step|end-to-end|capabilit(?:y|ies))\b/.test(lower);
}

function isInspectTool(name: string): boolean {
  return ['read_file', 'grep', 'glob', 'list_dir', 'benchmark_context', 'memory_search', 'memory_recall', 'skill_view', 'todo_write'].includes(name);
}

function isResearchTool(name: string): boolean {
  return ['web_search', 'web_fetch', 'research_sources', 'benchmark_repo_catalog', 'github_repo_digest'].includes(name);
}

function isEditTool(name: string): boolean {
  return ['write_file', 'edit_file', 'apply_patch'].includes(name);
}

export function isVerificationToolCall(name: string, rawArgs: string): boolean {
  if (name !== 'bash') return false;
  let command = rawArgs;
  try {
    const parsed = JSON.parse(rawArgs) as { command?: unknown };
    if (typeof parsed.command === 'string') command = parsed.command;
  } catch {
    /* use raw args */
  }
  return /\b(npm\s+(run\s+)?(test|build|lint|check)|pnpm\s+(test|build|lint)|yarn\s+(test|build|lint)|vitest|jest|pytest|ruff|mypy|tsc|cargo\s+(test|build|check)|go\s+test|dotnet\s+test|gradle\s+test|mvn\s+test)\b/i.test(command);
}

export function editedTargetsFromToolCall(toolName: string, rawArgs: string): string[] {
  if (!isEditTool(toolName)) return [];
  try {
    const parsed = JSON.parse(rawArgs ?? '{}') as Record<string, unknown>;
    if (typeof parsed.file_path === 'string') return [parsed.file_path];
    if (typeof parsed.path === 'string') return [parsed.path];
    if (toolName === 'apply_patch' && typeof parsed.patch === 'string') {
      const targets: string[] = [];
      const re = /^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm;
      let match: RegExpExecArray | null;
      while ((match = re.exec(parsed.patch)) !== null) {
        targets.push(match[1].trim());
      }
      const moveRe = /^\*\*\* Move to: (.+)$/gm;
      while ((match = moveRe.exec(parsed.patch)) !== null) {
        targets.push(match[1].trim());
      }
      return Array.from(new Set(targets)).slice(0, 20);
    }
  } catch {
    return [toolName];
  }
  return [toolName];
}

export interface FileEditState {
  key: string;
  displayPath: string;
  hash: string;
  sizeBytes: number;
}

function normalizeTrackedPath(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export function snapshotFileEditState(cwd: string, target: string): FileEditState | null {
  const displayPath = String(target ?? '').trim();
  if (!displayPath) return null;
  let absPath: string;
  try {
    absPath = resolveUserPath(cwd, displayPath);
    if (!existsSync(absPath)) return null;
    const stat = statSync(absPath);
    if (!stat.isFile()) return null;
    const data = readFileSync(absPath);
    return {
      key: normalizeTrackedPath(absPath),
      displayPath,
      hash: createHash('sha256').update(data).digest('hex'),
      sizeBytes: data.byteLength,
    };
  } catch {
    return null;
  }
}

export function snapshotFileEditStates(cwd: string, targets: Iterable<string>): Map<string, FileEditState> {
  const states = new Map<string, FileEditState>();
  for (const target of targets) {
    const state = snapshotFileEditState(cwd, target);
    if (state) states.set(state.key, state);
  }
  return states;
}

export function buildUnchangedFileEditReminder(
  filePath: string,
  reason: 'pre' | 'previous',
  sizeBytes: number,
): string {
  const signal = reason === 'pre'
    ? `Recovery signal: edit to "${filePath}" completed, but the file content hash is unchanged from before the edit.`
    : `Recovery signal: "${filePath}" was edited again, but its resulting content hash matches a previous successful edit.`;
  return [
    signal,
    `File size: ${sizeBytes} bytes.`,
    'Next move: do not rewrite/regenerate the same file unchanged. Inspect the current file, run the verifier, or change strategy before editing it again.',
  ].join('\n');
}

export function recordFileEditStates(
  cwd: string,
  targets: Iterable<string>,
  lastStates: Map<string, FileEditState>,
  beforeStates: Map<string, FileEditState> = new Map(),
): string[] {
  const reminders: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const current = snapshotFileEditState(cwd, target);
    if (!current || seen.has(current.key)) continue;
    seen.add(current.key);

    const before = beforeStates.get(current.key);
    const previous = lastStates.get(current.key);
    if (before?.hash === current.hash) {
      reminders.push(buildUnchangedFileEditReminder(current.displayPath, 'pre', current.sizeBytes));
    } else if (previous?.hash === current.hash) {
      reminders.push(buildUnchangedFileEditReminder(current.displayPath, 'previous', current.sizeBytes));
    }
    lastStates.set(current.key, current);
  }
  return reminders;
}

export function buildEditVerificationReminder(
  pendingFiles: Iterable<string>,
  editCount: number,
): string | null {
  const files = Array.from(new Set(Array.from(pendingFiles).map((f) => f.trim()).filter(Boolean)));
  if (files.length === 0 || editCount <= 0) return null;
  const shown = files.slice(0, 8);
  const extra = files.length > shown.length ? ` (+${files.length - shown.length} more)` : '';
  return [
    '<system-reminder>',
    `Verification needed: ${editCount} successful edit${editCount === 1 ? '' : 's'} have not been verified yet.`,
    `Changed files: ${shown.join(', ')}${extra}`,
    'Before a final answer, run the narrowest useful verification command with bash (test, build, typecheck, lint, or targeted script).',
    'If no automated verification exists, inspect the changed files or explain the concrete reason verification is unavailable.',
    '</system-reminder>',
  ].join('\n');
}

function isErrorObservation(content: string): boolean {
  return /(^|\n)(error:|blocked by|permission denied|command timed out|\[command exited with error|failed\b)/i.test(content);
}

function inferPlanPhase(actions: PlanActions): string {
  if (actions.errors > 0 && actions.verify > 0) return 'diagnose failing verification';
  if (actions.edit > 0 && actions.verify === 0) return 'verify edits';
  if (actions.edit > 0 && actions.verify > 0) return 'refine or summarize';
  if (actions.inspect > 0 || actions.research > 0) return 'inspect and choose edit';
  return 'orient and plan';
}

function recommendNextMove(actions: PlanActions, phase: string): string {
  if (phase === 'diagnose failing verification') {
    return 'read the failing output, inspect the implicated files, then make the smallest targeted fix';
  }
  if (phase === 'verify edits') {
    return 'run the narrowest relevant test/build/check before declaring completion';
  }
  if (phase === 'refine or summarize') {
    return 'if verification passed, summarize concrete evidence; if not, fix the remaining failure';
  }
  if (actions.inspect === 0 && actions.research === 0) {
    return 'inspect the repository and identify the files or commands that prove the next step';
  }
  return 'select one concrete edit or experiment that advances the original goal';
}

const MASKING_WINDOW_DEFAULT = 12;
const MASKING_TRIGGER_BYTES = 60_000;

export function maskOldToolResults(messages: Message[]): Message[] {
  const totalBytes = estimateMessageBytes(messages);
  if (totalBytes < MASKING_TRIGGER_BYTES) return messages;

  const window = Math.max(
    1,
    parseInt(process.env.GRAWKUS_MASK_WINDOW ?? '', 10) || MASKING_WINDOW_DEFAULT,
  );

  // Find indices of tool-result messages (newest first).
  const toolIdxs: number[] = [];
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'tool') {
      toolIdxs.push(i);
    }
  }

  // Keep the most-recent `window` tool results untouched; mask the rest.
  const toMask = new Set(toolIdxs.slice(window));
  if (toMask.size === 0) return messages;

  // Build a new array. Original messages are not mutated.
  return messages.map((m, i) => {
    if (!toMask.has(i)) return m;
    const original = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    const stub = `[older tool output omitted — ${original.length} chars; re-run the tool if you need the content]`;
    return { ...m, content: stub };
  });
}

function estimateMessageBytes(messages: Message[]): number {
  let total = 0;
  for (const m of messages) {
    if (typeof m.content === 'string') {
      total += m.content.length;
    } else if (m.content) {
      try {
        total += JSON.stringify(m.content).length;
      } catch {
        /* noop */
      }
    }
  }
  return total;
}

/**
 * F5+ DeCRIM 3-stage critique prompts.
 *
 * Each prompt is designed to do exactly one job, in sequence:
 *
 *   decompose — Forces the model to extract requirements from the
 *               ORIGINAL task before judging its own work. This is
 *               the leverage point: the model can't bypass an
 *               implicit requirement if it has to name it.
 *
 *   critique  — Per-item PASS/FAIL with concrete evidence required.
 *               Asking for evidence ("file path", "command output",
 *               "test result") is much harder to fake than the
 *               generic "have you accomplished what was asked?".
 *
 *   refine    — Only the FAIL items get redone, plus any items
 *               whose PASS evidence the model now thinks was weak.
 *               If everything is solid, the model exits naturally.
 *
 * The phrasing deliberately includes "be honest" / "the user prefers
 * honest failures over confident lies" — research on prompted self-
 * criticism shows this kind of social-cost signaling reduces the
 * self-confirmation bias that otherwise dominates weak-model
 * critique. (Reflexion-style "just reflect on your work" prompts
 * have been shown to degrade weak models — generic self-questioning
 * without concrete structure produces overconfident revisions.)
 */
export function critiquePromptFor(stage: 'decompose' | 'critique' | 'refine'): string {
  if (stage === 'decompose') {
    return (
      'Before you finalize: re-read the ORIGINAL task description (the very first user message in this conversation).\n\n' +
      'List every concrete verifiable requirement it contains, as a numbered Markdown list. For each item:\n' +
      '  - Quote the exact words from the task that express the requirement, where possible.\n' +
      '  - Note how a third party could verify the requirement is met (which file would they check? which command would they run? what output would they look for?).\n' +
      '  - Call out exact file names, exact output paths, output wording/sections, service/process names, long-running service expectations, and any required runtime/toolchain behavior.\n\n' +
      'Be exhaustive. Include format requirements, file names, output paths, output structure, environment/toolchain constraints, network/offline assumptions, and any "should also" clauses. ' +
      'Do not paraphrase — quote. Do not add requirements the task did not state. ' +
      'This list is just for grounding; you will judge each item in the next step.'
    );
  }
  if (stage === 'critique') {
    return (
      'Now judge each item from your checklist: did you actually satisfy it?\n\n' +
      'Format your answer as:\n' +
      '  1. [requirement quote] → PASS | FAIL\n' +
      '     evidence: [specific file path you created, command output you observed, test that passed, etc.]\n\n' +
      'Rules:\n' +
      '  - Mark PASS only if you have concrete evidence right now (a file on disk, an output you can paste).\n' +
      '  - "I implemented it" is NOT evidence. "I ran `ls /app/x.txt` and the file exists, with content `Hello`" IS evidence.\n' +
      '  - "It should work" is NOT evidence. "I ran the failing command and it now exits 0" IS evidence.\n' +
      '  - Check that your evidence used the project/runtime the task will use: package manager, virtualenv/interpreter, compiler, network/offline state, working directory, and relevant service process state.\n' +
      '  - If the task needs a server or daemon to keep running after you finish, verify it was launched persistently (not only `cmd &` inside a short-lived shell).\n' +
      '  - If you skipped a step, mark FAIL.\n' +
      '  - If you are uncertain, mark FAIL.\n\n' +
      'Be honest. The user prefers an honest "I left these 2 items undone" over a confident "all done" that fails the test. ' +
      'A FAIL here is fixable in the next step; a falsely-claimed PASS is not.'
    );
  }
  return (
    'For each FAIL item above, do the work to make it pass. Use the tools available.\n\n' +
    'Also revisit any PASS items where, on reflection, your evidence was weak — re-verify those.\n\n' +
    'If the failure is about environment mismatch, verify with the project-native toolchain (for example uv/npm/cargo/go test, the selected Python interpreter, or the configured working directory). ' +
    'If the failure is about a long-running service, launch it with a persistent mechanism such as `nohup ... & disown` or a detached tmux session, then verify the process/port is still alive.\n\n' +
    'If after the work all items are now genuinely PASS with concrete evidence, briefly summarize what you did and stop. ' +
    'Otherwise, keep working until every item is honestly PASS.'
  );
}

export function minimumToolCallsBeforeDone(mode: Mode, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GRAWKUS_MIN_TOOL_CALLS_BEFORE_DONE;
  if (raw && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
  }
  // Only benchmark mode enforces a minimum tool-call gate.
  // All other modes let the model finish whenever it decides to.
  return mode === 'benchmark' ? 2 : 0;
}

export function buildEmptyEngagementReminder(toolCallCount: number, minToolCalls: number, mode: Mode): string {
  const plural = minToolCalls === 1 ? '' : 's';
  return [
    'Your previous response attempted to finish without enough concrete tool work.',
    `Observed tool calls this chain: ${toolCallCount}. Minimum expected before finalizing in ${mode} mode: ${minToolCalls} tool call${plural}.`,
    '',
    'Before finalizing, do concrete work with the available tools unless the original task is purely answer-only:',
    '  1. Re-read the original task and identify the next concrete file, command, environment, or service check.',
    '  2. Use tools to inspect, edit, run, or verify. Do not only describe what should be done.',
    '  3. If no tool can possibly apply, explicitly explain why the task is answer-only and provide the final answer.',
  ].join('\n');
}

export function dedupFingerprint(toolName: string, rawArgs: string): string {
  let normalized: string;
  try {
    const parsed = JSON.parse(rawArgs ?? '{}');
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      // Normalize commonly-pathy fields
      for (const k of ['file_path', 'path', 'cwd', 'dir', 'directory']) {
        if (typeof obj[k] === 'string') {
          obj[k] = (obj[k] as string).replace(/\\/g, '/').toLowerCase();
        }
      }
      // Collapse whitespace in shell commands so `ls -la` and `ls  -la` match
      if (typeof obj.command === 'string') {
        obj.command = (obj.command as string).replace(/\s+/g, ' ').trim();
      }
      // Sorted-key serialization
      const keys = Object.keys(obj).sort();
      normalized = JSON.stringify(obj, keys);
    } else {
      normalized = JSON.stringify(parsed);
    }
  } catch {
    normalized = String(rawArgs ?? '');
  }
  return `${toolName}::${normalized}`;
}

type RecoveryReason = 'repeat' | 'timeout';

const RECOVERY_SNIPPET_CHARS = 500;
const RECOVERY_REMINDER_LIMIT = 3;

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateMiddle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  const head = Math.floor(maxChars * 0.55);
  const tail = maxChars - head - 15;
  return `${value.slice(0, head)} ...[truncated]... ${value.slice(-tail)}`;
}

function summarizeToolArgs(toolName: string, rawArgs: string): string {
  try {
    const parsed = JSON.parse(rawArgs ?? '{}') as Record<string, unknown>;
    if (toolName === 'bash' && typeof parsed.command === 'string') {
      return `$ ${truncateMiddle(oneLine(parsed.command), 220)}`;
    }
    for (const key of ['file_path', 'path', 'query', 'pattern', 'url']) {
      if (typeof parsed[key] === 'string') {
        return `${key}=${truncateMiddle(oneLine(parsed[key]), 220)}`;
      }
    }
    return truncateMiddle(oneLine(JSON.stringify(parsed)), 220);
  } catch {
    return truncateMiddle(oneLine(String(rawArgs ?? '')), 220);
  }
}

export function isTimeoutObservation(content: string): boolean {
  return /\b(command\s+timed\s+out\s+after|timed\s+out\s+waiting|operation\s+timed\s+out|timeout\s+after)\b/i
    .test(content);
}

export function buildRecoveryReminder(
  toolName: string,
  rawArgs: string,
  toolResultContent: string,
  reason: RecoveryReason = 'repeat',
): string {
  const args = summarizeToolArgs(toolName, rawArgs);
  const snippet = truncateMiddle(oneLine(String(toolResultContent ?? '')), RECOVERY_SNIPPET_CHARS);
  const action =
    reason === 'timeout'
      ? 'Do not rerun the same long command unchanged. Break it into a narrower command, inspect a smaller log/file range, run a background process and poll it, or increase timeout only when the long runtime is expected.'
      : 'Do not retry the same call unchanged. Use the fresh result, change the arguments substantively, inspect a narrower target, or switch tools.';

  return [
    reason === 'timeout'
      ? `Recovery signal: ${toolName} timed out.`
      : `Recovery signal: the same ${toolName} call was re-issued.`,
    `Arguments: ${args}`,
    snippet ? `Previous result snippet: ${snippet}` : null,
    `Next move: ${action}`,
  ].filter((line): line is string => Boolean(line)).join('\n');
}

function buildRecoveryReminderBlock(reminders: string[]): string | null {
  const unique = Array.from(new Set(reminders.map((r) => r.trim()).filter(Boolean)));
  if (unique.length === 0) return null;
  return [
    '<system-reminder>',
    'Recovery signals from recent tool use:',
    ...unique.slice(-RECOVERY_REMINDER_LIMIT).map((reminder, i) => {
      const indented = reminder.split('\n').map((line) => `  ${line}`).join('\n');
      return `${i + 1}. ${indented.trimStart()}`;
    }),
    'Before the next tool call, change strategy if the previous action repeated, timed out, or failed.',
    '</system-reminder>',
  ].join('\n');
}

/**
 * F4 — Rewrite stale duplicate tool-result messages in place.
 *
 * Called once per tool-execution batch. For each call whose
 * fingerprint we've seen before in this chain, find the previous
 * tool-result message and replace its `content` with a 1-line stub
 * pointing at the newer message. The new result stays untouched so
 * the model's next turn reads complete, fresh data.
 *
 * NOT called for the FIRST occurrence of a fingerprint — only when
 * a repeat fires. So a one-time `read` of a file is never touched.
 *
 * The map is keyed by fingerprint → array-index of the tool result
 * in ctx.messages. We update the index to the newest occurrence after
 * each rewrite, so the NEXT repeat collapses the second one (not the
 * first, which is already stubbed).
 */
export function dedupRepeatedToolCalls(
  messages: Message[],
  toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[],
  toolResults: Message[],
  dedupMap: Map<string, number>,
): string[] {
  const reminders: string[] = [];
  // Build a quick lookup from tool_call_id → freshly-appended message index.
  // toolResults are the LAST toolResults.length entries of messages.
  const newResultIndexById = new Map<string, number>();
  const firstNewIdx = messages.length - toolResults.length;
  for (let i = 0; i < toolResults.length; i++) {
    const m = toolResults[i] as Message & { tool_call_id?: string };
    if (m.tool_call_id) newResultIndexById.set(m.tool_call_id, firstNewIdx + i);
  }

  for (const tc of toolCalls) {
    const fp = dedupFingerprint(tc.function.name, tc.function.arguments);
    const newIdx = newResultIndexById.get(tc.id);
    if (newIdx === undefined) continue;
    const priorIdx = dedupMap.get(fp);
    if (priorIdx !== undefined && priorIdx !== newIdx) {
      const prior = messages[priorIdx];
      if (prior && prior.role === 'tool' && typeof prior.content === 'string') {
        const wasBytes = prior.content.length;
        // Keep the prior message structurally valid for the API
        // (role + tool_call_id stay; only content shrinks).
        prior.content =
          `[deduped — same ${tc.function.name} call was re-issued; ` +
          `see the fresh result later in this conversation. ` +
          `Original was ${wasBytes} bytes.]`;
        const fresh = messages[newIdx];
        if (fresh && fresh.role === 'tool' && typeof fresh.content === 'string') {
          reminders.push(buildRecoveryReminder(
            tc.function.name,
            tc.function.arguments,
            fresh.content,
            'repeat',
          ));
        }
      }
    }
    // Point the fingerprint at the NEWEST occurrence so future
    // repeats collapse the second one, not the (already-stubbed) first.
    dedupMap.set(fp, newIdx);
  }
  return reminders;
}

function validateToolArguments(tool: Tool, input: Record<string, unknown>): { valid: boolean; error?: string } {
  const schema = tool.parameters as unknown as Record<string, unknown>;
  const required = (schema.required as string[]) || [];
  const properties = (schema.properties as Record<string, unknown>) || {};

  // Check required parameters exist
  for (const param of required) {
    if (!(param in input)) {
      return { valid: false, error: `Missing required parameter: ${param}` };
    }
  }

  // Basic type checking for parameters that are specified
  for (const [key, value] of Object.entries(input)) {
    if (key in properties) {
      const propSchema = (properties[key] as Record<string, unknown>) || {};
      const expectedType = propSchema.type as string;

      if (expectedType === 'string' && typeof value !== 'string') {
        return { valid: false, error: `Parameter ${key} must be a string` };
      }
      if (expectedType === 'number' && typeof value !== 'number') {
        return { valid: false, error: `Parameter ${key} must be a number` };
      }
      if (expectedType === 'boolean' && typeof value !== 'boolean') {
        return { valid: false, error: `Parameter ${key} must be a boolean` };
      }
      if (expectedType === 'object' && typeof value !== 'object') {
        return { valid: false, error: `Parameter ${key} must be an object` };
      }
    }
  }

  return { valid: true };
}

/**
 * Main query loop: sends messages to the API, handles tool calls, loops until done.
 */
export async function runQuery(ctx: QueryContext): Promise<void> {
  // Per-chain turn cap. Default is Infinity — the loop runs until the
  // model stops calling tools, or the user cancels (Esc / Ctrl+G /
  // Shift+F5 / Ctrl+C), or the stream loop detector fires. Set
  // ctx.config.maxTurns to a finite number if you want a hard safety
  // cap (useful for unattended sessions). A previous hard-coded 50
  // cap was cutting off legitimate long scaffolding chains; the
  // stream-loop detector + per-turn cost line + Esc cancel are the
  // real defenses against runaways.
  const maxTurns = typeof ctx.config.maxTurns === 'number' && ctx.config.maxTurns > 0
    ? ctx.config.maxTurns
    : Infinity;
  let turns = 0;
  // Track total wall time for this response chain (user message →
  // assistant ending without a tool call). Printed once when the loop exits.
  const chainStart = Date.now();
  const initialLastUserMsg = [...ctx.messages].reverse().find((m) => m.role === 'user');
  const initialUserQuery = typeof initialLastUserMsg?.content === 'string' ? initialLastUserMsg.content : undefined;
  const chainFastDirect = shouldUseFastDirectReply(
    initialUserQuery,
    ctx.mode,
    hasPriorAssistantContext(ctx.messages),
  );

  // ── Voice: echo the user's input in the user-echo voice ────
  // Run async without awaiting — we don't want to block the API call on
  // ElevenLabs latency. The echo will play while the model is thinking.
  if (isVoiceEnabled(ctx.config) && getTtsConfig(ctx.config).echoUser) {
    const text = initialUserQuery || '';
    if (text) speakUserEcho(text, ctx.config).catch(() => { /* noop */ });
  }

  // Track the accumulated assistant text across the whole chain so we can
  // TTS it (or its summary) once the chain ends. We collect text from every
  // assistant turn, but the final TTS pass only fires after the no-tool-call
  // exit so tool descriptions aren't read out.
  let accumulatedAssistantText = '';

  // Auto-fallback: when the primary model returns a cryptic / unknown
  // provider error (common for free experimental models like
  // openrouter/owl-alpha which returns literally "ERROR" or "Provider
  // returned error"), we transparently retry the SAME turn once with the
  // user's configured fallbackModel. After we use it, this latches so we
  // don't bounce back and forth between failing models in a single chain.
  let usedFallbackModel = false;
  // Reliability path when fallback is intentionally disabled:
  // retry the SAME configured model once on transient empty/timeout/unknown
  // provider failures before surfacing a hard error.
  let usedPrimaryRetry = false;
  const retryPrimaryModelOnce = (reason: string): boolean => {
    if (usedPrimaryRetry) return false;
    usedPrimaryRetry = true;
    const model = ctx.config.model;
    resetClient();
    console.log(theme.warning(
      `  ${sym.warn} ${reason} — retrying once on the same model ${model}.`,
    ));
    console.log(theme.dim('    Fallback is disabled; this is a transient-recovery retry only.'));
    turns--;
    return true;
  };

  // Tracks whether ANY reasoning tokens arrived across the entire chain.
  // Used at chain-end to print a one-time "/thinking is ON but this model
  // doesn't emit reasoning" hint. Hoisted to chain scope (not per-turn)
  // because we only care about "in this whole exchange did we see any
  // reasoning at all".
  let sawAnyThinking = false;

  // Skill-graduation telemetry. The Sentience audit's deterministic rule
  // for "this work was worth remembering" — the model is a bad judge of
  // its own complexity, so the dispatcher counts and decides. Thresholds:
  //   - 5+ tool calls in this chain   → complex task
  //   - any tool errored then recovered → learned-from-failure
  // Only used to inform a chain-end suggestion in sentience mode; we don't
  // auto-create skills (which would burn an extra LLM call). We surface
  // the opportunity with a one-line nudge so the user can /skill-create
  // or /learn if they want.
  const chainStats: ChainStats = {
    toolCallCount: 0,
    sawToolError: false,
    sawToolRecovery: false,
    toolCallErrorCounts: new Map<string, number>(),
    toolParseFailureStreaks: new Map<string, number>(),
    toolCallLoopDetected: false,
    recoveryReminders: [],
    fileEditStates: new Map<string, FileEditState>(),
    pendingEditFiles: new Set<string>(),
    editCountSinceVerification: 0,
    verificationAttemptedSinceEdit: false,
    verificationGatePrompted: false,
    emptyEngagementPrompted: false,
    benchmarkTrajectoryGatePrompted: false,
    benchmarkTraceEvents: [],
    benchmarkUsageEvents: [],
  };

  // ── F4: Tool-call dedup map (chain-scope) ──
  //
  // Hash of (tool_name, normalized_args) → message-index where that
  // tool call's *result* lives in ctx.messages. When the same
  // fingerprint fires a second time, we rewrite the OLDER tool-result
  // message in place to a 1-line stub pointing at the newer one. The
  // new result is preserved so the model can read the live data; only
  // the stale duplicate gets collapsed.
  //
  // Why this matters: terminal-bench tasks routinely re-read the same
  // files / re-grep for the same patterns / re-list the same directory
  // 3-5 times across a chain. Each verbatim re-read costs 1-30K tokens
  // of context. After the rewrite, ctx token cost on the repeated read
  // drops from N to ~20.
  //
  // Different from the existing toolCallErrorCounts loop detector —
  // that one counts CONSECUTIVE ERRORS and aborts. This one runs on
  // SUCCESSFUL repeats and just rewrites stale messages. They compose.
  const toolCallDedupMap = new Map<string, number>();
  let contextCapNoticeCount = 0;
  let chainUsedFastDirect = chainFastDirect;

  // ── F5+: DeCRIM 3-stage self-critique gate ──
  //
  // Replaces v1.34.0's single-shot critique with a three-stage
  // decompose-critique-refine pipeline (arxiv 2410.06458). Each
  // stage fires when the model tries to emit a no-tool-call "done"
  // turn — we inject a stage-specific prompt and let the loop
  // continue. The model can do further tool work inside any stage;
  // we only advance to the next stage when it next tries to declare
  // done.
  //
  // The three stages:
  //   1. DECOMPOSE — list every concrete verifiable requirement
  //      from the original task as a numbered checklist
  //   2. CRITIQUE  — mark PASS or FAIL per item with concrete
  //      evidence (file path, command output, test result)
  //   3. REFINE    — for each FAIL, do the missing work; if all
  //      genuinely PASS, summarize and stop
  //
  // DeCRIM showed +7-8 points on IFEval and RealInstruct with
  // Mistral-7B as the prompted model. Our model class is similar.
  //
  // Why three stages instead of one: the original v1.34.0 single
  // prompt asked the model to "verify against concrete evidence" —
  // generic. A model already confident it's done will just confirm
  // itself. The DeCRIM split forces the model to FIRST enumerate
  // requirements separately from its own work, THEN judge each one
  // independently. The decomposition step is the leverage point —
  // it surfaces requirements the model implicitly skipped.
  //
  // Capped at one full pass per chain. Once all 3 stages have fired,
  // the gate is exhausted and the next "no tool calls" turn breaks
  // out of the loop normally.
  //
  // Off by default in REPL (the human is there to push back); ON
  // in non-interactive mode (`--prompt` / harness-driven runs)
  // where there's nobody to course-correct.
  type CritiqueStage = 'decompose' | 'critique' | 'refine';
  const CRITIQUE_STAGES: CritiqueStage[] = ['decompose', 'critique', 'refine'];
  let critiqueStageIdx = 0;
  const selfCritiqueEnabled = process.env.GRAWKUS_NON_INTERACTIVE === '1'
    && process.env.GRAWKUS_SELF_CRITIQUE !== '0';

  // Input suppression spans the entire chain: model streaming AND tool
  // execution. executeToolCalls calls inputGuard.pause()/resume() around
  // permission prompts so rl.question() can still read user input. Final
  // teardown happens in the finally block at the bottom of runQuery so
  // the guard is always cleaned up even if something throws unexpectedly.
  //
  // Pass the screen-reader flag through — when on, suppressInputDuringStream
  // skips the live queue box (NVDA/JAWS would re-read every cursor move
  // as new text, drowning the actual response).
  const isScreenReader = ctx.config.voice?.accessibility?.screenReader === true;
  ensureTurnFooterActive(ctx, isScreenReader);
  const inputGuard = startInputSuppression(isScreenReader);
  let earlyWorkingIndicator: WorkingIndicator | null = null;
  try {
    if (!chainFastDirect) {
      printInteractiveTurnAccepted(ctx.config);
      earlyWorkingIndicator = startWorkingIndicator(chainStart, isScreenReader, 0);
      // Turn-boundary collapse runs BEFORE compaction. Every completed prior
      // turn becomes [user, "<final text>\n[Completed: used X, Y]"] — the
      // model no longer sees stale tool_calls that it might mistake for
      // pending work (the "I'll handle BOTH requests" / "all THREE requests"
      // bug). The current turn (latest user message forward) is left intact
      // because its tool_calls and tool messages are still in flight.
      replaceMessagesInPlace(ctx.messages, collapseCompletedTurns(ctx.messages));

      // Auto-compact if context is getting large. The trigger scales with the
      // provider's context window so smaller/free-tier models get breathing room
      // before the hard context cap has to drop middle history. Short direct
      // prompts skip this entirely because their API request is isolated to the
      // current user message; compacting old history first defeats the fast path.
      const compactionConfig = buildCompactionConfig(ctx.config);
      if (shouldCompact(ctx.messages, compactionConfig)) {
        console.log(theme.dim(`  ${sym.running} auto-compacting conversation context...`));
        setStatus({ state: 'compacting' });
        replaceMessagesInPlace(
          ctx.messages,
          await compactMessages(ctx.messages, ctx.config, compactionConfig),
        );
      } else {
        // Quick compact: truncate oversized tool results
        replaceMessagesInPlace(ctx.messages, quickCompact(ctx.messages));
      }
    }

  // Tell the status singleton who we are. This is what F2 ("where am I?")
  // speaks back to the user. Updated once per chain — model/provider/mode
  // can't change mid-chain.
  setStatus({
    model: ctx.config.model,
    provider: ctx.config.provider,
    mode: ctx.mode,
    permissionMode: ctx.config.permissionMode,
  });

  while (turns < maxTurns) {
    turns++;

    // Get the last user message for context-aware system prompt
    const lastUserMsg = ctx.messages.filter((m) => m.role === 'user').pop();
    const userQuery = typeof lastUserMsg?.content === 'string' ? lastUserMsg.content : undefined;
    const fastDirect = turns === 1
      ? chainFastDirect
      : shouldUseFastDirectReply(userQuery, ctx.mode, hasPriorAssistantContext(ctx.messages));
    if (fastDirect) chainUsedFastDirect = true;

    // Build full messages array with system prompt.
    // F2 — Observation window masking: before sending to the model,
    // if our message history is large, mask older tool_result
    // contents with a short stub. Only the last MASKING_WINDOW tool
    // results stay verbatim. Stub keeps role + tool_call_id intact
    // so the API stays valid; only the content shrinks.
    if (!fastDirect) {
      replaceMessagesInPlace(ctx.messages, quickCompact(ctx.messages));
    }
    const requestTools = fastDirect
      ? []
      : applyAgentToolInstructions(ALL_TOOLS, ctx.cwd, ctx.config.model);
    const systemPrompt = fastDirect
      ? FAST_DIRECT_SYSTEM_PROMPT
      : buildSystemPrompt(ctx.config, ctx.cwd, ctx.mode, userQuery, requestTools);
    let visibleMessages = fastDirect
      ? (userQuery ? [{ role: 'user' as const, content: userQuery }] : [])
      : maskOldToolResults(ctx.messages);
    const cap = enforceContextCap(
      visibleMessages,
      contextCapTokens(inferContextWindowTokens(ctx.config)),
    );
    if (cap.changed) {
      visibleMessages = cap.messages;
      dbgEmit('info', 'context.cap-applied', {
        beforeTokens: cap.beforeTokens,
        afterTokens: cap.afterTokens,
        maxAllowedTokens: cap.maxAllowedTokens,
        droppedMessages: cap.droppedMessages,
      });
      if (contextCapNoticeCount < 3) {
        contextCapNoticeCount++;
        console.log(theme.dim(
          `  ${sym.running} context cap applied: ~${cap.beforeTokens.toLocaleString()} -> ` +
          `~${cap.afterTokens.toLocaleString()} tokens (${cap.droppedMessages} older messages omitted from this API call)`,
        ));
      }
    }
    // StateAct: inject a fresh task-state block as a system message
    // between the main system prompt and the conversation history.
    // The main system prompt stays first (cacheable); the state block
    // sits right after so the model sees it as ambient context for
    // the upcoming turn. Skipped on short chains or via env-var
    // override.
    const stateBlock = fastDirect ? null : buildStateBlock(visibleMessages);
    const runtimeInfoBlock = fastDirect ? null : buildRuntimeInfoBlock(ctx.cwd);
    const repoMapBlock = fastDirect || ctx.mode === 'design'
      ? null
      : buildAutoRepoMapBlock(ctx.cwd, userQuery);
    const globalPlanBlock = fastDirect ? null : buildGlobalPlanBlock(visibleMessages);
    const todoStateBlock = fastDirect ? null : buildTodoStateBlock(ctx.cwd);
    const benchmarkTrajectoryBlock = !fastDirect && ctx.mode === 'benchmark'
      ? buildBenchmarkTrajectorySystemBlock(chainStats.benchmarkTraceEvents, chainStats.benchmarkUsageEvents, visibleMessages)
      : null;
    const editVerificationBlock = !fastDirect && !chainStats.verificationAttemptedSinceEdit
      ? buildEditVerificationReminder(chainStats.pendingEditFiles, chainStats.editCountSinceVerification)
      : null;
    const recoveryReminderBlock = fastDirect ? null : buildRecoveryReminderBlock(chainStats.recoveryReminders);
    if (recoveryReminderBlock) {
      chainStats.recoveryReminders = [];
    }
    const apiMessages: Message[] = [
      { role: 'system', content: systemPrompt },
      ...(runtimeInfoBlock ? [{ role: 'system' as const, content: runtimeInfoBlock }] : []),
      ...(repoMapBlock ? [{ role: 'system' as const, content: repoMapBlock }] : []),
      ...(stateBlock ? [{ role: 'system' as const, content: stateBlock }] : []),
      ...(globalPlanBlock ? [{ role: 'system' as const, content: globalPlanBlock }] : []),
      ...(todoStateBlock ? [{ role: 'system' as const, content: todoStateBlock }] : []),
      ...(benchmarkTrajectoryBlock ? [{ role: 'system' as const, content: benchmarkTrajectoryBlock }] : []),
      ...(editVerificationBlock ? [{ role: 'system' as const, content: editVerificationBlock }] : []),
      ...(recoveryReminderBlock ? [{ role: 'system' as const, content: recoveryReminderBlock }] : []),
      ...visibleMessages,
    ];

    let fullText = '';
    let toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] | undefined;
    let hasOutput = false;
    let thinkingActive = false;
    let leadingTrimmed = false;        // strip leading whitespace from the model's first text chunk
    let assistantPrefixed = false;
    let lastCharWasNewline = false;    // collapse 3+ consecutive newlines down to 2
    let consecutiveNewlines = 0;

    const turnStart = Date.now();
    let usageRecorded = false;

    // Loop detection state: a stuck model can stream the SAME N-char
    // window of text 50+ times in a single API call (observed in the
    // wild with openrouter/owl-alpha emitting tool-call JSON as text).
    // We periodically check whether the most-recent tail occurs ≥3
    // times in the full stream; if so we abort the API call and warn
    // the user. checkpoint values are deliberately coarse — the cost
    // of one indexOf scan per ~500 chars of stream is negligible, the
    // cost of letting the loop run forever is a hung terminal.
    let nextLoopCheckAt = 800;        // first check after 800 chars
    const LOOP_WINDOW = 200;
    const LOOP_THRESHOLD = 3;
    let loopDetected = false;

    function writeStreamText(chunk: string): void {
      // Trim leading whitespace until the first non-whitespace character so
      // the model can't produce big vertical gaps before its real reply.
      let text = chunk;
      if (!leadingTrimmed) {
        text = text.replace(/^[\s\n]+/, '');
        if (text.length === 0) return; // entire chunk was leading whitespace
        leadingTrimmed = true;
      }
      // Collapse runs of 3+ newlines into 2 so the body of the response is
      // dense but still has paragraph breaks where the model intended them.
      let out = '';
      for (const ch of text) {
        if (ch === '\n') {
          consecutiveNewlines++;
          if (consecutiveNewlines <= 2) out += ch;
        } else {
          consecutiveNewlines = 0;
          out += ch;
        }
      }
      if (out.length === 0) return;
      lastCharWasNewline = out.endsWith('\n');
      if (!assistantPrefixed) {
        process.stdout.write(assistantTranscriptPrefix());
        assistantPrefixed = true;
      }
      process.stdout.write(theme.primary(out));
      fullText += out;

      // ── Loop detection ────────────────────────────────────
      // Once fullText crosses each checkpoint, scan: how many times
      // does the last LOOP_WINDOW chars appear in the full stream?
      // 3+ repeats = stuck. Abort and warn.
      if (!loopDetected && fullText.length >= nextLoopCheckAt && fullText.length > LOOP_WINDOW * LOOP_THRESHOLD) {
        nextLoopCheckAt = fullText.length + 500;
        const count = countTailRepetitions(fullText, LOOP_WINDOW, LOOP_THRESHOLD);
        if (count >= LOOP_THRESHOLD) {
          loopDetected = true;
          dbgEmit('info', 'stream.loop-detected', {
            windowSize: LOOP_WINDOW,
            occurrences: count,
            totalChars: fullText.length,
            tail: fullText.slice(-LOOP_WINDOW),
          });
          process.stdout.write('\n');
          console.log(theme.error(
            `  ⚠ Stream loop detected — same ${LOOP_WINDOW}-char window has appeared ${count}+ times. Aborting.`,
          ));
          console.log(theme.dim(
            `    The model is stuck repeating itself. Common causes:`,
          ));
          console.log(theme.dim(
            `      · model is emitting tool-call JSON as plain text (try /model <other>)`,
          ));
          console.log(theme.dim(
            `      · context exhausted (try /clear and rephrase)`,
          ));
          console.log(theme.dim(
            `      · experimental free model (openrouter/owl-alpha is a known offender)`,
          ));
          try { streamAbort.abort(); } catch { /* noop */ }
        }
      }
    }

    // (inputGuard is now lifted to runQuery scope — see above. It spans
    // both streaming and tool execution, with pause/resume around the
    // permission prompts inside executeToolCalls.)

    // We're about to wait on the API; tell the status singleton so a blind
    // user pressing F1 hears "calling claude-sonnet-4, 6 seconds elapsed"
    // instead of a stale "idle".
    setStatus({ state: 'streaming' });

    // Steer support — Ctrl+G during streaming aborts the API call and
    // treats the queued buffer as the next user message (with a marker
    // so the model knows the prior turn was interrupted). The handler
    // is wired through InputGuard.onSteer; we create a fresh
    // AbortController per turn and pass it to streamChat.
    const streamAbort = new AbortController();
    let wasSteered = false;
    const cancelCurrentTurn = () => {
      wasSteered = true;
      try { streamAbort.abort(); } catch { /* noop */ }
    };
    inputGuard.onSteer(cancelCurrentTurn);
    // Expose the per-turn abort controller on globalThis so the F-row
    // hotkey listener (src/index.ts) can soft-cancel the current turn
    // without going through Ctrl+C / SIGINT. Expose a cancel callback
    // too: aborting the controller directly bypasses wasSteered and makes
    // a user cancel look like a provider failure in the catch path.
    // Both globals are cleared in the finally block so stale handles
    // cannot fire between turns.
    (globalThis as {
      __turnAbortCtl?: AbortController | null;
      __turnCancelCurrent?: (() => void) | null;
    }).__turnAbortCtl = streamAbort;
    (globalThis as {
      __turnAbortCtl?: AbortController | null;
      __turnCancelCurrent?: (() => void) | null;
    }).__turnCancelCurrent = cancelCurrentTurn;

    dbgEmit('info', 'turn.start', {
      turn: turns,
      model: ctx.config.model,
      messageCount: ctx.messages.length,
    });

    // Pre-token indicator — print a dim "waiting" line inside the live-
    // queue scroll region so the user sees that something IS happening
    // before the first model token arrives. Without this, a slow or
    // hung model (like openrouter/owl-alpha returning ERROR after a
    // long timeout) leaves nothing visible between the prompt and the
    // queue box, making the whole REPL look frozen.
    //
    // Skipped in screen-reader mode (NVDA / JAWS would announce the
    // line and then announce every subsequent token as "after the
    // waiting line", which is noisier than helpful).
    let firstTokenSeen = false;
    let firstTokenLatencyMs: number | null = null;
    let firstRenderableOutputSeen = false;
    // Note: the outer `isScreenReader` declared at the top of runQuery
    // (line ~340) is in scope here via closure — no need for a second
    // declaration. Previously this re-declared inside the while loop
    // and TypeScript tolerated it as a different block scope, but it
    // was confusing and the audit flagged it as bug-bait.
    //
    // Live waiting indicator on the response line. It keeps motion and the
    // interrupt hint visible while still clearing itself before the first
    // model event writes real output.
    let workingIndicator = turns === 1 ? earlyWorkingIndicator : null;
    if (turns === 1) earlyWorkingIndicator = null;
    if (!workingIndicator) {
      workingIndicator = startWorkingIndicator(turnStart, isScreenReader, turns);
    }
    // Slow-model warning and first-token watchdog. The warning is a
    // UX hint; the watchdog is the hard recovery path for providers
    // that accept a request but then never produce a stream event.
    const slowTimer = setTimeout(() => {
      if (!firstRenderableOutputSeen) {
        // Clear the animated row before printing a persistent warning,
        // then restart it on the following line so the terminal stays tidy.
        workingIndicator?.stop();
        workingIndicator = null;
        console.log(chalk.yellow(
          `  ⏳ model is taking longer than 30s. Shift+F5 cancels, Ctrl+C exits. Often means the model returned no tokens (try /model <other> if this hangs).`,
        ));
        if (!firstRenderableOutputSeen) {
          workingIndicator = startWorkingIndicator(turnStart, isScreenReader, turns);
        }
      }
    }, 30_000);
    let firstTokenTimedOut = false;
    const firstTokenTimeoutMs = resolveTurnFirstTokenTimeoutMs(ctx.config, fastDirect);
    let streamIdleTimedOut = false;
    const streamIdleTimeoutMs = resolveStreamIdleTimeoutMs(fastDirect);
    let closeCurrentStream: (() => void) | null = null;

    try {
      const requestConfig = fastDirect
        ? { ...ctx.config, maxTokens: Math.min(ctx.config.maxTokens ?? 700, 700) }
        : ctx.config;
      const stream = streamChat(requestConfig, apiMessages, requestTools, streamAbort.signal);
      const iterator = stream[Symbol.asyncIterator]();
      closeCurrentStream = () => {
        const close = iterator.return;
        closeCurrentStream = null;
        if (typeof close === 'function') {
          void close.call(iterator, undefined as never).catch(() => { /* best effort stream cleanup */ });
        }
      };
      async function waitForNextEvent(
        nextPromise: Promise<Awaited<ReturnType<typeof iterator.next>>>,
        waitTimeoutMs: number,
      ): Promise<Awaited<ReturnType<typeof iterator.next>>> {
        if (waitTimeoutMs <= 0) return nextPromise;
        const deadline = Date.now() + waitTimeoutMs;
        while (true) {
          const remainingMs = deadline - Date.now();
          if (remainingMs <= 0) {
            try { streamAbort.abort(); } catch { /* noop */ }
            if (!firstTokenSeen) {
              firstTokenTimedOut = true;
              throw new Error('__GRAWKUS_FIRST_TOKEN_TIMEOUT__');
            }
            streamIdleTimedOut = true;
            throw new Error('__GRAWKUS_STREAM_IDLE_TIMEOUT__');
          }
          const sliceMs = Math.max(1, Math.min(250, remainingMs));
          const tick = new Promise<'__GRAWKUS_WAIT_TICK__'>((resolve) => {
            setTimeout(() => resolve('__GRAWKUS_WAIT_TICK__'), sliceMs);
          });
          const winner = await Promise.race([nextPromise, tick]);
          if (winner !== '__GRAWKUS_WAIT_TICK__') {
            return winner;
          }
          if (!firstRenderableOutputSeen && isFooterActive()) {
            setFooterActivity('Sumi ink moving', turns, turnStart);
          }
        }
      }
      while (true) {
        const nextPromise = iterator.next();
        const waitTimeoutMs = !firstTokenSeen ? firstTokenTimeoutMs : streamIdleTimeoutMs;
        let next: Awaited<ReturnType<typeof iterator.next>>;
        try {
          next = await waitForNextEvent(nextPromise, waitTimeoutMs);
        } catch (err) {
          nextPromise.catch(() => { /* avoid unhandled rejection if provider notices abort later */ });
          throw err;
        }
        if (next.done) break;
        const event = next.value;
        // First event of any kind — model is alive. Cancel the slow-
        // model warning timer; subsequent events are normal streaming.
        if (!firstTokenSeen) {
          firstTokenSeen = true;
          firstTokenLatencyMs = Date.now() - turnStart;
        }
        if (event.type === 'thinking' && event.content) {
          sawAnyThinking = true;
          // showThinking defaults to true; only off when explicitly disabled.
          if (!fastDirect && ctx.config.showThinking !== false) {
            if (!firstRenderableOutputSeen) {
              firstRenderableOutputSeen = true;
              clearTimeout(slowTimer);
              workingIndicator?.stop();
              workingIndicator = null;
            }
            if (!thinkingActive) {
              // Await the boot animation before streaming the first
              // thinking token — the animation paints in-place on the
              // header row and the streamed text needs to land on the
              // row below it.
              await printThinkingOpen();
              thinkingActive = true;
            }
            printThinkingText(event.content);
          }
        } else if (event.type === 'text' && event.content) {
          if (!firstRenderableOutputSeen) {
            firstRenderableOutputSeen = true;
            clearTimeout(slowTimer);
            workingIndicator?.stop();
            workingIndicator = null;
          }
          if (thinkingActive) {
            // Await the collapse animation so subsequent text streams
            // onto a fresh row beneath the settled footer.
            await printThinkingClose();
            thinkingActive = false;
          }
          if (!hasOutput) {
            hasOutput = true;
            // First token arrived; promote status so F1 reports "receiving"
            // rather than the still-waiting "streaming" message.
            setStatus({ state: 'responding' });
          }
          writeStreamText(event.content);
        } else if (event.type === 'tool_call') {
          toolCalls = event.toolCalls;
        } else if (event.type === 'done') {
          if (event.usage) {
            const u = event.usage;
            const turnDurationMs = Date.now() - turnStart;
            const { cost, warning } = trackUsage(
              ctx.sessionId,
              ctx.config.model,
              u.prompt,
              u.completion,
              {
                provider: ctx.config.provider,
                firstTokenMs: firstTokenLatencyMs,
                durationMs: turnDurationMs,
              },
            );
            chainStats.benchmarkUsageEvents.push({
              model: ctx.config.model,
              promptTokens: u.prompt,
              completionTokens: u.completion,
              totalTokens: u.total || u.prompt + u.completion,
              estimatedCostUsd: cost,
            });
            usageRecorded = true;
            setFooterCost(cost, u.prompt, u.completion, {
              firstTokenMs: firstTokenLatencyMs,
              durationMs: turnDurationMs,
            });
            // Single newline separator if we just streamed text, then the
            // compact telemetry line.
            if (hasOutput && !lastCharWasNewline) process.stdout.write('\n');
            printCost(u.prompt, u.completion, cost, warning, turnDurationMs);
          }
          try { streamAbort.abort(); } catch { /* close any provider socket left open after done */ }
          closeCurrentStream?.();
          break;
        }
      }
      closeCurrentStream?.();
      if (!usageRecorded && (hasOutput || (toolCalls && toolCalls.length > 0))) {
        const promptEstimate = Math.max(1, estimateTokens(apiMessages));
        const completionEstimate = Math.max(
          1,
          Math.ceil(((fullText || '') + (toolCalls ? JSON.stringify(toolCalls) : '')).length / 3.5),
        );
        const turnDurationMs = Date.now() - turnStart;
        const { cost } = trackUsage(
          ctx.sessionId,
          ctx.config.model,
          promptEstimate,
          completionEstimate,
          {
            provider: ctx.config.provider,
            firstTokenMs: firstTokenLatencyMs,
            durationMs: turnDurationMs,
          },
        );
        chainStats.benchmarkUsageEvents.push({
          model: ctx.config.model,
          promptTokens: promptEstimate,
          completionTokens: completionEstimate,
          totalTokens: promptEstimate + completionEstimate,
          estimatedCostUsd: cost,
        });
        setFooterCost(cost, promptEstimate, completionEstimate, {
          firstTokenMs: firstTokenLatencyMs,
          durationMs: turnDurationMs,
        });
        usageRecorded = true;
      }
      clearTimeout(slowTimer);
      workingIndicator?.stop();
      workingIndicator = null;
    } catch (err: unknown) {
      // Stream threw before any token arrived — clear the slow-model
      // timer so its 30s callback doesn't fire after the error is
      // already on stdout (would look like a false positive).
      clearTimeout(slowTimer);
      // Tear down the waiting indicator if it's still ticking — error
      // print below shouldn't trail an animated row.
      workingIndicator?.stop();
      workingIndicator = null;
      closeCurrentStream?.();
      clearActiveTurnHandle(streamAbort);
      const msg = err instanceof Error ? err.message : String(err);
      // Always close the streaming line first so the error doesn't glue to text.
      if (hasOutput && !lastCharWasNewline) process.stdout.write('\n');

      if (firstTokenTimedOut) {
        const failedModel = ctx.config.model;
        const fallback = fallbackModelForTurn(ctx.config, usedFallbackModel);
        if (fallback) {
          usedFallbackModel = true;
          ctx.config.model = fallback;
          resetClient();
          console.log(theme.warning(
            `  ${sym.warn} ${failedModel} produced no stream events for ${formatDuration(firstTokenTimeoutMs)} — retrying once with fallback model ${fallback}.`,
          ));
          console.log(theme.dim('    Configure with /fallback <model-id>, disable with /fallback off, or switch now with /openrouter-free.'));
          turns--;
          continue;
        }
        if (retryPrimaryModelOnce(`${failedModel} produced no stream events for ${formatDuration(firstTokenTimeoutMs)}`)) {
          continue;
        }
        const timeoutMsg = `${failedModel} produced no stream events for ${formatDuration(firstTokenTimeoutMs)}`;
        console.log(theme.error(`  ${sym.warn} ${timeoutMsg}.`));
        console.log(theme.dim('    Fallback is disabled and the same-model retry already ran; cancelling so the prompt can recover.'));
        console.log(theme.dim('    Use /fallback <model-id> to enable automatic retry, or /model <known-good-model> to switch primary models.'));
        ctx.messages.push({ role: 'assistant', content: `[Provider timeout: ${timeoutMsg}]` });
        break;
      }

      if (streamIdleTimedOut) {
        const failedModel = ctx.config.model;
        const timeoutMsg = `${failedModel} stream stalled for ${formatDuration(streamIdleTimeoutMs)} after the first event`;
        const fallback = !hasOutput && !toolCalls
          ? fallbackModelForTurn(ctx.config, usedFallbackModel)
          : null;
        if (fallback) {
          usedFallbackModel = true;
          ctx.config.model = fallback;
          resetClient();
          console.log(theme.warning(
            `  ${sym.warn} ${timeoutMsg} — retrying once with fallback model ${fallback}.`,
          ));
          console.log(theme.dim('    Configure with /fallback <model-id>, disable with /fallback off, or switch now with /openrouter-free.'));
          turns--;
          continue;
        }
        if (!hasOutput && !toolCalls && retryPrimaryModelOnce(timeoutMsg)) {
          continue;
        }
        if (fullText.trim()) {
          const partial = `${fullText.trimEnd()}\n[Provider timeout: stream stalled before completion]`;
          console.log(theme.warning(`  ${sym.warn} stream stalled before completion; returning the partial response.`));
          accumulatedAssistantText += (accumulatedAssistantText ? '\n\n' : '') + partial;
          ctx.messages.push({ role: 'assistant', content: partial });
        } else {
          console.log(theme.error(`  ${sym.warn} ${timeoutMsg}.`));
          console.log(theme.dim('    Same-model retry already ran; cancelling so the prompt can recover instead of hanging indefinitely.'));
          console.log(theme.dim('    Use /fallback <model-id> to enable automatic retry, or /model <known-good-model> to switch primary models.'));
          ctx.messages.push({ role: 'assistant', content: `[Provider timeout: ${timeoutMsg}]` });
        }
        break;
      }

      // ── User cancel path (graceful — not an error) ─────────
      // If the user pressed Ctrl+G / Esc / F5 during streaming, the
      // AbortController fired and the OpenAI SDK threw something like
      // "Request was aborted". Treat as a controlled end-of-turn:
      // save partial assistant text, preserve the type-ahead buffer,
      // and return to the editable prompt.
      //
      // Distinguishing USER steer from LOOP-DETECTOR abort: both fire
      // streamAbort.abort() but the loop detector sets
      // `loopDetected` first. Previously this branch keyed off the
      // SDK's error message ("abort|cancel"), which also matched
      // legitimate provider errors ("operation cancelled by upstream")
      // AND matched the loop-detector abort, causing the wrong path
      // to fire. Now we key strictly off `wasSteered` — the only path
      // that sets it is the steerHandler closure above.
      if (wasSteered) {
        console.log(theme.warning('  ⮌ cancelled — restoring your type-ahead at the prompt'));
        // Save whatever the model managed to emit before the abort.
        // Previously this skipped the push entirely when fullText was
        // empty (user steered before any tokens streamed). Result:
        // the saved session ended up with consecutive user messages
        // and no assistant alternation — /resume printed user-only
        // history because that's all the file contained. Now we
        // ALWAYS push an assistant message, even if it's just a
        // placeholder, so the conversation structure is preserved
        // for save + restore.
        const interruptedText = fullText.trim()
          ? fullText + '\n[interrupted by user steer]'
          : '[interrupted by user steer — no response generated]';
        accumulatedAssistantText += (accumulatedAssistantText ? '\n\n' : '') + interruptedText;
        ctx.messages.push({ role: 'assistant', content: interruptedText });
        // Drain the queue and restore it as an editable draft. The old
        // behavior silently submitted type-ahead as a new turn after an
        // interrupt, which made cancellation feel like accidental send.
        const steerText = inputGuard.drainQueuedInput();
        if (steerText.trim()) {
          (globalThis as { __grawkusQueuedInput?: string }).__grawkusQueuedInput = steerText;
        }
        // End the chain and let the outer REPL render the next prompt.
        break;
      }

      // ── Auto-fallback path ─────────────────────────────────
      // Categorize the error. If it's "unknown" (the provider returned a
      // cryptic empty error like "ERROR" or "Provider returned error" that
      // matches no specific pattern) AND we have a fallbackModel configured
      // AND we haven't already used it, swap models and silently retry the
      // same turn. This rescues users from broken free models without them
      // having to manually /clear and /model switch.
      const cat = categorizeApiError(msg, {
        baseURL: ctx.config.baseURL,
        provider: ctx.config.provider,
        model: ctx.config.model,
      });
      const errorFallback = cat.category === 'unknown'
        ? fallbackModelForTurn(ctx.config, usedFallbackModel)
        : null;
      if (errorFallback) {
        usedFallbackModel = true;
        const failedModel = ctx.config.model;
        const fallback = errorFallback;
        ctx.config.model = fallback;
        resetClient();
        console.log(theme.warning(
          `  ${sym.warn} ${failedModel} returned a cryptic provider error — retrying once with fallback model ${fallback}.`,
        ));
        console.log(theme.dim('    (configure a different fallback with: /fallback <model-id>)'));
        turns--;  // this retry doesn't burn a turn slot from the max-turns budget
        continue;
      }
      if (cat.category === 'unknown' && retryPrimaryModelOnce(`${ctx.config.model} returned a cryptic provider error`)) {
        continue;
      }

      printApiError(msg, {
        baseURL: ctx.config.baseURL,
        provider: ctx.config.provider,
        model: ctx.config.model,
      });
      // Voice: announce errors aloud for screen-reader users
      if (isVoiceEnabled(ctx.config) && getAccessibilityConfig(ctx.config).announceErrors) {
        const tts = getTtsConfig(ctx.config);
        if (tts.apiKey) {
          // Keep it terse — one short sentence — to avoid burning quota on
          // long stack traces. The error pretty-printer already showed the
          // categorized version to the screen-reader.
          speak(`API error: ${msg.slice(0, 120)}`, ctx.config, { voiceId: tts.assistantVoiceId }).catch(() => { /* noop */ });
        }
        if (getAccessibilityConfig(ctx.config).audioCues) {
          audioCue('error').catch(() => { /* noop */ });
        }
      }
      ctx.messages.push({ role: 'assistant', content: `[API error: ${msg}]` });
      break;
    }

    clearActiveTurnHandle(streamAbort);

    if (!hasOutput && (!toolCalls || toolCalls.length === 0)) {
      const failedModel = ctx.config.model;
      const fallback = fallbackModelForTurn(ctx.config, usedFallbackModel);
      if (fallback) {
        usedFallbackModel = true;
        ctx.config.model = fallback;
        resetClient();
        console.log(theme.warning(
          `  ${sym.warn} ${failedModel} returned an empty response — retrying once with fallback model ${fallback}.`,
        ));
        console.log(theme.dim('    Configure with /fallback <model-id>, disable with /fallback off, or switch now with /openrouter-free.'));
        turns--;
        continue;
      }
      if (retryPrimaryModelOnce(`${failedModel} returned an empty response`)) {
        continue;
      }
      const emptyMsg = `${failedModel} returned an empty response`;
      console.log(theme.error(`  ${sym.warn} ${emptyMsg}.`));
      console.log(theme.dim('    Fallback is disabled and the same-model retry already ran.'));
      console.log(theme.dim('    Use /fallback <model-id> to enable automatic retry, or /model <known-good-model> to switch primary models.'));
      ctx.messages.push({ role: 'assistant', content: `[Provider empty response: ${emptyMsg}]` });
      break;
    }

    if (hasOutput && !lastCharWasNewline) {
      process.stdout.write('\n');
    }

    // Save assistant message
    const assistantMsg: Message = { role: 'assistant', content: fullText || null };
    if (toolCalls && toolCalls.length > 0) {
      assistantMsg.tool_calls = toolCalls;
    }
    ctx.messages.push(assistantMsg);

    // Accumulate visible assistant text for chain-end TTS. We don't TTS
    // mid-chain because the model often emits short bridging sentences
    // between tool calls — speaking each one is noisy and slow.
    if (fullText) accumulatedAssistantText += (accumulatedAssistantText ? '\n\n' : '') + fullText;

    // F5+ DeCRIM 3-stage self-critique gate.
    //
    // When the model emits a no-tool-call turn ("I'm done"), we
    // walk through three sequential stages. Each stage injects a
    // user message; the model responds, possibly with more tool
    // calls. When it next tries to declare done, we advance to the
    // next stage. After all 3 stages fire, the gate is exhausted
    // and the next no-tool-call turn lets the chain end normally.
    if (!toolCalls || toolCalls.length === 0) {
      const hasRemainingTurnBudget = turns < maxTurns;
      const needsEditVerification =
        process.env.GRAWKUS_VERIFY_AFTER_EDIT !== '0'
        && selfCritiqueEnabled
        && hasRemainingTurnBudget
        && chainStats.editCountSinceVerification > 0
        && !chainStats.verificationAttemptedSinceEdit
        && !chainStats.verificationGatePrompted;
      if (needsEditVerification) {
        chainStats.verificationGatePrompted = true;
        ctx.messages.push({
          role: 'user',
          content:
            buildEditVerificationReminder(
              chainStats.pendingEditFiles,
              chainStats.editCountSinceVerification,
            ) +
            '\n\nThis is a non-interactive run. Do not provide the final answer yet: verify the edits first, or make a concrete evidence-based case that no verification command exists.',
        });
        continue;
      }
      const minToolCalls = minimumToolCallsBeforeDone(ctx.mode);
      if (
        selfCritiqueEnabled
        && hasRemainingTurnBudget
        && minToolCalls > 0
        && chainStats.toolCallCount < minToolCalls
        && !chainStats.emptyEngagementPrompted
      ) {
        chainStats.emptyEngagementPrompted = true;
        ctx.messages.push({
          role: 'user',
          content: buildEmptyEngagementReminder(chainStats.toolCallCount, minToolCalls, ctx.mode),
        });
        continue;
      }
      const benchmarkCompletionReminder = selfCritiqueEnabled
        && hasRemainingTurnBudget
        && ctx.mode === 'benchmark'
        && !chainStats.benchmarkTrajectoryGatePrompted
        ? buildBenchmarkCompletionReminder(chainStats.benchmarkTraceEvents, chainStats.benchmarkUsageEvents, ctx.messages)
        : null;
      if (benchmarkCompletionReminder) {
        chainStats.benchmarkTrajectoryGatePrompted = true;
        ctx.messages.push({
          role: 'user',
          content: benchmarkCompletionReminder,
        });
        continue;
      }
      if (selfCritiqueEnabled && hasRemainingTurnBudget && critiqueStageIdx < CRITIQUE_STAGES.length) {
        const stage = CRITIQUE_STAGES[critiqueStageIdx];
        critiqueStageIdx++;
        ctx.messages.push({
          role: 'user',
          content: critiquePromptFor(stage),
        });
        // Re-enter the loop — the model responds to the stage prompt.
        continue;
      }
      break;
    }

    // Execute tool calls — executeToolCalls itself flips per-tool state
    // and uses inputGuard.pause()/resume() around each permission prompt
    // so rl.question() can read user input even though suppression is on
    // for the rest of the chain. chainStats is mutated by side effect so
    // we can surface a skill-graduation hint at chain end.
    const toolResults = await executeToolCalls(toolCalls, ctx, inputGuard, chainStats);
    ctx.messages.push(...toolResults);

    // ── F4: Dedup repeat tool calls ──
    //
    // After each fresh batch of tool results lands in ctx.messages,
    // hash each call's (toolName, normalizedArgs) fingerprint. If
    // we've seen this fingerprint before in this chain, rewrite the
    // PRIOR tool-result message in place to a 1-line stub. The new
    // result stays full-fidelity so the model can read it.
    //
    // We rewrite the older one (not the newer) so the model's most
    // recent attention sees a fresh, complete result — but the
    // accumulated history doesn't carry redundant copies.
    const repeatReminders = dedupRepeatedToolCalls(ctx.messages, toolCalls, toolResults, toolCallDedupMap);
    queueRecoveryReminders(chainStats, repeatReminders);
  }

  // Chain ended; back to idle so F1 reports the correct state.
  setStatus({ state: 'idle' });
  if (isFooterActive()) setFooterActivity('Ready', 0, null);

  // ── Voice: read the assistant's final response ────────────
  // Off the hot path — fire-and-forget so the next prompt appears
  // immediately. The playback runs in background; F2 pauses, F4 skips.
  if (isVoiceEnabled(ctx.config) && accumulatedAssistantText.trim()) {
    const tts = getTtsConfig(ctx.config);
    if (tts.apiKey) {
      const a = getAccessibilityConfig(ctx.config);
      let toRead = accumulatedAssistantText;
      // If the response is long, abbreviate via cheap heuristic summary so
      // blind users aren't forced to listen to 800 words. They can press
      // F3 (replay) on chunks or ask "give me the full version" verbally.
      const words = countWords(toRead);
      if (words >= a.longResponseThreshold) {
        toRead = summarize(toRead, a.longResponseThreshold);
      }
      // Register an abort controller + last-chunk + last-full-response
      // globally so the hotkey handler in index.ts can cancel / replay.
      // - __voiceLastChunk drives PGUP "replay last chunk"
      // - __voiceLastFullResponse drives F3 "read full" + F4 "read summary"
      const g = globalThis as {
        __voicePlaybackCtl?: AbortController | null;
        __voiceLastChunk?: string | null;
        __voiceLastFullResponse?: string | null;
      };
      const ctl = new AbortController();
      g.__voicePlaybackCtl = ctl;
      g.__voiceLastChunk = toRead;
      g.__voiceLastFullResponse = accumulatedAssistantText;
      speakAssistantResponse(toRead, ctx.config, ctl.signal).catch(() => { /* noop */ });
    }
  }

  const latestRole = ctx.messages.at(-1)?.role;
  const stoppedWithPendingModelWork = latestRole === 'user' || latestRole === 'tool';
  if (Number.isFinite(maxTurns) && turns >= maxTurns && stoppedWithPendingModelWork) {
    console.log(theme.warning(`\n  ${sym.warn} reached configured max turns limit (${maxTurns})`));
    console.log(theme.dim(`     remove the cap by deleting maxTurns from ~/.grawkus/config.json`));
  }

  // Chain-elapsed summary. One line per response chain (user msg → assistant
  // ending without a tool call), printed regardless of how many tool-call
  // iterations the chain took. Lets the user see how long that whole
  // exchange took, separate from per-turn cost timings.
  const chainMs = Date.now() - chainStart;
  // Only show if there was meaningful work — multi-second chains. Sub-second
  // chains (slash command rejects, instant returns) don't need a chain line.
  if (chainMs > 1500) {
    console.log(theme.dim(`  chain ${formatDuration(chainMs)} | ${turns} ${turns === 1 ? 'turn' : 'turns'}`));
  }

  // /thinking visibility hint. If the user has thinking enabled but the
  // model didn't emit any reasoning tokens this turn AND we haven't
  // already shown the hint for this session, explain why nothing showed.
  // Most users hit this with general-purpose models (gpt-4o, claude-sonnet
  // without `thinking: enabled`, owl-alpha, etc.) — only reasoning models
  // (DeepSeek-R1, Claude with extended thinking, o1, etc.) actually emit
  // reasoning over the API.
  const showThinking = ctx.config.showThinking !== false;
  if (showThinking && !chainUsedFastDirect && !sawAnyThinking && !_thinkingHintShownForSession.has(ctx.sessionId)) {
    _thinkingHintShownForSession.add(ctx.sessionId);
    console.log(theme.dim(`  [hint] /thinking is ON, but ${ctx.config.model} didn't emit reasoning tokens.`));
    console.log(theme.dim(`         Reasoning models (DeepSeek-R1, o1, Claude with extended thinking) emit them; most general-purpose models don't.`));
    console.log(theme.dim(`         Hide this hint with /thinking (toggles off).`));
  }

  // ── Skill graduation hint (Sentience audit, M2 item 2) ─────────
  // Deterministic "this work was worth remembering" trigger. The model
  // is a bad judge of its own complexity (Sentience audit's exact wording);
  // we count instead. Fires at most once per chain in sentience mode, and
  // only when a clear threshold was crossed:
  //
  //   - 5+ tool calls   → complex multi-step task
  //   - error+recovery  → the agent learned a workaround
  //
  // We don't auto-execute /skill-create (it would burn another LLM call
  // and might extract noise); we surface the opportunity so the user can
  // decide. Outside sentience mode, this is silent — keeps the noise floor
  // low for regular dev/review/debug sessions.
  if (ctx.mode === 'sentience' || (ctx.mode as string) === 'hermes') {
    const complex = chainStats.toolCallCount >= 5;
    const learnedFromFailure = chainStats.sawToolError && chainStats.sawToolRecovery;
    if (complex || learnedFromFailure) {
      const reason = complex && learnedFromFailure
        ? `${chainStats.toolCallCount} tools, recovered from at least one error`
        : complex
          ? `${chainStats.toolCallCount} tools — complex enough that a learned pattern might save time next time`
          : `recovered from a tool error — the working path is worth banking`;
      console.log(theme.dim(`  [sentience] graduation candidate: ${reason}.`));
      console.log(theme.dim(`           Run /skill-create or /learn to bank it. Skip if it was one-off.`));
    }
  }

  const trace = writeBenchmarkTrace({
    sessionId: ctx.sessionId,
    mode: ctx.mode,
    cwd: ctx.cwd,
    config: ctx.config,
    startedAtMs: chainStart,
    endedAtMs: Date.now(),
    messages: ctx.messages,
    events: chainStats.benchmarkTraceEvents,
    usageEvents: chainStats.benchmarkUsageEvents,
  });
  if (trace) {
    console.log(theme.dim(`  [benchmark] trace: ${trace.summaryPath}`));
  }
  } finally {
    earlyWorkingIndicator?.stop();
    earlyWorkingIndicator = null;
    // Drain any queued user input typed during streaming. Stash on
    // globalThis for the REPL loop in index.ts to restore into the
    // next editable prompt. Enter typed mid-stream is preserved as
    // draft spacing, not treated as a hidden submit.
    const queued = inputGuard.drainQueuedInput();
    if (queued.trim()) {
      (globalThis as { __grawkusQueuedInput?: string }).__grawkusQueuedInput = queued;
    }
    inputGuard.restore();
    // Clear the per-turn abort controller pointer so a stale handle
    // can't be aborted between turns by Shift+F5 (soft-cancel).
    (globalThis as {
      __turnAbortCtl?: AbortController | null;
      __turnCancelCurrent?: (() => void) | null;
    }).__turnAbortCtl = null;
    (globalThis as {
      __turnAbortCtl?: AbortController | null;
      __turnCancelCurrent?: (() => void) | null;
    }).__turnCancelCurrent = null;
    if (isFooterActive()) setFooterActivity('Ready', 0, null);
  }
}

/**
 * Chain-scope counters threaded through executeToolCalls so runQuery can
 * surface "this looked complex enough to extract a skill" hints at chain
 * end. The Sentience audit's deterministic skill-graduation triggers:
 *   - 5+ tool calls in the chain         → complex task
 *   - a tool error followed by a success → learned-from-failure
 * Counted as side-effects, not returned, so the existing call sites
 * don't have to thread tuples back up.
 */
interface ChainStats {
  toolCallCount: number;
  sawToolError: boolean;
  sawToolRecovery: boolean;
  /**
   * Map<fingerprint, consecutiveErrorCount>. Tracks how many times
   * a model has attempted the SAME tool with the SAME args AND
   * the call failed each time. Fingerprint is
   * `${toolName}::${JSON.stringify(input).slice(0,1000)}`.
   *
   * Reset to 0 when the same fingerprint produces a SUCCESS — the
   * model recovered. Incremented when the SAME fingerprint produces
   * an error consecutively.
   *
   * Counting errors-only fixes the false-positive that triggered in
   * the wild on legitimate `tools/list`-style schema discovery
   * calls: the model called Stitch's tools/list 3× to (re-)read
   * the API surface; none failed but the old "total attempt"
   * counter still aborted the chain. With error-tracking only,
   * read-only exploration is unaffected; only a model genuinely
   * stuck retrying a broken call hits the safety valve.
   */
  toolCallErrorCounts: Map<string, number>;
  /**
   * Map<toolName, consecutiveParseFailureCount>. The per-fingerprint
   * detector above misses one important pattern: the model
   * regenerating a huge payload (e.g. 27KB of HTML inside a
   * write_file call) where every attempt FAILS JSON.parse at a
   * slightly different byte position. Different positions →
   * different args → different fingerprints → the
   * fingerprint-based detector never trips. Real-world repro:
   * write_file failed 4× consecutively with `Unterminated string`
   * at positions 27137, 27727, 27922, 27119 — same root cause,
   * different surface signal.
   *
   * This counter ignores args entirely. Same tool, 3 consecutive
   * JSON-parse failures → abort with a directive to switch
   * tools (e.g. apply_patch for huge content). Reset on any
   * successful execution of the same tool.
   */
  toolParseFailureStreaks: Map<string, number>;
  toolCallLoopDetected: boolean;
  recoveryReminders: string[];
  fileEditStates: Map<string, FileEditState>;
  pendingEditFiles: Set<string>;
  editCountSinceVerification: number;
  verificationAttemptedSinceEdit: boolean;
  verificationGatePrompted: boolean;
  emptyEngagementPrompted: boolean;
  benchmarkTrajectoryGatePrompted: boolean;
  benchmarkTraceEvents: BenchmarkTraceEvent[];
  benchmarkUsageEvents: BenchmarkUsageEvent[];
}

const TOOL_CALL_LOOP_THRESHOLD = 3;

function queueRecoveryReminders(chainStats: ChainStats | undefined, reminders: string[]): void {
  if (!chainStats || reminders.length === 0) return;
  for (const reminder of reminders) {
    if (!reminder.trim()) continue;
    if (!chainStats.recoveryReminders.includes(reminder)) {
      chainStats.recoveryReminders.push(reminder);
    }
  }
  if (chainStats.recoveryReminders.length > RECOVERY_REMINDER_LIMIT) {
    chainStats.recoveryReminders = chainStats.recoveryReminders.slice(-RECOVERY_REMINDER_LIMIT);
  }
}

async function executeToolCalls(
  toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[],
  ctx: QueryContext,
  inputGuard: InputGuard,
  chainStats?: ChainStats,
): Promise<Message[]> {
  const results: Message[] = [];

  for (const tc of toolCalls) {
  const toolName = tc.function.name;
    const tool = getToolByName(toolName);

    // ── Tool-call loop detection (error-only count) ──────
    // Fingerprint = tool name + raw arguments (truncated). The
    // counter tracks CONSECUTIVE ERRORS for the same fingerprint,
    // NOT total attempts — schema-discovery calls like `tools/list`
    // are routinely called 2-3+ times in a chain and shouldn't
    // trip the safety valve. We pre-check here; the post-execution
    // increment/reset happens further down (after we know whether
    // the call errored or succeeded).
    //
    // The fingerprint variable is hoisted so the post-exec hook
    // below can update the right map entry without recomputing.
    const tcFingerprint = chainStats
      ? `${toolName}::${String(tc.function.arguments ?? '').slice(0, 1000)}`
      : null;
    const recordInvalidToolAction = (
      reason: string,
      evidence: string,
      input?: Record<string, unknown>,
    ): void => {
      if (!chainStats || !(ctx.mode === 'benchmark' || process.env.GRAWKUS_BENCHMARK_TRACE === '1')) return;
      chainStats.benchmarkTraceEvents.push(makeBenchmarkInvalidToolActionEvent({
        seq: chainStats.benchmarkTraceEvents.length + 1,
        tool: toolName,
        reason,
        evidence,
        input,
      }));
    };
    const recordPermissionDecision = (
      toolName: string,
      policyDecision: 'allow' | 'prompt' | 'deny',
      finalDecision: 'allow' | 'prompt' | 'deny',
      policyReason: string,
      policyLines: string[],
      userInput?: string,
      extraInput?: Record<string, unknown>,
    ): void => {
      if (!chainStats || !(ctx.mode === 'benchmark' || process.env.GRAWKUS_BENCHMARK_TRACE === '1')) return;
      chainStats.benchmarkTraceEvents.push(makeBenchmarkPermissionDecisionEvent({
        seq: chainStats.benchmarkTraceEvents.length + 1,
        toolName,
        policyDecision,
        finalDecision,
        policyReason,
        policyLines,
        userInput,
        input: extraInput ? { ...extraInput } : { tool: toolName },
      }));
    };
    if (chainStats && tcFingerprint) {
      const errorCount = chainStats.toolCallErrorCounts.get(tcFingerprint) ?? 0;
      if (errorCount >= TOOL_CALL_LOOP_THRESHOLD && !chainStats.toolCallLoopDetected) {
        chainStats.toolCallLoopDetected = true;
        recordInvalidToolAction('tool_loop_detected', `same tool fingerprint failed ${errorCount} times consecutively`, {
          argumentsPreview: String(tc.function.arguments ?? '').slice(0, 1000),
          consecutiveErrorCount: errorCount,
        });
        console.log(theme.error(
          `  ⚠ Tool-call loop detected — ${toolName} with the same arguments has failed ${errorCount} times in a row. Aborting chain.`,
        ));
        console.log(theme.dim(
          `    The model is stuck retrying a call that keeps failing. Common causes:`,
        ));
        console.log(theme.dim(
          `      · same JSON parse / schema error on every retry (read the prior error carefully)`,
        ));
        console.log(theme.dim(
          `      · permission denied + the user not approving (try /perm auto or yolo)`,
        ));
        console.log(theme.dim(
          `      · tool is unavailable in this session (e.g. stitch — needs REPL restart after config)`,
        ));
        results.push({
          role: 'tool',
          tool_call_id: tc.id,
          content:
            `Error: tool-call loop detected — your last ${errorCount} attempts at "${toolName}" ` +
            `with these arguments have ALL failed. The agent is refusing further identical ` +
            `retries. Read the prior tool-result error carefully and either (a) change the ` +
            `arguments substantively, (b) use a different tool to achieve the goal, or ` +
            `(c) stop and report the issue to the user.`,
        });
        return results;  // abort the rest of this turn's tool calls
      }
    }

    // Helpers for the error-count tracker. Called on each error
    // path below (bumps the count for this fingerprint) and after
    // a successful execution (resets to 0 — model recovered).
    const bumpFingerprintError = (): void => {
      if (chainStats && tcFingerprint) {
        const cur = chainStats.toolCallErrorCounts.get(tcFingerprint) ?? 0;
        chainStats.toolCallErrorCounts.set(tcFingerprint, cur + 1);
      }
    };
    const clearFingerprintError = (): void => {
      if (chainStats && tcFingerprint) {
        chainStats.toolCallErrorCounts.set(tcFingerprint, 0);
      }
    };

    if (!tool) {
      // Free models routinely hallucinate tool names (web_search_exa,
      // google_search, etc.). Telling the model exactly what IS available lets
      // it self-correct on the next iteration instead of giving up.
      const valid = ALL_TOOLS.map((t) => t.name).join(', ');
      console.log(theme.error(`  ${sym.error} Unknown tool: ${toolName} (valid: ${valid})`));
      recordInvalidToolAction('unknown_tool', `tool "${toolName}" is not registered; valid tools: ${valid}`, {
        argumentsPreview: String(tc.function.arguments ?? '').slice(0, 1000),
      });
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content:
          `Error: tool "${toolName}" does not exist. Available tools: ${valid}. ` +
          `Retry with one of these exact names. Do not invent tool names — if you ` +
          `need a capability not in this list, work around it using the tools that exist ` +
          `(e.g. use web_search for discovery, web_fetch for a known URL, bash for shell-only operations).`,
      });
      bumpFingerprintError();
      continue;
    }

    let input: Record<string, unknown>;
    try {
      input = JSON.parse(tc.function.arguments);
    } catch (parseErr) {
      // The model emitted malformed JSON in the tool_calls arguments
      // field. Without a useful error the model loops with the same
      // broken call (observed in user testing: 3 retries on a
      // write_file with a huge HTML content burned 25K tokens). Give
      // the model concrete diagnostics so it can self-correct on the
      // next iteration:
      //   1. The actual parser error (location + what went wrong)
      //   2. A truncated preview of what it sent
      //   3. Hints about the most common causes
      const rawArgs = String(tc.function.arguments ?? '');
      const errMsg = parseErr instanceof Error ? parseErr.message : String(parseErr);
      const preview = rawArgs.length > 400
        ? rawArgs.slice(0, 200) + '\n…[truncated ' + (rawArgs.length - 400) + ' chars]…\n' + rawArgs.slice(-200)
        : rawArgs;
      console.log(theme.error(`  ${sym.error} Invalid tool arguments for ${toolName} — could not parse as JSON`));
      console.log(theme.dim(`    parser error: ${errMsg}`));
      // Heuristic hints to surface the most common root causes the
      // model usually misses on retry.
      const hints: string[] = [];
      if (rawArgs.length > 100_000) {
        hints.push(
          'argument payload is very large (' + rawArgs.length + ' chars) — for large file writes, ' +
          'prefer apply_patch (which handles large content more reliably) over write_file with the ' +
          'entire content as a single JSON string',
        );
      }
      if (/[^\\]\n/.test(rawArgs.slice(0, 5000))) {
        hints.push(
          'unescaped newline in a JSON string — every literal newline inside a string value must be \\n, not a raw newline',
        );
      }
      if (/,\s*[}\]]/.test(rawArgs)) {
        hints.push('trailing comma before } or ] — strict JSON forbids this');
      }
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content:
          `Error: could not parse tool arguments as JSON.\n` +
          `Parser error: ${errMsg}\n` +
          `What you sent (truncated): ${preview}\n` +
          (hints.length > 0
            ? `Likely causes:\n  - ${hints.join('\n  - ')}\n`
            : '') +
          `Do NOT retry with the same arguments. Fix the JSON issue and try again, ` +
          `or use a different approach (e.g. split a huge write into multiple smaller writes).`,
      });
      bumpFingerprintError();

      // ── Per-tool parse-failure streak detector ────────────
      // The per-fingerprint detector misses the case where args
      // differ slightly each retry (e.g. 27KB of HTML regenerated
      // with cosmetic variation between attempts, but every
      // attempt fails JSON.parse at a slightly different byte
      // position). Track streaks per TOOL NAME — if the same
      // tool fails to JSON-parse N times in a row, the issue
      // is the SHAPE of what the model is sending, not the
      // specific args; halt with a stronger directive.
      if (chainStats) {
        const streak = (chainStats.toolParseFailureStreaks.get(toolName) ?? 0) + 1;
        chainStats.toolParseFailureStreaks.set(toolName, streak);
        if (streak >= TOOL_CALL_LOOP_THRESHOLD && !chainStats.toolCallLoopDetected) {
          chainStats.toolCallLoopDetected = true;
          recordInvalidToolAction('parse_failure_streak', `JSON.parse failed ${streak} times consecutively for ${toolName}: ${errMsg}`, {
            argumentsPreview: preview,
            parserError: errMsg,
            parseFailureStreak: streak,
            hints,
          });
          console.log(theme.error(
            `  ⚠ Parse-failure streak — ${toolName} has failed JSON.parse ${streak} times in a row. Aborting chain.`,
          ));
          console.log(theme.dim(
            `    The model keeps generating malformed JSON for this tool. Likely causes:`,
          ));
          console.log(theme.dim(
            `      · payload too large for a single tool call (use apply_patch for big file writes,`,
          ));
          console.log(theme.dim(
            `        split into multiple smaller calls, or write via bash heredoc instead)`,
          ));
          console.log(theme.dim(
            `      · content with unescaped quotes / newlines / backslashes that break JSON encoding`,
          ));
          // Override the last error result with a stronger
          // terminal message that the model will read in the next
          // turn. Don't push an additional result — keep the
          // tool_call_id chain intact.
          results[results.length - 1] = {
            role: 'tool',
            tool_call_id: tc.id,
            content:
              `Error: parse-failure streak detected — your last ${streak} attempts at "${toolName}" ` +
              `have ALL failed JSON.parse (each with a slightly different byte position). The agent ` +
              `is refusing further attempts. DO NOT regenerate this tool call. Either:\n` +
              `  1. Use apply_patch instead (handles large file content via a different envelope)\n` +
              `  2. Split the work into multiple smaller calls (e.g. write the file in chunks via bash echo + >>)\n` +
              `  3. Stop and report the issue to the user`,
          };
          return results;  // abort the rest of this turn's tool calls
        }
      }

      recordInvalidToolAction('malformed_json', `could not parse tool arguments as JSON: ${errMsg}`, {
        argumentsPreview: preview,
        parserError: errMsg,
        hints,
      });
      continue;
    }

    // Validate arguments against tool's JSON schema
    const validation = validateToolArguments(tool, input);
    if (!validation.valid) {
      console.log(theme.error(`  ${sym.error} Invalid tool arguments for ${toolName}: ${validation.error}`));
      // Same fail-loud philosophy as the JSON-parse path: tell the
      // model what it actually sent + the validation rule + how to
      // recover. Without "Do NOT retry with the same arguments" the
      // model often retries with structurally-identical input.
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content:
          `Error: tool arguments failed schema validation.\n` +
          `Validation error: ${validation.error}\n` +
          `Tool: ${toolName}\n` +
          `What you sent: ${JSON.stringify(input).slice(0, 400)}\n` +
          `Do NOT retry with the same arguments. Adjust the arguments to satisfy the schema and try again.`,
      });
      bumpFingerprintError();
      recordInvalidToolAction('schema_validation', validation.error || 'tool arguments failed schema validation', {
        input,
      });
      continue;
    }

    // ── Security scan ─────────────────────────────────────
    const secResult = scanToolCall(toolName, input);
    if (secResult.threats.length > 0) {
      printSecurityWarning(secResult);
    }
    if (secResult.blocked) {
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: `BLOCKED by security scanner: ${secResult.threats.join('; ')}`,
      });
      bumpFingerprintError();
      recordInvalidToolAction('security_blocked', secResult.threats.join('; ') || 'blocked by security scanner', {
        input,
      });
      continue;
    }

    // ── Pre-tool hook ─────────────────────────────────────
    const preHook = await runHooks({
      event: 'PreToolUse',
      toolName,
      toolInput: input,
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      permissionMode: ctx.config.permissionMode,
    });
    if (!preHook.allowed) {
      dbgEmit('info', 'hook.blocked', {
        tool: toolName,
        reason: preHook.message || 'denied',
      });
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: `Blocked by hook: ${preHook.message || 'denied'}`,
      });
      bumpFingerprintError();
      recordInvalidToolAction('hook_blocked', preHook.message || 'denied by pre-tool hook', {
        input,
      });
      continue;
    }

    // ── Accessibility: TTS-announce destructive actions ───
    // Plays before the permission prompt so a blind user hears WHAT they're
    // approving in addition to the visual prompt. Only fires for tools
    // flagged destructive AND when voice + askBeforeDestructive are on.
    if (isVoiceEnabled(ctx.config) && getAccessibilityConfig(ctx.config).askBeforeDestructive) {
      if (isLikelyDestructive(toolName, input)) {
        const tts = getTtsConfig(ctx.config);
        if (tts.apiKey) {
          const blurb = describeDestructive(toolName, input);
          await speak(blurb, ctx.config, { voiceId: tts.assistantVoiceId }).catch(() => false);
        }
      }
    }

    // ── Permission check ──────────────────────────────────
    // Pause input suppression so rl.question() can read the user's
    // Y/n/always response — without this, readline's keypress listener is
    // detached and the prompt would hang forever. Re-suppress immediately
    // after so any typing during the next tool's execution is blocked.
    const permissionExplanation = explainPermission(tool, input, ctx.config);
    let finalPermissionDecision: 'allow' | 'prompt' | 'deny' = permissionExplanation.decision;
    let allowed: boolean;
    inputGuard.pause();
    try {
      allowed = await checkPermission(tool, input, ctx.config, ctx.rl);
      finalPermissionDecision = permissionExplanation.decision === 'prompt'
        ? (allowed ? 'allow' : 'deny')
        : permissionExplanation.decision;
    } finally {
      inputGuard.resume();
    }
    const userInput = permissionExplanation.decision === 'prompt'
      ? (finalPermissionDecision === 'allow' ? 'allow' : finalPermissionDecision === 'deny' ? 'deny' : undefined)
      : undefined;
    recordPermissionDecision(
      toolName,
      permissionExplanation.decision,
      finalPermissionDecision,
      permissionExplanation.reason,
      permissionExplanation.lines,
      userInput,
      input,
    );
    if (!allowed) {
      console.log(theme.warning(`  ${sym.warn} Denied: ${toolName}`));
      results.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: 'Permission denied by user.',
      });
      bumpFingerprintError();
      recordInvalidToolAction('permission_denied', 'permission denied by user', {
        input,
      });
      continue;
    }

    // ── Execute ───────────────────────────────────────────
    const editTargetsForStateTracking = chainStats
      ? editedTargetsFromToolCall(toolName, tc.function.arguments)
      : [];
    const beforeEditStates = editTargetsForStateTracking.length > 0
      ? snapshotFileEditStates(ctx.cwd, editTargetsForStateTracking)
      : new Map<string, FileEditState>();

    // printToolRun is now async (animated boot + persistent spinner).
    // Await before kicking off the actual tool — the boot animation
    // is short (~150ms) and the spinner starts ticking immediately
    // after, so the user sees motion the entire time the tool runs.
    await printToolRun(toolName, formatArgs(tool, input));
    // Update status for F1 status hotkey — include a short arg snippet so
    // the speaker can hear "executing bash, list directory, 4 seconds
    // elapsed" instead of just "tool".
    setStatus({ state: 'tool-call', detail: `${toolName}: ${formatArgs(tool, input).slice(0, 60)}` });

    let result;
    let elapsedMs = 0;
    if (ctx.config.dryRun) {
      console.log(theme.warning(`  ${sym.pending} [DRY RUN] Would execute: ${toolName}`));
      console.log(theme.warning(`           Arguments: ${JSON.stringify(input).slice(0, 100)}`));
      result = {
        isError: false,
        output: `[DRY RUN] Tool execution skipped`,
      };
    } else {
      const startTime = Date.now();
      dbgEmit('debug', 'tool.start', { tool: toolName, input });
      result = await tool.call(input, ctx.cwd);
      const elapsed = Date.now() - startTime;
      elapsedMs = elapsed;
      dbgEmit('info', 'tool.done', {
        tool: toolName,
        elapsedMs: elapsed,
        isError: !!result.isError,
        outputPreview: String(result.output ?? '').slice(0, 200),
      });
      // Stops the spinner, paints the settle animation, then commits
      // the final ✓/✗ result line. Async — must await so the next
      // tool's run line doesn't overwrite mid-settle.
      await printToolResult(!result.isError, elapsed, result.output);
    }

    if (chainStats && (ctx.mode === 'benchmark' || process.env.GRAWKUS_BENCHMARK_TRACE === '1')) {
      chainStats.benchmarkTraceEvents.push(makeBenchmarkTraceEvent({
        seq: chainStats.benchmarkTraceEvents.length + 1,
        tool: toolName,
        input,
        output: result.output,
        isError: !!result.isError,
        elapsedMs,
      }));
    }

    const modelOutput = ctx.config.dryRun || toolName === 'bash'
      ? String(result.output ?? '')
      : archiveLargeToolOutput(ctx.cwd, toolName, result.output).output;

    // Stash last-tool-call info so the Shift+F3 hotkey (src/index.ts) can
    // re-announce "what did the model just do." Truncate the preview to
    // keep TTS readouts short and avoid pinning huge buffers in memory.
    (globalThis as { __lastToolCall?: {
      name: string; argsPreview: string; outputPreview: string; isError: boolean;
    } | null }).__lastToolCall = {
      name: toolName,
      argsPreview: formatArgs(tool, input).slice(0, 80),
      outputPreview: modelOutput.slice(0, 160),
      isError: !!result.isError,
    };

    // Loop-detector fingerprint bookkeeping for the EXECUTED path.
    // The tool actually ran; whether it succeeded or returned an
    // error result, we know more than at the pre-checks above.
    // Successful exec → reset error count (the model can repeat
    // legitimate calls like tools/list without tripping the loop).
    // Tool returned an error result → bump (counts as another
    // failure for this fingerprint).
    if (result.isError) {
      bumpFingerprintError();
    } else {
      clearFingerprintError();
      // A successful exec for this tool also breaks its
      // parse-failure streak. The model recovered from whatever
      // was generating malformed JSON.
      if (chainStats) chainStats.toolParseFailureStreaks.set(toolName, 0);
    }

    // Chain stats — bump the counter on every successful execution path
    // we got here through (denied / blocked tool calls hit `continue`
    // above and don't reach this point). Recovery = success-after-error
    // within the same chain.
    if (chainStats) {
      chainStats.toolCallCount++;
      const wasVerificationCall = isVerificationToolCall(toolName, tc.function.arguments);
      if (result.isError) {
        chainStats.sawToolError = true;
      } else if (chainStats.sawToolError) {
        chainStats.sawToolRecovery = true;
      }
      if (wasVerificationCall && chainStats.editCountSinceVerification > 0) {
        chainStats.verificationAttemptedSinceEdit = true;
        if (!result.isError) {
          chainStats.pendingEditFiles.clear();
          chainStats.editCountSinceVerification = 0;
          chainStats.verificationGatePrompted = false;
        }
      } else if (!result.isError) {
        const editedTargets = editTargetsForStateTracking;
        if (editedTargets.length > 0) {
          for (const target of editedTargets) chainStats.pendingEditFiles.add(target);
          chainStats.editCountSinceVerification++;
          chainStats.verificationAttemptedSinceEdit = false;
          chainStats.verificationGatePrompted = false;
          if (!ctx.config.dryRun) {
            queueRecoveryReminders(chainStats, recordFileEditStates(
              ctx.cwd,
              editedTargets,
              chainStats.fileEditStates,
              beforeEditStates,
            ));
          }
        }
      }
      const outputText = modelOutput;
      if (isTimeoutObservation(outputText)) {
        queueRecoveryReminders(chainStats, [
          buildRecoveryReminder(toolName, tc.function.arguments, outputText, 'timeout'),
        ]);
      }
    }

    // ── Post-tool hook ────────────────────────────────────
    await runHooks({
      event: 'PostToolUse',
      toolName,
      toolInput: input,
      // Defensively coerce to string — some tool implementations may
      // return non-string output (Buffer, object, undefined) and the
      // raw .slice would throw, killing the chain after the tool
      // already ran. Matches the same coercion pattern used by the
      // __lastToolCall stash above.
      toolOutput: modelOutput.slice(0, 1000),
      sessionId: ctx.sessionId,
      cwd: ctx.cwd,
      permissionMode: ctx.config.permissionMode,
    });

    results.push({
      role: 'tool',
      tool_call_id: tc.id,
      content: modelOutput,
    });
  }

  return results;
}

function formatArgs(tool: Tool, input: Record<string, unknown>): string {
  switch (tool.name) {
    case 'bash':
      return `$ ${input.command}`;
    case 'read_file':
      return String(input.file_path);
    case 'write_file':
      return String(input.file_path);
    case 'edit_file':
      return String(input.file_path);
    case 'grep':
      return `/${input.pattern}/${input.path ? ` in ${input.path}` : ''}`;
    case 'glob':
      return String(input.pattern);
    case 'list_dir':
      return String(input.path || '.');
    case 'web_fetch':
      return String(input.url);
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}
